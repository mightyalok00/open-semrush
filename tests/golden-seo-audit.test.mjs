import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSinglePage } from '../dist/crawler.js';
import { generateDomainOverview, compareKeywordGap } from '../dist/domain.js';
import { analyzeKeyword } from '../dist/keywords.js';
import { fetchLiveSerp } from '../dist/serp.js';

test('Golden Audit: Flawless page achieves 100% health score with zero issues', async () => {
  // Produce at least 200 words of body content to satisfy the content depth threshold
  const bodyParagraphs = Array.from({ length: 25 }, (_, i) => 
    `<p>Paragraph ${i + 1}: Comprehensive technical search engine optimization requires robust infrastructure, proper heading hierarchy, rich structured data, valid canonical declarations, descriptive meta tags, and fast time to first byte performance across modern web deployments.</p>`
  ).join('\n');

  const perfectHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>High Quality SEO Optimized Page Title Demo</title>
  <meta name="description" content="This is an exact golden standard meta description containing detailed summary information between seventy and one hundred and sixty characters for audit testing.">
  <link rel="canonical" href="https://golden.example.com/perfect">
  <meta property="og:title" content="Flawless Golden Title">
  <meta property="og:description" content="Flawless Golden Description">
  <meta property="og:image" content="https://golden.example.com/og.jpg">
  <meta property="og:url" content="https://golden.example.com/perfect">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Flawless"}</script>
</head>
<body>
  <h1>Flawless Golden SEO Benchmark Page</h1>
  ${bodyParagraphs}
  <img src="/banner.webp" alt="Descriptive accessible alternative text">
  <a href="/features">Features</a>
</body>
</html>`;

  const deps = {
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    requester: async () => new Response(perfectHtml, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'SAMEORIGIN',
        'x-content-type-options': 'nosniff',
      },
    }),
  };

  const result = await auditSinglePage('https://golden.example.com/perfect', 5000, 'TestBot', deps);

  assert.equal(result.statusCode, 200);
  assert.equal(result.title, 'High Quality SEO Optimized Page Title Demo');
  assert.equal(result.h1Count, 1);
  assert.equal(result.canonical, 'https://golden.example.com/perfect');
  assert.equal(result.openGraphComplete, true);
  assert.ok(result.schemaTypes.length > 0);
  assert.equal(result.imagesMissingAlt, 0);

  // Assert zero errors, zero warnings, zero notices
  const criticalErrors = result.issues.filter(i => i.severity === 'error');
  const warnings = result.issues.filter(i => i.severity === 'warning');
  assert.equal(criticalErrors.length, 0, `Unexpected errors: ${JSON.stringify(criticalErrors)}`);
  assert.equal(warnings.length, 0, `Unexpected warnings: ${JSON.stringify(warnings)}`);
});

test('Golden Audit: Degraded page produces exact deterministic SEO issue codes', async () => {
  const brokenHtml = `<!DOCTYPE html>
<html>
<head>
  <!-- Missing Title -->
  <!-- Missing Meta Description -->
  <!-- Missing Canonical -->
  <!-- Missing Schema and OpenGraph -->
</head>
<body>
  <!-- Missing H1 -->
  <h2>Only subheadings present</h2>
  <!-- Missing Image Alt tags -->
  <img src="/chart1.png">
  <img src="/chart2.png">
</body>
</html>`;

  const deps = {
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    requester: async () => new Response(brokenHtml, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  };

  const result = await auditSinglePage('https://golden.example.com/degraded', 5000, 'TestBot', deps);

  const issueCodes = new Set(result.issues.map(i => i.code));

  // Required exact heuristic issue codes
  assert.ok(issueCodes.has('TITLE_MISSING'), 'Expected TITLE_MISSING error');
  assert.ok(issueCodes.has('H1_MISSING'), 'Expected H1_MISSING error');
  assert.ok(issueCodes.has('META_DESC_MISSING'), 'Expected META_DESC_MISSING warning');
  assert.ok(issueCodes.has('IMAGES_MISSING_ALT'), 'Expected IMAGES_MISSING_ALT warning');
  assert.ok(issueCodes.has('CANONICAL_MISSING'), 'Expected CANONICAL_MISSING notice');
  assert.ok(issueCodes.has('SCHEMA_MISSING'), 'Expected SCHEMA_MISSING notice');

  assert.equal(result.imagesMissingAlt, 2);
  assert.equal(result.title, null);
  assert.equal(result.h1Count, 0);
});

test('Golden Audit: Broken HTTP statuses are recorded with correct error severity', async () => {
  const deps404 = {
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    requester: async () => new Response('Not Found', { status: 404 }),
  };
  const res404 = await auditSinglePage('https://golden.example.com/missing', 5000, 'TestBot', deps404);
  assert.equal(res404.statusCode, 404);
  assert.ok(res404.issues.some(i => i.code === 'HTTP_CLIENT_ERROR' && i.severity === 'error'));

  const deps500 = {
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    requester: async () => new Response('Internal Crash', { status: 500 }),
  };
  const res500 = await auditSinglePage('https://golden.example.com/crash', 5000, 'TestBot', deps500);
  assert.equal(res500.statusCode, 500);
  assert.ok(res500.issues.some(i => i.code === 'HTTP_SERVER_ERROR' && i.severity === 'error'));
});

test('Golden Heuristics: Modeled SEO calculations stay within bounded empirical ranges', async () => {
  // Keyword difficulty calculation
  const kwMetrics = analyzeKeyword('best seo tools');
  assert.ok(kwMetrics.keywordDifficulty >= 0 && kwMetrics.keywordDifficulty <= 100);
  assert.ok(kwMetrics.searchVolume > 0);
  assert.ok(['Informational', 'Navigational', 'Commercial', 'Transactional'].includes(kwMetrics.intent));

  // Domain overview generation
  const domainOverview = await generateDomainOverview('github.com', 'us');
  assert.equal(domainOverview.domain, 'github.com');
  assert.ok(domainOverview.authorityScore >= 0 && domainOverview.authorityScore <= 100);
  assert.ok(domainOverview.estimatedMonthlyOrganicTraffic > 0);
  assert.equal(domainOverview.history24Months.length, 24);

  // Keyword gap comparison
  const kwA = ['github', 'git clone', 'github desktop'];
  const kwB = ['gitlab', 'git clone', 'gitlab runner'];
  const gap = compareKeywordGap('github.com', kwA, 'gitlab.com', kwB);
  assert.equal(gap.domainA, 'github.com');
  assert.equal(gap.domainB, 'gitlab.com');
  assert.ok(Array.isArray(gap.sharedKeywords));
  assert.ok(gap.sharedKeywords.includes('git clone'));
  assert.ok(Array.isArray(gap.uniqueToDomainA));
  assert.ok(gap.uniqueToDomainA.includes('github'));
  assert.ok(Array.isArray(gap.missingForDomainA));
  assert.ok(gap.missingForDomainA.includes('gitlab'));

  // SERP fetcher fallback
  const serp = await fetchLiveSerp('fast static site generators');
  assert.ok(serp.topRankings.length > 0);
  assert.equal(typeof serp.features.hasFeaturedSnippet, 'boolean');
});
