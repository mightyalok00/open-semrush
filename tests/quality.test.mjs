import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateKeywordDifficulty, classifySearchIntent, analyzeKeyword } from '../dist/keywords.js';
import { calculateCtrByPosition, parseSerpHtml, fetchLiveSerp } from '../dist/serp.js';
import { compareKeywordGap, generateDomainOverview, compareMultiCompetitorGap, estimateMonthlyOrganicTraffic } from '../dist/domain.js';
import { generateBacklinkReport } from '../dist/backlinks.js';
import { assertPublicHttpUrl, isPublicIpAddress } from '../dist/url-safety.js';
import { runSiteAudit, auditSinglePage } from '../dist/crawler.js';

test('keyword intent classification is stable and case-insensitive', () => {
  assert.equal(classifySearchIntent('BEST SEO TOOLS'), 'Commercial');
  assert.equal(classifySearchIntent('buy SEO software'), 'Transactional');
  assert.equal(classifySearchIntent('how search engines work'), 'Informational');
});

test('keyword metrics stay within documented numeric bounds', () => {
  const result = analyzeKeyword('technical seo audit');
  assert.ok(Number.isFinite(result.searchVolume) && result.searchVolume >= 0);
  assert.ok(Number.isFinite(result.keywordDifficulty) && result.keywordDifficulty >= 0 && result.keywordDifficulty <= 100);
  assert.equal(result.seasonalityTrend.length, 12);
  assert.ok(result.seasonalityTrend.every((value) => value >= 0 && value <= 100));
  assert.equal(calculateKeywordDifficulty(''), 0);
});

test('CTR model returns zero for non-positive positions', () => {
  assert.equal(calculateCtrByPosition(0, false), 0);
  assert.equal(calculateCtrByPosition(-1, false), 0);
  assert.ok(calculateCtrByPosition(1, false) > calculateCtrByPosition(10, false));
});

test('SERP parser ignores invalid URLs and returns a stable empty result', () => {
  const result = parseSerpHtml('<html><body>no organic results</body></html>', 'example query');
  assert.equal(result.query, 'example query');
  assert.deepEqual(result.rankings, []);
});

test('SERP parser extracts organic search results and rich snippets', () => {
  const html = `
    <div class="featured_snippet">Featured Snippet Summary</div>
    <div class="related-question-pair">What is SEO?</div>
    <div class="g">
      <a href="https://example.com/guide"><h3>Complete SEO Guide 2026</h3></a>
      <div class="VwiC3b">Learn how technical SEO works with audits and crawlers.</div>
    </div>
  `;
  const result = parseSerpHtml(html, 'seo guide');
  assert.equal(result.query, 'seo guide');
  assert.equal(result.features.hasFeaturedSnippet, true);
  assert.equal(result.features.hasPeopleAlsoAsk, true);
  assert.equal(result.rankings.length, 1);
  assert.equal(result.rankings[0].url, 'https://example.com/guide');
  assert.equal(result.rankings[0].domain, 'example.com');
  assert.equal(result.rankings[0].title, 'Complete SEO Guide 2026');
});

test('fetchLiveSerp provides fallback ranked domains and features', async () => {
  const savedKey = process.env.SERPAPI_KEY;
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedOpenRouter = process.env.OPENROUTER_API_KEY;
  delete process.env.SERPAPI_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const report = await fetchLiveSerp('seo audit');
    assert.equal(report.query, 'seo audit');
    assert.equal(report.topRankings.length, 10);
    assert.equal(report.topRankings[0].position, 1);
    assert.ok(report.features.hasFeaturedSnippet);
  } finally {
    if (savedKey) process.env.SERPAPI_KEY = savedKey;
    if (savedGemini) process.env.GEMINI_API_KEY = savedGemini;
    if (savedOpenRouter) process.env.OPENROUTER_API_KEY = savedOpenRouter;
  }
});



test('keyword gap comparison separates shared, unique, and missing terms', () => {
  const result = compareKeywordGap('a.example', ['SEO', 'analytics'], 'b.example', ['seo', 'keywords']);
  assert.deepEqual(result.sharedKeywords, ['seo']);
  assert.deepEqual(result.uniqueToDomainA, ['analytics']);
  assert.deepEqual(result.missingForDomainA, ['keywords']);
});

test('outbound URL guard rejects loopback, private, link-local, and reserved addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1', 'fe80::1']) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress('8.8.8.8'), true);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);
});

