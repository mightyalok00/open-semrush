import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSearchConsoleReport, listSearchConsoleSites } from '../dist/search-console.js';
import { DataForSeoAdapter } from '../dist/provider-adapter.js';
import { fetchRealKeywordResearch } from '../dist/keywords.js';

test('GSC: full ingestion workflow with query and page dimensions and token refresh', async () => {
  const capturedRequests = [];
  const fakeToken = 'mock-gsc-access-token-fixture-12345';

  const fetchImpl = async (url, init) => {
    capturedRequests.push({ url: String(url), init });

    // Handle OAuth token refresh
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({
        access_token: fakeToken,
        expires_in: 3600,
        token_type: 'Bearer',
      }), { status: 200 });
    }

    // Handle Webmasters Sites listing
    if (String(url).endsWith('/webmasters/v3/sites')) {
      return new Response(JSON.stringify({
        siteEntry: [
          { siteUrl: 'sc-domain:production-saas-platform.com', permissionLevel: 'siteOwner' },
          { siteUrl: 'https://production-saas-platform.com/', permissionLevel: 'siteFullUser' },
        ],
      }), { status: 200 });
    }

    // Handle Search Analytics Query
    if (String(url).includes('/searchAnalytics/query')) {
      const body = JSON.parse(init.body);
      const isAggregated = !body.dimensions;

      if (isAggregated) {
        return new Response(JSON.stringify({
          rows: [
            { clicks: 1250, impressions: 25000, ctr: 0.05, position: 4.8 },
          ],
        }), { status: 200 });
      }

      // Query + Page dimensions response
      return new Response(JSON.stringify({
        rows: [
          { keys: ['enterprise crm software', 'https://production-saas-platform.com/crm'], clicks: 500, impressions: 8000, ctr: 0.0625, position: 3.2 },
          { keys: ['b2b sales automation', 'https://production-saas-platform.com/sales'], clicks: 350, impressions: 7000, ctr: 0.05, position: 5.1 },
          { keys: ['crm pricing plans', 'https://production-saas-platform.com/pricing'], clicks: 200, impressions: 5000, ctr: 0.04, position: 8.5 },
          // Striking distance candidate (rank 12.4, high impressions)
          { keys: ['best sales tools for startups', 'https://production-saas-platform.com/tools'], clicks: 45, impressions: 1800, ctr: 0.025, position: 12.4 },
          // Cannibalization candidate on query 'enterprise crm software'
          { keys: ['enterprise crm software', 'https://production-saas-platform.com/enterprise'], clicks: 155, impressions: 3200, ctr: 0.048, position: 6.4 },
        ],
      }), { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
  };

  // 1. Verify Site Listing
  const sites = await listSearchConsoleSites({
    clientId: 'gsc-client-id.apps.googleusercontent.com',
    clientSecret: 'gsc-client-secret-12345',
    refreshToken: '1//04_refresh_token_abc',
    fetchImpl,
  });

  assert.equal(sites.length, 2);
  assert.equal(sites[0].siteUrl, 'sc-domain:production-saas-platform.com');
  assert.equal(sites[0].permissionLevel, 'siteOwner');

  // 2. Ingest Search Analytics with deep intelligence
  const report = await fetchSearchConsoleReport({
    siteUrl: 'sc-domain:production-saas-platform.com',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    dimensions: ['query', 'page'],
    includeIntelligence: true,
    clientId: 'gsc-client-id.apps.googleusercontent.com',
    clientSecret: 'gsc-client-secret-12345',
    refreshToken: '1//04_refresh_token_abc',
    fetchImpl,
  });

  assert.equal(report.provider, 'google-search-console');
  assert.equal(report.verified, true);
  assert.equal(report.provenance.tier, 'verified_provider');
  assert.equal(report.rows.length, 5);
  assert.equal(report.totals.clicks, 1250);

  // Intelligence assertions
  assert.ok(report.intelligence);
  const striking = report.intelligence.strikingDistanceQueries;
  assert.ok(striking.length >= 1);
  assert.equal(striking[0].query, 'best sales tools for startups');
  assert.equal(striking[0].position, 12.4);

  const cannibal = report.intelligence.cannibalizationIssues;
  assert.ok(cannibal.length >= 1);
  assert.equal(cannibal[0].query, 'enterprise crm software');
  assert.equal(cannibal[0].competingPages.length, 2);
});

test('DataForSEO Adapter: health check, credential detection & live payload parsing', async () => {
  const adapter = new DataForSeoAdapter();

  // Test unconfigured state
  const prevLogin = process.env.DATAFORSEO_LOGIN;
  const prevPass = process.env.DATAFORSEO_PASSWORD;
  delete process.env.DATAFORSEO_LOGIN;
  delete process.env.DATAFORSEO_PASSWORD;

  assert.equal(adapter.isConfigured(), false);
  const unconfiguredStatus = await adapter.getStatus();
  assert.equal(unconfiguredStatus.isConfigured, false);
  assert.match(unconfiguredStatus.message, /Unmeasured queries will return explicit unavailable states/);

  // Test configured state
  process.env.DATAFORSEO_LOGIN = 'sandbox_user';
  process.env.DATAFORSEO_PASSWORD = 'sandbox_password';
  assert.equal(adapter.isConfigured(), true);
  const configuredStatus = await adapter.getStatus();
  assert.equal(configuredStatus.isConfigured, true);
  assert.match(configuredStatus.message, /DataForSEO credentials configured/);

  // Ingestion with DataForSEO live payload mock
  const fetchImpl = async (url, init) => {
    assert.match(String(url), /dataforseo_labs\/google\/keyword_suggestions\/live/);
    assert.equal(init.method, 'POST');
    assert.ok(init.headers.Authorization.startsWith('Basic '));

    return new Response(JSON.stringify({
      version: '0.1.2026',
      status_code: 20000,
      tasks: [
        {
          id: '01234567-dfs-task',
          status_code: 20000,
          result: [
            {
              seed_keyword: 'crm software',
              total_count: 3,
              items: [
                {
                  keyword: 'crm software for small business',
                  keyword_info: {
                    search_volume: 18100,
                    cpc: 14.25,
                    competition_level: 'HIGH',
                  },
                },
                {
                  keyword: 'best crm software reviews',
                  keyword_info: {
                    search_volume: 4400,
                    cpc: 8.50,
                    competition_level: 'MEDIUM',
                  },
                },
                {
                  keyword: 'how to choose crm software',
                  keyword_info: {
                    search_volume: 1600,
                    cpc: 3.20,
                    competition_level: 'LOW',
                  },
                },
              ],
            },
          ],
        },
      ],
    }), { status: 200 });
  };

  const report = await fetchRealKeywordResearch({
    query: 'crm software',
    provider: 'dataforseo',
    fetchImpl,
  });

  assert.equal(report.provider, 'DataForSEO Labs API');
  assert.equal(report.totalSuggestions, 3);
  assert.equal(report.provenance.tier, 'provider_api');
  assert.equal(report.provenance.isFactual, true);

  const top = report.suggestions[0];
  assert.equal(top.keyword, 'crm software for small business');
  assert.equal(top.searchVolume, 18100);
  assert.equal(top.searchVolumeStatus, 'measured');
  assert.equal(top.cpcUsd, 14.25);
  assert.equal(top.source, 'dataforseo');

  const question = report.suggestions.find(s => s.category === 'question');
  assert.ok(question);
  assert.equal(question.keyword, 'how to choose crm software');

  // Restore environment
  if (prevLogin) process.env.DATAFORSEO_LOGIN = prevLogin; else delete process.env.DATAFORSEO_LOGIN;
  if (prevPass) process.env.DATAFORSEO_PASSWORD = prevPass; else delete process.env.DATAFORSEO_PASSWORD;
});

test('Real Keywords: unconfigured paid provider returns explicit unavailable volume states', async () => {
  const prevLogin = process.env.DATAFORSEO_LOGIN;
  const prevPass = process.env.DATAFORSEO_PASSWORD;
  delete process.env.DATAFORSEO_LOGIN;
  delete process.env.DATAFORSEO_PASSWORD;

  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    const q = u.searchParams.get('q') || '';
    return new Response(JSON.stringify([q, [q + ' free trial', q + ' pricing plans']]), { status: 200 });
  };

  const report = await fetchRealKeywordResearch({
    query: 'email marketing',
    provider: 'auto',
    fetchImpl,
  });

  assert.equal(report.provider, 'Google Suggest Autocomplete API');
  assert.ok(report.suggestions.length >= 2);
  for (const s of report.suggestions) {
    assert.equal(s.searchVolume, null);
    assert.equal(s.searchVolumeStatus, 'unavailable');
    assert.ok(typeof s.modeledSearchVolume === 'number' && s.modeledSearchVolume > 0);
  }

  if (prevLogin) process.env.DATAFORSEO_LOGIN = prevLogin;
  if (prevPass) process.env.DATAFORSEO_PASSWORD = prevPass;
});
