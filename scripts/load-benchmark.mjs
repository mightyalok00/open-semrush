#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

const baseUrl = (process.env.LOAD_TEST_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const mode = process.env.LOAD_TEST_MODE || 'api';
const iterations = Number(process.env.LOAD_TEST_ITERATIONS || (mode === 'crawl' ? 10 : 200));
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY || (mode === 'crawl' ? 2 : 10));
const token = process.env.OPEN_SEMRUSH_API_TOKEN || '';
const targetUrl = process.env.LOAD_TEST_TARGET_URL || '';
const confirmation = process.env.LOAD_TEST_CONFIRM || '';

if (!['api', 'crawl'].includes(mode)) throw new Error('LOAD_TEST_MODE must be api or crawl.');
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10000) throw new Error('LOAD_TEST_ITERATIONS must be an integer from 1 to 10000.');
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) throw new Error('LOAD_TEST_CONCURRENCY must be an integer from 1 to 50.');
if (mode === 'crawl' && (!targetUrl || confirmation !== 'I_OWN_OR_HAVE_PERMISSION')) {
  throw new Error('Crawl mode requires LOAD_TEST_TARGET_URL and LOAD_TEST_CONFIRM=I_OWN_OR_HAVE_PERMISSION. Only test a site you own or have explicit permission to load-test.');
}
if (mode === 'crawl' && !token) throw new Error('Crawl mode requires OPEN_SEMRUSH_API_TOKEN for the protected audit endpoint.');

const latencies = [];
const statuses = {};
let failures = 0;
let next = 0;
const start = performance.now();

async function worker() {
  while (true) {
    const index = next++;
    if (index >= iterations) return;
    const url = mode === 'crawl'
      ? new URL('/api/audit', baseUrl)
      : new URL('/api/keyword?q=technical%20seo%20audit%20' + (index % 17), baseUrl);
    const init = mode === 'crawl'
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ url: targetUrl, maxPages: 3 }) }
      : {};
    const t0 = performance.now();
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      const elapsed = performance.now() - t0;
      latencies.push(elapsed);
      statuses[response.status] = (statuses[response.status] || 0) + 1;
      await response.arrayBuffer();
      if (!response.ok) failures += 1;
    } catch {
      latencies.push(performance.now() - t0);
      failures += 1;
      statuses.network_error = (statuses.network_error || 0) + 1;
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, iterations) }, worker));
const elapsedMs = performance.now() - start;
latencies.sort((a, b) => a - b);
const percentile = p => latencies.length ? Number(latencies[Math.min(latencies.length - 1, Math.ceil(p * latencies.length) - 1)].toFixed(2)) : null;
const result = {
  benchmark: 'open-semrush-http-load-v1',
  mode,
  startedAt: new Date().toISOString(),
  baseUrl,
  targetUrl: mode === 'crawl' ? targetUrl : undefined,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  iterations,
  concurrency: Math.min(concurrency, iterations),
  elapsedMs: Number(elapsedMs.toFixed(2)),
  requestsPerSecond: Number((iterations / (elapsedMs / 1000)).toFixed(2)),
  latencyMs: { p50: percentile(0.50), p95: percentile(0.95), p99: percentile(0.99), max: latencies.length ? Number(latencies.at(-1).toFixed(2)) : null },
  failures,
  statuses,
  note: mode === 'crawl'
    ? 'Opt-in crawl load test against an explicitly authorized target; results include remote network and target-site latency.'
    : 'HTTP endpoint load test only; it is not a crawl-throughput result and does not contact a third-party SEO provider.'
};
console.log(JSON.stringify(result, null, 2));
if (failures > 0) process.exitCode = 1;
