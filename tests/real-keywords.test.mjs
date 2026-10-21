import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchGoogleSuggestions,
  fetchRealKeywordResearch,
  analyzeKeyword,
} from '../dist/keywords.js';

test('analyzeKeyword: attaches explicit statistical_model provenance', () => {
  const result = analyzeKeyword('technical seo');
  assert.ok(result.provenance);
  assert.equal(result.provenance.tier, 'statistical_model');
  assert.equal(result.provenance.isFactual, false);
  assert.match(result.provenance.warning || '', /Modeled search volume/);
});

test('fetchGoogleSuggestions: parses official Google autocomplete json structure', async () => {
  const fetchImpl = async (url) => {
    assert.match(String(url), /suggestqueries\.google\.com\/complete\/search/);
    return new Response(JSON.stringify([
      'seo audit',
      ['seo audit checklist', 'seo audit tool', 'seo audit free', 'seo audit services'],
    ]), { status: 200 });
  };

  const suggestions = await fetchGoogleSuggestions('seo audit', { fetchImpl });
  assert.equal(suggestions.length, 4);
  assert.equal(suggestions[0], 'seo audit checklist');
  assert.equal(suggestions[1], 'seo audit tool');
});

test('fetchRealKeywordResearch: categorizes queries and attaches provider_api provenance', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    const query = u.searchParams.get('q') || '';
    if (query.startsWith('how')) {
      return new Response(JSON.stringify([query, ['how to do a technical seo audit']]), { status: 200 });
    }
    if (query.includes('vs')) {
      return new Response(JSON.stringify([query, ['semrush vs ahrefs vs open-semrush']]), { status: 200 });
    }
    return new Response(JSON.stringify([query, ['seo audit', 'best seo audit template for agency']]), { status: 200 });
  };

  const report = await fetchRealKeywordResearch({
    query: 'seo audit',
    fetchImpl,
  });

  assert.equal(report.seedKeyword, 'seo audit');
  assert.equal(report.provenance.tier, 'provider_api');
  assert.equal(report.provenance.isFactual, true);
  assert.ok(report.suggestions.length >= 3);

  const question = report.suggestions.find(s => s.category === 'question');
  assert.ok(question);
  assert.equal(question.keyword, 'how to do a technical seo audit');

  const comparison = report.suggestions.find(s => s.category === 'comparison');
  assert.ok(comparison);
  assert.equal(comparison.keyword, 'semrush vs ahrefs vs open-semrush');

  const longTail = report.suggestions.find(s => s.category === 'long-tail');
  assert.ok(longTail);
});
