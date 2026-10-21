import test from 'node:test';
import assert from 'node:assert/strict';
import {
  predictCtrPowerLaw,
  calibratePowerLawModel,
  estimateCompetitorVisibility,
  assertPublicHttpUrl,
  auditSinglePage,
} from '../dist/index.js';
import {
  checkProductionControls,
  resetRateLimitsForTests,
} from '../scripts/production-controls.mjs';

function mockReq({ method = 'GET', authorization, headers = {}, address = '198.51.100.5' } = {}) {
  return {
    method,
    headers: { ...(authorization ? { authorization } : {}), ...headers },
    socket: { remoteAddress: address },
  };
}

// ---------------------------------------------------------------------------
// 1. Benchmarking & Crawl Resilience / SPA Client Render Detection
// ---------------------------------------------------------------------------

test('Crawler SPA Detection: identifies client-side hydration with minimal initial markup', async () => {
  const spaHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Modern React SPA App</title></head>
      <body>
        <div id="root"></div>
        <script src="/_next/static/chunks/main.js"></script>
      </body>
    </html>
  `;

  const mockRequester = async () =>
    new Response(spaHtml, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'strict-transport-security': 'max-age=31536000',
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'SAMEORIGIN',
        'x-content-type-options': 'nosniff',
      },
    });

  const mockResolver = async () => [{ address: '93.184.216.34', family: 4 }];

  const result = await auditSinglePage(
    'https://example.com/spa-app',
    5000,
    'REA-SemrushBot/2.0',
    { requester: mockRequester, resolver: mockResolver }
  );

  assert.equal(result.spaDetected, true);
  assert.equal(result.renderEngine, 'raw_html');
  const spaIssue = result.issues.find(i => i.code === 'SPA_CLIENT_RENDER_DETECTED');
  assert.ok(spaIssue, 'Should flag SPA_CLIENT_RENDER_DETECTED issue');
  assert.equal(spaIssue.severity, 'warning');
  assert.match(spaIssue.recommendation, /Server-Side Rendering/i);
});

// ---------------------------------------------------------------------------
// 2. First-Party Boundary: Competitor SERP Visibility Estimation
// ---------------------------------------------------------------------------

test('Competitor Visibility: estimates clicks and average position from observed rankings', () => {
  const observedRankings = [
    { query: 'seo software', position: 1, searchVolume: 10000 },
    { query: 'backlink checker', position: 2, searchVolume: 5000 },
    { query: 'keyword research tool', position: 5, searchVolume: 8000 },
  ];

  const report = estimateCompetitorVisibility('competitor.com', observedRankings);
  assert.equal(report.competitorDomain, 'competitor.com');
  assert.equal(report.observedKeywordsCount, 3);
  assert.ok(report.estimatedMonthlyClicks > 0, 'Estimated clicks must be greater than zero');
  assert.equal(report.averagePosition, 2.7);
  assert.equal(report.provenance.tier, 'statistical_model');
  assert.equal(report.provenance.isFactual, false);
});

// ---------------------------------------------------------------------------
// 3. Model Nature: SERP Layout Modifiers & Closed-Loop Calibration
// ---------------------------------------------------------------------------

test('ML Power-Law: AI Overview and Local 3-Pack layout modifiers attenuate CTR', () => {
  const baselinePos1 = predictCtrPowerLaw(1);
  const aiOverviewPos1 = predictCtrPowerLaw(1, { hasAiOverview: true });
  assert.ok(aiOverviewPos1.adjustedCtr < baselinePos1.baseCtr, 'AI Overview should reduce CTR at pos 1');
  assert.ok(aiOverviewPos1.featureModifiersApplied.some(m => m.includes('AI Overview')));

  const baselinePos2 = predictCtrPowerLaw(2);
  const localPackPos2 = predictCtrPowerLaw(2, { hasLocalPack: true });
  assert.ok(localPackPos2.adjustedCtr < baselinePos2.baseCtr, 'Local Pack should reduce CTR at pos 2');
  assert.ok(localPackPos2.featureModifiersApplied.some(m => m.includes('Local 3-Pack')));
});

test('ML Closed-Loop Calibration: fits empirical GSC telemetry to power law curve', () => {
  const empiricalGscData = [
    { position: 1, ctr: 0.32 },
    { position: 2, ctr: 0.16 },
    { position: 3, ctr: 0.10 },
    { position: 4, ctr: 0.07 },
    { position: 5, ctr: 0.05 },
    { position: 10, ctr: 0.015 },
  ];

  const calibrated = calibratePowerLawModel(empiricalGscData);
  assert.equal(calibrated.sampleSize, 6);
  assert.ok(calibrated.alpha > 0.25 && calibrated.alpha < 0.45, `Alpha (${calibrated.alpha}) should be reasonable`);
  assert.ok(calibrated.beta > 0.50 && calibrated.beta < 1.60, `Beta (${calibrated.beta}) should reflect power decay`);
  assert.ok(calibrated.rSquared > 0.90, `R^2 (${calibrated.rSquared}) should show strong empirical fit`);
});

// ---------------------------------------------------------------------------
// 4. DNS Pinning & SSRF: Alternative IP Representations & Cloud Metadata
// ---------------------------------------------------------------------------

test('SSRF Guard: rejects alternative IP encodings, 0.0.0.0, and cloud metadata hostnames', async () => {
  const invalidTargets = [
    'http://0177.0.0.1/admin',
    'http://0x7f000001/',
    'http://2130706433/',
    'http://0.0.0.0:8000/',
    'http://instance-data/latest/meta-data',
  ];

  for (const target of invalidTargets) {
    await assert.rejects(
      () => assertPublicHttpUrl(target),
      /Alternative and non-canonical IP representations are not allowed|Local and metadata hostnames are not allowed|Private or reserved IP addresses are not allowed/i,
      `Target ${target} should be rejected`
    );
  }
});

// ---------------------------------------------------------------------------
// 5. Authentication Scope: Role-Based Access Control (RBAC) & Multi-Tenancy
// ---------------------------------------------------------------------------

test('RBAC: enforces viewer, analyst, and admin permissions across endpoints', () => {
  resetRateLimitsForTests();
  process.env.OPEN_SEMRUSH_API_TOKENS = 'viewer-key:viewer, analyst-key:analyst, admin-key:admin';
  process.env.NODE_ENV = 'test';

  // 1. Viewer role: can GET, but cannot POST or DELETE
  const viewerRead = checkProductionControls(mockReq({ method: 'GET', authorization: 'Bearer viewer-key' }), '/api/projects', 1000);
  assert.equal(viewerRead, null, 'Viewer should be able to read /api/projects');

  const viewerWrite = checkProductionControls(mockReq({ method: 'POST', authorization: 'Bearer viewer-key' }), '/api/audit', 1001);
  assert.equal(viewerWrite?.status, 403, 'Viewer must not be permitted to POST /api/audit');
  assert.match(viewerWrite?.body?.error, /Viewer role is restricted to read-only/i);

  // 2. Analyst role: can POST audits, but cannot DELETE
  const analystAudit = checkProductionControls(mockReq({ method: 'POST', authorization: 'Bearer analyst-key' }), '/api/audit', 1002);
  assert.equal(analystAudit, null, 'Analyst should be able to trigger audits');

  const analystDelete = checkProductionControls(mockReq({ method: 'DELETE', authorization: 'Bearer analyst-key' }), '/api/rank-tracker/keywords', 1003);
  assert.equal(analystDelete?.status, 403, 'Analyst must not be permitted to DELETE');
  assert.match(analystDelete?.body?.error, /Analyst role is not authorized/i);

  // 3. Admin role: unrestricted access
  const adminAudit = checkProductionControls(mockReq({ method: 'POST', authorization: 'Bearer admin-key' }), '/api/audit', 1004);
  assert.equal(adminAudit, null, 'Admin should be able to perform audits');

  const adminDelete = checkProductionControls(mockReq({ method: 'DELETE', authorization: 'Bearer admin-key' }), '/api/rank-tracker/keywords', 1005);
  assert.equal(adminDelete, null, 'Admin should be able to perform deletions');

  delete process.env.OPEN_SEMRUSH_API_TOKENS;
});

test('Multi-Tenancy: validates x-tenant-id header format', () => {
  resetRateLimitsForTests();
  process.env.OPEN_SEMRUSH_API_TOKEN = 'test-secret';

  // Valid tenant header
  const validTenant = checkProductionControls(
    mockReq({ method: 'GET', authorization: 'Bearer test-secret', headers: { 'x-tenant-id': 'client_corp-123' } }),
    '/api/projects',
    2000
  );
  assert.equal(validTenant, null);

  // Invalid tenant header (script injection or path traversal)
  const invalidTenant = checkProductionControls(
    mockReq({ method: 'GET', authorization: 'Bearer test-secret', headers: { 'x-tenant-id': '../evil<script>' } }),
    '/api/projects',
    2001
  );
  assert.equal(invalidTenant?.status, 400);
  assert.match(invalidTenant?.body?.error, /Invalid x-tenant-id header/i);

  delete process.env.OPEN_SEMRUSH_API_TOKEN;
});
