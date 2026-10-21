# Open Semrush

A self-hosted technical SEO audit prototype. It crawls public pages for on-page and HTTP signals, provides deterministic illustrative keyword/domain/backlink models, previews SERP-like results, and can read first-party Google Search Console performance for a property your Google OAuth account can access.

> Data integrity: Google Search Console is the only provider-backed search performance source currently integrated. Domain traffic, third-party keyword volumes/difficulty/CPC, backlink counts, competitor rankings, traffic history, authority scores and fallback SERPs are modeled or synthetic. They are not Semrush/Ahrefs equivalents and must not be used as factual client reporting. Technical audit findings come from pages actually fetched; the heuristic score is not a Google ranking factor.

## Implemented functionality

- Technical page audit with title/meta/H1/alt/HTTP/header/schema checks.
- Bounded crawling, redirect-by-redirect URL validation, DNS pinning to a checked public IP, response-size limit and reserved/private IP blocking.
- Deterministic keyword intent and difficulty model (illustrative only).
- Domain overview, keyword gap and backlink demo endpoints, explicitly marked modeled/synthetic.
- Optional Google Search Console Search Analytics API integration for clicks, impressions, CTR, average position and top queries.
- JSON project/history storage under data/, persisted in Docker using a named volume, atomic replacement, restrictive file permissions, bounded history and fail-closed corruption handling.
- Optional AI suggestions that require your own Gemini or OpenRouter key and may be inaccurate.
- Node tests, coverage summaries, Docker smoke/persistence workflow, CPU microbenchmarks and a concurrent HTTP load harness with opt-in crawl mode.

## Quick start

Requirements: Node.js 22+ recommended; Docker Compose v2 for container use. The copied .env.example defaults to development mode for local `npm start`; Compose overrides this to production mode.

    git clone https://github.com/mightyalok00/open-semrush.git
    cd open-semrush
    cp .env.example .env
    npm install
    npm start

Open <http://localhost:3000>. npm start compiles TypeScript before launching. Google Search Console remains unavailable until OAuth credentials are configured.

### Docker Compose

    cp .env.example .env

Before starting Compose, set OPEN_SEMRUSH_API_TOKEN in .env to a unique secret (generate one with `openssl rand -hex 32`; never use a committed/default token). Compose runs with NODE_ENV=production and protected endpoints fail closed without it.

    docker compose up --build -d
    curl http://localhost:3000/api/health
    docker compose down

Compose persists audit history in the named volume open-semrush-data. Running docker compose down -v deletes that volume. The image builds TypeScript source and runs as a non-root user. Compose binds to 127.0.0.1 by default, drops Linux capabilities, enables no-new-privileges, uses a read-only container root filesystem (with writable data volume and /tmp), and applies CPU/memory limits. Set HOST_BIND_ADDRESS=0.0.0.0 only when a firewall/reverse proxy and deployment security controls are configured.

## Google Search Console

This uses Google's official Search Console Search Analytics API: <https://developers.google.com/webmaster-tools/v1/searchanalytics/query>. It returns first-party performance for a property the configured OAuth user can access. It does not provide competitors' traffic, third-party keyword volume or backlink indexes.

1. Enable the Search Console API in Google Cloud and create OAuth credentials.
2. Authorize the <https://www.googleapis.com/auth/webmasters.readonly> scope and obtain a refresh token for an account that has access to the property.
3. Store credentials in the local .env file. Never commit secrets.

    GOOGLE_OAUTH_CLIENT_ID=
    GOOGLE_OAUTH_CLIENT_SECRET=
    GOOGLE_OAUTH_REFRESH_TOKEN=
    GOOGLE_SEARCH_CONSOLE_SITE_URL=sc-domain:example.com

A short-lived GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN is supported, but refresh-token credentials are preferred. Request data with explicit dates:

    curl 'http://localhost:3000/api/search-console?siteUrl=sc-domain%3Aexample.com&startDate=2026-09-01&endDate=2026-09-30'

For a URL-prefix property, set siteUrl to <https://example.com/>. Optional query filters matching query strings. If Google is unavailable, the endpoint returns an error rather than synthetic substitute data. verified:true means the response came from Google's API for the authorized property; it is not a guarantee that every interpretation is correct.

