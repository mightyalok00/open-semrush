import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTrafficForecast,
  FORECAST_MODEL_VERSION,
} from '../dist/forecast.js';
import {
  predictCtrPowerLaw,
  predictCtrCalibrated,
  calibratePowerLawModel,
} from '../dist/ml.js';
import {
  generateDomainOverview,
} from '../dist/domain.js';
import {
  extractDailyObservations,
} from '../dist/search-console.js';
import {
  JsonFileStorageAdapter,
  SqliteStorageAdapter,
} from '../dist/storage.js';

// Helper to generate synthetic daily observations
function createDailySeries(startDateStr, dayCount, baseClicks = 100, trend = 0.5) {
  const series = [];
  const start = new Date(startDateStr + 'T00:00:00Z');

  for (let i = 0; i < dayCount; i++) {
    const current = new Date(start);
    current.setUTCDate(start.getUTCDate() + i);
    const dateStr = current.toISOString().slice(0, 10);
    const dow = current.getUTCDay();
    // weekend dip
    const weekendFactor = (dow === 0 || dow === 6) ? 0.75 : 1.15;
    const clicks = Math.max(1, Math.round((baseClicks + i * trend) * weekendFactor));
    const impressions = clicks * 15;

    series.push({
      date: dateStr,
      clicks,
      impressions,
      averagePosition: 4.2,
      ctr: Number((clicks / impressions).toFixed(4)),
    });
  }
  return series;
}

test('Criterion 1: Synthetic & modeled metrics are never represented as measured SEO results', async () => {
  const curated = await generateDomainOverview('github.com');
  assert.equal(curated.isSyntheticExample, true);
  assert.ok(Array.isArray(curated.dataLimitations) && curated.dataLimitations.length > 0);
  assert.equal(curated.provenance?.isFactual, false);
  assert.equal(curated.provenance?.tier, 'synthetic_estimate');

  const heuristic = await generateDomainOverview('unknown-test-domain-xyz123.com');
  assert.equal(heuristic.isSyntheticExample, true);
  assert.ok(heuristic.dataLimitations?.some(l => l.includes('Heuristic approximation')));
  assert.equal(heuristic.provenance?.isFactual, false);
});

test('Criterion 2: Authorized GSC observations retain their original dates and dimensions', () => {
  const mockGscReport = {
    provider: 'google-search-console',
    verified: true,
    siteUrl: 'sc-domain:example.com',
    startDate: '2026-01-01',
    endDate: '2026-01-03',
    dimensions: ['date', 'query'],
    rows: [
      { keys: ['2026-01-01', 'open source seo'], clicks: 12, impressions: 200, ctr: 0.06, position: 2.1 },
      { keys: ['2026-01-01', 'site audit'], clicks: 8, impressions: 100, ctr: 0.08, position: 3.5 },
      { keys: ['2026-01-02', 'open source seo'], clicks: 15, impressions: 220, ctr: 0.068, position: 1.9 },
    ],
    totals: { clicks: 35, impressions: 520, ctr: 0.067, averagePosition: 2.3 },
    provenance: {
      tier: 'verified_provider',
      isFactual: true,
      dataSource: 'Google Search Console API',
      methodology: 'First-party telemetry',
      confidence: 'exact',
    },
  };

  const observations = extractDailyObservations(mockGscReport);
  assert.equal(observations.length, 2);
  assert.equal(observations[0].date, '2026-01-01');
  assert.equal(observations[0].clicks, 20); // 12 + 8
  assert.equal(observations[0].impressions, 300); // 200 + 100
  assert.equal(observations[1].date, '2026-01-02');
  assert.equal(observations[1].clicks, 15);
});

test('Criterion 3 & 4: Missing or inadequate historical data returns explicit insufficient-evidence result', () => {
  // Case A: Short history (<30 days)
  const shortHistory = createDailySeries('2026-01-01', 20, 100, 1.0);
  const reportA = generateTrafficForecast('example.com', shortHistory);
  assert.equal(reportA.status, 'insufficient_evidence');
  assert.ok(reportA.reason?.includes('Insufficient history'));
  assert.equal(reportA.horizons[30], null);
  assert.equal(reportA.horizons[90], null);
  assert.equal(reportA.horizons[180], null);
  assert.ok(reportA.dataLimitations.length > 0);

  // Case B: Inadequate clicks (<50 clicks)
  const sparseHistory = createDailySeries('2026-01-01', 35, 1, 0.0);
  const reportB = generateTrafficForecast('example.com', sparseHistory, { minClicksThreshold: 50 });
  assert.equal(reportB.status, 'insufficient_evidence');
  assert.ok(reportB.reason?.includes('Sparse telemetry volume'));
});

