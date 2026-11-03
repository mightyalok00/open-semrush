import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateWinProbability,
  rankSeoOpportunities,
  evaluateOpportunityRankings,
  normalizeOpportunityFeatures,
  summarizeOpportunityPlan,
} from '../dist/seo-opportunity-ranking.js';

test('ML Opportunity Ranking: calculateWinProbability reflects realistic authority & content bounds', () => {
  const easyWin = {
    query: 'easy brand query',
    url: 'https://example.com/easy',
    impressions: 5000,
    clicks: 250,
    ctr: 0.05,
    position: 4,
    keywordDifficulty: 15,
    pageAuthority: 85,
    contentQuality: 92,
    searchIntentAlignment: 0.95,
    backlinkStrength: 45,
  };

  const hardWin = {
    query: 'ultra competitive keyword',
    url: 'https://example.com/hard',
    impressions: 50000,
    clicks: 100,
    ctr: 0.002,
    position: 28,
    keywordDifficulty: 92,
    pageAuthority: 25,
    contentQuality: 50,
    searchIntentAlignment: 0.70,
    backlinkStrength: 2,
  };

  const probEasy = calculateWinProbability(easyWin);
  const probHard = calculateWinProbability(hardWin);

  assert.ok(probEasy > 0.80, `Easy win probability (${probEasy}) should be high (> 0.80)`);
  assert.ok(probHard < 0.25, `Hard win probability (${probHard}) should be low (< 0.25)`);
  assert.ok(probEasy > probHard, 'Easy opportunity must have higher win probability than hard');
});

test('ML Opportunity Ranking: rankSeoOpportunities orders by expected incremental traffic impact', () => {
  const items = [
    {
      query: 'low impact low volume',
      url: 'https://example.com/low',
      impressions: 200,
      clicks: 10,
      ctr: 0.05,
      position: 8,
      keywordDifficulty: 30,
      pageAuthority: 50,
      contentQuality: 70,
      searchIntentAlignment: 0.85,
      backlinkStrength: 10,
    },
    {
      query: 'massive striking distance opportunity',
      url: 'https://example.com/massive',
      impressions: 40000,
      clicks: 400,
      ctr: 0.01,
      position: 12,
      keywordDifficulty: 35,
      pageAuthority: 75,
      contentQuality: 88,
      searchIntentAlignment: 0.92,
      backlinkStrength: 30,
    },
  ];

  const ranked = rankSeoOpportunities(items);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[0].query, 'massive striking distance opportunity');
  assert.ok(ranked[0].expectedIncrementalClicks > ranked[1].expectedIncrementalClicks);
  assert.ok(ranked[0].opportunityScore >= 75);
  assert.equal(ranked[0].priorityTier, 'critical');
  assert.equal(ranked[0].primaryLever, 'Striking Distance Title & Internal Link Push');
});

test('ML Opportunity Ranking: evaluateOpportunityRankings computes valid NDCG and Spearman rho', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    query: `query-${i}`,
    url: `https://example.com/p${i}`,
    impressions: (20 - i) * 1500,
    clicks: (20 - i) * 50,
    ctr: 0.03,
    position: 5 + (i % 5),
    keywordDifficulty: 30 + i * 2,
    pageAuthority: 80 - i * 2,
    contentQuality: 85,
    searchIntentAlignment: 0.9,
    backlinkStrength: 20,
  }));

  const ranked = rankSeoOpportunities(items);
  const relevance = ranked.map(r => Math.max(1, Math.round(r.expectedIncrementalClicks / 100)));
  const evalResult = evaluateOpportunityRankings(ranked, relevance);

  assert.equal(evalResult.sampleSize, 20);
  assert.ok(evalResult.ndcgAt5 >= 0.85, `NDCG@5 (${evalResult.ndcgAt5}) should be >= 0.85`);
  assert.ok(evalResult.ndcgAt10 >= 0.85, `NDCG@10 (${evalResult.ndcgAt10}) should be >= 0.85`);
  assert.ok(evalResult.spearmanRho > 0.5, `Spearman rho (${evalResult.spearmanRho}) should show strong positive alignment`);
  assert.ok(evalResult.totalExpectedGainClicks > 0);
});

test('ML Opportunity Ranking: evaluates real-world SearchStudies SEO Data Dive 2025 corpus', () => {
  const filePath = path.resolve('data', 'seo-data-dive-bookconv-opportunities.json');
  assert.ok(fs.existsSync(filePath), 'Real SEO Data Dive dataset file must exist');

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(raw.domain, 'www.bookconv.com');
  assert.ok(raw.records.length > 100, `Expected > 100 queries, got ${raw.records.length}`);

  const ranked = rankSeoOpportunities(raw.records);
  assert.equal(ranked.length, raw.records.length);

  // Top opportunity checks
  const top1 = ranked[0];
  assert.equal(top1.rank, 1);
  assert.ok(top1.impressions > 0);
  assert.ok(!isNaN(top1.expectedIncrementalClicks));
  assert.ok(!isNaN(top1.opportunityScore));
  assert.ok(top1.opportunityScore >= 1 && top1.opportunityScore <= 100);

  // Summary aggregation
  const summary = summarizeOpportunityPlan(ranked);
  assert.equal(summary.totalCandidates, raw.records.length);
  assert.ok(summary.totalExpectedGainClicks > 0);
  assert.equal(summary.topOpportunities.length, 10);
});


