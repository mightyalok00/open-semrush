import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateKeywordDifficulty, classifySearchIntent, analyzeKeyword } from '../dist/keywords.js';
import { calculateCtrByPosition, parseSerpHtml } from '../dist/serp.js';
import { compareKeywordGap } from '../dist/domain.js';
import { assertPublicHttpUrl, isPublicIpAddress } from '../dist/url-safety.js';

test('keyword intent classification is stable and case-insensitive', () => {
  assert.equal(classifySearchIntent('BEST SEO TOOLS'), 'Commercial');
  assert.equal(classifySearchIntent('buy SEO software'), 'Transactional');
  assert.equal(classifySearchIntent('how search engines work'), 'Informational');
});

test('keyword metrics stay within documented numeric bounds', () => {
  const result = analyzeKeyword('technical seo audit');
  assert.ok(Number.isFinite(result.searchVolume) && result.searchVolume >= 0);
  assert.ok(Number.isFinite(result.keywordDifficulty) && result.keywordDifficulty >= 0 && result.keywordDifficulty <= 100);
  assert.equal(result.seasonalityTrend.length, 12);
  assert.ok(result.seasonalityTrend.every((value) => value >= 0 && value <= 100));
  assert.equal(calculateKeywordDifficulty(''), 0);
});

test('CTR model returns zero for non-positive positions', () => {
  assert.equal(calculateCtrByPosition(0, false), 0);
  assert.equal(calculateCtrByPosition(-1, false), 0);
  assert.ok(calculateCtrByPosition(1, false) > calculateCtrByPosition(10, false));
});

test('SERP parser ignores invalid URLs and returns a stable empty result', () => {
  const result = parseSerpHtml('<html><body>no organic results</body></html>', 'example query');
  assert.equal(result.query, 'example query');
  assert.deepEqual(result.rankings, []);
});

test('keyword gap comparison separates shared, unique, and missing terms', () => {
  const result = compareKeywordGap('a.example', ['SEO', 'analytics'], 'b.example', ['seo', 'keywords']);
  assert.deepEqual(result.sharedKeywords, ['seo']);
  assert.deepEqual(result.uniqueToDomainA, ['analytics']);
  assert.deepEqual(result.missingForDomainA, ['keywords']);
});

test('outbound URL guard rejects loopback, private, link-local, and reserved addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1', 'fe80::1']) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress('8.8.8.8'), true);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);
});

test('outbound URL guard rejects unsafe schemes, credentials, and localhost without network access', async () => {
  await assert.rejects(assertPublicHttpUrl('file:///etc/passwd'), /Only HTTP and HTTPS/);
  await assert.rejects(assertPublicHttpUrl('http://127.0.0.1/'), /Private or reserved IP/);
  await assert.rejects(assertPublicHttpUrl('http://localhost/'), /Local and metadata hostnames/);
  await assert.rejects(assertPublicHttpUrl('https://user:pass@example.com/'), /credentials/);
});
