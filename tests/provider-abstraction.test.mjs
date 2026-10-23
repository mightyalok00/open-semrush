import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderRegistry,
  ProviderCache,
  ProviderRateLimiter,
  createStandardProvenance,
  fetchRealKeywordResearch,
} from '../dist/index.js';

test('Provider Abstraction: ProviderRegistry registers all standard adapters and reports status', async () => {
  const registry = ProviderRegistry.getInstance();
  const allProviders = registry.getAll();
  assert.ok(allProviders.length >= 6);

  const gsc = registry.get('google_search_console');
  assert.ok(gsc);
  assert.equal(gsc.category, 'search_console');

  const crawler = registry.get('active_crawler');
  assert.ok(crawler);
  assert.equal(crawler.category, 'crawler');
  assert.equal(crawler.isConfigured(), true);

  const suggest = registry.get('google_suggest');
  assert.ok(suggest);
  assert.equal(suggest.category, 'external_keywords');

  const dataForSeo = registry.get('dataforseo');
  assert.ok(dataForSeo);

  const models = registry.get('open_semrush_models');
  assert.ok(models);
  assert.equal(models.isConfigured(), true);

  const statuses = await registry.getStatusSummary();
  assert.equal(statuses.length, allProviders.length);
  for (const st of statuses) {
    assert.ok(st.id);
    assert.ok(st.name);
    assert.ok(typeof st.isConfigured === 'boolean');
    assert.ok(typeof st.isHealthy === 'boolean');
    assert.ok(st.message);
  }
});

test('Provider Abstraction: ProviderCache enforces TTL expiration', async () => {
  const cache = new ProviderCache();
  cache.set('test_key', { data: 123 }, 0.05); // 50ms TTL
  assert.deepEqual(cache.get('test_key'), { data: 123 });

  await new Promise(r => setTimeout(r, 65));
  assert.equal(cache.get('test_key'), null);
});

test('Provider Abstraction: ProviderRateLimiter limits request bursts and returns retryAfter', () => {
  const limiter = new ProviderRateLimiter(2, 5000); // 2 requests per 5s window
  const res1 = limiter.checkLimit('user_ip_1');
  assert.equal(res1.allowed, true);
  assert.equal(res1.remaining, 1);

  const res2 = limiter.checkLimit('user_ip_1');
  assert.equal(res2.allowed, true);
  assert.equal(res2.remaining, 0);

  const res3 = limiter.checkLimit('user_ip_1');
  assert.equal(res3.allowed, false);
  assert.ok(res3.retryAfterSeconds && res3.retryAfterSeconds > 0);
});

test('Provider Abstraction: createStandardProvenance attaches explicit classification metadata', () => {
  const prov = createStandardProvenance({
    tier: 'empirical_observation',
    dataSource: 'Safe Web Crawler',
    methodology: 'Socket HTTP GET with DNS Pinning',
    geography: 'uk',
    device: 'mobile',
  });

  assert.equal(prov.tier, 'empirical_observation');
  assert.equal(prov.isFactual, true);
  assert.equal(prov.metricType, 'measured');
  assert.equal(prov.geography, 'uk');
  assert.equal(prov.device, 'mobile');
  assert.ok(prov.retrievalTimestamp);
});

test('Provider Abstraction: Google Suggest query completions mark volume as unavailable when no commercial provider is configured', async () => {
  const fetchImpl = async () => new Response(JSON.stringify([
    'seo checklist',
    ['seo checklist 2026', 'seo checklist for developers'],
  ]), { status: 200 });

  const report = await fetchRealKeywordResearch({
    query: 'seo checklist',
    fetchImpl,
  });

  assert.equal(report.seedKeyword, 'seo checklist');
  assert.equal(report.provenance.tier, 'provider_api');
  assert.equal(report.provenance.metricType, 'unavailable');

  for (const s of report.suggestions) {
    assert.equal(s.searchVolume, null);
    assert.equal(s.searchVolumeStatus, 'unavailable');
    assert.ok(typeof s.modeledSearchVolume === 'number');
  }
});
