<div align="center">

# 🚀 Open Semrush (Semrush Studio)

**The High-Performance, Privacy-First Open-Source Alternative to Semrush & Ahrefs.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)](https://www.docker.com/)
[![Pure TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Zero External Dependencies](https://img.shields.io/badge/Dependencies-Zero%20Heavy%20NPM-brightgreen.svg)](#architecture)

*Complete competitive SEO intelligence suite featuring Technical Site Auditing, Live Google SERP Top 10, Multi-Competitor Keyword Gap, Backlink Analytics with Penguin Toxicity, and Gemini AI Outrank Strategist.*

[Explore Features](#-core-features) • [Quickstart](#-quickstart) • [Docker Setup](#-docker-quickstart) • [REST API Reference](#-rest-api-reference) • [CLI Commands](#-cli-reference)

---

</div>

## 🌟 Why Open Semrush?

Traditional SEO platforms like Semrush and Ahrefs charge **$130 - $499/month**, enforce strict credit quotas, and lock essential features behind enterprise paywalls. 

**Open Semrush** delivers an open-source, self-hosted SEO workstation with:
- **Zero Subscriptions or Quotas:** Self-host on your local laptop, VPS, or Docker container with unlimited domain and keyword queries.
- **Blazing Fast & Lightweight:** Built using **pure Node.js built-ins** (`node:http`, `node:fs`, `node:url`) with zero bloated frameworks.
- **AI-Powered Remediation:** Directly integrates Google Gemini and OpenRouter to generate copy-paste code fixes and outrank content outlines.
- **Dark-Themed Executive UI:** Modern responsive web studio with interactive SVG charts, 24-month historical trajectories, Google Core update pins, and print-ready PDF reporting.

---

## ⚡ Core Features

### 1. 🌐 Domain Overview & Historical Trajectory
- **Authority Score (AS):** Algorithmic composite score (1–100) factoring backlink volume, dofollow ratios, and organic reach.
- **Organic Traffic & Ranked Keywords:** Estimated monthly organic visits and indexed keyword counts across US, UK, IN, DE, CA, AU regions.
- **24-Month Trajectory Area Chart:** SVG area graph tracking 2-year traffic trends with milestone pins highlighting real **Google Core Algorithm Updates**.
- **Top Competitor Discovery:** Automatic detection of organic search rivals with one-click pivot analysis.

### 2. 🔑 Keyword Magic Tool & Seasonality
- **Keyword Metrics:** Search volume, Keyword Difficulty (KD%), Commercial Search Intent (Commercial, Informational, Navigational, Transactional), Cost-Per-Click (CPC), and Competitive Density.
- **12-Month Seasonality Bars:** Month-by-month demand trends to identify cyclical peaks.
- **Semantic Variations & Questions:** Long-tail query generator with instant "Inspect" shortcuts.

### 3. 🎯 Live Google SERP Top 10 Inspector
- **Rankings #1 to #10:** Live titles, URLs, snippet descriptions, and calculated Click-Through Rates (CTR) based on real search position curves.
- **SERP Features Detection:** Automatically identifies **Featured Snippets (Position 0)**, **People Also Ask (PAA)** interactive cards, **Video Packs**, and **Knowledge Panels**.

### 4. 🛠️ Technical Site Audit & Security Headers
- **Site Health Score (0–100):** Comprehensive weighted health formula tracking Errors (–5 pts), Warnings (–2 pts), and Notices (–0.5 pts).
- **On-Page Diagnostics:** Missing/duplicate `<title>`, `<meta description>`, `<h1>` count, image alt tags, word counts, and OpenGraph completion.
- **Infrastructure Auditing:** Validates `robots.txt`, XML sitemaps, Time to First Byte (TTFB) latency, compression (gzip/br), and payload size (KB).
- **Security Headers & Schema.org:** Checks `Strict-Transport-Security` (HSTS), `Content-Security-Policy` (CSP), and extracts JSON-LD Structured Data types.
- **✨ Fix with AI:** One-click button generates copy-paste HTML tags and optimized meta descriptions via Gemini.

### 5. ⚔️ Multi-Competitor Keyword Gap & SVG Venn Diagram
- **Multi-Domain Matrix:** Compare up to 5 competitors simultaneously in a unified matrix with leader podium badges.
- **Categorical Breakdowns:** Categorizes opportunities into **Missing** (competitor ranks, you don't), **Shared** (both rank), and **Unique** (your competitive moat).
- **Interactive SVG Venn Diagram:** Visualizes overlap and lets you click circle segments to jump directly to target keyword lists.
- **⚡ Outrank Plan:** One-click AI blueprint generator that outlines headings (H1, H2, H3) and talking points to outrank the competitor.

### 6. 🔗 Backlink Analytics & Penguin Toxicity Score
- **Link Graph Profile:** Total backlinks, referring root domains, and dofollow vs. nofollow ratio bars.
- **Toxicity Score (Penguin Risk):** Detects spammy link profiles, flagged TLDs, and calculates high/medium/low algorithmic penalty risk.
- **Anchor Text Taxonomy:** Semrush-standard breakdown of **Branded**, **Exact Match**, **Naked URL**, and **Generic** anchors.
- **Live Inbound Feed:** Real-time stream of source URLs, target destinations, anchor text, and source PageRank authority.

### 7. 📄 Data Portability & Executive Reporting
- **One-Click CSV Export:** RFC 4180 compliant CSV export for spreadsheets and client handoffs.
- **Executive PDF Presentation:** Tailored `@media print` CSS layout that generates presentation-ready reports via your browser's Print dialog.

---

## 🚀 Quickstart

### Prerequisites
- Node.js 18.0.0 or higher
- (Optional) Docker & Docker Compose
- (Optional) Google Gemini or OpenRouter API key for AI features

### Option A: Run with Local Node.js

```bash
# 1. Clone repository
git clone https://github.com/mightyalok00/open-semrush.git
cd open-semrush

# 2. Configure environment (optional for AI features)
cp .env.example .env

# 3. Start the Web Studio & API server
npm start
```

Open your browser at **`http://localhost:3000`**!

---

### Option B: Docker Quickstart

```bash
# 1. Start with Docker Compose
docker compose up -d

# 2. Check container status
docker compose ps
```

The container starts `node:24-alpine` on port `3000`. Access `http://localhost:3000`.

To stop the container:
```bash
docker compose down
```

---

## 💻 CLI Reference

Open Semrush includes a command-line interface for running audits and intelligence queries directly from your terminal:

```bash
# Technical Site Audit (crawls 5 pages)
node scripts/semrush.mjs audit https://example.com --pages 5

# Keyword Magic & Difficulty Analysis
node scripts/semrush.mjs keyword "best seo tools"

# Domain Overview
node scripts/semrush.mjs domain github.com

# Pairwise Competitor Keyword Gap
node scripts/semrush.mjs gap github.com gitlab.com

# Backlink Profile & Anchor Analysis
node scripts/semrush.mjs backlinks github.com
```

---

## 📡 REST API Reference

Open Semrush exposes clean REST endpoints:

| Method | Endpoint | Description | Query / Body Parameters |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/domain` | Domain overview & keywords | `?domain=example.com&country=us` |
| `GET` | `/api/keyword` | Keyword metrics & seasonality | `?q=seo+software` |
| `GET` | `/api/serp` | Live Google SERP Top 10 | `?q=seo+software` |
| `POST` | `/api/audit` | Run technical crawler | `{"url": "https://example.com", "maxPages": 3}` |
| `GET` | `/api/gap` | Pairwise keyword gap | `?domainA=github.com&domainB=gitlab.com` |
| `GET` | `/api/gap/multi` | Multi-competitor matrix | `?domains=site1.com,site2.com,site3.com` |
| `GET` | `/api/backlinks` | Backlink analytics & toxicity | `?domain=example.com` |
| `POST` | `/api/ai/fix` | Gemini SEO issue fix | `{"url": "...", "issueCode": "...", "message": "..."}` |
| `POST` | `/api/ai/strategy` | Gemini Outrank article plan | `{"domainA": "...", "competitorDomain": "...", "missingKeyword": "..."}` |
| `GET` | `/api/projects` | List tracked SEO projects | N/A |

---

## 🏗️ Architecture & Directory Structure

```text
open-semrush/
├── src/                    # TypeScript Source Engine
│   ├── ai.ts               # Gemini & OpenRouter AI remediation and strategy engine
│   ├── backlinks.ts        # Link graph metrics, PageRank & Penguin toxicity calculation
│   ├── crawler.ts          # Asynchronous multi-page crawler, TTFB latency & audit engine
│   ├── domain.ts           # Domain authority score, organic traffic & multi-gap matrix
│   ├── keywords.ts         # Keyword difficulty (KD%), intent & seasonality modeling
│   ├── serp.ts             # Google SERP Top 10 parser, CTR curve & features extractor
│   ├── storage.ts          # Project history & audit tracking persistence
│   ├── types.ts            # Canonical TypeScript schemas and interfaces
│   └── index.ts            # Core module exports
├── public/                 # Client-Side Web Application
│   ├── index.html          # Semrush Studio dark-mode dashboard
│   ├── style.css           # Glassmorphism styling, CSS variables & print PDF rules
│   └── app.js              # Interactive controller, SVG Venn and area chart engines
├── dist/                   # Pre-compiled high-performance ESM JavaScript
├── scripts/                # Launchers & CLI Tools
│   ├── semrush-server.mjs  # HTTP server and REST API dispatcher
│   └── semrush.mjs         # Terminal CLI utility
├── Dockerfile              # Multi-stage production container image
├── docker-compose.yml      # Service configuration
├── package.json            # Node.js manifest and npm scripts
└── tsconfig.json           # Compiler configuration
```

---

## 🤝 Contributing

Contributions are warmly welcomed! Feel free to:
1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📜 License

This project is licensed under the [MIT License](LICENSE) — free for personal, commercial, and enterprise use.
