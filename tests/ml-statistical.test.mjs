import test from 'node:test';
import assert from 'node:assert/strict';
import {
  predictCtrPowerLaw,
  classifySearchIntentProbabilities,
  calculateTrafficForecast,
  calculateNgramSimilarity,
  clusterKeywordsBySemantics,
  getAiEngineStatus,
  analyzeKeyword,
} from '../dist/index.js';

test('ML CTR: Empirical power-law decays monotonically across search rankings', () => {
  let prevCtr = 1.0;
  for (let pos = 1; pos <= 20; pos++) {
    const pred = predictCtrPowerLaw(pos);
    assert.ok(pred.adjustedCtr <= prevCtr, `Position ${pos} CTR (${pred.adjustedCtr}) must be <= Position ${pos - 1} (${prevCtr})`);
    assert.ok(pred.adjustedCtr > 0, `Position ${pos} CTR must be strictly positive`);
    prevCtr = pred.adjustedCtr;
  }
  assert.equal(predictCtrPowerLaw(0).adjustedCtr, 0);
  assert.equal(predictCtrPowerLaw(-5).adjustedCtr, 0);
});

test('ML CTR: Featured Snippet presence applies layout cannibalization discount', () => {
  const standardPos1 = predictCtrPowerLaw(1);
  const snippetPos1 = predictCtrPowerLaw(1, { hasFeaturedSnippet: true });
  assert.ok(snippetPos1.adjustedCtr < standardPos1.adjustedCtr, 'Featured snippet must reduce Pos 1 organic CTR');
  assert.ok(snippetPos1.featureModifiersApplied.some(m => m.includes('Featured Snippet')));
});

test('ML Intent: Softmax probabilities sum to 1.0 with robust confidence scores', () => {
  const queries = [
    'buy organic coffee beans online',
    'best mechanical keyboards 2026',
    'github login dashboard',
    'how does gradient descent work in machine learning',
  ];

  for (const q of queries) {
    const dist = classifySearchIntentProbabilities(q);
    const sum = dist.probabilities.Informational +
      dist.probabilities.Commercial +
      dist.probabilities.Navigational +
      dist.probabilities.Transactional;

    assert.ok(Math.abs(sum - 1.0) < 0.002, `Softmax probabilities for "${q}" must sum to 1.0 (got ${sum})`);
    assert.ok(dist.confidence >= 0.25 && dist.confidence <= 1.0, `Confidence must be in [0.25, 1.0] (got ${dist.confidence})`);
    assert.equal(dist.probabilities[dist.primaryIntent], dist.confidence, 'Confidence must match probability of primary intent');
  }

  assert.equal(classifySearchIntentProbabilities('cheap flights discount code').primaryIntent, 'Transactional');
  assert.equal(classifySearchIntentProbabilities('top 10 analytics platforms comparison').primaryIntent, 'Commercial');
  assert.equal(classifySearchIntentProbabilities('app.slack.com login').primaryIntent, 'Navigational');
  assert.equal(classifySearchIntentProbabilities('how to implement transformer attention mechanism').primaryIntent, 'Informational');
});

test('ML Traffic Forecasting: Produces bounded 95% confidence intervals', () => {
  const forecast = calculateTrafficForecast(50000, 0.285);
  assert.equal(forecast.expectedVisits, Math.round(50000 * 0.285));
  assert.ok(forecast.lower95 <= forecast.expectedVisits, 'Lower 95% bound must be <= expected visits');
  assert.ok(forecast.upper95 >= forecast.expectedVisits, 'Upper 95% bound must be >= expected visits');
  assert.ok(forecast.standardError > 0, 'Standard error must be positive');
  assert.equal(forecast.confidenceLevel, 0.95);

  const zeroForecast = calculateTrafficForecast(0, 0.15);
  assert.equal(zeroForecast.expectedVisits, 0);
  assert.equal(zeroForecast.lower95, 0);
  assert.equal(zeroForecast.upper95, 0);
});

test('ML Semantic Similarity: N-gram Jaccard metric is symmetric and bounded', () => {
  const simIdentical = calculateNgramSimilarity('python tutorial', 'python tutorial');
  assert.equal(simIdentical, 1.0);

  const simHigh = calculateNgramSimilarity('python tutorial for beginners', 'python beginners tutorial');
  assert.ok(simHigh > 0.6, 'Reordered identical phrase should have high n-gram similarity');

  const simLow = calculateNgramSimilarity('python tutorial', 'best luxury yacht charter');
  assert.ok(simLow < 0.1, 'Unrelated phrases must have low similarity');

  // Symmetry
  assert.equal(
    calculateNgramSimilarity('seo audit checklist', 'technical seo audit'),
    calculateNgramSimilarity('technical seo audit', 'seo audit checklist')
  );
});

test('ML Semantic Clustering: Groups semantically similar queries into thematic clusters', () => {
  const keywordItems = [
    { keyword: 'python course online', searchVolume: 12000, difficulty: 55 },
    { keyword: 'online python course', searchVolume: 9000, difficulty: 52 },
    { keyword: 'learn python free', searchVolume: 15000, difficulty: 45 },
    { keyword: 'seo audit software', searchVolume: 4000, difficulty: 70 },
    { keyword: 'best seo audit tool', searchVolume: 6500, difficulty: 72 },
  ];

  const clusters = clusterKeywordsBySemantics(keywordItems, 0.35);
  assert.ok(clusters.length >= 2, 'Should create at least 2 distinct thematic clusters');
  assert.ok(clusters.every(c => c.totalVolume > 0));
  assert.ok(clusters.every(c => c.keywords.length >= 1));
});

test('AI & ML Engine: Telemetry probe accurately returns model cascade status', () => {
  const status = getAiEngineStatus();
  assert.ok(typeof status.openRouterConfigured === 'boolean');
  assert.ok(status.openRouterModelCount >= 5, 'Must have at least 5 free OpenRouter models configured');
  assert.ok(typeof status.geminiConfigured === 'boolean');
  assert.ok(status.geminiModelCount >= 5, 'Must have working Gemini models configured');
});

test('Keyword Analysis: Rich KeywordMetrics encapsulates ML probability and forecasting', () => {
  const metrics = analyzeKeyword('best machine learning course');
  assert.ok(metrics.intentDistribution, 'Keyword metrics must include intentDistribution');
  assert.equal(metrics.intentDistribution.primaryIntent, 'Commercial');
  assert.ok(metrics.trafficForecast, 'Keyword metrics must include trafficForecast');
  assert.ok(metrics.trafficForecast.expectedVisits > 0);
  assert.ok(metrics.trafficForecast.lower95 <= metrics.trafficForecast.expectedVisits);
  assert.ok(metrics.trafficForecast.upper95 >= metrics.trafficForecast.expectedVisits);
});
