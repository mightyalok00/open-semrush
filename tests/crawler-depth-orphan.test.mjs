import test from 'node:test';
import assert from 'node:assert/strict';
import { runSiteAudit } from '../dist/index.js';

test('runSiteAudit calculates click depth and detects orphan pages', async () => {
  // Page graph:
  // Root (/) links to /linked-page
  // /orphan-page is listed in sitemap but never linked by any page
  const pages = {
    'https://example.com/robots.txt': {
      status: 200,
      body: 'Sitemap: https://example.com/sitemap.xml\n',
    },
    'https://example.com/sitemap.xml': {
      status: 200,
      body: `
        <urlset>
          <url><loc>https://example.com/</loc></url>
          <url><loc>https://example.com/linked-page</loc></url>
          <url><loc>https://example.com/orphan-page</loc></url>
        </urlset>
      `,
    },
    'https://example.com/': {
      status: 200,
      body: `
        <html>
          <head><title>Root Page Title with Good Length Character Bounds</title></head>
          <body>
            <h1>Root Header</h1>
            <a href="/linked-page">Go to linked page</a>
          </body>
        </html>
      `,
    },
    'https://example.com/linked-page': {
      status: 200,
      body: `
        <html>
          <head><title>Linked Subpage Title with Length Character Bounds</title></head>
          <body>
            <h1>Linked Subpage</h1>
          </body>
        </html>
      `,
    },
    'https://example.com/orphan-page': {
      status: 200,
      body: `
        <html>
          <head><title>Orphan Page Title with Good Length Character Bounds</title></head>
          <body>
            <h1>Orphan Page</h1>
          </body>
        </html>
      `,
    },
  };

  const mockResolver = async () => [{ address: '93.184.216.34', family: 4 }];
  const mockRequester = async (url) => {
    const p = pages[url.href];
    if (!p) return new Response('Not found', { status: 404 });
    return new Response(p.body, { status: p.status, headers: { 'content-type': 'text/html' } });
  };
  const deps = { resolver: mockResolver, requester: mockRequester };

  const report = await runSiteAudit('https://example.com/', { maxPages: 5, safeFetchDependencies: deps });

  assert.equal(report.scannedPagesCount, 3);

  const rootPage = report.pages.find(p => p.url === 'https://example.com/');
  const linkedPage = report.pages.find(p => p.url === 'https://example.com/linked-page');
  const orphanPage = report.pages.find(p => p.url === 'https://example.com/orphan-page');

  assert.ok(rootPage, 'Root page must be present');
  assert.ok(linkedPage, 'Linked page must be present');
  assert.ok(orphanPage, 'Orphan page must be present');

  // Verify click depth
  assert.equal(rootPage.clickDepth, 0);
  assert.equal(linkedPage.clickDepth, 1);
  assert.equal(rootPage.isOrphan, false);
  assert.equal(linkedPage.isOrphan, false);

  // Verify orphan detection
  assert.equal(orphanPage.isOrphan, true);
  const orphanIssue = orphanPage.issues.find(i => i.code === 'ORPHAN_PAGE');
  assert.ok(orphanIssue, 'Orphan page must contain ORPHAN_PAGE issue');
  assert.equal(orphanIssue.severity, 'warning');
  assert.equal(orphanIssue.evidence.observed, 0);
});
