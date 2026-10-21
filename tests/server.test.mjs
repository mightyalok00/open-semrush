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
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
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
