import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProductionControls, resetRateLimitsForTests } from '../scripts/production-controls.mjs';

function request({ method = 'GET', authorization, address = '192.0.2.10' } = {}) {
  return { method, headers: authorization ? { authorization } : {}, socket: { remoteAddress: address } };
}

test('protected API routes reject missing and incorrect bearer tokens', () => {
  resetRateLimitsForTests();
  process.env.OPEN_SEMRUSH_API_TOKEN = 'test-secret';
  process.env.NODE_ENV = 'test';
  assert.equal(checkProductionControls(request({ method: 'POST' }), '/api/audit', 1000)?.status, 401);
  assert.equal(checkProductionControls(request({ method: 'POST', authorization: 'Bearer wrong' }), '/api/audit', 1001)?.status, 401);
  delete process.env.OPEN_SEMRUSH_API_TOKEN;
});

test('protected API routes accept the configured bearer token', () => {
  resetRateLimitsForTests();
  process.env.OPEN_SEMRUSH_API_TOKEN = 'test-secret';
  const result = checkProductionControls(request({ method: 'POST', authorization: 'Bearer test-secret' }), '/api/audit', 2000);
  assert.equal(result, null);
  delete process.env.OPEN_SEMRUSH_API_TOKEN;
});

test('expensive endpoints have a lower independent request budget and return Retry-After', () => {
  resetRateLimitsForTests();
  process.env.OPEN_SEMRUSH_API_TOKEN = 'test-secret';
  for (let i = 0; i < 10; i++) {
    assert.equal(checkProductionControls(request({ method: 'POST', authorization: 'Bearer test-secret' }), '/api/audit', 3000 + i), null);
  }
  const rejected = checkProductionControls(request({ method: 'POST', authorization: 'Bearer test-secret' }), '/api/audit', 3010);
  assert.equal(rejected?.status, 429);
  assert.equal(rejected?.headers?.['Retry-After'], '60');
  delete process.env.OPEN_SEMRUSH_API_TOKEN;
});

test('production mode fails closed for protected routes when no token is configured', () => {
  resetRateLimitsForTests();
  delete process.env.OPEN_SEMRUSH_API_TOKEN;
  process.env.NODE_ENV = 'production';
  const result = checkProductionControls(request({ method: 'POST' }), '/api/audit', 4000);
  assert.equal(result?.status, 503);
  process.env.NODE_ENV = 'test';
});

test('health endpoint is not subject to bearer authentication', () => {
  resetRateLimitsForTests();
  process.env.OPEN_SEMRUSH_API_TOKEN = 'test-secret';
  assert.equal(checkProductionControls(request(), '/api/health', 5000), null);
  delete process.env.OPEN_SEMRUSH_API_TOKEN;
});

test('stored project and history endpoints require authentication', () => {
  resetRateLimitsForTests();
  process.env.OPEN_SEMRUSH_API_TOKEN = 'test-secret';
  assert.equal(checkProductionControls(request({ method: 'GET' }), '/api/projects', 6000)?.status, 401);
  assert.equal(checkProductionControls(request({ method: 'GET', authorization: 'Bearer test-secret' }), '/api/history', 6001), null);
  delete process.env.OPEN_SEMRUSH_API_TOKEN;
});
