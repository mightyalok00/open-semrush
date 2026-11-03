import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeHydrationDiff,
  EmulatedBrowserRenderer,
  runRenderedAudit,
} from '../dist/rendering-crawler.js';

test('Rendering Pipeline: computeHydrationDiff detects canonical conflicts & dynamic noindex', () => {
  const rawHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Server Side Rendered Title</title>
        <link rel="canonical" href="https://example.com/original-canonical" />
        <meta name="robots" content="index, follow" />
      </head>
      <body>
        <p>Loading application...</p>
      </body>
    </html>
  `;

  const renderedHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Client Hydrated Title - Brand</title>
        <link rel="canonical" href="https://example.com/altered-canonical" />
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <body>
        <h1>Dynamic Client Heading</h1>
        <p>Full content loaded after JavaScript runs.</p>
        <a href="/client-link-1">Page 1</a>
        <a href="/client-link-2">Page 2</a>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Widget Pro"
          }
        </script>
      </body>
    </html>
  `;

  const diff = computeHydrationDiff(rawHtml, renderedHtml, 'https://example.com');

  assert.equal(diff.titleChanged, true);
  assert.equal(diff.rawTitle, 'Server Side Rendered Title');
  assert.equal(diff.renderedTitle, 'Client Hydrated Title - Brand');

  assert.equal(diff.canonicalConflict, true);
  assert.equal(diff.rawCanonical, 'https://example.com/original-canonical');
  assert.equal(diff.renderedCanonical, 'https://example.com/altered-canonical');

  assert.equal(diff.dynamicNoindexInjected, true);
  assert.equal(diff.clientOnlyHeadings.length, 1);
  assert.equal(diff.clientOnlyHeadings[0], 'Dynamic Client Heading');
  assert.equal(diff.clientOnlyLinksCount, 2);
  assert.ok(diff.jsRenderedContentPercentage > 0);
});

test('Rendering Pipeline: runRenderedAudit flags high-severity JavaScript SEO issues', async () => {
  const mockRawHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title></title>
        <link rel="canonical" href="https://example.com/good" />
      </head>
      <body>
        <div id="app"></div>
      </body>
    </html>
  `;

  const mockRenderedHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Rendered App</title>
        <link rel="canonical" href="https://example.com/bad-redirect" />
        <meta name="robots" content="noindex" />
      </head>
      <body>
        <h1>Welcome</h1>
        <script type="application/ld+json">
          {
            "@context": "invalid-context",
            "@type": "Thing"
          }
        </script>
      </body>
    </html>
  `;

  const customRenderer = new EmulatedBrowserRenderer(() => mockRenderedHtml);

  const customFetch = async () => ({
    status: 200,
    text: async () => mockRawHtml,
  });

  const report = await runRenderedAudit('https://example.com', {
    renderer: customRenderer,
    customFetch,
  });

  assert.equal(report.url, 'https://example.com');
  assert.equal(report.httpStatus, 200);
  assert.equal(report.renderEngine, 'playwright');

  const issueCodes = report.issues.map(i => i.code);
  assert.ok(issueCodes.includes('JS_CANONICAL_CONFLICT'), 'Must flag canonical conflict');
  assert.ok(issueCodes.includes('JS_NOINDEX_INJECTION'), 'Must flag dynamic noindex');
  assert.ok(issueCodes.includes('CLIENT_ONLY_TITLE'), 'Must flag client-only title');
  assert.ok(issueCodes.includes('CLIENT_ONLY_HEADINGS'), 'Must flag client-only H1');
  assert.ok(issueCodes.includes('INVALID_STRUCTURED_DATA'), 'Must flag invalid schema.org context');

  // Verify Provenance
  assert.equal(report.provenance.tier, 'empirical_observation');
  assert.equal(report.provenance.dataSource, 'Playwright Headless Browser Rendering Engine');
});