test('outbound URL guard rejects unsafe schemes, credentials, and localhost without network access', async () => {
  await assert.rejects(assertPublicHttpUrl('file:///etc/passwd'), /Only HTTP and HTTPS/);
  await assert.rejects(assertPublicHttpUrl('http://127.0.0.1/'), /Private or reserved IP/);
  await assert.rejects(assertPublicHttpUrl('http://localhost/'), /Local and metadata hostnames/);
  await assert.rejects(assertPublicHttpUrl('https://user:pass@example.com/'), /credentials/);
});

test('auditSinglePage detects HTTP errors and on-page SEO issues', async () => {
  const mockResolver = async () => [{ address: '93.184.216.34', family: 4 }];
  const mockRequester = async (url) => {
    if (url.pathname === '/404') {
      return new Response('Not Found', { status: 404 });
    }
    if (url.pathname === '/500') {
      return new Response('Server Error', { status: 500 });
    }
    return new Response(`<!DOCTYPE html><html><head><title>Short</title><meta name="description" content="Test"></head><body><img src="pic.jpg"></body></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  };
  const deps = { resolver: mockResolver, requester: mockRequester };

  const audit404 = await auditSinglePage('https://example.com/404', 5000, undefined, deps);
  assert.equal(audit404.statusCode, 404);
  assert.ok(audit404.issues.some((i) => i.code === 'HTTP_CLIENT_ERROR'));

  const audit500 = await auditSinglePage('https://example.com/500', 5000, undefined, deps);
  assert.equal(audit500.statusCode, 500);
  assert.ok(audit500.issues.some((i) => i.code === 'HTTP_SERVER_ERROR'));

  const auditOk = await auditSinglePage('https://example.com/page', 5000, undefined, deps);
  assert.equal(auditOk.statusCode, 200);
  assert.ok(auditOk.issues.some((i) => i.code === 'H1_MISSING'));
  assert.ok(auditOk.issues.some((i) => i.code === 'IMAGES_MISSING_ALT'));
});

test('runSiteAudit discovers robots, sitemaps, and audits multiple pages', async () => {
  const pages = {
    'https://example.com/robots.txt': { status: 200, body: 'Sitemap: https://example.com/sitemap.xml\n' },
    'https://example.com/sitemap.xml': { status: 200, body: '<urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/sub</loc></url></urlset>' },
    'https://example.com/': { status: 200, body: '<html><head><title>Proper Long Title for Testing Page SEO Factor</title><meta name="description" content="A comprehensive meta description designed to meet recommended character length requirements."></head><body><h1>Main Heading</h1></body></html>' },
    'https://example.com/sub': { status: 200, body: '<html><head><title>Sub Page Title with Proper Length Characteristics</title><meta name="description" content="Another good meta description for the secondary crawled page in this audit."></head><body><h1>Sub Heading</h1></body></html>' },
  };
  const mockResolver = async () => [{ address: '93.184.216.34', family: 4 }];
  const mockRequester = async (url) => {
    const p = pages[url.href];
    if (!p) return new Response('Not found', { status: 404 });
    return new Response(p.body, { status: p.status, headers: { 'content-type': 'text/html' } });
  };
  const deps = { resolver: mockResolver, requester: mockRequester };

  const report = await runSiteAudit('https://example.com/', { maxPages: 2, safeFetchDependencies: deps });
  assert.equal(report.scannedPagesCount, 2);
  assert.equal(report.hasRobotsTxt, true);
  assert.equal(report.hasSitemap, true);
  assert.ok(report.healthScore >= 80);
});

test('domain analysis and backlink generators return modeled metrics within bounds', async () => {
  const savedOpenRouter = process.env.OPENROUTER_API_KEY;
  const savedGemini = process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const overview = await generateDomainOverview('github.com');
    assert.equal(overview.domain, 'github.com');
    assert.ok(overview.authorityScore > 0 && overview.authorityScore <= 100);
    assert.ok(overview.totalRankedKeywords > 0);
    assert.ok(overview.history24Months.length === 24);

    const traffic = estimateMonthlyOrganicTraffic([{ searchVolume: 10000, position: 1 }]);
    assert.ok(traffic > 0);

    const backlinks = generateBacklinkReport('github.com');
    assert.equal(backlinks.targetDomain, 'github.com');
    assert.ok(backlinks.totalBacklinks > 0);
    assert.ok(backlinks.totalReferringDomains > 0);

    const multi = await compareMultiCompetitorGap(['github.com', 'gitlab.com', 'stripe.com']);
    assert.equal(multi.domains.length, 3);
    assert.ok(multi.matrix.length > 0);
  } finally {
    if (savedOpenRouter) process.env.OPENROUTER_API_KEY = savedOpenRouter;
    if (savedGemini) process.env.GEMINI_API_KEY = savedGemini;
  }
});

