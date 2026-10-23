import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSeoContentBrief } from '../dist/index.js';

test('generateSeoContentBrief synthesizes intent-aligned brief for informational query', async () => {
  const brief = await generateSeoContentBrief('how to do technical seo audit');

  assert.equal(brief.keyword, 'how to do technical seo audit');
  assert.equal(brief.searchIntent, 'informational');
  assert.ok(brief.recommendedWordCount >= 2000);
  assert.ok(brief.recommendedTitle.includes('Technical Seo Audit'));
  assert.ok(brief.headingsOutline.length >= 8);

  const levels = brief.headingsOutline.map(h => h.level);
  assert.ok(levels.includes('h2'));
  assert.ok(levels.includes('h3'));

  assert.ok(brief.essentialQuestions.length >= 4);
  assert.ok(brief.targetEntities.length >= 3);
  assert.ok(brief.competitorBenchmark.medianWordCount > 1500);

  // Provenance check
  assert.ok(brief.provenance);
  assert.equal(brief.provenance.tier, 'statistical_model');
  assert.equal(brief.provenance.dataSource, 'serp_nlp_content_blueprint');
});

test('generateSeoContentBrief adapts outline and title for commercial comparison query', async () => {
  const brief = await generateSeoContentBrief('best payment gateways for ecommerce');

  assert.equal(brief.searchIntent, 'commercial');
  assert.ok(brief.recommendedTitle.toLowerCase().includes('reviewed') || brief.recommendedTitle.toLowerCase().includes('compared'));
  assert.ok(brief.headingsOutline.some(h => h.intent === 'competitor_comparison'));
});

test('generateSeoContentBrief respects manual targetWordCount and intent overrides', async () => {
  const brief = await generateSeoContentBrief('buy running shoes online', {
    searchIntent: 'transactional',
    targetWordCount: 1500,
  });

  assert.equal(brief.searchIntent, 'transactional');
  assert.equal(brief.recommendedWordCount, 1500);
  assert.ok(brief.headingsOutline.some(h => h.intent === 'offer_details'));
});