## API reference

| Method | Endpoint | Source / behavior |
| --- | --- | --- |
| GET | /api/health | Process health check |
| GET | /api/metrics | Operational metrics (uptime, active requests, memory telemetry) |
| GET | /api/search-console?siteUrl=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD | Google Search Console; OAuth required |
| GET | /api/domain?domain=...&country=... | Modeled domain/traffic/keyword metrics |
| GET | /api/keyword?q=... | Modeled volume, difficulty, CPC, seasonality |
| GET | /api/serp?q=... | Parsed/demo SERP; fallback is not guaranteed live |
| POST | /api/audit | Fetches a public target and returns heuristic audit findings |
| GET | /api/gap?domainA=...&domainB=... | Gap comparison from modeled keyword lists |
| GET | /api/gap/multi?domains=a,b,c | Modeled multi-domain comparison |
| GET | /api/backlinks?domain=... | Synthetic backlink profile |
| GET | /api/ai/status | AI cascade engine status & telemetry probe |
| GET | /api/ml/forecast?q=...&volume=...&position=... | Empirical power-law CTR & 95% traffic forecast |
| POST | /api/ai/fix | Optional AI suggestion; API key required |
| POST | /api/ai/strategy | Optional AI outline; API key required |
| GET | /api/projects | Persisted projects from audits; bearer token required |
| GET | /api/history?domain=... | Persisted audit history; bearer token required |

## Tests, coverage and benchmarks

    npm install
    npm run build
    npm test
    npm run test:coverage
    npm run check:security
    npm run benchmark
    npm run benchmark:crawl
    npm run benchmark:crawl:real
    npm run benchmark:crawl:matrix

npm test compiles TypeScript and runs Node's native test runner across 80+ unit, ML statistical, security regression, and storage recovery tests. npm run test:coverage emits coverage summaries with an enforced 72% minimum coverage gate. npm run check:security runs dedicated SSRF, redirect, DNS rebinding, proxy header spoofing, and authentication rotation regressions. npm run benchmark emits JSON microbenchmark throughput. npm run benchmark:crawl executes a 25-iteration multi-page simulated crawl benchmark. npm run benchmark:crawl:real executes 20 live network crawls against public targets with concurrency 4. npm run benchmark:crawl:matrix sweeps across 1, 3, 5, and 10 pages at 1, 2, 4, and 8 concurrency levels. npm run benchmark:load sends concurrent HTTP requests to LOAD_TEST_BASE_URL (default localhost) and records p50/p95/p99 latency, throughput, failures and status counts.

GitHub Actions runs unit/API/security tests across Node.js 22 and 24, verifies dependencies with `npm audit`, performs secret leak scanning, uploads coverage and benchmark evidence as artifacts, and builds/runs a clean Docker Compose stack to verify health, API behavior and audit-history persistence across a restart. The latest production-readiness report is [reports/quality/production-readiness-2026-10-21.md](reports/quality/production-readiness-2026-10-21.md).

## Applied AI & Machine Learning Architecture

The analytical pipeline uses applied statistical models and multi-tier LLM cascades. See [docs/ai-ml-architecture.md](docs/ai-ml-architecture.md) for complete mathematical formulations:

- **Empirical CTR Power-Law Model**: Fits rank-decay curves using $CTR(p) = \alpha \cdot p^{-\beta}$ ($\alpha = 0.312, \beta = 0.93$) adjusted for SERP layout feature attenuation (featured snippet cannibalization, PAA accordion dampening, video carousels).
- **Softmax Intent Probability Distribution**: Evaluates multi-class logit features ($z_{\text{Info}}, z_{\text{Comm}}, z_{\text{Nav}}, z_{\text{Trans}}$) normalized with numerically stable softmax $\sigma(\mathbf{z})$ to provide full probability distributions and confidence scores rather than hard-coded binary labels.
- **Parametric Traffic Forecasting (95% CI)**: Estimates organic searcher visits $\hat{Y} = V \cdot CTR$ accompanied by 95% confidence intervals combining binomial sampling variance and seasonal volatility dispersion ($I_{0.95} = [\hat{Y} - 1.96\sigma, \hat{Y} + 1.96\sigma]$).
- **N-Gram Semantic Clustering**: Aggregates composite queries into topical clusters using character 3-gram Jaccard similarity matrices and greedy agglomerative clustering.
- **Autonomous Multi-Tier LLM Cascade**: In-flight failover chain connecting OpenRouter free models (`minimax`, `gemma-4`, `lfm-2.5`, `nemotron-3.5`) and Google Gemini (`gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-flash-latest`) with deterministic air-gapped fallback.

