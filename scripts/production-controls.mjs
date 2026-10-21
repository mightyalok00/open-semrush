import { createHash, timingSafeEqual } from 'node:crypto';

const WINDOW_MS = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60_000);
const MAX_REQUESTS = Number(process.env.API_RATE_LIMIT_MAX || 120);
const MAX_EXPENSIVE_REQUESTS = Number(process.env.API_RATE_LIMIT_EXPENSIVE_MAX || 10);
const MAX_TRACKED_CLIENTS = 10_000;
const buckets = new Map();

const protectedPath = (method, pathname) =>
  (method === 'POST' && (pathname === '/api/audit' || pathname.startsWith('/api/ai/'))) ||
  (method === 'GET' && pathname === '/api/search-console');

function equalSecret(provided, expected) {
  if (!provided || !expected) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function clientKey(req) {
  // Do not trust X-Forwarded-For unless a trusted reverse proxy has normalized it.
  return req.socket?.remoteAddress || 'unknown';
}

/** Returns null on success or an HTTP response description on rejection. */
export function checkProductionControls(req, pathname, now = Date.now()) {
  const token = process.env.OPEN_SEMRUSH_API_TOKEN;
  if (protectedPath(req.method || 'GET', pathname)) {
    if (!token && process.env.NODE_ENV === 'production') {
      return { status: 503, body: { error: 'Protected API routes are disabled until OPEN_SEMRUSH_API_TOKEN is configured.' } };
    }
    if (token) {
      const header = String(req.headers?.authorization || '');
      const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!equalSecret(provided, token)) {
        return { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="open-semrush"' }, body: { error: 'A valid bearer token is required for this endpoint.' } };
      }
    }
  }

  const key = clientKey(req);
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    bucket = { start: now, total: 0, expensive: 0, touched: now };
    buckets.set(key, bucket);
  }
  bucket.total += 1;
  bucket.touched = now;
  const expensive = protectedPath(req.method || 'GET', pathname);
  if (expensive) bucket.expensive += 1;

  if (buckets.size > MAX_TRACKED_CLIENTS) {
    for (const [k, v] of buckets) {
      if (now - v.touched >= WINDOW_MS) buckets.delete(k);
      if (buckets.size <= MAX_TRACKED_CLIENTS) break;
    }
    if (buckets.size > MAX_TRACKED_CLIENTS) {
      return { status: 503, headers: { 'Retry-After': '60' }, body: { error: 'Rate limiter capacity reached; retry shortly.' } };
    }
  }

  const limit = expensive ? MAX_EXPENSIVE_REQUESTS : MAX_REQUESTS;
  const used = expensive ? bucket.expensive : bucket.total;
  if (used > limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.start + WINDOW_MS - now) / 1000));
    return { status: 429, headers: { 'Retry-After': String(retryAfter), 'RateLimit-Limit': String(limit), 'RateLimit-Remaining': '0' }, body: { error: 'Request rate limit exceeded.', retryAfterSeconds: retryAfter } };
  }
  return null;
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
