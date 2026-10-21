import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';

let serverProcess;
let baseUrl;

async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not allocate a local test port.');
  }
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

before(async () => {
  const port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['scripts/semrush-server.mjs'], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN: '', GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '', GOOGLE_OAUTH_REFRESH_TOKEN: '' },
    stdio: 'ignore',
  });

  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  serverProcess.kill('SIGTERM');
  throw new Error(`Server did not become healthy: ${lastError ?? 'unknown error'}`);
});

after(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill('SIGTERM');
});

test('HTTP API reports health and labels modeled keyword data', async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'healthy');

  const keywordResponse = await fetch(`${baseUrl}/api/keyword?q=seo%20tools`);
  const keywordData = await keywordResponse.json();
  assert.equal(keywordResponse.status, 200);
  assert.equal(keywordData.dataProvenance.verified, false);
  assert.equal(keywordData.dataProvenance.type, 'modeled');
});

test('HTTP API rejects private audit targets and does not enable wildcard CORS', async () => {
  const response = await fetch(`${baseUrl}/api/audit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1/' }),
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.match((await response.json()).error, /Private or reserved IP/);
});


test('Search Console endpoint fails closed when provider credentials are absent', async () => {
  const response = await fetch(baseUrl + '/api/search-console?siteUrl=sc-domain%3Aexample.com&startDate=2026-09-01&endDate=2026-09-30');
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/i);
});

test('HTTP API exports operational metrics with memory and request telemetry', async () => {
  const response = await fetch(`${baseUrl}/api/metrics`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.status, 'healthy');
  assert.ok(typeof data.uptimeSeconds === 'number' && data.uptimeSeconds >= 0);
  assert.ok(typeof data.totalRequests === 'number' && data.totalRequests > 0);
  assert.ok(typeof data.activeRequests === 'number' && data.activeRequests >= 0);
  assert.ok(typeof data.memory?.heapUsedBytes === 'number' && data.memory.heapUsedBytes > 0);
});

test('HTTP API domain and gap endpoints return modeled provenance', async () => {
  const domainRes = await fetch(`${baseUrl}/api/domain?domain=github.com`);
  assert.equal(domainRes.status, 200);
  const domainData = await domainRes.json();
  assert.equal(domainData.domain, 'github.com');
  assert.equal(domainData.dataProvenance.type, 'modeled');

  const gapRes = await fetch(`${baseUrl}/api/gap?domainA=github.com&domainB=gitlab.com`);
  assert.equal(gapRes.status, 200);
  const gapData = await gapRes.json();
  assert.equal(gapData.dataProvenance.type, 'modeled');

  const multiRes = await fetch(`${baseUrl}/api/gap/multi?domains=github.com,gitlab.com`);
  assert.equal(multiRes.status, 200);
  const multiData = await multiRes.json();
  assert.equal(multiData.dataProvenance.type, 'modeled');

  const backlinkRes = await fetch(`${baseUrl}/api/backlinks?domain=github.com`);
  assert.equal(backlinkRes.status, 200);
  const backlinkData = await backlinkRes.json();
  assert.equal(backlinkData.dataProvenance.type, 'synthetic');
});

test('HTTP API serves static files and returns 404 for missing paths', async () => {
  const home = await fetch(`${baseUrl}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type') || '', /text\/html/);

  const missing = await fetch(`${baseUrl}/nonexistent-file-xyz.txt`);
  assert.equal(missing.status, 404);
});

