#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { runSiteAudit } from '../dist/crawler.js';

const iterations = Number(process.env.CRAWL_BENCH_ITERATIONS || 10);
const concurrency = Number(process.env.CRAWL_BENCH_CONCURRENCY || 2);
const maxPages = Number(process.env.CRAWL_BENCH_MAX_PAGES || 3);

// In-memory simulated realistic multi-page site
const pages = {
  'https://benchmark.example.com/robots.txt': {
    status: 200,
    headers: { 'content-type': 'text/plain' },
    body: 'User-agent: *\nAllow: /\nSitemap: https://benchmark.example.com/sitemap.xml\n',
  },
  'https://benchmark.example.com/sitemap.xml': {
    status: 200,
    headers: { 'content-type': 'application/xml' },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://benchmark.example.com/</loc></url>
  <url><loc>https://benchmark.example.com/features</loc></url>
  <url><loc>https://benchmark.example.com/pricing</loc></url>
</urlset>`,
  },
  'https://benchmark.example.com/': {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Benchmark Example Home - Fast, Reliable SEO Testing</title>
  <meta name="description" content="Realistic HTML benchmark fixture page with high quality meta tags and links.">
  <link rel="canonical" href="https://benchmark.example.com/">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Benchmark"}</script>
</head>
<body>
  <h1>Welcome to the Benchmark Target</h1>
  <p>Testing realistic crawling performance and parser speed.</p>
  <img src="/logo.png" alt="Benchmark Logo">
  <a href="/features">Features</a>
  <a href="/pricing">Pricing</a>
</body>
</html>`,
  },
  'https://benchmark.example.com/features': {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Features - Benchmark Suite Capabilities</title>
  <meta name="description" content="Detailed features list for performance benchmarking and load audits.">
  <link rel="canonical" href="https://benchmark.example.com/features">
</head>
<body>
  <h1>Features Overview</h1>
  <p>Exploring automated auditing, DNS pinning, and rate limits.</p>
  <a href="/">Home</a>
  <a href="/pricing">Pricing</a>
</body>
</html>`,
  },
  'https://benchmark.example.com/pricing': {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Pricing Plans - Benchmark Suite</title>
  <meta name="description" content="Transparent pricing tiers for self-hosted SEO intelligence.">
  <link rel="canonical" href="https://benchmark.example.com/pricing">
</head>
<body>
  <h1>Pricing Plans</h1>
  <p>Choose the tier that fits your team's workflow.</p>
  <a href="/">Home</a>
  <a href="/features">Features</a>
</body>
</html>`,
  },
};

const mockResolver = async () => [{ address: '93.184.216.34', family: 4 }];
const mockRequester = async (url) => {
  const page = pages[url.href];
  if (!page) {
    return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
  return new Response(page.body, { status: page.status, headers: page.headers });
};

const deps = { resolver: mockResolver, requester: mockRequester };

const latencies = [];
let failures = 0;
let totalPagesScanned = 0;
let next = 0;

if (global.gc) global.gc();
const memStart = process.memoryUsage();
const startedAt = new Date().toISOString();
const start = performance.now();

async function worker() {
  while (true) {
    const idx = next++;
    if (idx >= iterations) return;
    const t0 = performance.now();
    try {
      const report = await runSiteAudit('https://benchmark.example.com/', {
        maxPages,
        safeFetchDependencies: deps,
      });
      const elapsed = performance.now() - t0;
      latencies.push(elapsed);
      totalPagesScanned += report.scannedPagesCount;
      if (!report || report.scannedPagesCount === 0) failures += 1;
    } catch {
      latencies.push(performance.now() - t0);
      failures += 1;
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, iterations) }, worker));

const elapsedMs = performance.now() - start;
const memEnd = process.memoryUsage();
latencies.sort((a, b) => a - b);
const percentile = p => latencies.length ? Number(latencies[Math.min(latencies.length - 1, Math.ceil(p * latencies.length) - 1)].toFixed(2)) : null;

const result = {
  benchmark: 'open-semrush-crawl-benchmark-v1',
  startedAt,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  iterations,
  concurrency: Math.min(concurrency, iterations),
  maxPagesPerCrawl: maxPages,
  totalPagesScanned,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  crawlsPerSecond: Number((iterations / (elapsedMs / 1000)).toFixed(2)),
  pagesPerSecond: Number((totalPagesScanned / (elapsedMs / 1000)).toFixed(2)),
  latencyMs: {
    p50: percentile(0.50),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: latencies.length ? Number(latencies.at(-1).toFixed(2)) : null,
  },
  memoryUsageMb: {
    heapUsedDelta: Number(((memEnd.heapUsed - memStart.heapUsed) / (1024 * 1024)).toFixed(2)),
    heapTotalFinal: Number((memEnd.heapTotal / (1024 * 1024)).toFixed(2)),
    rssFinal: Number((memEnd.rss / (1024 * 1024)).toFixed(2)),
  },
  failures,
  note: 'Deterministic, verified end-to-end multi-page crawl and parser benchmark using in-memory public mock responder; measures parser, SEO evaluation, robots/sitemap discovery, and crawl concurrency without external network noise.',
};

console.log(JSON.stringify(result, null, 2));
if (failures > 0) process.exitCode = 1;
