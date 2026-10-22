# Open Semrush REST API Reference

Comprehensive specification for all HTTP endpoints exposed by `open-semrush`.

---

## Table of Contents

- [Data Provenance Contract](#data-provenance-contract)
- [Authentication & Security](#authentication--security)
- [Rate Limiting & Headers](#rate-limiting--headers)
- [System & Operational Endpoints](#system--operational-endpoints)
- [Site Audit & Crawler Endpoints](#site-audit--crawler-endpoints)
- [Google Search Console Endpoints](#google-search-console-endpoints)
- [Keywords & SERP Endpoints](#keywords--serp-endpoints)
- [Competitor Intelligence & Domain Analysis](#competitor-intelligence--domain-analysis)
- [Backlink & Toxicity Engine](#backlink--toxicity-engine)
- [Rank Tracking & Alerts](#rank-tracking--alerts)
- [Local NLP & Semantic Engine](#local-nlp--semantic-engine)
- [Traffic Forecasting & Rolling-Origin Backtesting](#traffic-forecasting--rolling-origin-backtesting)
- [AI Remediation & Strategy Cascades](#ai-remediation--strategy-cascades)
- [Storage & Audit History](#storage--audit-history)

---

## Data Provenance Contract

Every metric and intelligence object in Open Semrush explicitly declares its data provenance. The platform never conflates empirical observations with statistical approximations:

| Provenance Tier | Verification Standard | Example Fields / Endpoints |
| :--- | :--- | :--- |
| `verified_provider` | Direct first-party telemetry from official APIs | GSC clicks, impressions, CTR, average position (`/api/search-console`) |
| `empirical_observation` | Direct factual measurements during active HTTP crawls | Status codes, response headers, DOM markup, link graphs, SSL info (`/api/audit`) |
| `provider_api` | Live search provider telemetry | Google Suggest Autocomplete queries (`/api/keywords/real`) |
| `statistical_model` | Deterministic mathematical regressions & NLP embeddings | Power-law CTR decay, 4-class softmax intent, 8-vector backlink toxicity, KD calibrator |
| `synthetic_estimate` | Initial preview heuristics for unverified competitor domains | Modeled traffic and keyword distributions for domain overviews (`/api/domain`) |

---

## Authentication & Security

Protected endpoints require a Bearer token in the `Authorization` header:

```http
Authorization: Bearer <your-configured-token>
```

- In production (`NODE_ENV=production`), all protected routes fail closed with `503 Service Unavailable` if no tokens are configured.
- Supports zero-downtime key rotation via comma-separated tokens in `OPEN_SEMRUSH_API_TOKENS`.
- Token comparison uses constant-time `crypto.timingSafeEqual` over SHA-256 digests to eliminate timing attacks.

---

## Rate Limiting & Headers

In-memory sliding window rate limits protect endpoints:

| Endpoint Tier | Default Window | Default Max Requests | Header Returned |
| :--- | :--- | :--- | :--- |
| Standard Endpoints | 60,000 ms (1 min) | 120 req / IP | `X-RateLimit-Limit`, `X-RateLimit-Remaining` |
| Expensive Endpoints (`/api/audit`, `/api/ai/*`) | 60,000 ms (1 min) | 10 req / IP | `Retry-After: <seconds>` on 429 |

When behind a reverse proxy (e.g., Cloudflare, Nginx, AWS ALB), configure `TRUST_PROXY_HOPS=1` to safely parse client IPs while preventing header injection.

---

## System & Operational Endpoints

### 1. Health Probe
```http
GET /api/health
```
- **Auth**: None (Public)
- **Response `200 OK`**:
```json
{
  "status": "healthy",
  "timestamp": "2026-10-22T21:00:00.000Z",
  "uptimeSeconds": 1420,
  "activeRequests": 2
}
```

### 2. Operational Metrics
```http
GET /api/metrics
```
- **Auth**: None (Public)
- **Response `200 OK`**:
```json
{
  "status": "healthy",
  "uptimeSeconds": 1420,
  "activeRequests": 2,
  "totalRequests": 1845,
  "totalErrors": 3,
  "isShuttingDown": false,
  "memory": {
    "heapUsedBytes": 58349280,
    "heapTotalBytes": 94371840,
    "rssBytes": 134217728
  }
}
```

---

## Site Audit & Crawler Endpoints

### 3. Asynchronous Technical Site Audit
Performs bounded multi-page crawling, extracting HTML markup, canonicalization, OpenGraph, headers, SSL certificate, performance metrics, and directed link topology.
```http
POST /api/audit
Content-Type: application/json
Authorization: Bearer <token>

{
  "url": "https://example.com",
  "maxPages": 10
}
```

- **Security Enforcement**: Outbound URL safety guard verifies target is public IPv4/IPv6; blocks RFC 1918, loopbacks, cloud metadata (`169.254.169.254`), and executes socket IP pinning to prevent DNS rebinding TOCTOU attacks.
- **Response `200 OK`**:
```json
{
  "startUrl": "https://example.com",
  "pagesAudited": 3,
  "healthScore": 92,
  "totalErrors": 0,
  "totalWarnings": 2,
  "totalNotices": 1,
  "issues": [
    {
      "code": "MISSING_META_DESCRIPTION",
      "severity": "warning",
      "url": "https://example.com/about",
      "message": "Page is missing a meta description tag."
    }
  ],
  "pages": [
    {
      "url": "https://example.com",
      "statusCode": 200,
      "responseTimeMs": 142,
      "title": "Example Domain",
      "metaDescription": "Example domain for documentation",
      "canonicalUrl": "https://example.com",
      "h1Tags": ["Welcome to Example Domain"],
      "h2Tags": ["Overview", "Features"],
      "internalLinksCount": 12,
      "externalLinksCount": 4,
      "ssl": { "valid": true, "daysRemaining": 85 }
    }
  ],
  "linkGraph": {
    "nodes": 3,
    "edges": 8,
    "orphanedPages": []
  },
  "provenance": {
    "tier": "empirical_observation",
    "isFactual": true
  }
}
```

---

## Google Search Console Endpoints

### 4. List Verified Properties
```http
GET /api/search-console/sites
Authorization: Bearer <token>
```
- **Response `200 OK`**:
```json
{
  "sites": [
    { "siteUrl": "sc-domain:example.com", "permissionLevel": "siteOwner" }
  ],
  "verified": true
}
```

### 5. Search Analytics with Automated Intelligence
Queries official Search Analytics API and automatically computes **Striking Distance** keywords (ranks 11–20 with high impressions), **Cannibalization Conflicts** (multiple URLs ranking for identical query), and **CTR Opportunity Gaps**.
```http
GET /api/search-console?siteUrl=sc-domain:example.com&startDate=2026-09-01&endDate=2026-09-30&dimensions=query,page
Authorization: Bearer <token>
```
- **Query Parameters**:
  - `siteUrl`: Target property (e.g. `sc-domain:example.com`)
  - `startDate`, `endDate`: ISO YYYY-MM-DD date range
  - `dimensions`: Comma-separated (`query`, `page`, `device`, `country`)
  - `page`: Optional landing page filter
  - `query`: Optional search term filter
  - `intelligence`: `true` (default) or `false`
- **Response `200 OK`**:
```json
{
  "siteUrl": "sc-domain:example.com",
  "rows": 482,
  "totalClicks": 14280,
  "totalImpressions": 284100,
  "averageCtr": 0.0503,
  "averagePosition": 12.4,
  "strikingDistanceKeywords": [
    {
      "query": "cloud monitoring dashboard",
      "clicks": 42,
      "impressions": 8450,
      "ctr": 0.005,
      "position": 11.8,
      "expectedClicksPosition3": 760,
      "potentialGain": 718
    }
  ],
  "cannibalizationConflicts": [
    {
      "query": "best database tools",
      "competingPages": [
        { "page": "https://example.com/blog/best-db-tools", "clicks": 80, "position": 8.2 },
        { "page": "https://example.com/features/database", "clicks": 65, "position": 11.4 }
      ]
    }
  ],
  "dataProvenance": {
    "tier": "verified_provider",
    "isFactual": true,
    "provider": "Google Search Console Search Analytics API"
  }
}
```

---

## Keywords & SERP Endpoints

### 6. Live Suggest Research
```http
GET /api/keywords/real?q=saas+seo&provider=google&country=us
```
- **Response `200 OK`**:
```json
{
  "query": "saas seo",
  "provider": "google",
  "country": "us",
  "suggestions": [
    "saas seo strategy",
    "saas seo agency",
    "saas seo checklist",
    "saas seo benchmark"
  ],
  "questions": [
    "how to do saas seo",
    "what is a good b2b saas seo budget"
  ],
  "comparisons": [
    "saas seo vs content marketing",
    "saas seo vs paid search"
  ],
  "provenance": {
    "tier": "provider_api",
    "isFactual": true
  }
}
```

### 7. Multi-Angle Suggestion Expander
```http
POST /api/keywords/expand
Content-Type: application/json

{ "keyword": "technical seo" }
```
- **Response `200 OK`**: Returns structured linguistic permutations across prepositions, questions, comparisons, and transactional intents.

### 8. 6-Tier Keyword Difficulty (KD) Calibrator
```http
GET /api/keywords/kd?score=68
```
- **Response `200 OK`**:
```json
{
  "score": 68,
  "tier": "Hard",
  "color": "#ea580c",
  "description": "High competition among established domain authorities.",
  "referringDomainsNeeded": "80–150 unique high-quality referring domains",
  "intentRecommendation": "Comprehensive pillar guide + authoritative external backlink outreach."
}
```

---

## Competitor Intelligence & Domain Analysis

### 9. Domain Overview
```http
GET /api/domain?domain=stripe.com&country=us
```
- **Response `200 OK`**:
```json
{
  "domain": "stripe.com",
  "organicTraffic": 4200000,
  "domainAuthority": 92,
  "rankingKeywords": 345000,
  "marketShareOfVoice": 34.2,
  "topOrganicKeywords": [
    { "keyword": "payment gateway", "position": 1, "searchVolume": 165000, "traffic": 51480 }
  ],
  "dataProvenance": {
    "tier": "synthetic_estimate",
    "isFactual": false
  }
}
```

### 10. Multi-Competitor Keyword Gap Matrix
```http
GET /api/gap/multi?domains=github.com,gitlab.com,bitbucket.org
```
- **Response `200 OK`**: Computes pairwise and joint overlap, classifying keywords into `shared`, `unique`, `weak`, and `missing` opportunities.

---

## Backlink & Toxicity Engine

### 11. 8-Vector Backlink Toxicity Audit
Evaluates referring URLs across 8 distinct toxicity vectors:
1. Toxic TLDs (`.click`, `.top`, `.download`, `.xyz`, etc.)
2. Sitewide footer/sidebar link repetition
3. Manipulative commercial anchor density
4. Spam URL pattern heuristics (excessive subdomains, gibberish slugs)
5. Foreign or mismatched alphabet scripts
6. Non-secure transport over HTTP
7. Extreme link velocity bursts
8. IP subnet co-location spam clusters

```http
POST /api/backlinks/toxicity
Content-Type: application/json

{
  "domain": "example.com",
  "links": [
    {
      "sourceUrl": "http://free-spammers-download.xyz/link.html",
      "targetUrl": "https://example.com",
      "anchorText": "buy cheap pills online"
    }
  ]
}
```
- **Response `200 OK`**: Returns overall toxicity score (0–100), risk tier (`Clean`, `Low`, `Medium`, `High`, `Toxic`), vector triggers, and Google Disavow file candidate list formatted according to official Google specs.

---

## Rank Tracking & Alerts

### 12. Rank Tracker Overview
```http
GET /api/rank-tracker/overview?domain=example.com
Authorization: Bearer <token>
```
- **Response `200 OK`**: Returns tracked domain summary, Visibility Index (0–100), rank distribution tiers (1–3, 4–10, 11–20, 21–50, 51–100), average position, top winners, and top losers.

### 13. Scheduled / On-Demand Rank Check
```http
POST /api/rank-tracker/check
Content-Type: application/json
Authorization: Bearer <token>

{ "domain": "example.com" }
```
- Updates live positions, records historical deltas, and generates ranking volatility alerts (`CRITICAL_DROP`, `PAGE_ONE_ENTRY`, `RANK_ONE_GAINED`, `OUT_OF_INDEX`).

---

## Local NLP & Semantic Engine

### 14. Semantic Keyword Clustering
```http
POST /api/nlp/cluster
Content-Type: application/json

{
  "keywords": [
    "b2b saas pricing",
    "saas pricing calculator",
    "enterprise software cost",
    "how to price saas software"
  ],
  "threshold": 0.35
}
```
- **Response `200 OK`**: Partitions keywords into agglomerative semantic clusters using character 3-gram Jaccard similarity matrices and dominant intent distributions.

### 15. Search Intent vs. Page Content Alignment
```http
POST /api/nlp/intent-alignment
Content-Type: application/json

{
  "query": "best project management tools",
  "html": "<html><body><h1>Top 10 Project Management Software</h1>...</body></html>"
}
```
- **Response `200 OK`**: Evaluates whether page copy fulfills the searcher's dominant intent (Informational, Commercial, Navigational, Transactional) and flags severe satisfaction mismatches.

### 16. Semantic Content Gap Analyzer
```http
POST /api/nlp/content-gap
Content-Type: application/json

{
  "targetText": "Our guide to technical SEO audits...",
  "competitorText": "Complete technical SEO checklist including Core Web Vitals, SSRF, robots.txt, schema markup, and canonical tags..."
}
```
- **Response `200 OK`**: Extracts missing subtopics, vocabulary gaps, and unanswered questions present in competitor content but missing from your page.

---

## Traffic Forecasting & Rolling-Origin Backtesting

### 17. Parametric Traffic Forecast Point & Interval
```http
GET /api/ml/forecast?q=saas+audit&volume=10000&position=3&hasFeaturedSnippet=false
```
- **Response `200 OK`**:
```json
{
  "query": "saas audit",
  "position": 3,
  "monthlySearchVolume": 10000,
  "intentDistribution": {
    "informational": 0.22,
    "commercial": 0.68,
    "navigational": 0.05,
    "transactional": 0.05
  },
  "ctrPrediction": {
    "baseCtr": 0.1124,
    "adjustedCtr": 0.1124,
    "attenuationFactors": []
  },
  "trafficForecast": {
    "expectedMonthlyVisits": 1124,
    "confidenceInterval95": {
      "lower": 1062,
      "upper": 1186,
      "marginOfError": 62
    }
  }
}
```

### 18. Rolling-Origin Temporal Holdout Backtesting
```http
POST /api/forecast
Content-Type: application/json

{
  "domain": "example.com",
  "observations": [
    { "date": "2025-05-01", "clicks": 184, "impressions": 2840, "ctr": 0.0648, "position": 14.2 },
    { "date": "2025-05-02", "clicks": 192, "impressions": 2910, "ctr": 0.0660, "position": 14.1 }
  ],
  "minObservations": 30,
  "backtestFolds": 4
}
```
- **Response `200 OK`**: Evaluates historical time-series against Naive and Mean baselines across rolling temporal folds. Ensures zero data leakage ($\max(T_{\text{train}}) < \min(T_{\text{test}})$) and reports MAE, RMSE, MAPE, Directional Bias, and 95% Coverage.

---

## AI Remediation & Strategy Cascades

### 19. Autonomous SEO Code Fix Generation
```http
POST /api/ai/fix
Content-Type: application/json
Authorization: Bearer <token>

{
  "url": "https://example.com/pricing",
  "issueCode": "MISSING_CANONICAL",
  "originalValue": null,
  "message": "Page lacks rel=canonical tag"
}
```
- **Response `200 OK`**: Returns production-ready HTML/schema fix with step-by-step developer remediation instructions. Failover cascade: OpenRouter free models -> Google Gemini -> Deterministic fallback.

### 20. Outrank Content Strategy Blueprint
```http
POST /api/ai/strategy
Content-Type: application/json
Authorization: Bearer <token>

{
  "domainA": "yoursite.com",
  "competitorDomain": "competitor.com",
  "missingKeyword": "headless cms comparison"
}
```
- **Response `200 OK`**: Generates a high-authority content outline designed to outrank the target competitor page.

---

## Storage & Audit History

### 21. Stored Project Registry
```http
GET /api/projects
Authorization: Bearer <token>
```
- Returns all persisted audit projects and metadata.

### 22. Historical Audit Scores
```http
GET /api/history?domain=example.com
Authorization: Bearer <token>
```
- Returns historical health score snapshots and error progression for the domain.
