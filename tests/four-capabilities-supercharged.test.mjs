import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  // Phase 1: Backlinks
  extractLinksFromHtml,
  buildLinkGraphFromCrawl,
  classifyAnchorText,
  auditBacklinkToxicity,
  // Phase 2: Competitor Traffic
  calculateShareOfVoice,
  classifyCompetitiveKeywordPositions,
  generateDomainOverview,
  resolveCompetitorDomains,
  // Phase 3: Keywords
  getKdTier,
  calculateSerpFeatureOpportunities,
  expandKeywordMultiAngle,
  analyzeKeyword,
  // Phase 4: Rank Tracking
  addTrackedCompetitor,
  getTrackedCompetitors,
  getRankingAlerts,
  addTrackedKeyword,
  runScheduledRankCheck,
  getRankTrackingOverview,
} from '../dist/index.js';

const TEST_DB_PATH = path.resolve('data/test_supercharged_tracker.json');

function cleanup() {
  if (fs.existsSync(TEST_DB_PATH)) {
    try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  }
}

// =========================================================================
// PHASE 1: BACKLINK INTELLIGENCE (Target: 9.0/10)
// =========================================================================

test('Phase 1: extractLinksFromHtml parses and normalizes HTML links accurately', () => {
  const sampleHtml = `
    <!DOCTYPE html>
    <html>
      <body>
        <a href="https://target.com/product" rel="nofollow noopener">Best Product</a>
        <a href="/about-us">About Us</a>
        <a href="https://spammy-network.buzz/casino" rel="sponsored">Free Casino Bonus</a>
        <a href="https://target.com/features">Our Features</a>
        <a href="javascript:void(0)">Invalid</a>
      </body>
    </html>
  `;

  const links = extractLinksFromHtml('https://source-blog.org/article-1', sampleHtml);
  assert.equal(links.length, 4, 'Should extract 4 valid HTTP/relative links');

  const sponsoredLink = links.find(l => l.targetUrl.includes('casino'));
  assert.ok(sponsoredLink);
  assert.ok(sponsoredLink.rel.includes('sponsored'));
  assert.equal(sponsoredLink.anchorText, 'Free Casino Bonus');
});

test('Phase 1: classifyAnchorText classifies 5 distinct anchor taxonomies', () => {
  assert.equal(classifyAnchorText('acme.com', 'Acme Corporation'), 'Branded');
  assert.equal(classifyAnchorText('acme.com', 'seo tools'), 'Exact Match');
  assert.equal(classifyAnchorText('acme.com', 'complete guide to seo software tools'), 'Partial Match');
  assert.equal(classifyAnchorText('acme.com', 'https://acme.com/pricing'), 'Naked URL');
  assert.equal(classifyAnchorText('acme.com', 'click here'), 'Generic');
});

test('Phase 1: auditBacklinkToxicity flags toxic vectors and computes healthy scores', () => {
  const highRiskNodes = [
    {
      sourceDomain: 'poker-pbn-network.buzz',
      targetDomain: 'mysite.com',
      authorityScore: 8,
      anchorText: 'cheap buy online viagra casino',
      dofollow: true,
      lastDiscovered: new Date().toISOString(),
    },
    {
      sourceDomain: 'spam-directory.top',
      targetDomain: 'mysite.com',
      authorityScore: 5,
      anchorText: 'free slots jackpot',
      dofollow: true,
      lastDiscovered: new Date().toISOString(),
    },
    {
      sourceDomain: 'spam-directory.top',
      targetDomain: 'mysite.com',
      authorityScore: 4,
      anchorText: 'payday loans online',
      dofollow: true,
      lastDiscovered: new Date().toISOString(),
    },
  ];

  const report = auditBacklinkToxicity('mysite.com', highRiskNodes);
  assert.ok(report.toxicityScore >= 30, `Toxicity score (${report.toxicityScore}) should indicate risk`);
  assert.ok(['clean', 'low_risk', 'suspicious', 'toxic'].includes(report.toxicityGrade));
  assert.ok(report.toxicDomainsCount >= 1);
  assert.ok(report.vectors.length === 8);

  // Assert risk vectors fired
  const vectorNames = report.vectors.map(v => v.name);
  assert.ok(vectorNames.includes('SPAM_TLD_CONCENTRATION'));
  assert.ok(vectorNames.includes('SUSPICIOUS_PHARMA_GAMBLING_ANCHORS'));
});

test('Phase 1: buildLinkGraphFromCrawl computes directed node authority & referring domains', () => {
  const crawlPages = [
    {
      url: 'https://domain.com/',
      html: '<a href="https://partner.com/pricing">Pricing</a><a href="https://external.com">Partner</a>',
    },
    {
      url: 'https://domain.com/pricing',
      html: '<a href="https://domain.com/">Home</a><a href="https://vendor.org/signup">Sign Up</a>',
    },
    {
      url: 'https://domain.com/signup',
      html: '<a href="https://domain.com/">Home</a>',
    },
  ];

  const graph = buildLinkGraphFromCrawl(crawlPages);
  assert.ok(graph.nodes.length >= 3);
  assert.ok(graph.edges.length >= 3);
  assert.ok(graph.links.length >= 3);
});