## Storage and Disaster Recovery

- **Atomic JSON Storage (`JsonFileStorageAdapter`)**: Atomic replacement with `.tmp` staging, `fsync`, restrictive permissions (`0o600`), and fail-closed schema corruption defense.
- **Transactional SQLite Adapter (`SqliteStorageAdapter`)**: Built-in transactional database engine powered by Node native `node:sqlite`. Uses Write-Ahead Logging (`WAL`), strict relational tables, and ACID transactions for multi-instance or high-concurrency clustered operations.
- **Backup & Restore API**:

      import { backupDb, restoreDb, SqliteStorageAdapter } from './dist/storage.js';
      // Create verified atomic backup snapshot
      const backup = backupDb();
      // Restore database with schema validation
      restoreDb(backup.backupPath);
      // Or switch to transactional SQLite adapter
      const db = new SqliteStorageAdapter('./data/seo_projects.sqlite');

## Security model

- Outbound crawling accepts only HTTP(S), rejects URL credentials and local/private/reserved addresses, checks each redirect, resolves hostnames and pins the socket to a validated public IP to eliminate DNS-rebinding/TOCTOU exposure.
- Mixed DNS answers containing any non-public address fail closed.
- Response bodies are capped at 5 MiB; requests have a 15-second socket timeout and redirects are capped at five.
- POST /api/audit, POST /api/ai/*, GET /api/search-console, GET /api/projects and GET /api/history require a bearer token when OPEN_SEMRUSH_API_TOKEN or OPEN_SEMRUSH_API_TOKENS is configured. Multiple comma-separated tokens are supported to enable zero-downtime key rotation. In NODE_ENV=production those routes fail closed with 503 if no token is configured.
- In-process per-client rate limits default to 120 API requests/minute and 10 protected/expensive requests/minute. Behind an authenticating reverse proxy (Nginx, Caddy, Cloudflare), set `TRUST_PROXY_HOPS` to parse `X-Forwarded-For` without opening client IP spoofing vectors.
- Graceful shutdown handles `SIGTERM` and `SIGINT` signals by rejecting new requests with 503 draining notices and waiting up to 10 seconds for active in-flight crawls to complete.
- OAuth and AI secrets belong in .env or a secret manager, not source control. Multi-user identity and per-property authorization beyond Google's OAuth permissions are not implemented.

## Limitations

1. Coverage and benchmark numbers are generated by CI/local runs; this README intentionally does not invent results.
2. Search Console covers only first-party properties accessible to the OAuth user. It is not a competitor research dataset.
3. Modeled keyword/domain/competitor/SERP/backlink outputs are illustrative and may be wrong; provenance is shown by API where supported.
4. The crawler is not a browser, does not execute JavaScript, and may miss canonicalized/parameterized URL variants. It does not guarantee complete robots.txt policy compliance across all crawl paths.
5. DNS pinning reduces rebinding exposure but network-layer egress controls remain recommended because unusual proxies, routing and resolver configurations are outside the process's full control.
6. Authentication covers expensive/provider-sensitive API routes only; there is no user identity, per-user authorization, multi-tenant isolation, distributed rate limiter, task queue or transactional database. A named Docker volume is persistence, not backup.
7. AI suggestions can be inaccurate or unsafe; review them before publishing.
8. CPU microbenchmarks and CI HTTP smoke-load results are not proof of production crawl capacity. No representative crawl-load result is claimed until the opt-in benchmark has been run against a consented target at the intended deployment size.

## License

MIT. Independent prototype; not affiliated with or endorsed by Semrush or Ahrefs.
