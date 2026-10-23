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

test('HTTP API NLP endpoints handle clustering, intent alignment, content gap, and entity extraction', async () => {
  // 1. Semantic Clustering
  const clusterRes = await fetch(`${baseUrl}/api/nlp/cluster`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keywords: ['buy running shoes online', 'cheap sneakers discount', 'learn python coding', 'python programming tutorial'],
    }),
  });
  assert.equal(clusterRes.status, 200);
  const clusterData = await clusterRes.json();
  assert.ok(clusterData.totalClusters >= 2);
  assert.equal(clusterData.provenance.tier, 'statistical_model');

  // 2. Intent Alignment
  const alignRes = await fetch(`${baseUrl}/api/nlp/intent-alignment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'buy mechanical keyboard',
      html: '<html><body><h1>Store</h1><button>Add to Cart</button><button>Checkout</button></body></html>',
    }),
  });
  assert.equal(alignRes.status, 200);
  const alignData = await alignRes.json();
  assert.equal(alignData.queryIntent, 'Transactional');
  assert.equal(alignData.pageIntent, 'Transactional');
  assert.ok(alignData.alignmentScore >= 80);

  // 3. Content Gap
  const gapRes = await fetch(`${baseUrl}/api/nlp/content-gap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetText: 'Basic Docker deployment instructions for nodejs apps.',
      competitorText: 'Advanced Docker deployment: Kubernetes ingress, rootless security, multi-stage builds.',
    }),
  });
  assert.equal(gapRes.status, 200);
  const gapData = await gapRes.json();
  assert.ok(gapData.missingSubtopics.length > 0);
  assert.equal(gapData.provenance.tier, 'statistical_model');

  // 4. Entity Extraction
  const entityRes = await fetch(`${baseUrl}/api/nlp/extract-entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'Google and Cloudflare leverage TypeScript, Docker, and PostgreSQL for high reliability web services.',
    }),
  });
  assert.equal(entityRes.status, 200);
  const entityData = await entityRes.json();
  assert.ok(entityData.entities.length > 0);
  assert.ok(entityData.contentQuality.lexicalDiversity > 0);
  assert.equal(entityData.provenance.tier, 'empirical_observation');
});

test('HTTP API Phase 5 endpoints: toxicity, keyword expansion, KD calibrator, alerts, competitors', async () => {
  // 1. Backlink Toxicity Audit
  const toxRes = await fetch(`${baseUrl}/api/backlinks/toxicity?domain=github.com`);
  assert.equal(toxRes.status, 200);
  const toxData = await toxRes.json();
  assert.equal(typeof toxData.toxicityScore, 'number');
  assert.ok(Array.isArray(toxData.vectors));
  assert.equal(toxData.vectors.length, 8);

  // 2. Keyword Expansion
  const expandRes = await fetch(`${baseUrl}/api/keywords/expand`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword: 'keyword ranking software' }),
  });
  assert.equal(expandRes.status, 200);
  const expandData = await expandRes.json();
  assert.equal(expandData.keyword, 'keyword ranking software');
  assert.equal(expandData.provenance.tier, 'statistical_model');

  // 3. KD Tier Calibrator
  const kdRes = await fetch(`${baseUrl}/api/keywords/kd?score=65`);
  assert.equal(kdRes.status, 200);
  const kdData = await kdRes.json();
  assert.equal(kdData.tier, 'Hard');
  assert.equal(typeof kdData.minReferringDomainsNeeded, 'number');

  // 4. Rank Volatility Alerts
  const alertsRes = await fetch(`${baseUrl}/api/rank-tracker/alerts?domain=github.com`);
  assert.equal(alertsRes.status, 200);
  const alertsData = await alertsRes.json();
  assert.equal(alertsData.domain, 'github.com');
  assert.ok(Array.isArray(alertsData.alerts));

  // 5. Tracked Competitors (POST & GET)
  const compPostRes = await fetch(`${baseUrl}/api/rank-tracker/competitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: 'github.com', competitorDomain: 'gitlab.com' }),
  });
  assert.equal(compPostRes.status, 201);

  const compGetRes = await fetch(`${baseUrl}/api/rank-tracker/competitors?domain=github.com`);
  assert.equal(compGetRes.status, 200);
  const compGetData = await compGetRes.json();
  assert.equal(compGetData.domain, 'github.com');
  assert.ok(compGetData.competitors.includes('gitlab.com'));
});

test('HTTP API handles AI visibility, Content Briefs, and Core Web Vitals', async () => {
  // 1. AI Search Visibility endpoint
  const visRes = await fetch(`${baseUrl}/api/ai-visibility`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: 'stripe.com', brandName: 'Stripe' }),
  });
  assert.equal(visRes.status, 200);
  const visData = await visRes.json();
  assert.equal(visData.domain, 'stripe.com');
  assert.ok(visData.sampleSize > 0);
  assert.ok(typeof visData.visibilityRate === 'number');

  // 2. SEO Content Brief endpoint
  const briefRes = await fetch(`${baseUrl}/api/content/brief`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword: 'technical seo audit guide', searchIntent: 'informational' }),
  });
  assert.equal(briefRes.status, 200);
  const briefData = await briefRes.json();
  assert.equal(briefData.keyword, 'technical seo audit guide');
  assert.ok(briefData.recommendedWordCount > 1000);
  assert.ok(briefData.headingsOutline.length > 5);

  // 3. Core Web Vitals endpoint (rejects private addresses)
  const privateCwvRes = await fetch(`${baseUrl}/api/audit/pagespeed?url=http://127.0.0.1:8080/private`);
  assert.equal(privateCwvRes.status, 400);

  // 4. Core Web Vitals endpoint (validates public URL)
  const publicCwvRes = await fetch(`${baseUrl}/api/audit/pagespeed?url=https://example.com/test-page`);
  assert.equal(publicCwvRes.status, 200);
  const cwvData = await publicCwvRes.json();
  assert.ok(cwvData.performanceScore >= 0);
  assert.ok(cwvData.fcpMs > 0);
});

