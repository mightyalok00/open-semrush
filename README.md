# 🚀 Open Semrush

**High-performance, self-hosted SEO intelligence & technical site audit suite.**  
Official Google Search Console telemetry, empirical machine learning rank curves, and autonomous multi-provider AI remediation.

[![CI Quality](https://img.shields.io/badge/CI%20Quality-Passing-brightgreen?logo=github-actions)](https://github.com/mightyalok00/open-semrush/actions/workflows/quality.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.0.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Tests: 83 Passing](https://img.shields.io/badge/Tests-83%20Passing-success)](#-tests-coverage-and-benchmarks)
[![Coverage: 82.6%](https://img.shields.io/badge/Coverage-82.6%25-informational)](#-tests-coverage-and-benchmarks)
[![Security Score: 9.5/10](https://img.shields.io/badge/Security%20Score-9.5%2F10-blueviolet)](reports/quality/production-readiness-2026-10-21.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

> ⚠️ **Data Integrity & Provenance Disclosure**:
> Google Search Console is the only provider-backed search performance source currently integrated. Domain traffic, third-party keyword volumes/difficulty/CPC, backlink profiles, competitor rankings, and authority scores are modeled, heuristic, or synthetic. They are not Semrush/Ahrefs equivalents and must not be used as factual client reporting. Technical audit findings reflect actual fetched HTML and HTTP responses; heuristic health scores are not Google ranking factors.

---

## ✨ Key Platform Capabilities

- 🕷️ **Asynchronous Technical Crawler**: Bounded multi-page crawler with redirect loop protection, streaming body limit (5 MiB), socket DNS pinning to public IPs, and title/meta/H1/alt/schema validation.
- 🧠 **Applied ML & Statistical Engine**: Empirical power-law CTR rank curve regression, 4-class softmax intent probability distribution, and parametric 95% traffic forecast intervals ($I_{0.95} = \hat{Y} \pm 1.96\sigma$).
- 🤖 **Autonomous Multi-Tier AI Cascade**: Intelligent failover chain connecting OpenRouter free-tier models (`minimax`, `gemma-4`, `lfm-2.5`, `nemotron-3.5`) and Google Gemini (`gemini-3.5-flash`, `gemini-3.1-flash-lite`) with air-gapped deterministic fallback.
- 📊 **Verified Google Search Console**: Direct OAuth2 telemetry for clicks, impressions, CTR, average position, and top queries from Google's official Search Analytics API.
- 🛡️ **Zero-Trust Security & SSRF Defense**: Sockets connect directly to pinned public IPs to defeat DNS rebinding/TOCTOU attacks. In-flight redirect re-validation, proxy header sanitization, constant-time token comparison, and zero-downtime key rotation.
- 💾 **Dual-Engine Storage & Disaster Recovery**: Atomic JSON storage with `.tmp` staging, `fsync` flushing, and fail-closed corruption defense, plus a relational SQLite engine (`node:sqlite` WAL mode) with ACID rollback and point-in-time backup verification.

---

## ⚡ Quick Start

### Option 1: Local Node.js

Requirements: Node.js 22+ recommended.

```bash
# 1. Clone repository
git clone https://github.com/mightyalok00/open-semrush.git
cd open-semrush

# 2. Configure environment
cp .env.example .env

# 3. Install dependencies and launch
npm install
npm start
```

Open `<http://localhost:3000>` in your browser. `npm start` automatically compiles TypeScript before launching the server. Google Search Console remains disabled until OAuth credentials are provided in `.env`.

### Option 2: Docker Compose

```bash
# 1. Prepare environment
cp .env.example .env

# 2. Generate and set unique API secret
openssl rand -hex 32

# 3. Build and launch container stack
docker compose up --build -d

# 4. Probe service health
curl http://localhost:3000/api/health

# 5. Stop containers (preserves open-semrush-data volume)
docker compose down
```

Docker Compose runs with `NODE_ENV=production`, non-root user execution (`uid 1000`), a read-only root container filesystem, dropped Linux capabilities (`cap_drop: [ALL]`), and persistent volume mapping at `/app/data`.

---

## 🔍 Google Search Console Integration

`open-semrush` integrates with Google's official Search Console Search Analytics API: `<https://developers.google.com/webmaster-tools/v1/searchanalytics/query>`. It returns verified first-party metrics for properties the configured OAuth user can access.

1. Enable the Search Console API in Google Cloud Console and generate OAuth credentials.
2. Authorize the `<https://www.googleapis.com/auth/webmasters.readonly>` scope and obtain a refresh token.
3. Configure credentials in your local `.env` file (never commit secrets):

```env
GOOGLE_OAUTH_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret
GOOGLE_OAUTH_REFRESH_TOKEN=your_refresh_token
GOOGLE_SEARCH_CONSOLE_SITE_URL=sc-domain:example.com
```

Query performance data across date ranges:

```bash
curl 'http://localhost:3000/api/search-console?siteUrl=sc-domain%3Aexample.com&startDate=2026-09-01&endDate=2026-09-30'
```

---

## 📡 REST API Reference

| Method | Endpoint | Auth | Provenance Contract |
| --- | --- | --- | --- |
| `GET` | `/api/health` | 🔓 Public | Process uptime, socket state, and daemon status |
| `GET` | `/api/metrics` | 🔓 Public | Memory telemetry (heap, RSS), active requests, error counters |
| `GET` | `/api/ai/status` | 🔓 Public | Operational telemetry for OpenRouter & Gemini model cascades |
| `GET` | `/api/ml/forecast?q=...&volume=...&position=...` | 🔓 Public | Empirical power-law CTR & 95% traffic forecast interval |
| `GET` | `/api/search-console?siteUrl=...&startDate=...&endDate=...` | 🔒 Token | **Verified Provider Data** (Google Search Console API) |
| `GET` | `/api/domain?domain=...&country=...` | 🔓 Public | Modeled domain authority, traffic history, and keywords |
| `GET` | `/api/keyword?q=...` | 🔓 Public | Modeled search volume, KD%, intent distribution, and CPC |
| `GET` | `/api/serp?q=...` | 🔓 Public | Parsed live SERP with feature extraction and fallback examples |
| `POST` | `/api/audit` | 🔒 Token | **Empirical Finding** (Active crawl & HTML signal audit) |
| `GET` | `/api/gap?domainA=...&domainB=...` | 🔓 Public | Modeled keyword gap comparison |
| `GET` | `/api/gap/multi?domains=a,b,c` | 🔓 Public | Modeled multi-domain competitive matrix |
| `GET` | `/api/backlinks?domain=...` | 🔓 Public | Synthetic backlink graph and anchor distribution |
| `POST` | `/api/ai/fix` | 🔒 Token | Autonomous AI code remediation snippet |
| `POST` | `/api/ai/strategy` | 🔒 Token | Autonomous AI outrank content blueprint |
| `GET` | `/api/projects` | 🔒 Token | Persisted audit project registry |
| `GET` | `/api/history?domain=...` | 🔒 Token | Persisted domain audit score history |

---

## 🧪 Tests, Coverage and Benchmarks

```bash
# Run full 83-test suite (Unit, ML, Security, Storage)
npm test

# Run test coverage with enforced 72% minimum threshold gate
npm run test:coverage

# Run dedicated security regression test suite
npm run check:security

# Scan for committed secrets or private credentials
npm run check:secrets

# Run microbenchmarks
npm run benchmark

# Run 25-iteration simulated multi-page crawl benchmark
npm run benchmark:crawl

# Run 20-run live network crawl against public targets
npm run benchmark:crawl:real

# Run multi-target live public network crawl across diverse real domains
npm run benchmark:crawl:multi

# Run multi-dimensional matrix sweep (320 runs across 4 depths & 4 concurrency tiers)
npm run benchmark:crawl:matrix
```

CI workflows verify Node.js 22 and 24, validate dependencies via `npm audit`, perform secret leak detection, enforce test coverage gates, and verify persistence across Docker container restarts.

- Detailed audit and benchmark data: [reports/quality/production-readiness-2026-10-21.md](reports/quality/production-readiness-2026-10-21.md)
- Product validation against ground-truth sites & live web: [reports/quality/reproducible-evaluation-2026-10-21.md](reports/quality/reproducible-evaluation-2026-10-21.md)

---

## 🧠 Applied AI & Machine Learning Architecture

See [docs/ai-ml-architecture.md](docs/ai-ml-architecture.md) for full mathematical derivations, variance proofs, and inference cascade specifications:

- **Empirical CTR Power-Law Model**: Regresses organic click decay using $CTR(p) = \alpha \cdot p^{-\beta}$ ($\alpha = 0.312, \beta = 0.93$) adjusted for layout cannibalization (featured snippets $-28\%$, video carousels $-15\%$, PAA accordions $-8\%$).
- **Softmax Intent Probability Distribution**: Computes multi-class logit features ($z_{\text{Info}}, z_{\text{Comm}}, z_{\text{Nav}}, z_{\text{Trans}}$) with numerically stable softmax $\sigma(\mathbf{z})$ for calibrated confidence distributions.
- **Parametric Traffic Forecasting (95% CI)**: Computes expected search visits accompanied by 95% confidence intervals combining binomial sampling variance with seasonal volatility ($I_{0.95} = \hat{Y} \pm 1.96\sigma$).
- **N-Gram Semantic Clustering**: Aggregates composite queries into topical clusters using character 3-gram Jaccard similarity matrices.
- **Autonomous Multi-Tier LLM Cascade**: In-flight failover connecting OpenRouter free models (`minimax`, `gemma-4`, `lfm-2.5`, `nemotron-3.5`) and Google Gemini (`gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-flash-latest`) with deterministic air-gapped fallback.

---

## 💾 Storage and Disaster Recovery

- **Atomic JSON Storage (`JsonFileStorageAdapter`)**: Atomic replacement with `.tmp` staging, explicit `fsync` flushing, restrictive file permissions (`0o600`), and fail-closed schema corruption defense.
- **Transactional SQLite Adapter (`SqliteStorageAdapter`)**: High-performance relational database engine powered by Node native `node:sqlite`. Uses Write-Ahead Logging (`WAL`), strict relational tables, and ACID transactions for high-concurrency clustered operations.
- **Disaster Recovery Drills**: Documented drills for interrupted write recovery, corrupt snapshot rejection, atomic point-in-time restore, and SQLite WAL high-concurrency rollback. See full runbook: [reports/quality/disaster-recovery-runbook.md](reports/quality/disaster-recovery-runbook.md).
- **Backup & Restore API**:

```javascript
import { backupDb, restoreDb, SqliteStorageAdapter } from './dist/storage.js';

// Create verified atomic backup snapshot
const backup = backupDb();

// Restore database with strict schema validation
restoreDb(backup.backupPath);

// Or switch to transactional SQLite adapter
const db = new SqliteStorageAdapter('./data/seo_projects.sqlite');
```

---

## 🛡️ Security Model & Production Hardening

- **SSRF & Metadata Defense**: Blocks `0.0.0.0/8`, `10.0.0.0/8`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, cloud metadata endpoints (`http://169.254.169.254`), and non-global IPv6 scopes.
- **DNS Rebinding & TOCTOU Immunity**: Sockets connect directly to the pinned IP verified during DNS pre-flight; mixed public/private DNS answers fail closed immediately.
- **Strict In-Flight Redirect Aborts**: Each redirect hop (`301`, `302`, `307`, `308`) re-runs hostname resolution, scheme verification, and private IP rejection (capped at 5 hops).
- **Zero-Downtime Secret Rotation**: `OPEN_SEMRUSH_API_TOKENS` accepts comma-separated secrets compared via `crypto.timingSafeEqual` over SHA-256 digests.
- **Reverse Proxy IP Parsing**: `cleanIpCandidate` strips ports, interface zone indexes (`%eth0`), and injection vectors. Set `TRUST_PROXY_HOPS` to enable spoof-proof rate limiting behind Cloudflare, Nginx, or AWS ALB.
- **Graceful Draining Shutdown**: `SIGTERM` and `SIGINT` trigger connection draining, rejecting new requests with 503 while allowing in-flight audits up to 10 seconds to finish.
- **Independent Security Review**: Documented threat model audit, vulnerability verification, and regression tests. See [reports/security/security-review-2026-10-21.md](reports/security/security-review-2026-10-21.md).

---

## 🌐 Community Testing & Feedback

We actively seek feedback from external SEO practitioners, developers, and agency teams testing Open Semrush across diverse real-world websites.

### How to Test

1. **One-Line Docker Run**:

   ```bash
   git clone https://github.com/mightyalok00/open-semrush.git && cd open-semrush
   docker compose up -d
   ```

2. **Execute an Audit on Your Target**:

   ```bash
   curl -X POST http://localhost:3000/api/audit \
     -H 'Content-Type: application/json' \
     -d '{"url":"https://your-website.com","depth":2,"maxPages":10}'
   ```

3. **Submit Your Report**:
   - For crawl accuracy, false positives, or edge-case feedback, use the [External Tester Template](.github/ISSUE_TEMPLATE/external_feedback.md) on [GitHub Issues](https://github.com/mightyalok00/open-semrush/issues).
   - For bug reports with reproduction steps, use the [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.md).
   - For feature requests and new SEO metrics, submit a [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md).

---

## ⚖️ Limitations

1. **Benchmarking Scope**: Coverage and benchmark metrics reflect automated test execution; production crawl throughput depends on target host latency and bandwidth.
2. **First-Party Boundary**: Search Console covers only properties authorized by the OAuth user; it does not supply competitor telemetry.
3. **Model Nature**: Modeled keyword/domain/SERP metrics are illustrative approximations; provider provenance is explicitly flagged in API responses.
4. **JavaScript Execution**: The crawler inspects raw HTTP responses and HTML markup; it does not execute client-side JavaScript (SPA rendering).
5. **DNS Pinning**: Socket IP pinning mitigates application-layer rebinding, but network-level egress firewalls remain standard enterprise best practice.
6. **Authentication Scope**: Bearer authentication protects destructive, audit, and provider-sensitive routes; it is not a multi-tenant user identity system.

---

## 📄 License

MIT License. Independent open-source prototype; not affiliated with or endorsed by Semrush® or Ahrefs®.
