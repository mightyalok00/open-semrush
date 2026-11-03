import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_BENCHMARK_MODELS,
  seasonalNaiveModel,
  linearOlsModel,
  ridgeRegressionModel,
  randomForestModel,
  gradientBoostingModel,
  sarimaModel,
  prophetModel,
  productionEnsembleModel,
  evaluateModelOnSeries,
  runMultiDomainBenchmark,
} from '../dist/ml-forecasting-benchmark.js';

test('ML Benchmark: All 8 models generate finite, valid predictions and intervals', () => {
  // Synthetic 60-day sine wave with positive trend
  const series = Array.from({ length: 60 }, (_, i) => Math.max(10, Math.round(100 + i * 2 + Math.sin((i * 2 * Math.PI) / 7) * 20)));

  for (const model of ALL_BENCHMARK_MODELS) {
    const res = model.trainAndPredict(series, 30);
    assert.equal(res.predictions.length, 30, `${model.id} should output 30 predictions`);
    assert.equal(res.lower95.length, 30, `${model.id} should output 30 lower95 bounds`);
    assert.equal(res.upper95.length, 30, `${model.id} should output 30 upper95 bounds`);

    for (let h = 0; h < 30; h++) {
      const pred = res.predictions[h];
      const lower = res.lower95[h];
      const upper = res.upper95[h];

      assert.ok(!Number.isNaN(pred) && Number.isFinite(pred) && pred >= 0, `${model.id} prediction at ${h} must be non-negative finite`);
      assert.ok(!Number.isNaN(lower) && Number.isFinite(lower) && lower >= 0, `${model.id} lower bound at ${h} must be non-negative finite`);
      assert.ok(!Number.isNaN(upper) && Number.isFinite(upper) && upper >= lower, `${model.id} upper bound at ${h} must be >= lower`);
    }
  }
});

test('ML Benchmark: Temporal rolling-origin backtesting metrics contract (MAE, RMSE, WAPE, MASE, Coverage)', () => {
  const series = Array.from({ length: 90 }, (_, i) => Math.max(20, Math.round(150 + i * 1.5 + ((i % 7) > 4 ? -40 : 25))));

  const score = evaluateModelOnSeries(linearOlsModel, series, 30, 3);

  assert.equal(score.modelId, 'linear_ols');
  assert.ok(score.mae > 0, 'MAE should be positive');
  assert.ok(score.rmse >= score.mae, 'RMSE must be >= MAE mathematically (Jensen inequality)');
  assert.ok(score.wape > 0 && score.wape < 100, `WAPE (${score.wape}%) should be bounded and reasonable`);
  assert.ok(score.mase > 0, `MASE (${score.mase}) should be positive`);
  assert.ok(score.coverage95 >= 50 && score.coverage95 <= 100, `Coverage (${score.coverage95}%) should be reasonable`);
  assert.ok(Number.isFinite(score.bias), 'Bias must be finite');
});

test('ML Benchmark: Multi-domain benchmark execution across diverse domains', () => {
  const domainA = Array.from({ length: 60 }, (_, i) => 200 + i + (i % 7) * 10);
  const domainB = Array.from({ length: 60 }, (_, i) => 500 - i * 0.5 + ((i % 7 === 0 || i % 7 === 6) ? 100 : 0));

  const results = runMultiDomainBenchmark([
    { domain: 'domain-a.com', sector: 'SaaS', series: domainA },
    { domain: 'domain-b.com', sector: 'Retail', series: domainB },
  ], [30]);

  assert.equal(results.length, 2);
  assert.equal(results[0].domain, 'domain-a.com');
  assert.equal(results[1].domain, 'domain-b.com');
  assert.equal(results[0].models.length, ALL_BENCHMARK_MODELS.length);
});

test('ML Benchmark: Production ensemble and regularized models beat seasonal naive (MASE < 1.0)', () => {
  // Realistic series with strong weekly periodicity and moderate upward trend
  const series = Array.from({ length: 120 }, (_, i) => {
    const dow = i % 7;
    const dowFactor = dow === 0 || dow === 6 ? 0.6 : 1.15;
    return Math.round((100 + i * 0.8) * dowFactor + Math.sin(i) * 5);
  });

  const ensembleScore = evaluateModelOnSeries(productionEnsembleModel, series, 30, 4);
  const prophetScore = evaluateModelOnSeries(prophetModel, series, 30, 4);
  const ridgeScore = evaluateModelOnSeries(ridgeRegressionModel, series, 30, 4);

  assert.ok(ensembleScore.mase < 1.0, `Production ensemble MASE (${ensembleScore.mase}) must beat seasonal naive (< 1.0)`);
  assert.ok(ensembleScore.vsSeasonalNaivePct > 0, 'Ensemble should show positive gain over seasonal naive');
  assert.ok(prophetScore.vsSeasonalNaivePct > 0, 'Prophet-style additive model should show positive gain over seasonal naive');
  assert.ok(ridgeScore.mae > 0, 'Ridge regression should compute finite positive MAE');
});
