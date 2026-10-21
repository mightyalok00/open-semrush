#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { runSiteAudit } from '../dist/crawler.js';

// Parse command line arguments and environment variables
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return process.env[`CRAWL_BENCH_${name.toUpperCase()}`] || fallback;
}
const isMatrix = args.includes('--matrix') || process.env.CRAWL_BENCH_MATRIX === 'true';
const iterations = Number(getArg('iterations', 25));
const concurrency = Number(getArg('concurrency', 2));
const maxPages = Number(getArg('pages', 3));
const mode = getArg('mode', process.env.CRAWL_BENCH_MODE || (process.env.CRAWL_TARGET_URL ? 'real' : 'simulated'));
const targetUrl = process.env.CRAWL_TARGET_URL || (mode === 'real' ? 'https://example.com/' : 'https://benchmark.example.com/');

// In-memory simulated realistic 10-page site graph with sitemap and robots.txt
const simulatedPages = {
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
  <url><loc>https://benchmark.example.com/about</loc></url>
  <url><loc>https://benchmark.example.com/blog</loc></url>
  <url><loc>https://benchmark.example.com/blog/post-1</loc></url>
  <url><loc>https://benchmark.example.com/docs</loc></url>
  <url><loc>https://benchmark.example.com/docs/api</loc></url>
  <url><loc>https://benchmark.example.com/contact</loc></url>
  <url><loc>https://benchmark.example.com/privacy</loc></url>
</urlset>`,
  },
  'https://benchmark.example.com/': {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Benchmark Example Home</title><meta name="description" content="Realistic SEO benchmark target."><link rel="canonical" href="https://benchmark.example.com/"><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Benchmark"}</script></head><body><h1>Home</h1><p>Home content</p><a href="/features">Features</a><a href="/pricing">Pricing</a><a href="/about">About</a></body></html>`,
  },
  'https://benchmark.example.com/features': {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Features - Capabilities</title><meta name="description" content="Performance features."><link rel="canonical" href="https://benchmark.example.com/features"></head><body><h1>Features</h1><a href="/">Home</a><a href="/pricing">Pricing</a><a href="/docs">Docs</a></body></html>`,
  },
  'https://benchmark.example.com/pricing': {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Pricing - Tiers</title><meta name="description" content="Transparent pricing tiers."><link rel="canonical" href="https://benchmark.example.com/pricing"></head><body><h1>Pricing</h1><a href="/contact">Contact</a><a href="/features">Features</a></body></html>`,
  },
  'https://benchmark.example.com/about': {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>About Us</title><meta name="description" content="About our team."></head><body><h1>About</h1><a href="/blog">Blog</a><a href="/contact">Contact</a></body></html>`,
  },
  'https://benchmark.example.com/blog': {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Engineering Blog</title><meta name="description" content="Technical articles."></head><body><h1>Blog</h1><a href="/blog/post-1">Post 1</a><a href="/">Home</a></body></html>`,
  },
  'https://benchmark.example.com/blog/post-1': {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Deep-Dive Article</title><meta name="description" content="Audit deep-dive article."></head><body><h1>Post 1</h1><a href="/blog">Blog</a><a href="/docs">Docs</a></body></html>`,
  },
  'https://benchmark.example.com/docs': {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Documentation Overview</title><meta name="description" content="Technical docs."></head><body><h1>Docs</h1><a href="/docs/api">API</a><a href="/">Home</a></body></html>`,
  },
  'https://benchmark.example.com/docs/api': {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>API Reference</title><meta name="description" content="REST API endpoints."></head><body><h1>API</h1><a href="/docs">Docs</a><a href="/pricing">Pricing</a></body></html>`,
  },
  'https://benchmark.example.com/contact': {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Contact Support</title><meta name="description" content="Reach our support team."></head><body><h1>Contact</h1><a href="/privacy">Privacy</a></body></html>`,
  },
  'https://benchmark.example.com/privacy': {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Privacy Policy</title><meta name="description" content="Privacy commitment."></head><body><h1>Privacy</h1><a href="/">Home</a></body></html>`,
  },
};

const mockResolver = async () => [{ address: '93.184.216.34', family: 4 }];
const mockRequester = async (url) => {
  const page = simulatedPages[url.href];
  if (!page) {
    return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
  return new Response(page.body, { status: page.status, headers: page.headers });
};

const deps = mode === 'simulated' ? { resolver: mockResolver, requester: mockRequester } : undefined;

async function executeCrawlRun(target, maxPagesCount, concurrencyLevel, totalRuns) {
  const latencies = [];
  let failures = 0;
  let timeouts = 0;
  let totalPagesScanned = 0;
  let next = 0;

  if (global.gc) global.gc();
  const memStart = process.memoryUsage();
  const startedAt = new Date().toISOString();
  const start = performance.now();

  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= totalRuns) return;
      const t0 = performance.now();
      try {
        const report = await runSiteAudit(target, {
          maxPages: maxPagesCount,
          safeFetchDependencies: deps,
        });
        const elapsed = performance.now() - t0;
        latencies.push(elapsed);
        totalPagesScanned += report.scannedPagesCount;
        if (!report || report.scannedPagesCount === 0) failures += 1;
      } catch (err) {
        const elapsed = performance.now() - t0;
        latencies.push(elapsed);
        failures += 1;
        if (err && (String(err).includes('timeout') || elapsed >= 15_000)) {
          timeouts += 1;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrencyLevel, totalRuns) }, worker));

  const elapsedMs = performance.now() - start;
  const memEnd = process.memoryUsage();
  latencies.sort((a, b) => a - b);
  const percentile = p => latencies.length ? Number(latencies[Math.min(latencies.length - 1, Math.ceil(p * latencies.length) - 1)].toFixed(2)) : null;

  return {
    targetUrl: target,
    startedAt,
    iterations: totalRuns,
    concurrency: Math.min(concurrencyLevel, totalRuns),
    maxPagesPerCrawl: maxPagesCount,
    totalPagesScanned,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    crawlsPerSecond: Number((totalRuns / (elapsedMs / 1000)).toFixed(2)),
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
    timeouts,
    failures,
  };
}

if (!isMatrix) {
  const result = await executeCrawlRun(targetUrl, maxPages, concurrency, iterations);
  console.log(JSON.stringify({
    benchmark: 'open-semrush-crawl-benchmark-v1',
    mode,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    ...result,
    note: mode === 'real'
      ? 'Real-world live network crawl benchmark measuring real DNS resolution, TLS handshakes, socket transfers, HTML parsing and audit evaluations.'
      : 'Deterministic multi-page crawl benchmark using in-memory public mock responder to measure parser and signal evaluation speed.',
  }, null, 2));

  if (result.failures > 0) process.exitCode = 1;
} else {
  // Matrix benchmark across page counts and concurrency levels
  const pageConfigs = [1, 3, 5, 10];
  const concurrencyConfigs = [1, 2, 4, 8];
  const runsPerConfig = mode === 'real' ? 5 : 20;

  console.log(`Starting Crawl Benchmark Matrix (mode=${mode}, runsPerConfig=${runsPerConfig})...`);
  const matrixResults = [];

  for (const p of pageConfigs) {
    for (const c of concurrencyConfigs) {
      const res = await executeCrawlRun(targetUrl, p, c, runsPerConfig);
      matrixResults.push({
        pages: p,
        concurrency: c,
        crawlsPerSec: res.crawlsPerSecond,
        pagesPerSec: res.pagesPerSecond,
        p50Ms: res.latencyMs.p50,
        p95Ms: res.latencyMs.p95,
        p99Ms: res.latencyMs.p99,
        heapDeltaMb: res.memoryUsageMb.heapUsedDelta,
        rssMb: res.memoryUsageMb.rssFinal,
        failures: res.failures,
        timeouts: res.timeouts,
      });
    }
  }

  const output = {
    benchmark: 'open-semrush-crawl-matrix-v1',
    mode,
    targetUrl,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    runsPerConfig,
    results: matrixResults,
  };

  console.log(JSON.stringify(output, null, 2));
}