// =========================================================================
// PHASE 2: COMPETITOR TRAFFIC INTELLIGENCE (Target: 9.0/10)
// =========================================================================

test('Phase 2: calculateShareOfVoice computes proportional visibility shares', () => {
  const targetVis = 85;
  const compVis = [75, 40, 20];

  const sov = calculateShareOfVoice(targetVis, compVis);
  assert.equal(typeof sov, 'number');
  assert.ok(sov > 0 && sov < 100);
  assert.ok(Math.abs(sov - 38.6) <= 0.5);
});

test('Phase 2: classifyCompetitiveKeywordPositions groups keywords into missing, weak, strong, shared, unique', () => {
  // Target position null, competitor ranks at #3 -> missing
  assert.equal(classifyCompetitiveKeywordPositions(null, { 'rival.com': 3 }), 'missing');

  // Target position #2, competitor ranks at #15 -> strong (target top 10, competitor not)
  assert.equal(classifyCompetitiveKeywordPositions(2, { 'rival.com': 15 }), 'strong');

  // Target position #12, competitor ranks at #1 -> weak
  assert.equal(classifyCompetitiveKeywordPositions(12, { 'rival.com': 1 }), 'weak');

  // Both target and competitor rank in top 10 -> shared
  assert.equal(classifyCompetitiveKeywordPositions(4, { 'rival.com': 6 }), 'shared');

  // Competitor does not rank -> unique
  assert.equal(classifyCompetitiveKeywordPositions(3, { 'rival.com': null }), 'unique');
});

test('Phase 2: generateDomainOverview includes bottom-up traffic, shareOfVoice and distribution', async () => {
  const overview = await generateDomainOverview('github.com');
  assert.equal(overview.domain, 'github.com');
  assert.ok(overview.organicKeywordsDistribution);
  assert.ok(overview.organicKeywordsDistribution.top3 >= 0);
  assert.ok(overview.organicKeywordsDistribution.top10 >= overview.organicKeywordsDistribution.top3);
  assert.equal(typeof overview.shareOfVoice, 'number');
  assert.ok(overview.shareOfVoice >= 0);
  assert.ok(overview.competitorOverlap.length > 0);
});

// =========================================================================
// PHASE 3: KEYWORD RESEARCH (Target: 9.0/10)
// =========================================================================

test('Phase 3: getKdTier calibrates 6 tiers with referring domain requirements', () => {
  const t1 = getKdTier(5);
  assert.equal(t1.tier, 'Very Easy');
  assert.equal(t1.minReferringDomainsNeeded, 0);

  const t2 = getKdTier(22);
  assert.equal(t2.tier, 'Easy');

  const t3 = getKdTier(40);
  assert.equal(t3.tier, 'Possible');

  const t4 = getKdTier(65);
  assert.equal(t4.tier, 'Hard');

  const t5 = getKdTier(78);
  assert.equal(t5.tier, 'Very Hard');

  const t6 = getKdTier(95);
  assert.equal(t6.tier, 'Super Hard');
  assert.ok(t6.minReferringDomainsNeeded >= 100);
});

test('Phase 3: calculateSerpFeatureOpportunities predicts multi-feature viability', () => {
  const query = 'how to do technical seo audit step by step';
  const opps = calculateSerpFeatureOpportunities(query);
  assert.equal(opps.snippetOpportunity, 'high', 'How-to query should have high snippet opportunity');
  assert.equal(opps.paaOpportunity, 'high', 'Informational question query should have high PAA opportunity');
  assert.ok(['high', 'medium'].includes(opps.videoOpportunity), 'Tutorial queries should have video opportunity');
});

test('Phase 3: expandKeywordMultiAngle generates rich taxonomy expansions', () => {
  const expansions = expandKeywordMultiAngle('seo software');
  assert.ok(Array.isArray(expansions));
  assert.ok(expansions.length >= 10);

  const categories = expansions.map(e => e.category);
  assert.ok(categories.includes('question'));
  assert.ok(categories.includes('comparison'));
  assert.ok(categories.includes('long-tail'));
  assert.ok(categories.includes('autocomplete'));
  for (const item of expansions) {
    assert.equal(item.searchVolume, 0, 'Heuristic expansion must not claim measured volume');
    assert.equal(item.searchVolumeStatus, 'unavailable');
    assert.ok(typeof item.modeledSearchVolume === 'number');
    assert.equal(item.cpcUsd, 0, 'CPC must remain unavailable without a provider');
  }
});

test('Phase 3: unknown niches do not receive fabricated competitor domains', () => {
  assert.deepEqual(resolveCompetitorDomains('unmapped-example-domain.test', []), []);
});

