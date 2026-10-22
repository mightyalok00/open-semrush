#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import compiled forecast engine
let semrushModule;
for (const p of ['../dist/index.js', '../dist/semrush/index.js', '../dist/forecast.js']) {
  try {
    semrushModule = await import(p);
    break;
  } catch {}
}

if (!semrushModule || !semrushModule.generateTrafficForecast) {
  console.error('Error: Could not load forecast engine. Run `npm run build` first.');
  process.exit(1);
}

const { generateTrafficForecast, FORECAST_MODEL_VERSION } = semrushModule;

const dataPath = path.resolve(__dirname, '../data/historical-gsc-anonymized-180d.json');
if (!fs.existsSync(dataPath)) {
  console.error(`Error: Dataset not found at ${dataPath}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const observations = raw.dailyObservations || [];

console.log('='.repeat(78));
console.log('OPEN SEMRUSH: INDEPENDENT FORECAST ACCURACY & BACKTEST VERIFICATION');
console.log('='.repeat(78));
console.log(`Telemetry Dataset:    ${raw.siteUrl} (${raw.totalDays} consecutive days)`);
console.log(`Date Range:           ${raw.startDate} to ${raw.endDate}`);
console.log(`Total Observed Volume: ${raw.totalClicks.toLocaleString()} clicks across ${raw.totalImpressions.toLocaleString()} impressions`);
console.log(`Model Version:        ${FORECAST_MODEL_VERSION}`);
console.log(`Methodology:          Leakage-Free Rolling-Origin Temporal Holdout Cross-Validation`);
console.log('-'.repeat(78));

const report = generateTrafficForecast(raw.siteUrl, observations, { backtestFolds: 5 });

console.log('\nPROJECTIONS WITH 95% PARAMETRIC UNCERTAINTY INTERVALS:');
for (const h of [30, 90, 180]) {
  const horizon = report.horizons[h];
  if (horizon) {
    const margin = Math.round((horizon.upper95TotalClicks - horizon.lower95TotalClicks) / 2);
    console.log(`  ${String(h).padStart(3)}-Day Horizon: ${horizon.expectedTotalClicks.toLocaleString()} expected clicks ` +
      `(95% CI: [${horizon.lower95TotalClicks.toLocaleString()}, ${horizon.upper95TotalClicks.toLocaleString()}], margin: ±${margin.toLocaleString()})`);
  }
}

console.log('\nEMPIRICAL ROLLING-ORIGIN BACKTEST ACCURACY VS BASELINES:');
console.log(`  Temporal Data Leakage Free: ${report.backtestEvaluation.dataLeakageFree ? 'VERIFIED (max(T_train) < min(T_test))' : 'FAILED'}`);

const metrics = report.backtestEvaluation.metrics;
const rows = [];
let passAccuracy = true;

for (const [h, m] of Object.entries(metrics)) {
  if (!m) continue;
  const improvement = ((m.naiveMae - m.mae) / m.naiveMae) * 100;
  if (improvement < 30) passAccuracy = false;

  rows.push({
    'Horizon': `${h} Days`,
    'Model MAE': `${m.mae.toFixed(2)} clicks`,
    'Naive MAE': `${m.naiveMae.toFixed(2)} clicks`,
    'Mean MAE': `${m.meanMae.toFixed(2)} clicks`,
    'vs Naive': `+${improvement.toFixed(1)}%`,
    'RMSE': m.rmse.toFixed(2),
    'MAPE': `${(m.mape * 100).toFixed(2)}%`,
    'Directional Bias': `${m.bias >= 0 ? '+' : ''}${m.bias.toFixed(2)} clicks`,
    '95% Coverage': `${(m.coverage95 * 100).toFixed(1)}%`,
  });
}

console.table(rows);
console.log('Verification Standard: Model MAE must beat standard Naive persistence baseline by >= 30%.');

if (!report.backtestEvaluation.dataLeakageFree || !passAccuracy) {
  console.error('\nFAIL: Model failed accuracy threshold or data leakage check.');
  process.exit(1);
}

console.log('\nRESULT: ALL FORECAST ACCURACY & BACKTEST CHECKS PASSED DETERMINISTICALLY.');
process.exit(0);
