#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProductionControls } from './production-controls.mjs';

// Load .env if present
try {
  process.loadEnvFile();
} catch {
  // .env is optional
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import compiled Semrush engine
let semrushModule;
for (const p of ['../dist/index.js', '../dist/semrush/index.js']) {
  try {
    semrushModule = await import(p);
    break;
  } catch {}
}

if (!semrushModule) {
  console.error('Error: Could not load Semrush engine. Run `npm run build` first.');
  process.exit(1);
}

const { 
  runSiteAudit, 
  analyzeKeyword, 
  generateKeywordVariations, 
  generateDomainOverview, 
  compareKeywordGap, 
  generateBacklinkReport,
  generateSeoFixWithAi,
  generateContentStrategyWithAi,
  recordAuditInHistory,
  getAllProjects,
  getDomainAuditHistory,
  fetchLiveSerp,
  compareMultiCompetitorGap,
  assertPublicHttpUrl,
  fetchSearchConsoleReport,
  getAiEngineStatus,
  predictCtrPowerLaw,
  calculateTrafficForecast,
  classifySearchIntentProbabilities,
} = semrushModule;

// Resolve public assets directory
const candidatePublicDirs = [
  path.resolve(__dirname, '../public'),
  path.resolve(__dirname, '../src/public'),
  path.resolve(__dirname, '../src/semrush/public')
];
const PUBLIC_DIR = candidatePublicDirs.find(d => fs.existsSync(d)) || candidatePublicDirs[0];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function sendJson(res, statusCode, data, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) { // 1MB limit
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function serveStaticFile(req, res, pathname) {
  let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, relativePath);

  // Security check: ensure within PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

let activeRequests = 0;
let totalRequests = 0;
let totalErrors = 0;
let isShuttingDown = false;
const serverStartTime = Date.now();

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (isShuttingDown) {
    sendJson(res, 503, { error: 'Server is shutting down', status: 'draining' }, { Connection: 'close' });
    return;
  }

  activeRequests += 1;
  totalRequests += 1;
  res.on('finish', () => {
    activeRequests = Math.max(0, activeRequests - 1);
    if (res.statusCode >= 500) totalErrors += 1;
  });

  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  try {
    if (pathname.startsWith('/api/')) {
      const rejection = checkProductionControls(req, pathname);
      if (rejection) {
        sendJson(res, rejection.status, rejection.body, rejection.headers);
        return;
      }
    }
    // API Route: Health
    if (pathname === '/api/health') {
      const status = isShuttingDown ? 'draining' : 'healthy';
      sendJson(res, isShuttingDown ? 503 : 200, {
        status,
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor((Date.now() - serverStartTime) / 1000),
        activeRequests,
      });
      return;
    }

    // API Route: Operational Metrics
    if (pathname === '/api/metrics' && req.method === 'GET') {
      const mem = process.memoryUsage();
      sendJson(res, 200, {
        status: isShuttingDown ? 'draining' : 'healthy',
        uptimeSeconds: Math.floor((Date.now() - serverStartTime) / 1000),
        activeRequests,
        totalRequests,
        totalErrors,
        isShuttingDown,
        memory: {
          heapUsedBytes: mem.heapUsed,
          heapTotalBytes: mem.heapTotal,
          rssBytes: mem.rss,
        },
      });
      return;
    }

    // API Route: Domain Overview
    if (pathname === '/api/domain' && req.method === 'GET') {
      const domain = reqUrl.searchParams.get('domain') || 'github.com';
      const country = reqUrl.searchParams.get('country') || 'us';
      const data = await generateDomainOverview(domain, country);
      sendJson(res, 200, { ...data, dataProvenance: { type: 'modeled', verified: false, note: 'Traffic, authority, keyword and history metrics are modeled or AI-generated, not verified against a live SEO data provider.' } });
      return;
    }

    // API Route: Keyword Magic
    if (pathname === '/api/keyword' && req.method === 'GET') {
      const query = reqUrl.searchParams.get('q') || 'seo tools';
      const metrics = analyzeKeyword(query);
      const variations = generateKeywordVariations(query);
      sendJson(res, 200, { metrics, variations, dataProvenance: { type: 'modeled', verified: false, note: 'Search volume, difficulty, CPC and seasonality are deterministic illustrative estimates, not provider data.' } });
      return;
    }


    if (pathname === '/api/search-console' && req.method === 'GET') {
      const siteUrl = reqUrl.searchParams.get('siteUrl') || process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL || '';
      const startDate = reqUrl.searchParams.get('startDate') || '';
      const endDate = reqUrl.searchParams.get('endDate') || '';
      const query = reqUrl.searchParams.get('query') || undefined;
      const configured = Boolean(process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN ||
        (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_OAUTH_REFRESH_TOKEN));
      if (!configured) { sendJson(res, 503, { error: 'Google Search Console is not configured. Add OAuth refresh-token credentials to .env.' }); return; }
      try {
        const report = await fetchSearchConsoleReport({ siteUrl, startDate, endDate, query,
          accessToken: process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN,
          clientId: process.env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
          refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
        sendJson(res, 200, report);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Search Console request failed.';
        sendJson(res, /valid YYYY-MM-DD|siteUrl must/.test(message) ? 400 : 502, { error: message });
      }
      return;
    }

    // API Route: Site Audit
    if (pathname === '/api/audit' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const url = body.url;
      const requestedMaxPages = Number(body.maxPages);
      const maxPages = Number.isFinite(requestedMaxPages) && requestedMaxPages > 0
        ? Math.min(100, Math.floor(requestedMaxPages))
        : 3;

      if (!url) {
        sendJson(res, 400, { error: 'url is required' });
        return;
      }

      try {
        await assertPublicHttpUrl(url);
      } catch (validationError) {
        sendJson(res, 400, { error: validationError instanceof Error ? validationError.message : 'Invalid target URL.' });
        return;
      }

      const report = await runSiteAudit(url, { maxPages });
      try {
        const parsedUrl = new URL(url);
        recordAuditInHistory(parsedUrl.hostname, report.healthScore, report.totalErrors, report.totalWarnings, report.totalNotices);
      } catch {}

      sendJson(res, 200, report);
      return;
    }

    // API Route: AI-Powered SEO Fix
    if (pathname === '/api/ai/fix' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const apiKey = process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY;

      if (!apiKey) {
        sendJson(res, 400, { error: 'Gemini or OpenRouter API key not configured in .env' });
        return;
      }

      const fix = await generateSeoFixWithAi(
        body.url || 'https://example.com',
        body.issueCode || 'GENERAL_ISSUE',
        body.originalValue ?? null,
        body.message || 'Optimize SEO factor',
        apiKey
      );

      sendJson(res, 200, fix || { error: 'Failed to generate fix' });
      return;
    }

    // API Route: AI Content Strategy Outline
    if (pathname === '/api/ai/strategy' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const apiKey = process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY;

      if (!apiKey) {
        sendJson(res, 400, { error: 'API key not configured' });
        return;
      }

      const outline = await generateContentStrategyWithAi(
        body.domainA || 'yoursite.com',
        body.competitorDomain || 'competitor.com',
        body.missingKeyword || 'seo tools',
        apiKey
      );

      sendJson(res, 200, outline || { error: 'Failed to generate content strategy' });
      return;
    }

    // API Route: AI Model Cascade Status
    if (pathname === '/api/ai/status' && req.method === 'GET') {
      sendJson(res, 200, {
        ...getAiEngineStatus(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // API Route: Machine Learning Predictive Forecast
    if (pathname === '/api/ml/forecast' && req.method === 'GET') {
      const q = reqUrl.searchParams.get('q') || 'seo tools';
      const volume = parseInt(reqUrl.searchParams.get('volume') || '10000', 10);
      const position = parseInt(reqUrl.searchParams.get('position') || '1', 10);
      const hasFeaturedSnippet = reqUrl.searchParams.get('hasFeaturedSnippet') === 'true';

      const intentDist = classifySearchIntentProbabilities(q);
      const ctrPred = predictCtrPowerLaw(position, { hasFeaturedSnippet });
      const forecast = calculateTrafficForecast(volume, ctrPred.adjustedCtr);

      sendJson(res, 200, {
        query: q,
        position,
        monthlySearchVolume: volume,
        intentDistribution: intentDist,
        ctrPrediction: ctrPred,
        trafficForecast: forecast,
        modelProvenance: {
          ctrModel: 'empirical_power_law (alpha=0.312, beta=0.93)',
          intentClassifier: 'softmax_distribution (4-class logit fusion)',
          uncertaintyMethod: 'binomial_volatility_prediction_interval (95% CI, z=1.96)',
        },
      });
      return;
    }

    // API Route: Tracked Projects & History
    if (pathname === '/api/projects' && req.method === 'GET') {
      sendJson(res, 200, getAllProjects());
      return;
    }

    if (pathname === '/api/history' && req.method === 'GET') {
      const domain = reqUrl.searchParams.get('domain') || '';
      sendJson(res, 200, getDomainAuditHistory(domain));
      return;
    }

    // API Route: Live SERP Inspector
    if (pathname === '/api/serp' && req.method === 'GET') {
      const q = reqUrl.searchParams.get('q') || 'best seo tools';
      const serpData = await fetchLiveSerp(q);
      sendJson(res, 200, { ...serpData, dataProvenance: { type: 'generated-demo', verified: false, note: 'Results may be AI-generated or algorithmic fallback examples; they are not verified live Google rankings.' } });
      return;
    }

    // API Route: Keyword Gap (2 domains legacy)
    if (pathname === '/api/gap' && req.method === 'GET') {
      const d1 = reqUrl.searchParams.get('domainA') || 'github.com';
      const d2 = reqUrl.searchParams.get('domainB') || 'gitlab.com';
      const overviewA = await generateDomainOverview(d1);
      const overviewB = await generateDomainOverview(d2);

      const gap = compareKeywordGap(
        d1,
        overviewA.topOrganicKeywords.map(k => k.keyword),
        d2,
        overviewB.topOrganicKeywords.map(k => k.keyword)
      );
      sendJson(res, 200, { ...gap, dataProvenance: { type: 'modeled', verified: false, note: 'Keyword sets are derived from modeled domain overviews, not a verified ranking database.' } });
      return;
    }

    // API Route: Multi-Competitor Matrix (up to 5 domains)
    if (pathname === '/api/gap/multi' && req.method === 'GET') {
      const domainsParam = reqUrl.searchParams.get('domains') || 'github.com,gitlab.com,bitbucket.org';
      const domains = domainsParam.split(',').map(d => d.trim()).filter(Boolean);
      const matrixReport = await compareMultiCompetitorGap(domains);
      sendJson(res, 200, { ...matrixReport, dataProvenance: { type: 'modeled', verified: false, note: 'Keyword rankings and volumes are illustrative model outputs.' } });
      return;
    }

    // API Route: Backlink Profile
    if (pathname === '/api/backlinks' && req.method === 'GET') {
      const domain = reqUrl.searchParams.get('domain') || 'github.com';
      const profile = generateBacklinkReport(domain);
      sendJson(res, 200, { ...profile, dataProvenance: { type: 'synthetic', verified: false, note: 'Backlink counts, sources and toxicity are generated examples, not observed link data.' } });
      return;
    }

    // Serve static files
    serveStaticFile(req, res, pathname);

  } catch (err) {
    console.error('Server error handling request:', err);
    sendJson(res, 500, { error: err.message || 'Internal server error' });
  }
});

const DEFAULT_PORT = parseInt(process.env.PORT || '3000', 10);

function startServer(port) {
  server.listen(port, () => {
    console.log(`\n=======================================================`);
    console.log(`🚀 OPEN SEMRUSH SERVER RUNNING`);
    console.log(`=======================================================`);
    console.log(`📡 Web Studio:    http://localhost:${port}`);
    console.log(`⚡ API Endpoints: http://localhost:${port}/api/domain`);
    console.log(`                  http://localhost:${port}/api/keyword`);
    console.log(`                  http://localhost:${port}/api/audit`);
    console.log(`                  http://localhost:${port}/api/gap`);
    console.log(`                  http://localhost:${port}/api/gap/multi`);
    console.log(`                  http://localhost:${port}/api/backlinks`);
    console.log(`                  http://localhost:${port}/api/serp`);
    console.log(`=======================================================\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\nReceived ${signal}. Initiating graceful shutdown (draining ${activeRequests} active requests)...`);

  server.close(() => {
    console.log('HTTP server closed successfully.');
    process.exit(0);
  });

  const checkInterval = setInterval(() => {
    if (activeRequests === 0) {
      clearInterval(checkInterval);
      clearTimeout(forceExitTimer);
      server.close(() => {
        process.exit(0);
      });
    }
  }, 100);

  const forceExitTimer = setTimeout(() => {
    clearInterval(checkInterval);
    console.warn(`Graceful shutdown timed out with ${activeRequests} active requests remaining. Forcefully exiting.`);
    process.exit(1);
  }, 10_000);

  if (checkInterval.unref) checkInterval.unref();
  if (forceExitTimer.unref) forceExitTimer.unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer(DEFAULT_PORT);

