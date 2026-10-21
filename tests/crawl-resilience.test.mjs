import test from 'node:test';
import assert from 'node:assert/strict';
import { runSiteAudit, auditSinglePage } from '../dist/crawler.js';

test('Crawler Resilience: Handles slow servers and aborts when timeout is exceeded', async () => {
  const slowDeps = {
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    requester: async (_url, _address, _family, init) => {
      // Simulate slow server with delayed response that respects abort signal
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(new Response('<!DOCTYPE html><html><head><title>Delayed</title></head><body>Delayed</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }));
        }, 200);

        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('The operation was aborted due to timeout'));
          });
        }
      });
    },
  };

  // With a 50ms timeout, the request should fail gracefully without hanging
  const result = await auditSinglePage('https://example.com/slow', 50, 'TestBot', slowDeps);
  assert.equal(result.statusCode, 0);
  assert.ok(result.issues.some(i => i.code === 'FETCH_FAILED' && i.severity === 'error'));
});

test('Crawler Resilience: Parses unusual and malformed HTML without crashing', async () => {
  // Extreme, unclosed, deeply nested HTML with emojis, huge attributes, and broken tags
  const weirdHtml = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <title>日本語タイトル 🚀 &amp; Deep Nesting Test</title>
      <meta name="description" content="Detailed meta description with emoji 🔥 and unescaped quotes inside attribute value & special characters: <>&'\\\"">
      <link rel="canonical" href="https://example.com/weird-path?param=1&amp;tag=テスト#section">
    </head>
    <body class="${'a'.repeat(5000)}">
      <h1>Main Heading with <span>Inline Elements</span> and Emoji ⚡</h1>
      ${'<div>'.repeat(60)}
        <p>Deeply nested paragraph with UTF-8: こんにちは世界, Привет мир, مرحبا بالعالم</p>
      ${'</div>'.repeat(60)}
      <!-- Unclosed image tags and malformed attributes -->
      <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="Data URI test">
      <img src="/broken-quote.jpg alt="missing quote>
      <img src="/no-alt.png">
      <!-- Strange links -->
      <a href="javascript:void(0)">JS Void</a>
      <a href="mailto:support@example.com">Email link</a>
      <a href="#section-top">Anchor fragment</a>
      <a href="/valid-internal-1">Valid internal 1</a>
      <a href="https://other-domain.com/ext">External link</a>
      <a href="//example.com/protocol-rel">Protocol relative</a>
  `; // Deliberately omit </body> and </html>

  const deps = {
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    requester: async () => new Response(weirdHtml, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'strict-transport-security': 'max-age=31536000',
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'SAMEORIGIN',
      },
    }),
  };

  const result = await auditSinglePage('https://example.com/weird', 5000, 'TestBot', deps);

  assert.equal(result.statusCode, 200);
  assert.ok(result.title.includes('日本語タイトル 🚀'));
  assert.equal(result.h1Count, 1);
  assert.equal(result.canonical, 'https://example.com/weird-path?param=1&amp;tag=テスト#section');
  assert.equal(result.imagesTotal, 3);
  assert.ok(result.imagesMissingAlt >= 1);
  assert.ok(result.internalLinksCount >= 1);
  assert.ok(result.externalLinksCount >= 1);
});

test('Crawler Resilience: Enforces explicit page limits and de-duplicates when encountering massive sitemaps', async () => {
  // Generate a massive sitemap containing 1,000 URLs
  const sitemapUrls = Array.from({ length: 1000 }, (_, i) => `<url><loc>https://example.com/page-${i + 1}</loc></url>`).join('\n');
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapUrls}</urlset>`;

  const dummyPage = (idx) => `<!DOCTYPE html><html lang="en"><head><title>Page ${idx}</title><meta name="description" content="Description for page ${idx} with sufficient length to pass validation."></head><body><h1>Page ${idx}</h1><a href="/page-1">Duplicate Link</a><a href="/page-${idx + 1}">Next Page</a></body></html>`;

  const deps = {
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    requester: async (reqUrl) => {
      const urlStr = reqUrl.href;
      if (urlStr.endsWith('/robots.txt')) {
        return new Response('User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n', { status: 200 });
      }
      if (urlStr.endsWith('/sitemap.xml')) {
        return new Response(sitemapXml, { status: 200, headers: { 'content-type': 'application/xml' } });
      }
      return new Response(dummyPage(1), { status: 200, headers: { 'content-type': 'text/html' } });
    },
  };

  // Run audit with strict maxPages resource limit of 5
  const memBefore = process.memoryUsage().heapUsed;
  const auditReport = await runSiteAudit('https://example.com/', {
    maxPages: 5,
    concurrency: 2,
    safeFetchDependencies: deps,
  });
  const memAfter = process.memoryUsage().heapUsed;

  // Verify bounded resource limits
  assert.equal(auditReport.scannedPagesCount, 5, 'Must strictly stop at maxPages limit of 5');
  assert.equal(auditReport.pages.length, 5, 'Must not retain unbounded pages');
  assert.ok(auditReport.healthScore >= 0 && auditReport.healthScore <= 100);

  // Heap increase must be strictly bounded (< 25 MB)
  const heapDeltaMb = (memAfter - memBefore) / (1024 * 1024);
  assert.ok(heapDeltaMb < 25, `Heap delta must stay bounded under massive sitemaps, got ${heapDeltaMb.toFixed(2)} MB`);
});

test('Crawler Resilience: Flags heavy payload sizes as warnings', async () => {
  // Generate HTML exceeding 250 KB threshold
  const hugeBody = '<p>' + 'Large content chunk repeated for testing payload limits. '.repeat(5000) + '</p>';
  const hugeHtml = `<!DOCTYPE html><html><head><title>Huge Page</title><meta name="description" content="Valid meta description for large content payload test."></head><body><h1>Heavy Page</h1>${hugeBody}</body></html>`;

  const deps = {
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    requester: async () => new Response(hugeHtml, {
      status: 200,
      headers: {
        'content-type': 'text/html',
        'strict-transport-security': 'max-age=31536000',
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'SAMEORIGIN',
      },
    }),
  };

  const result = await auditSinglePage('https://example.com/huge', 5000, 'TestBot', deps);
  assert.equal(result.statusCode, 200);
  assert.ok(result.pageSizeKb > 250);
  assert.ok(result.issues.some(i => i.code === 'HEAVY_PAGE_SIZE' && i.severity === 'warning'));
});
