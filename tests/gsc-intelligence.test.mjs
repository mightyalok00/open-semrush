import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchSearchConsoleReport,
  listSearchConsoleSites,
  computeSearchConsoleIntelligence,
} from '../dist/search-console.js';

test('GSC Intelligence: identifies striking distance queries (positions 11-20)', () => {
  const rows = [
    { query: 'seo tips', impressions: 1200, clicks: 15, ctr: 0.0125, position: 12.4 },
    { query: 'brand keyword', impressions: 5000, clicks: 2000, ctr: 0.4, position: 1.2 },
    { query: 'technical audit checklist', impressions: 850, clicks: 8, ctr: 0.0094, position: 16.8 },
    { query: 'zero impression query', impressions: 5, clicks: 0, ctr: 0, position: 14.0 },
  ];

  const intelligence = computeSearchConsoleIntelligence(rows);
  assert.equal(intelligence.strikingDistanceQueries.length, 2);
  assert.equal(intelligence.strikingDistanceQueries[0]?.query, 'seo tips');
  assert.equal(intelligence.strikingDistanceQueries[1]?.query, 'technical audit checklist');
  assert.ok(intelligence.strikingDistanceQueries[0].opportunityScore > intelligence.strikingDistanceQueries[1].opportunityScore);
});

test('GSC Intelligence: detects keyword cannibalization across distinct landing pages', () => {
  const rows = [
    { query: 'best seo tools', page: 'https://example.com/blog/seo-tools', clicks: 20, impressions: 500, ctr: 0.04, position: 4.2 },
    { query: 'best seo tools', page: 'https://example.com/products/suite', clicks: 10, impressions: 350, ctr: 0.028, position: 6.8 },
    { query: 'single page query', page: 'https://example.com/about', clicks: 5, impressions: 100, ctr: 0.05, position: 2.1 },
  ];

  const intelligence = computeSearchConsoleIntelligence(rows);
  assert.equal(intelligence.cannibalizationIssues.length, 1);
  const issue = intelligence.cannibalizationIssues[0];
  assert.equal(issue.query, 'best seo tools');
  assert.equal(issue.competingPages.length, 2);
  assert.equal(issue.totalClicks, 30);
  assert.equal(issue.totalImpressions, 850);
});

test('GSC Intelligence: surfaces CTR opportunity gaps vs power-law expectations', () => {
  const rows = [
    // Position 2 with an abnormally low CTR of 1% (expected is ~15-20%)
    { query: 'high volume low ctr', impressions: 4000, clicks: 40, ctr: 0.01, position: 2.0 },
    // Position 1 with healthy 30% CTR
    { query: 'healthy ranking', impressions: 1000, clicks: 300, ctr: 0.30, position: 1.0 },
  ];

  const intelligence = computeSearchConsoleIntelligence(rows);
  assert.equal(intelligence.ctrOpportunities.length, 1);
  const opp = intelligence.ctrOpportunities[0];
  assert.equal(opp.query, 'high volume low ctr');
  assert.ok(opp.expectedCtr > opp.actualCtr);
  assert.ok(opp.potentialExtraClicks > 100);
});

test('listSearchConsoleSites: queries official webmasters sites endpoint', async () => {
  const fetchImpl = async (url, init) => {
    assert.match(String(url), /webmasters\/v3\/sites$/);
    assert.equal(init?.headers?.authorization, 'Bearer test-token');
    return new Response(JSON.stringify({
      siteEntry: [
        { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
        { siteUrl: 'https://my-blog.org/', permissionLevel: 'siteUser' },
      ],
    }), { status: 200 });
  };

  const sites = await listSearchConsoleSites({
    accessToken: 'test-token',
    fetchImpl,
  });

  assert.equal(sites.length, 2);
  assert.equal(sites[0]?.siteUrl, 'sc-domain:example.com');
  assert.equal(sites[0]?.permissionLevel, 'siteOwner');
  assert.equal(sites[1]?.siteUrl, 'https://my-blog.org/');
});

test('fetchSearchConsoleReport: attaches verified provenance and computes intelligence', async () => {
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.dimensions) {
      return new Response(JSON.stringify({
        rows: [
          { keys: ['ranking query', 'https://example.com/page1'], clicks: 50, impressions: 500, ctr: 0.1, position: 12.0 },
        ],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      rows: [{ clicks: 50, impressions: 500, ctr: 0.1, position: 12.0 }],
    }), { status: 200 });
  };

  const report = await fetchSearchConsoleReport({
    siteUrl: 'sc-domain:example.com',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    dimensions: ['query', 'page'],
    accessToken: 'valid-token',
    fetchImpl,
  });

  assert.equal(report.provenance.tier, 'verified_provider');
  assert.equal(report.provenance.isFactual, true);
  assert.ok(report.intelligence);
  assert.equal(report.intelligence.strikingDistanceQueries.length, 1);
});
