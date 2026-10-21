# 📜 Changelog

All notable changes to the **Open Semrush** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] - 2026-10-21

### 🚀 Added

- **Data Provenance & Metric Labeling Architecture (`src/types.ts`)**:
  - Implemented 5-tier classification framework: `verified_provider`, `empirical_observation`, `provider_api`, `statistical_model`, and `synthetic_estimate`.
  - Added explicit `provenance` metadata across all data contracts (`SiteAuditReport`, `PageAuditResult`, `KeywordMetrics`, `SearchConsoleReport`, `DomainOverviewReport`, `BacklinkProfileReport`).
  - Transparent labeling of modeled metrics: competitor domain metrics and backlink profiles are explicitly marked as `synthetic_estimate` with `isFactual: false` and explanatory notes to distinguish empirical measurements from synthetic simulations.
- **Deep Google Search Console Intelligence (`src/search-console.ts`)**:
  - Property discovery via `listSearchConsoleSites` with permission level tracking (`siteOwner`, `siteFullUser`, etc.).
  - Multi-dimension query slicing supporting `query`, `page`, `device`, `country`, and `date` dimensions simultaneously.
  - Striking Distance keyword discovery identifying ranking opportunities in positions 11-20 with high impressions.
  - Keyword Cannibalization detection identifying queries where multiple distinct URLs compete for search visibility.
  - CTR Opportunity Gap scoring quantifying traffic upside by benchmarking actual search performance against our power-law rank curve ($CTR(p) = \alpha \cdot p^{-\beta}$).
- **Real Keyword Research & Autocomplete Extraction (`src/keywords.ts`)**:
  - Integrated real-time query expansion via Google Suggest autocomplete (`fetchGoogleSuggestions`).
  - Categorization into question queries (`who`, `what`, `where`, `how`, `why`), comparison queries (`vs`, `versus`, `or`), and long-tail variants.
  - DataForSEO Labs API fallback provider (`fetchDataForSeoKeywordMetrics`) with support for search volume, CPC, competition index, and historical trends.
- **Scheduled Organic Rank Tracking Engine (`src/rank-tracker.ts`)**:
  - Live SERP position polling up to rank 100 with exponential backoff and rotating browser user-agents.
  - Atomic staged JSON persistence (`data/rank_tracker.json`) with `.tmp` staging, `fsyncSync`, and secure file permissions (`0o600`).
  - Scheduled batch rank checking (`runScheduledRankCheck`) with configurable concurrency controls.
  - Weighted Search Visibility Index calculation (0-100 scale).
  - Historical winner/loser delta tracking across consecutive rank snapshots.
- **REST API Expansion (`scripts/semrush-server.mjs`, `scripts/production-controls.mjs`)**:
  - `GET /api/search-console/sites`: Discover accessible Search Console properties.
  - `GET /api/search-console`: Multi-dimension Search Console analytics with deep intelligence synthesis.
  - `GET /api/keywords/real`: Live Google Suggest autocomplete & DataForSEO keyword research.
  - `GET /api/rank-tracker/overview`: Global rank tracking summary, visibility index, and winner/loser deltas.
  - `GET /api/rank-tracker/keywords`: List tracked target keywords and current rankings.
  - `POST /api/rank-tracker/keywords`: Add keywords to scheduled rank tracking.
  - `DELETE /api/rank-tracker/keywords`: Remove keywords from rank tracking.
  - `POST /api/rank-tracker/check`: Trigger immediate rank check polling.
  - `GET /api/rank-tracker/history`: Fetch historical rank snapshots for a keyword.
- **Multi-Target Real Network Crawl Suite (`scripts/multi-target-crawl.mjs`)**:
  - Verification harness executing production crawls against diverse external targets (`httpbin.org`, `example.com`, `wikipedia.org`) with SSRF validation.

### 🧪 Testing & Verification

- Expanded test suite from 83 to 95 tests (100% pass rate).
- Added `tests/gsc-intelligence.test.mjs` (striking distance, cannibalization, CTR gap scoring).
- Added `tests/real-keywords.test.mjs` (Google Suggest parsing, questions/comparisons, DataForSEO fallback).
- Added `tests/rank-tracker.test.mjs` (atomic persistence, visibility index, winner/loser deltas).
- Maintained 83.2% line coverage across the entire TypeScript and JavaScript codebase.