test('Phase 3: analyzeKeyword attaches kdTier and serpFeatureOpportunities to metrics', () => {
  const metrics = analyzeKeyword('best keyword rank tracker');
  assert.ok(metrics.kdTier);
  assert.ok(metrics.kdTier.tier);
  assert.ok(metrics.serpFeatureOpportunities);
  assert.ok(['high', 'medium', 'low'].includes(metrics.serpFeatureOpportunities.snippetOpportunity));
  assert.equal(metrics.provenance.tier, 'statistical_model');
});

// =========================================================================
// PHASE 4: RANK TRACKING (Target: 9.0/10)
// =========================================================================

test('Phase 4: addTrackedCompetitor and getTrackedCompetitors manages competitor list', () => {
  cleanup();
  try {
    addTrackedCompetitor('brand.io', 'rival1.com', TEST_DB_PATH);
    const list1 = getTrackedCompetitors('brand.io', TEST_DB_PATH);
    assert.deepEqual(list1, ['rival1.com']);

    // De-duplication
    addTrackedCompetitor('brand.io', 'RIVAL1.COM', TEST_DB_PATH);
    const listDedup = getTrackedCompetitors('brand.io', TEST_DB_PATH);
    assert.deepEqual(listDedup, ['rival1.com']);

    addTrackedCompetitor('brand.io', 'rival2.com', TEST_DB_PATH);
    const list2 = getTrackedCompetitors('brand.io', TEST_DB_PATH);
    assert.equal(list2.length, 2);
  } finally {
    cleanup();
  }
});

test('Phase 4: getRankingAlerts triggers critical volatility and milestone events', async () => {
  cleanup();
  try {
    addTrackedKeyword('testdomain.com', 'core keyword', { dbPath: TEST_DB_PATH });

    let checkCount = 0;
    const mockSerp = async (query) => {
      checkCount += 1;
      // Round 1: position 12
      // Round 2: position 1 (gain #1 and page 1 entry)
      return {
        query,
        features: { hasFeaturedSnippet: false, peopleAlsoAsk: [], hasVideoPack: false, hasKnowledgePanel: false },
        topRankings: [
          {
            position: checkCount === 1 ? 12 : 1,
            title: 'Test',
            url: 'https://testdomain.com/p1',
            domain: 'testdomain.com',
            snippet: '',
            estimatedCtr: 0.3,
            authorityScore: 60,
          },
        ],
      };
    };

    // First check (baseline)
    await runScheduledRankCheck('testdomain.com', { dbPath: TEST_DB_PATH, fetchSerpImpl: mockSerp });
    // Second check (jump from 12 to 1)
    await runScheduledRankCheck('testdomain.com', { dbPath: TEST_DB_PATH, fetchSerpImpl: mockSerp });

    const alerts = getRankingAlerts('testdomain.com', TEST_DB_PATH);
    assert.ok(alerts.length >= 1, 'Should generate alerts for jumping from 12 to 1');
    const types = alerts.map(a => a.type);
    assert.ok(types.includes('RANK_ONE_GAINED') || types.includes('PAGE_ONE_ENTRY'));
  } finally {
    cleanup();
  }
});

test('Phase 4: getRankTrackingOverview computes head-to-head competitor comparisons & alerts', async () => {
  cleanup();
  try {
    addTrackedKeyword('myshop.com', 'shoes online', { dbPath: TEST_DB_PATH });
    addTrackedKeyword('rivalshop.com', 'shoes online', { dbPath: TEST_DB_PATH });
    addTrackedCompetitor('myshop.com', 'rivalshop.com', TEST_DB_PATH);

    const mockSerp = async (query) => ({
      query,
      features: { hasFeaturedSnippet: true, peopleAlsoAsk: [], hasVideoPack: false, hasKnowledgePanel: false },
      topRankings: [
        { position: 2, title: 'My Shop', url: 'https://myshop.com/shoes', domain: 'myshop.com', snippet: '', estimatedCtr: 0.25, authorityScore: 65 },
        { position: 4, title: 'Rival Shop', url: 'https://rivalshop.com/shoes', domain: 'rivalshop.com', snippet: '', estimatedCtr: 0.12, authorityScore: 60 },
      ],
    });

    await runScheduledRankCheck('myshop.com', { dbPath: TEST_DB_PATH, fetchSerpImpl: mockSerp });
    await runScheduledRankCheck('rivalshop.com', { dbPath: TEST_DB_PATH, fetchSerpImpl: mockSerp });

    const overview = getRankTrackingOverview('myshop.com', TEST_DB_PATH);
    assert.ok(overview.competitorComparisons.length >= 1);
    const comp1 = overview.competitorComparisons[0];
    assert.equal(comp1.competitorDomain, 'rivalshop.com');
    assert.ok(comp1.winRate >= 0.5, 'MyShop at rank 2 beats RivalShop at rank 4');
    assert.equal(comp1.targetHigherCount, 1);
  } finally {
    cleanup();
  }
});