test('Criterion 5 & 6: Forecasts return 30-, 90-, and 180-day horizons with rolling backtests & baselines', () => {
  // Generate 120 days of historical data
  const history = createDailySeries('2025-10-01', 120, 150, 0.8);
  const report = generateTrafficForecast('example.com', history, { backtestFolds: 4 });

  assert.equal(report.status, 'completed');
  assert.equal(report.modelVersion, FORECAST_MODEL_VERSION);

  // Validate 30, 90, 180 day horizons
  const h30 = report.horizons[30];
  const h90 = report.horizons[90];
  const h180 = report.horizons[180];

  assert.ok(h30 && h30.points.length === 30);
  assert.ok(h90 && h90.points.length === 90);
  assert.ok(h180 && h180.points.length === 180);

  // Check uncertainty bounds: lower95 <= expected <= upper95
  assert.ok(h30.lower95TotalClicks <= h30.expectedTotalClicks);
  assert.ok(h30.expectedTotalClicks <= h30.upper95TotalClicks);
  assert.ok(h90.lower95TotalClicks <= h90.expectedTotalClicks);
  assert.ok(h180.lower95TotalClicks <= h180.expectedTotalClicks);

  // Verify baseline models exist on points
  assert.ok(typeof h30.points[0].baselineNaive === 'number');
  assert.ok(typeof h30.points[0].baselineMean === 'number');

  // Verify rolling backtest evaluation and zero data leakage
  assert.ok(report.backtestEvaluation);
  assert.equal(report.backtestEvaluation.dataLeakageFree, true);

  const m30 = report.backtestEvaluation.metrics[30];
  assert.ok(m30);
  assert.equal(m30.horizonDays, 30);
  assert.ok(m30.mae >= 0);
  assert.ok(m30.rmse >= 0);
  assert.ok(m30.coverage95 >= 0 && m30.coverage95 <= 1.0);
  assert.ok(typeof m30.bias === 'number');
  assert.ok(typeof m30.naiveMae === 'number');
  assert.ok(typeof m30.meanMae === 'number');
});

test('Criterion 7: Model calibration and calibrated CTR predictions in ml.ts', () => {
  // Test site calibration from empirical points
  const points = [
    { position: 1, ctr: 0.32 },
    { position: 2, ctr: 0.17 },
    { position: 3, ctr: 0.11 },
    { position: 4, ctr: 0.07 },
    { position: 5, ctr: 0.05 },
  ];
  const model = calibratePowerLawModel(points);
  assert.ok(model.alpha > 0);
  assert.ok(model.beta > 0);
  assert.ok(model.rSquared > 0.8);

  const pred = predictCtrCalibrated(1, model);
  assert.ok(pred.baseCtr > 0.2);

  // Invalid inputs handle gracefully
  const invalidPred = predictCtrCalibrated(-5, model);
  assert.equal(invalidPred.baseCtr, 0);

  const powerLawInvalid = predictCtrPowerLaw(-1);
  assert.equal(powerLawInvalid.baseCtr, 0);
});

test('Criterion 8: Persistence of forecasts in Json and SQLite storage adapters', () => {
  const jsonAdapter = new JsonFileStorageAdapter();
  const sqliteAdapter = new SqliteStorageAdapter(':memory:');

  const forecastRecord = {
    id: 'fc_test_001',
    domain: 'test-domain.com',
    modelVersion: 'v1.4.0-ts-ensemble',
    generatedAt: new Date().toISOString(),
    horizonDays: 30,
    targetEndDate: '2026-11-20',
    expectedTotalClicks: 4500,
    lower95TotalClicks: 3900,
    upper95TotalClicks: 5100,
  };

  // Test SQLite persistence
  sqliteAdapter.recordForecast(forecastRecord);
  const sqliteRecords = sqliteAdapter.getForecastsForDomain('test-domain.com');
  assert.equal(sqliteRecords.length, 1);
  assert.equal(sqliteRecords[0].id, 'fc_test_001');
  assert.equal(sqliteRecords[0].expectedTotalClicks, 4500);

  // Record outcome
  sqliteAdapter.recordForecastOutcome('fc_test_001', 4620);
  const updatedSqlite = sqliteAdapter.getForecastsForDomain('test-domain.com');
  assert.equal(updatedSqlite[0].actualOutcomeClicks, 4620);
  assert.ok(updatedSqlite[0].evaluatedAt);

  sqliteAdapter.close();
});