---

## [1.1.0] - 2026-10-21

### 🚀 Added

- **Empirical CTR Power-Law Regression (`src/ml.ts`)**:
  - Parametric power-law model ($CTR(p) = \alpha \cdot p^{-\beta}$) with $\alpha = 0.312$ and $\beta = 0.93$.
  - Layout feature cannibalization factors for featured snippets, video carousels, knowledge panels, and PAA accordions.
- **Probabilistic Softmax Search Intent Classifier (`src/ml.ts`)**:
  - 4-class multi-dimensional logit fusion ($z_{\text{Info}}, z_{\text{Comm}}, z_{\text{Nav}}, z_{\text{Trans}}$).
  - Numerically stable softmax normalization outputting calibrated confidence scores and probability distributions.
- **Parametric 95% Traffic Forecast Intervals (`src/ml.ts`)**:
  - Point estimate visits $\hat{Y} = V \cdot \text{CTR}$.
  - Uncertainty variance decomposition combining binomial sampling dispersion and seasonal volatility ($I_{0.95} = \hat{Y} \pm 1.96\sigma$).
- **Agglomerative N-Gram Semantic Keyword Clustering (`src/ml.ts`)**:
  - Character 3-gram Jaccard similarity metric and greedy clustering for keyword gap grouping.
- **Autonomous Multi-Model LLM Inference Cascade (`src/ai.ts`)**:
  - OpenRouter free model pool (`minimax/minimax-m3.1-flash:free`, `google/gemma-4-31b-it:free`, `google/gemma-4-26b-a4b-it:free`, `liquid/lfm-2.5-2.6b:free`, `nvidia/nemotron-3.5-lightning:free`).
  - Google Gemini pool (`gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-flash-latest`).
  - Runtime circuit breaking for 401/403 authorization failures to avoid repeated failed calls.
- **New REST API Endpoints (`scripts/semrush-server.mjs`)**:
  - `GET /api/ml/forecast`: Predictive power-law CTR, intent distribution, and 95% traffic forecast.
  - `GET /api/ai/status`: Operational readiness and active model telemetry.
- **Community Health & Governance**:
  - `CONTRIBUTING.md`: Development environment setup, PR guidelines, and testing checklist.
  - `SECURITY.md`: Security architecture overview, SSRF policy, and private disclosure runbook.
  - `.github/ISSUE_TEMPLATE/`: Structured bug report and feature request issue templates.
  - `.github/PULL_REQUEST_TEMPLATE.md`: Standard pull request checklist.

### 🛡️ Security & Hardening

- Added `cleanIpCandidate` port and zone-index sanitization to defeat reverse-proxy spoofing.
- Implemented constant-time secret comparison via `crypto.timingSafeEqual` with SHA-256 digest hashing.
- Enforced zero-downtime secret rotation supporting comma-separated `OPEN_SEMRUSH_API_TOKENS`.
- DNS answers pinned to pre-flight socket addresses to defeat TOCTOU rebinding attacks.

---

## [1.0.0] - 2026-10-20

### 🚀 Initial Release

- **Core Technical Crawler**:
  - Bounded multi-page crawler with redirect loop protection and response size caps (5 MiB).
  - On-page technical checks: Title, meta description, canonical, H1 hierarchy, alt tags, schema, security headers.
- **Google Search Console Integration**:
  - First-party telemetry via official Search Analytics API (clicks, impressions, CTR, average position).
- **Persistence Engines**:
  - Atomic JSON storage with `.tmp` staging, `fsync`, and restrictive permissions (`0o600`).
  - Transactional SQLite adapter (`node:sqlite` WAL mode) with ACID rollback and disaster recovery snapshot APIs.
- **Competitive SEO Intelligence**:
  - Domain overview, keyword gap comparison, multi-domain matrix, and synthetic backlink profiling.
- **Web Studio UI**:
  - Single-page application with dark theme, responsive layouts, CSV export, and print-ready PDF reports.

[1.2.0]: https://github.com/mightyalok00/open-semrush/releases/tag/v1.2.0
[1.1.0]: https://github.com/mightyalok00/open-semrush/releases/tag/v1.1.0
[1.0.0]: https://github.com/mightyalok00/open-semrush/releases/tag/v1.0.0
