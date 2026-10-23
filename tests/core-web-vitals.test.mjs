import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchCoreWebVitals,
  estimateSyntheticCoreWebVitals,
} from '../dist/index.js';

test('estimateSyntheticCoreWebVitals computes realistic Lighthouse metric bounds', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Fast Page</title>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body>
        <h1>Hello World</h1>
        <p>This is a fast clean page.</p>
        <img src="/logo.png" width="200" height="100">
        <script src="/app.js"></script>
      </body>
    </html>
  `;

  const metrics = estimateSyntheticCoreWebVitals('https://example.com/fast', html, 150);

  assert.equal(metrics.url, 'https://example.com/fast');
  assert.ok(metrics.performanceScore >= 70 && metrics.performanceScore <= 100);
  assert.ok(metrics.fcpMs >= 300 && metrics.fcpMs <= 2000);
  assert.ok(metrics.lcpMs >= metrics.fcpMs);
  assert.ok(metrics.cls >= 0 && metrics.cls <= 0.2);
  assert.ok(metrics.tbtMs >= 0 && metrics.tbtMs <= 500);
  assert.ok(['good', 'needs_improvement', 'poor'].includes(metrics.assessment));
  assert.equal(metrics.isSyntheticHeuristic, true);
  assert.equal(metrics.provenance.tier, 'empirical_observation');
});

test('estimateSyntheticCoreWebVitals reflects penalties for heavy pages with unsized images', () => {
  let heavyHtml = '<html><head>';
  for (let i = 0; i < 15; i++) {
    heavyHtml += `<script src="/vendor-${i}.js"></script>`;
    heavyHtml += `<link rel="stylesheet" href="/theme-${i}.css">`;
  }
  heavyHtml += '</head><body>';
  for (let i = 0; i < 20; i++) {
    heavyHtml += `<img src="/heavy-${i}.jpg">`; // unsized images trigger CLS
  }
  heavyHtml += '</body></html>';

  const metrics = estimateSyntheticCoreWebVitals('https://example.com/heavy', heavyHtml, 900);

  assert.ok(metrics.performanceScore < 70);
  assert.ok(metrics.lcpMs > 2500);
  assert.ok(metrics.cls > 0.05);
  assert.ok(metrics.assessment === 'needs_improvement' || metrics.assessment === 'poor');
});

test('fetchCoreWebVitals gracefully falls back to synthetic heuristic in test/offline environment', async () => {
  const metrics = await fetchCoreWebVitals('https://example.com');

  assert.equal(metrics.url, 'https://example.com');
  assert.ok(metrics.performanceScore >= 0 && metrics.performanceScore <= 100);
  assert.ok(metrics.fcpMs > 0);
  assert.ok(metrics.lcpMs > 0);
  assert.ok(typeof metrics.cls === 'number');
  assert.ok(metrics.provenance);
});
