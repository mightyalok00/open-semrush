import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAiSearchVisibility,
  extractBrandFromDomain,
  generateDefaultAiPromptSamples,
} from '../dist/index.js';

test('extractBrandFromDomain correctly derives clean brand name', () => {
  assert.equal(extractBrandFromDomain('stripe.com'), 'Stripe');
  assert.equal(extractBrandFromDomain('https://www.hubspot.com/blog'), 'Hubspot');
  assert.equal(extractBrandFromDomain('vercel.app'), 'Vercel');
});

test('generateDefaultAiPromptSamples constructs balanced multi-intent prompt matrix', () => {
  const samples = generateDefaultAiPromptSamples('stripe.com', 'Stripe');
  assert.equal(samples.length, 8);
  const categories = samples.map(s => s.category);
  assert.ok(categories.includes('commercial'));
  assert.ok(categories.includes('informational'));
  assert.ok(categories.includes('transactional'));
  assert.ok(categories.includes('navigational'));
});

test('evaluateAiSearchVisibility evaluates brand citations and Share of AI Voice', async () => {
  const report = await evaluateAiSearchVisibility('stripe.com', 'Stripe');

  assert.equal(report.domain, 'stripe.com');
  assert.equal(report.brandName, 'Stripe');
  assert.equal(report.sampleSize, 8);
  assert.ok(report.visibilityRate >= 0 && report.visibilityRate <= 1);
  assert.ok(report.citationRate >= 0 && report.citationRate <= 1);
  assert.ok(report.shareOfAiVoice >= 0 && report.shareOfAiVoice <= 100);
  assert.equal(report.results.length, 8);

  for (const res of report.results) {
    assert.ok(typeof res.brandMentioned === 'boolean');
    assert.ok(typeof res.brandCited === 'boolean');
    assert.ok(['positive', 'neutral', 'negative', 'unmentioned'].includes(res.sentiment));
    assert.ok(Array.isArray(res.competitorMentions));
    assert.ok(Array.isArray(res.citedUrls));
  }

  // Provenance check
  assert.ok(report.provenance);
  assert.equal(report.provenance.tier, 'statistical_model');
  assert.equal(report.provenance.dataSource, 'ai_visibility_benchmark_model');
  assert.ok(report.provenance.dataLimitations.length > 0);
});

test('evaluateAiSearchVisibility accepts custom prompts and custom brand overrides', async () => {
  const customPrompts = [
    'What is the pricing for Stripe billing?',
    'Top alternatives to Stripe in 2026',
  ];
  const report = await evaluateAiSearchVisibility('stripe.com', 'Stripe Payments', customPrompts);

  assert.equal(report.sampleSize, 2);
  assert.equal(report.brandName, 'Stripe Payments');
  assert.equal(report.results.length, 2);
  assert.equal(report.results[0].prompt, customPrompts[0]);
});
