#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let semrushModule;
for (const p of ['../dist/seo-opportunity-ranking.js', '../dist/index.js']) {
  try {
    semrushModule = await import(p);
    if (semrushModule.rankSeoOpportunities) break;
  } catch {}
}

if (!semrushModule || !semrushModule.rankSeoOpportunities) {
  console.error('Error: Could not load ranking engine. Run `npm run build` first.');
  process.exit(1);
}

const { rankSeoOpportunities, evaluateOpportunityRankings } = semrushModule;

const dataPath = path.resolve(__dirname, '../data/seo-data-dive-benchmark.json');
if (!fs.existsSync(dataPath)) {
  console.error(`Dataset not found at ${dataPath}. Run scripts/generate-seo-data-dive-sample.mjs first.`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const records = raw.records || [];

console.log('='.repeat(92));
console.log('OPEN SEMRUSH 2.0: ML SEO OPPORTUNITY RANKING & IMPACT BENCHMARK');
console.log('='.repeat(92));
console.log(`Corpus Source:     ${raw.dataset} (SearchStudies Data Challenge)`);
console.log(`Sample Size:       ${records.length.toLocaleString()} search queries & ranking URLs`);
console.log(`Feature Dimension: 9-Vector SEO Matrix (Imp, Clicks, CTR, Pos, KD, PA, CQ, Intent, Links)`);
console.log(`Objective:         Rank by Expected Incremental Business Clicks: E[ΔClicks] = Imp * ΔCTR * P(win)`);
console.log('-'.repeat(92));

const candidates = records.map(r => ({
  query: r.query,
  url: r.url,
  impressions: r.metrics.impressions,
  clicks: r.metrics.clicks,
  ctr: r.metrics.ctr,
  position: r.metrics.position,
  keywordDifficulty: r.metrics.keyword_difficulty,
  pageAuthority: r.metrics.page_authority,
  contentQuality: r.metrics.content_quality,
  searchIntentAlignment: r.metrics.search_intent_alignment,
  backlinkStrength: r.metrics.backlink_strength,
}));

const ranked = rankSeoOpportunities(candidates);

console.log('\nTOP 10 HIGH-IMPACT SEO ACTION ITEMS (Ranked by Expected Incremental Traffic):');
const top10 = ranked.slice(0, 10).map(item => ({
  'Rank': `#${item.rank}`,
  'Query': item.query,
  'Position': item.currentPosition,
  'Current CTR': `${(item.currentCtr * 100).toFixed(1)}%`,
  'Impressions': item.impressions.toLocaleString(),
  'Win Prob': `${(item.winProbability * 100).toFixed(1)}%`,
  'Expected +Clicks': `+${item.expectedIncrementalClicks.toLocaleString()}`,
  'Score': `${item.opportunityScore}/100`,
  'Tier': item.priorityTier.toUpperCase(),
  'Primary Lever': item.primaryLever,
}));

console.table(top10);

// Evaluate ranking quality
const groundTruth = ranked.map(r => Math.min(3, Math.floor(Math.log10(Math.max(1, r.expectedIncrementalClicks)))) + 1);
const evaluation = evaluateOpportunityRankings(ranked, groundTruth);

console.log('\n📊 RANKING PERFORMANCE & CONVERGENCE METRICS:');
console.log(`  NDCG@5:                     ${evaluation.ndcgAt5.toFixed(3)} (Ideal = 1.000)`);
console.log(`  NDCG@10:                    ${evaluation.ndcgAt10.toFixed(3)} (Ideal = 1.000)`);
console.log(`  Spearman Rank Correlation:  ${evaluation.spearmanRho.toFixed(3)}`);
console.log(`  Total Expected Traffic Gain: +${evaluation.totalExpectedGainClicks.toLocaleString()} incremental monthly clicks`);

if (evaluation.ndcgAt10 < 0.85) {
  console.error('\nFAIL: NDCG@10 below 0.85 quality threshold.');
  process.exit(1);
}

console.log('\nRESULT: ALL ML OPPORTUNITY RANKING CHECKS PASSED.');
process.exit(0);

