import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

function boundedIntegerEnv(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}
const WINDOW_MS = boundedIntegerEnv('API_RATE_LIMIT_WINDOW_MS', 60_000, 1_000, 3_600_000);
const MAX_REQUESTS = boundedIntegerEnv('API_RATE_LIMIT_MAX', 120, 1, 100_000);
const MAX_EXPENSIVE_REQUESTS = boundedIntegerEnv('API_RATE_LIMIT_EXPENSIVE_MAX', 10, 1, 10_000);
const MAX_TRACKED_CLIENTS = 10_000;

export class MemoryRateLimiterStore {
  constructor(maxClients = MAX_TRACKED_CLIENTS, windowMs = WINDOW_MS) {
    this.maxClients = maxClients;
    this.windowMs = windowMs;
    this.buckets = new Map();
  }

  getBucket(key, now) {
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.start >= this.windowMs) {
      bucket = { start: now, total: 0, expensive: 0, touched: now };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  recordRequest(key, now, expensive) {
    const bucket = this.getBucket(key, now);
    bucket.total += 1;
    bucket.touched = now;
    if (expensive) bucket.expensive += 1;

    if (this.buckets.size > this.maxClients) {
      for (const [k, v] of this.buckets) {
        if (now - v.touched >= this.windowMs) this.buckets.delete(k);
        if (this.buckets.size <= this.maxClients) break;
      }
      if (this.buckets.size > this.maxClients) {
        return { isFull: true, bucket };
      }
    }
    return { isFull: false, bucket };
  }

  clear() {
    this.buckets.clear();
  }
}

export const defaultRateLimiterStore = new MemoryRateLimiterStore(MAX_TRACKED_CLIENTS, WINDOW_MS);

const protectedPath = (method, pathname) =>
  (method === 'POST' && (pathname === '/api/audit' || pathname.startsWith('/api/ai/'))) ||
  (method === 'GET' && ['/api/search-console', '/api/projects', '/api/history'].includes(pathname));

const expensivePath = (method, pathname) =>
  (method === 'POST' && (pathname === '/api/audit' || pathname.startsWith('/api/ai/'))) ||
  (method === 'GET' && pathname === '/api/search-console');

function equalSecret(provided, expected) {
  if (!provided || !expected) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function getValidTokens() {
  const raw = [process.env.OPEN_SEMRUSH_API_TOKEN, process.env.OPEN_SEMRUSH_API_TOKENS]
    .filter(Boolean)
    .join(',');
  return raw
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
}

export function cleanIpCandidate(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let str = raw.trim();
  if (/^(\d{1,3}\.){3}\d{1,3}:\d+$/.test(str)) {
    str = str.replace(/:\d+$/, '');
  }
  if (/^\[([a-f0-9:]+)\]:\d+$/i.test(str)) {
    str = str.replace(/^\[|\]:\d+$/g, '');
  }
  str = str.split('%')[0] || str;
  return isIP(str) !== 0 ? str : '';
}

export function parseClientIp(req, trustHops = boundedIntegerEnv('TRUST_PROXY_HOPS', 0, 0, 10)) {
  const remote = cleanIpCandidate(req.socket?.remoteAddress) || req.socket?.remoteAddress || 'unknown';
  if (trustHops > 0 && req.headers?.['x-forwarded-for']) {
    const raw = String(req.headers['x-forwarded-for']);
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= trustHops) {
      const candidate = cleanIpCandidate(parts[parts.length - trustHops]);
      if (candidate) return candidate;
    } else if (parts.length > 0) {
      const candidate = cleanIpCandidate(parts[0]);
      if (candidate) return candidate;
    }
  }
  return remote;
}

function clientKey(req) {
  return parseClientIp(req);
}

/** Returns null on success or an HTTP response description on rejection. */
export function checkProductionControls(req, pathname, now = Date.now(), store = defaultRateLimiterStore) {
  // Keep container/orchestrator liveness probes available during application traffic spikes.
  if (pathname === '/api/health') return null;
  const tokens = getValidTokens();
  const isProtected = protectedPath(req.method || 'GET', pathname);
  const key = clientKey(req);
  const expensive = expensivePath(req.method || 'GET', pathname);

  const { isFull, bucket } = store.recordRequest(key, now, expensive);
  if (isFull) {
    return { status: 503, headers: { 'Retry-After': '60' }, body: { error: 'Rate limiter capacity reached; retry shortly.' } };
  }

  const limit = expensive ? MAX_EXPENSIVE_REQUESTS : MAX_REQUESTS;
  const used = expensive ? bucket.expensive : bucket.total;
  if (used > limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.start + WINDOW_MS - now) / 1000));
    return { status: 429, headers: { 'Retry-After': String(retryAfter), 'RateLimit-Limit': String(limit), 'RateLimit-Remaining': '0' }, body: { error: 'Request rate limit exceeded.', retryAfterSeconds: retryAfter } };
  }


  if (isProtected) {
    if (tokens.length === 0 && process.env.NODE_ENV === 'production') {
      return { status: 503, body: { error: 'Protected API routes are disabled until OPEN_SEMRUSH_API_TOKEN is configured.' } };
    }
    if (tokens.length > 0) {
      const header = String(req.headers?.authorization || '');
      const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      const matched = tokens.some(token => equalSecret(provided, token));
      if (!matched) {
        return { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="open-semrush"' }, body: { error: 'A valid bearer token is required for this endpoint.' } };
      }
    }
  }
  return null;
}

export function resetRateLimitsForTests() {
  defaultRateLimiterStore.clear();
}


