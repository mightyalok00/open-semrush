import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  addTrackedKeyword,
  removeTrackedKeyword,
  getTrackedKeywords,
  pollKeywordRank,
  runScheduledRankCheck,
  getRankTrackingOverview,
  calculateVisibilityScore,
} from '../dist/rank-tracker.js';

const TEST_DB_PATH = path.resolve('data/test_rank_tracker.json');

function cleanup() {
  if (fs.existsSync(TEST_DB_PATH)) {
    try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  }
}

test('calculateVisibilityScore: weights top positions correctly', () => {
  // Rank 1 gets 100 points
  assert.equal(calculateVisibilityScore([1]), 100);
  // Rank 2 gets 80 points
  assert.equal(calculateVisibilityScore([2]), 80);
  // Null (unranked) gets 0
  assert.equal(calculateVisibilityScore([null]), 0);
  // Mixed positions average out
  assert.equal(calculateVisibilityScore([1, null]), 50);
});

test('Rank Tracker: adds, lists, and de-duplicates tracked keywords', () => {
  cleanup();
  try {
    const kw1 = addTrackedKeyword('example.com', 'seo audit tool', { dbPath: TEST_DB_PATH, tags: ['core'] });
    assert.ok(kw1.id);
    assert.equal(kw1.domain, 'example.com');
    assert.equal(kw1.keyword, 'seo audit tool');
    assert.deepEqual(kw1.tags, ['core']);

    // De-duplication
    const kw2 = addTrackedKeyword('https://example.com/', 'SEO AUDIT TOOL', { dbPath: TEST_DB_PATH });
    assert.equal(kw2.id, kw1.id);

    const list = getTrackedKeywords('example.com', TEST_DB_PATH);
    assert.equal(list.length, 1);
  } finally {
    cleanup();
  }
});

test('pollKeywordRank: matches domain in live SERP report or returns null', async () => {
  const fakeSerp = async (query) => ({
    query,
    totalResults: 100,
    searchTimeSeconds: 0.1,
    features: {
      hasFeaturedSnippet: true,
      peopleAlsoAsk: ['What is SEO?'],
      hasVideoPack: false,
      hasKnowledgePanel: false,
    },
    topRankings: [
      { position: 1, title: 'Competitor A', url: 'https://competitor.com/tool', domain: 'competitor.com', snippet: '', estimatedCtr: 0.3, authorityScore: 70 },
      { position: 2, title: 'My Awesome Tool', url: 'https://example.com/best-tool', domain: 'example.com', snippet: '', estimatedCtr: 0.18, authorityScore: 65 },
    ],
  });

  const rankedResult = await pollKeywordRank('best tool', 'example.com', { fetchSerpImpl: fakeSerp });
  assert.equal(rankedResult.position, 2);
  assert.equal(rankedResult.foundUrl, 'https://example.com/best-tool');
  assert.ok(rankedResult.serpFeatures.includes('featured_snippet'));

  const unrankedResult = await pollKeywordRank('best tool', 'not-ranking.org', { fetchSerpImpl: fakeSerp });
  assert.equal(unrankedResult.position, null);
});

test('runScheduledRankCheck: updates positions, calculates deltas, and compiles overview', async () => {
  cleanup();
  try {
    addTrackedKeyword('mycorp.com', 'brand tool', { dbPath: TEST_DB_PATH });
    addTrackedKeyword('mycorp.com', 'cloud security', { dbPath: TEST_DB_PATH });

    let round = 1;
    const mockSerp = async (query) => {
      if (query === 'brand tool') {
        return {
          query,
          features: { hasFeaturedSnippet: false, peopleAlsoAsk: [], hasVideoPack: false, hasKnowledgePanel: false },
          topRankings: [{ position: round === 1 ? 5 : 2, title: 'Brand', url: 'https://mycorp.com', domain: 'mycorp.com', snippet: '', estimatedCtr: 0.2, authorityScore: 50 }],
        };
      }
      return {
        query,
        features: { hasFeaturedSnippet: false, peopleAlsoAsk: [], hasVideoPack: false, hasKnowledgePanel: false },
        topRankings: [{ position: round === 1 ? 8 : 12, title: 'Cloud', url: 'https://mycorp.com/cloud', domain: 'mycorp.com', snippet: '', estimatedCtr: 0.05, authorityScore: 50 }],
      };
    };

    // First scheduled poll
    await runScheduledRankCheck('mycorp.com', { fetchSerpImpl: mockSerp, dbPath: TEST_DB_PATH });
    const overview1 = getRankTrackingOverview('mycorp.com', TEST_DB_PATH);
    assert.equal(overview1.totalTrackedKeywords, 2);
    assert.equal(overview1.distribution.top10, 2);

    // Second scheduled poll with position changes
    round = 2;
    await runScheduledRankCheck('mycorp.com', { fetchSerpImpl: mockSerp, dbPath: TEST_DB_PATH });
    const overview2 = getRankTrackingOverview('mycorp.com', TEST_DB_PATH);

    // brand tool moved from 5 to 2 (+3 rank change) -> Winner
    assert.equal(overview2.winners.length, 1);
    assert.equal(overview2.winners[0]?.keyword, 'brand tool');
    assert.equal(overview2.winners[0]?.delta, 3);

    // cloud security moved from 8 to 12 (-4 rank change) -> Loser
    assert.equal(overview2.losers.length, 1);
    assert.equal(overview2.losers[0]?.keyword, 'cloud security');
    assert.equal(overview2.losers[0]?.delta, -4);

    assert.equal(overview2.provenance.tier, 'empirical_observation');
  } finally {
    cleanup();
  }
});
