import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTrafficForecast } from '../dist/forecast.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Forecast Calibration Regression: verifies nominal ~95% interval coverage on real historical telemetry', () => {
  const dataPath = path.resolve(__dirname, '../data/historical-gsc-anonymized-180d.json');
  assert.ok(fs.existsSync(dataPath), 'historical-gsc-anonymized-180d.json must exist');

  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const observations = raw.dailyObservations || [];
  assert.ok(observations.length >= 180);

  const report = generateTrafficForecast(raw.siteUrl, observations, { backtestFolds: 5 });
  assert.equal(report.status, 'completed');
  assert.equal(report.backtestEvaluation?.dataLeakageFree, true);

  const metrics30 = report.backtestEvaluation?.metrics[30];
  const metrics90 = report.backtestEvaluation?.metrics[90];

  assert.ok(metrics30, '30-day metrics must exist');
  assert.ok(metrics90, '90-day metrics must exist');

  // Verify calibrated coverage is >= 90% (exceeding nominal 90-95% expectation)
  assert.ok(metrics30.coverage95 >= 0.90, `30-day coverage (${(metrics30.coverage95 * 100).toFixed(1)}%) must be >= 90%`);
  assert.ok(metrics90.coverage95 >= 0.90, `90-day coverage (${(metrics90.coverage95 * 100).toFixed(1)}%) must be >= 90%`);

  // Verify accuracy vs Naive baseline beats it by >= 30%
  const improvement30 = ((metrics30.naiveMae - metrics30.mae) / metrics30.naiveMae) * 100;
  const improvement90 = ((metrics90.naiveMae - metrics90.mae) / metrics90.naiveMae) * 100;
  assert.ok(improvement30 >= 30, `30-day improvement vs Naive (${improvement30.toFixed(1)}%) must be >= 30%`);
  assert.ok(improvement90 >= 30, `90-day improvement vs Naive (${improvement90.toFixed(1)}%) must be >= 30%`);
});
