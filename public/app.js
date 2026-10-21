/**
 * ==============================================================================
 * SEMRUSH STUDIO — CLIENT-SIDE CONTROLLER & DATA VISUALIZATION ENGINE
 * ==============================================================================
 * Architecture: Modular vanilla JS client interacting with Semrush Studio REST APIs.
 * Supports:
 *   - Domain Overview with 24-month historical trajectory area chart
 *   - Google Core Algorithm Update correlation pins
 *   - Keyword Magic Tool with 12-month seasonality trends & SERP features
 *   - Live Google SERP Top 10 analyzer with CTR curve & PAA questions
 *   - Technical Site Audit with crawler, TTFB latency, security headers & Schema.org
 *   - Multi-Competitor Keyword Gap matrix with interactive SVG Venn diagram
 *   - Backlink Analytics with PageRank, Penguin toxicity scoring & anchor taxonomy
 *   - Gemini / OpenRouter AI code remediation & Outrank content strategist
 *   - Data portability via CSV export & print-ready executive PDF reports
 * ==============================================================================
 */

/* ========================================================================== */
/* CELL 0: GLOBAL APPLICATION STATE & BOOTSTRAPPER                            */
/* ========================================================================== */

/**
 * Cached snapshot of the active domain overview response.
 * Used by the CSV exporter to generate on-demand keyword reports without re-fetching.
 * @type {Object|null}
 */
let currentActiveDomainData = null;

/**
 * Active ISO country code for regional search volume and traffic scaling.
 * Defaults to 'us' (United States).
 * @type {string}
 */
let currentCountryCode = 'us';

/**
 * Application Entry Point.
 * Listens for DOMContentLoaded to wire up all view controllers, modals,
 * data export listeners, and load default demo analysis.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Initialize sub-modules and event listeners
  setupTabs();
  setupRegionSelector();
  setupDomainOverview();
  setupKeywordMagic();
  setupSiteAudit();
  setupKeywordGap();
  setupBacklinkAnalytics();
  setupModals();
  setupExportCsv();
  setupExportPdf();

  // Load initial demo analysis for 'github.com' to populate Domain Overview
  fetchDomainOverview('github.com');
});


/* ========================================================================== */
/* CELL 1: REGION & COUNTRY SELECTOR                                          */
/* ========================================================================== */

/**
 * Sets up the global country selector dropdown in the top navigation bar.
 * When changed, updates `currentCountryCode` and triggers a re-fetch of the
 * active domain with region-specific traffic scaling.
 */
function setupRegionSelector() {
  const sel = document.getElementById('globalCountrySelect');
  if (sel) {
    sel.addEventListener('change', () => {
      // 1. Update the active global country state
      currentCountryCode = sel.value;

      // 2. Identify currently queried domain or fallback to github.com
      const curDom = document.getElementById('domainInput').value.trim() || 'github.com';

      // 3. Re-query backend with new geo-location parameters
      fetchDomainOverview(curDom);
    });
  }
}


/* ========================================================================== */
/* CELL 2: TAB NAVIGATION ROUTER                                              */
/* ========================================================================== */

/**
 * Initializes the tab navigation bar.
 * Switches visible panes, updates active nav state, and synchronizes the header
 * title and description with metadata for the selected SEO tool.
 */
function setupTabs() {
  const navButtons = document.querySelectorAll('.nav-item');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const titleEl = document.getElementById('currentTabTitle');
  const descEl = document.getElementById('currentTabDescription');

  /**
   * Header metadata dictionary mapped by tab identifier.
   */
  const tabMeta = {
    domain: {
      title: 'Domain Overview',
      desc: "Analyze any domain's organic traffic, keyword portfolio, and authority score."
    },
    keywords: {
      title: 'Keyword Magic Tool',
      desc: 'Discover search volumes, commercial intent, and Keyword Difficulty (KD%).'
    },
    audit: {
      title: 'Technical Site Audit',
      desc: 'Scan website pages for on-page SEO issues, broken tags, and compute Site Health.'
    },
    gap: {
      title: 'Keyword Gap Analysis',
      desc: 'Compare keyword overlaps, discover competitor advantages and missing terms.'
    },
    backlinks: {
      title: 'Backlink Analytics',
      desc: 'Inspect graph PageRank, inbound link profiles, referring domains, and anchor text.'
    }
  };

  // Wire click event to each nav button
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');

      // Remove active class from all buttons and panes
      navButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      // Activate current button and matching pane
      btn.classList.add('active');
      const pane = document.getElementById(`tab-${targetTab}`);
      if (pane) pane.classList.add('active');

      // Update header banner text
      if (tabMeta[targetTab]) {
        titleEl.textContent = tabMeta[targetTab].title;
        descEl.textContent = tabMeta[targetTab].desc;
      }
    });
  });
}


/* ========================================================================== */
/* CELL 3: DOMAIN OVERVIEW CONTROLLER                                         */
/* ========================================================================== */

/**
 * Attaches form submission handlers for the Domain Overview tool.
 */
function setupDomainOverview() {
  const form = document.getElementById('domainForm');
  const input = document.getElementById('domainInput');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const domain = input.value.trim();
    if (domain) {
      fetchDomainOverview(domain);
    }
  });
}

/**
 * Asynchronously queries the `/api/domain` endpoint for traffic, authority,
 * ranked keywords, competitors, and historical trajectory.
 * 
 * @param {string} domain - Target root domain (e.g. 'github.com')
 */
async function fetchDomainOverview(domain) {
  const loader = document.getElementById('domainLoading');
  const results = document.getElementById('domainResults');

  // Toggle loading spinner
  loader.classList.remove('hidden');
  results.classList.add('hidden');

  try {
    // Execute API fetch with domain and active country code
    const res = await fetch(`/api/domain?domain=${encodeURIComponent(domain)}&country=${encodeURIComponent(currentCountryCode)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    // Store in global memory for subsequent CSV exports
    currentActiveDomainData = data;

    // Render KPI Cards: Authority Score, Traffic & Total Keywords
    document.getElementById('domainAs').textContent = data.authorityScore;
    document.getElementById('domainAsBar').style.width = `${data.authorityScore}%`;
    document.getElementById('domainTraffic').textContent = data.estimatedMonthlyOrganicTraffic.toLocaleString();
    document.getElementById('domainKeywordsCount').textContent = data.totalRankedKeywords.toLocaleString();

    // Render Competitor Tags with click-to-inspect shortcuts
    const compContainer = document.getElementById('domainCompetitors');
    compContainer.innerHTML = '';
    (data.topCompetitors || []).forEach(comp => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = comp;
      tag.style.cursor = 'pointer';
      tag.title = 'Click to inspect competitor';
      tag.onclick = () => {
        document.getElementById('domainInput').value = comp;
        fetchDomainOverview(comp);
      };
      compContainer.appendChild(tag);
    });

    // Populate Top Organic Keywords Table
    const tbody = document.getElementById('domainKeywordsTableBody');
    tbody.innerHTML = '';
    document.getElementById('kwCountBadge').textContent = `${data.topOrganicKeywords.length} keywords`;

    (data.topOrganicKeywords || []).forEach(item => {
      const tr = document.createElement('tr');
      // Highlight podium positions (1, 2, 3)
      const posClass = item.position === 1 ? 'pos-1' : (item.position === 2 ? 'pos-2' : (item.position === 3 ? 'pos-3' : ''));
      const intentClass = `intent-${item.intent.toLowerCase()}`;

      tr.innerHTML = `
        <td><span class="pos-badge ${posClass}">${item.position}</span></td>
        <td style="font-weight: 600;">${escapeHtml(item.keyword)}</td>
        <td>${item.searchVolume.toLocaleString()}</td>
        <td style="color: var(--accent-green); font-weight: 600;">${item.estimatedMonthlyTraffic.toLocaleString()}</td>
        <td><span class="intent-badge ${intentClass}">${item.intent}</span></td>
      `;
      tbody.appendChild(tr);
    });

    // Render 24-Month Trajectory Area Chart if historical records exist
    if (data.history24Months && data.history24Months.length > 0) {
      render24MonthTrafficChart(data.history24Months);
    }

    // Reveal populated results container
    results.classList.remove('hidden');
  } catch (err) {
    alert(`Failed to load domain overview: ${err.message}`);
  } finally {
    loader.classList.add('hidden');
  }
}


/* ========================================================================== */
/* CELL 4: 24-MONTH HISTORICAL TRAJECTORY SVG AREA CHART                      */
/* ========================================================================== */

/**
 * Renders an interactive SVG area and line chart depicting 24 months of
 * organic search traffic fluctuations.
 * Calculates normalized coordinates and overlays Google Core Update milestone pins.
 * 
 * @param {Array<{month: string, organicTraffic: number, googleUpdate?: string}>} history - 24-month timeline dataset
 */
function render24MonthTrafficChart(history) {
  const container = document.getElementById('history24MonthChart');
  if (!container || !history || history.length === 0) return;

  // Compute dynamic min/max bounds for mathematical Y-axis scaling
  const maxTraffic = Math.max(...history.map(h => h.organicTraffic), 1000);
  const minTraffic = Math.min(...history.map(h => h.organicTraffic), 0);
  const range = maxTraffic - minTraffic || 1;

  // ViewBox layout dimensions
  const w = 800;
  const h = 200;
  const paddingX = 40;
  const paddingY = 30;

  // Map each data point to 2D SVG canvas coordinates
  const points = history.map((m, i) => {
    const x = paddingX + (i / (history.length - 1)) * (w - paddingX * 2);
    const y = h - paddingY - ((m.organicTraffic - minTraffic) / range) * (h - paddingY * 2);
    return { x, y, m };
  });

  // Closed polygon coordinate string for the gradient fill
  const polyPoints = [
    `${paddingX},${h - paddingY}`,
    ...points.map(p => `${p.x},${p.y}`),
    `${w - paddingX},${h - paddingY}`
  ].join(' ');

  // Polyline coordinate string for the stroke path
  const linePoints = points.map(p => `${p.x},${p.y}`).join(' ');

  // Generate milestone pins for Google Core Updates & periodic month labels
  let markersHtml = '';
  points.forEach((p, idx) => {
    if (p.m.googleUpdate) {
      // Pin with dashed vertical line, star icon, and hover tooltip
      markersHtml += `
        <g class="update-pin" style="cursor: pointer;">
          <line x1="${p.x}" y1="${p.y}" x2="${p.x}" y2="${p.y - 30}" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="3,3" />
          <circle cx="${p.x}" cy="${p.y}" r="6" fill="#fbbf24" stroke="#0f172a" stroke-width="2">
            <title>${escapeHtml(p.m.googleUpdate)} (${p.m.month})</title>
          </circle>
          <text x="${p.x}" y="${p.y - 34}" fill="#fbbf24" font-size="10" font-weight="700" text-anchor="middle">★ Core Update</text>
        </g>
      `;
    } else if (idx === points.length - 1 || idx === 0 || idx % 4 === 0) {
      // Regular month marker dots and X-axis labels
      markersHtml += `
        <circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#3b82f6" stroke="#ffffff" stroke-width="1">
          <title>${p.m.month}: ${p.m.organicTraffic.toLocaleString()} visits</title>
        </circle>
        <text x="${p.x}" y="${h - 10}" fill="#94a3b8" font-size="10" text-anchor="middle">${p.m.month}</text>
      `;
    }
  });

  // Inject fully composed SVG into DOM container
  container.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" style="width: 100%; height: 100%; overflow: visible;" preserveAspectRatio="none">
      <defs>
        <linearGradient id="trafficGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      <!-- Base Axis Line -->
      <line x1="${paddingX}" y1="${h - paddingY}" x2="${w - paddingX}" y2="${h - paddingY}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
      <!-- Shaded Area Polygon -->
      <polygon points="${polyPoints}" fill="url(#trafficGradient)"/>
      <!-- Trend Line -->
      <polyline points="${linePoints}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round"/>
      <!-- Google Core Update and Milestone Pins -->
      ${markersHtml}
    </svg>
  `;
}


/* ========================================================================== */
/* CELL 5: KEYWORD MAGIC TOOL & SEASONALITY CONTROLLER                        */
/* ========================================================================== */

/**
 * Initializes form submission listener for the Keyword Magic Tool.
 */
function setupKeywordMagic() {
  const form = document.getElementById('keywordForm');
  const input = document.getElementById('keywordInput');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (query) {
      fetchKeywordData(query);
    }
  });
}

/**
 * Asynchronously queries `/api/keyword` for search metrics, KD% index,
 * 12-month seasonality trend, and semantic long-tail variations.
 * Automatically chains a call to `fetchSerpData` to inspect real Google rankings.
 * 
 * @param {string} query - Keyword search phrase (e.g. 'best seo tools')
 */
async function fetchKeywordData(query) {
  const loader = document.getElementById('keywordLoading');
  const results = document.getElementById('keywordResults');

  loader.classList.remove('hidden');
  results.classList.add('hidden');

  try {
    const res = await fetch(`/api/keyword?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const m = data.metrics;

    // Display Volume & KD%
    document.getElementById('kwVolume').textContent = m.searchVolume.toLocaleString();
    document.getElementById('kwKd').textContent = `${m.keywordDifficulty}%`;
    document.getElementById('kwKdBar').style.width = `${m.keywordDifficulty}%`;

    // Dynamic color coding based on KD difficulty tier
    const kdBadge = document.getElementById('kwKdBadge');
    if (m.keywordDifficulty > 70) {
      kdBadge.className = 'kpi-badge badge-error';
      kdBadge.textContent = 'Very Hard';
    } else if (m.keywordDifficulty > 45) {
      kdBadge.className = 'kpi-badge badge-warning';
      kdBadge.textContent = 'Moderate';
    } else {
      kdBadge.className = 'kpi-badge badge-growth';
      kdBadge.textContent = 'Easy';
    }

    // Intent badge (Commercial, Informational, Navigational, Transactional)
    const intentEl = document.getElementById('kwIntent');
    intentEl.className = `intent-badge intent-${m.intent.toLowerCase()}`;
    intentEl.textContent = m.intent;

    // Financial Metrics
    document.getElementById('kwCpc').textContent = `$${m.cpcUsd.toFixed(2)}`;
    document.getElementById('kwDensity').textContent = m.competitiveDensity.toFixed(2);

    // 12-Month Seasonality Bar Chart
    const chartContainer = document.getElementById('seasonalityChart');
    chartContainer.innerHTML = '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    (m.seasonalityTrend || []).forEach((val, i) => {
      const col = document.createElement('div');
      col.className = 'bar-col';
      col.innerHTML = `
        <div class="bar-fill" style="height: ${val}%;" title="${months[i]}: ${val}% interest"></div>
        <span class="bar-label">${months[i]}</span>
      `;
      chartContainer.appendChild(col);
    });

    // Keyword Variations List with instant 'Inspect' shortcut buttons
    const varList = document.getElementById('kwVariationsList');
    varList.innerHTML = '';
    (data.variations || []).forEach(v => {
      const li = document.createElement('li');
      li.className = 'variation-item';
      li.innerHTML = `
        <span>${escapeHtml(v)}</span>
        <button class="kpi-badge" style="cursor: pointer;" onclick="document.getElementById('keywordInput').value='${escapeHtml(v)}'; fetchKeywordData('${escapeHtml(v)}');">Inspect</button>
      `;
      varList.appendChild(li);
    });

    results.classList.remove('hidden');

    // Automatically trigger SERP Top 10 inspection for this query
    fetchSerpData(query);

  } catch (err) {
    alert(`Failed to analyze keyword: ${err.message}`);
  } finally {
    loader.classList.add('hidden');
  }
}


/* ========================================================================== */
/* CELL 6: LIVE GOOGLE SERP TOP 10 & SERP FEATURES INSPECTOR                  */
/* ========================================================================== */

/**
 * Asynchronously queries `/api/serp` to inspect the top 10 search results,
 * calculate estimated CTR via logarithmic model, and parse SERP feature blocks
 * (Featured Snippets, People Also Ask questions, Video Packs, Knowledge Panels).
 * 
 * @param {string} query - Target search query
 */
async function fetchSerpData(query) {
  try {
    const res = await fetch(`/api/serp?q=${encodeURIComponent(query)}`);
    if (!res.ok) return;
    const data = await res.json();

    // 1. Render SERP Feature Badges
    const badgesContainer = document.getElementById('serpFeaturesBadges');
    badgesContainer.innerHTML = '';
    const feats = data.features || {};
    if (feats.hasFeaturedSnippet) {
      badgesContainer.innerHTML += '<span class="kpi-badge badge-growth">★ Featured Snippet</span>';
    }
    if (feats.peopleAlsoAsk && feats.peopleAlsoAsk.length > 0) {
      badgesContainer.innerHTML += '<span class="kpi-badge">❓ People Also Ask</span>';
    }
    if (feats.hasVideoPack) {
      badgesContainer.innerHTML += '<span class="kpi-badge">🎬 Video Pack</span>';
    }
    if (feats.hasKnowledgePanel) {
      badgesContainer.innerHTML += '<span class="kpi-badge">🏢 Knowledge Panel</span>';
    }

    // 2. Render Featured Snippet Callout Box (Position 0)
    const snipBox = document.getElementById('serpFeaturedSnippetBox');
    if (feats.hasFeaturedSnippet && feats.featuredSnippet) {
      snipBox.classList.remove('hidden');
      snipBox.innerHTML = `
        <div style="font-weight: 700; color: var(--accent-blue); margin-bottom: 6px;">★ Google Featured Snippet</div>
        <p style="font-size: 0.95rem; line-height: 1.6; color: var(--text-primary); margin-bottom: 8px;">"${escapeHtml(feats.featuredSnippet.snippet)}"</p>
        <div style="font-size: 0.8rem; color: var(--text-secondary);">
          Source: <a href="${escapeHtml(feats.featuredSnippet.sourceUrl)}" target="_blank" style="color: var(--accent-orange); text-decoration: none;">${escapeHtml(feats.featuredSnippet.title)} (${escapeHtml(feats.featuredSnippet.sourceDomain)})</a>
        </div>
      `;
    } else {
      snipBox.classList.add('hidden');
    }

    // 3. Render People Also Ask (PAA) Questions Grid
    const paaBox = document.getElementById('serpPaaBox');
    if (feats.peopleAlsoAsk && feats.peopleAlsoAsk.length > 0) {
      paaBox.classList.remove('hidden');
      let paaHtml = '<div style="font-weight: 700; margin-bottom: 8px;">❓ People Also Ask:</div><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px;">';
      feats.peopleAlsoAsk.forEach(q => {
        paaHtml += `
          <div style="background: rgba(255,255,255,0.02); padding: 8px 12px; border-radius: 6px; font-size: 0.85rem; border-left: 2px solid var(--accent-orange); cursor: pointer;" onclick="document.getElementById('keywordInput').value='${escapeHtml(q)}'; fetchKeywordData('${escapeHtml(q)}');">
            ${escapeHtml(q)}
          </div>
        `;
      });
      paaHtml += '</div>';
      paaBox.innerHTML = paaHtml;
    } else {
      paaBox.classList.add('hidden');
    }

    // 4. Render Google Top 10 SERP Table
    const tbody = document.getElementById('serpTableBody');
    tbody.innerHTML = '';
    (data.topRankings || []).forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="rank-pos ${r.position === 1 ? 'pos-1' : ''}">${r.position}</span></td>
        <td>
          <a href="${escapeHtml(r.url)}" target="_blank" style="font-weight: 600; color: var(--accent-blue); text-decoration: none;">${escapeHtml(r.title)}</a>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">${escapeHtml(r.snippet)}</div>
        </td>
        <td><span class="kpi-badge badge-high">${r.authorityScore}</span></td>
        <td style="font-weight: 600; color: var(--accent-green);">${(r.estimatedCtr * 100).toFixed(1)}%</td>
        <td>
          <button class="kpi-badge" style="cursor: pointer; background: var(--bg-card);" onclick="inspectDomainFromSerp('${escapeHtml(r.domain)}')">
            Inspect
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Failed to load SERP:', err);
  }
}

/**
 * Global helper to pivot from a SERP ranking row directly into Domain Overview.
 * Switches active tabs and automatically triggers a new domain query.
 * 
 * @param {string} domain - Domain name to inspect
 */
window.inspectDomainFromSerp = function(domain) {
  document.getElementById('domainInput').value = domain;
  document.querySelector('.nav-item[data-tab="domain"]').click();
  document.getElementById('domainForm').dispatchEvent(new Event('submit'));
};


/* ========================================================================== */
/* CELL 7: TECHNICAL SITE AUDIT & CRAWLER CONTROLLER                          */
/* ========================================================================== */

/**
 * Initializes form submission listener for the Technical Site Audit crawler.
 * Posts audit parameters to `/api/audit`, renders health scores, crawl metrics,
 * sitemap / robots.txt validation, and individual page audit accordions.
 */
function setupSiteAudit() {
  const form = document.getElementById('auditForm');
  const urlInput = document.getElementById('auditUrlInput');
  const pagesSelect = document.getElementById('auditPagesCount');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    const maxPages = parseInt(pagesSelect.value, 10) || 3;
    if (!url) return;

    const loader = document.getElementById('auditLoading');
    const results = document.getElementById('auditResults');

    // Show loading spinner
    loader.classList.remove('hidden');
    results.classList.add('hidden');

    try {
      // POST request to trigger multi-page asynchronous crawl
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, maxPages }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Update Site Health Score & Error counts
      document.getElementById('auditHealthScore').textContent = data.healthScore;
      document.getElementById('auditHealthBar').style.width = `${data.healthScore}%`;
      document.getElementById('auditErrorsCount').textContent = data.totalErrors;
      document.getElementById('auditWarningsCount').textContent = data.totalWarnings;
      document.getElementById('auditNoticesCount').textContent = data.totalNotices;
      
      // Crawl summary badge (Sitemap, Robots.txt, Duration)
      const sitemapLabel = data.hasSitemap ? `✅ Sitemap (${data.discoveredSitemapUrlsCount} URLs)` : '❌ No Sitemap';
      const robotsLabel = data.hasRobotsTxt ? '✅ Robots.txt' : '❌ No Robots.txt';
      document.getElementById('auditCrawledCount').textContent = `${data.scannedPagesCount} pages scanned in ${data.crawlDurationMs}ms • ${robotsLabel} • ${sitemapLabel}`;

      // Build Page Accordions & Issue Lists
      const acc = document.getElementById('auditPagesAccordion');
      acc.innerHTML = '';

      (data.pages || []).forEach(page => {
        const item = document.createElement('div');
        item.className = 'page-audit-item';

        // Render Page Issues with AI Remediation Buttons
        let issuesHtml = '';
        if (page.issues.length === 0) {
          issuesHtml = '<div style="color: var(--accent-green); font-size: 0.85rem;">✅ No issues detected. Clean page.</div>';
        } else {
          page.issues.forEach(iss => {
            const sevClass = iss.severity;
            const icon = iss.severity === 'error' ? '❌' : (iss.severity === 'warning' ? '⚠️' : 'ℹ️');
            
            // Extract current target value for AI context
            let originalVal = '';
            if (iss.code.startsWith('TITLE')) originalVal = page.title || '';
            else if (iss.code.startsWith('META_DESC')) originalVal = page.metaDescription || '';
            else if (iss.code.startsWith('H1')) originalVal = `Current H1 count: ${page.h1Count}`;

            issuesHtml += `
              <div class="issue-row ${sevClass}">
                <div style="font-size: 1.1rem;">${icon}</div>
                <div style="flex: 1;">
                  <div class="issue-message">[${escapeHtml(iss.code)}] ${escapeHtml(iss.message)}</div>
                  <div class="issue-fix">Fix: ${escapeHtml(iss.recommendation)}</div>
                </div>
                <button class="btn-ai-fix" onclick="requestAiFix('${escapeHtml(page.url)}', '${escapeHtml(iss.code)}', '${escapeHtml(originalVal)}', '${escapeHtml(iss.message)}')">
                  ✨ Fix with AI
                </button>
              </div>
            `;
          });
        }

        // Schema.org Structured Data Badges
        const schemaBadges = (page.schemaTypes && page.schemaTypes.length > 0)
          ? page.schemaTypes.map(st => `<span class="kpi-badge badge-growth">Schema: ${escapeHtml(st)}</span>`).join(' ')
          : '<span class="kpi-badge badge-notice">No Schema</span>';

        // HTTP Security Headers & Payload Weight Badges
        const secBadges = page.securityHeaders
          ? `<span class="kpi-badge ${page.securityHeaders.hsts ? 'badge-growth' : 'badge-notice'}">HSTS ${page.securityHeaders.hsts ? '✅' : '❌'}</span>
             <span class="kpi-badge ${page.securityHeaders.csp ? 'badge-growth' : 'badge-notice'}">CSP ${page.securityHeaders.csp ? '✅' : '⚠️'}</span>
             <span class="kpi-badge">Weight: ${page.pageSizeKb || 0} KB</span>`
          : '';

        // Assemble Page Item DOM
        item.innerHTML = `
          <div class="page-audit-header">
            <span class="page-url">${escapeHtml(page.url)}</span>
            <div class="page-badges">
              <span class="kpi-badge ${page.statusCode === 200 ? 'badge-growth' : 'badge-error'}">HTTP ${page.statusCode}</span>
              <span class="kpi-badge">TTFB: ${page.ttfbMs || page.loadTimeMs}ms</span>
              ${schemaBadges}
              ${secBadges}
            </div>
          </div>
          <div class="page-meta-row">
            <div><strong>Title:</strong> ${page.title ? escapeHtml(page.title) : '<span style="color: var(--accent-rose)">Missing</span>'}</div>
            <div><strong>H1 Tags:</strong> ${page.h1Count}</div>
            <div><strong>Words:</strong> ${page.wordCount}</div>
            <div><strong>Links:</strong> ${page.internalLinksCount} in / ${page.externalLinksCount} out</div>
            <div><strong>Images:</strong> ${page.imagesTotal} (${page.imagesMissingAlt} missing alt)</div>
            <div><strong>OpenGraph:</strong> ${page.openGraphComplete ? '✅ Complete' : '⚠️ Incomplete'}</div>
            <div><strong>Payload:</strong> ${page.pageSizeKb || 0} KB (${page.compression || 'uncompressed'})</div>
          </div>
          <div class="issues-container">
            ${issuesHtml}
          </div>
        `;
        acc.appendChild(item);
      });

      results.classList.remove('hidden');
    } catch (err) {
      alert(`Site audit error: ${err.message}`);
    } finally {
      loader.classList.add('hidden');
    }
  });
}


/* ========================================================================== */
/* CELL 8: COMPETITOR KEYWORD GAP CONTROLLER                                  */
/* ========================================================================== */

/**
 * Initializes form submission listener for Keyword Gap analysis.
 * Fetches pairwise gap analysis between Domain A & Domain B, renders Venn diagrams,
 * and launches multi-competitor comparison matrix.
 */
function setupKeywordGap() {
  const form = document.getElementById('gapForm');
  const domAInput = document.getElementById('gapDomainA');
  const domBInput = document.getElementById('gapDomainB');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d1 = domAInput.value.trim();
    const d2 = domBInput.value.trim();
    const domCInput = document.getElementById('gapDomainC');
    const d3 = domCInput ? domCInput.value.trim() : '';

    if (!d1 || !d2) return;
    const allDomains = [d1, d2, d3].filter(Boolean);

    const loader = document.getElementById('gapLoading');
    const results = document.getElementById('gapResults');

    loader.classList.remove('hidden');
    results.classList.add('hidden');

    try {
      // 1. Fetch Pairwise Gap between primary and competitor
      const res = await fetch(`/api/gap?domainA=${encodeURIComponent(d1)}&domainB=${encodeURIComponent(d2)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Render 3 Categorical Lists (Missing / Shared / Unique)
      renderGapList('gapMissingList', 'gapMissingCount', data.missingForDomainA, d1, d2, true);
      renderGapList('gapSharedList', 'gapSharedCount', data.sharedKeywords, d1, d2, false);
      renderGapList('gapUniqueList', 'gapUniqueCount', data.uniqueToDomainA, d1, d2, false);

      // 2. Render Interactive SVG Venn Diagram
      renderVennDiagram(d1, d2, data.uniqueToDomainA.length, data.sharedKeywords.length, data.missingForDomainA.length);

      // 3. Fetch Multi-Competitor Matrix (Up to 5 domains)
      fetchMultiGapMatrix(allDomains, d1, d2);

      results.classList.remove('hidden');
    } catch (err) {
      alert(`Keyword gap error: ${err.message}`);
    } finally {
      loader.classList.add('hidden');
    }
  });
}

/**
 * Renders an unordered list of keywords for one category in the Keyword Gap tool.
 * 
 * @param {string} listId - Target HTML <ul> element ID
 * @param {string} countId - Target count badge ID
 * @param {string[]} items - Array of keyword strings
 * @param {string} d1 - Primary domain
 * @param {string} d2 - Competitor domain
 * @param {boolean} [isMissing=false] - Whether to show the '⚡ Outrank Plan' action button
 */
function renderGapList(listId, countId, items, d1, d2, isMissing = false) {
  const ul = document.getElementById(listId);
  const countEl = document.getElementById(countId);
  ul.innerHTML = '';
  countEl.textContent = `${items.length} terms`;

  if (items.length === 0) {
    ul.innerHTML = '<li class="gap-item" style="color: var(--text-muted);">None found</li>';
    return;
  }

  items.forEach(it => {
    const li = document.createElement('li');
    li.className = 'gap-item';
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';

    let actionBtn = '';
    if (isMissing) {
      actionBtn = `<button class="kpi-badge badge-growth" style="cursor: pointer;" onclick="requestAiStrategy('${escapeHtml(d1)}', '${escapeHtml(d2)}', '${escapeHtml(it)}')">⚡ Outrank Plan</button>`;
    }

    li.innerHTML = `<span>${escapeHtml(it)}</span> ${actionBtn}`;
    ul.appendChild(li);
  });
}


/* ========================================================================== */
/* CELL 9: MULTI-COMPETITOR MATRIX ENGINE (UP TO 5 DOMAINS)                   */
/* ========================================================================== */

/**
 * Asynchronously queries `/api/gap/multi` to retrieve comparative rankings
 * across up to 5 domains simultaneously.
 * Populates a dynamic matrix table with leader highlights and AI outrank triggers.
 * 
 * @param {string[]} domains - List of domains to compare
 * @param {string} primaryDomain - The user's primary domain
 * @param {string} compDomain - Default competitor domain for AI planning
 */
async function fetchMultiGapMatrix(domains, primaryDomain, compDomain) {
  try {
    const res = await fetch(`/api/gap/multi?domains=${encodeURIComponent(domains.join(','))}`);
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('multiMatrixTotalCount').textContent = `${data.allKeywordsCount} Keywords`;

    // 1. Build Dynamic Table Header based on participating domains
    const thead = document.getElementById('multiGapTableHead');
    let headHtml = '<tr><th>Keyword</th><th>Search Vol</th><th>Intent</th><th>KD%</th>';
    data.domains.forEach(d => {
      headHtml += `<th style="text-align: center;">${escapeHtml(d)}</th>`;
    });
    headHtml += '<th>Action</th></tr>';
    thead.innerHTML = headHtml;

    // 2. Build Dynamic Table Body
    const tbody = document.getElementById('multiGapTableBody');
    tbody.innerHTML = '';

    (data.matrix || []).forEach(row => {
      const tr = document.createElement('tr');
      let domCols = '';

      // Create a ranking cell for each domain
      data.domains.forEach(d => {
        const pos = row.rankings[d];
        if (pos !== null) {
          const isLeader = (d === row.bestDomain);
          domCols += `<td style="text-align: center;"><span class="rank-pos ${isLeader ? 'pos-1' : ''}">${pos}</span></td>`;
        } else {
          domCols += `<td style="text-align: center; color: var(--text-muted);">—</td>`;
        }
      });

      const intentClass = `intent-${(row.intent || 'Informational').toLowerCase()}`;
      const isMissingForPrimary = (row.rankings[primaryDomain] === null);

      tr.innerHTML = `
        <td style="font-weight: 600;">${escapeHtml(row.keyword)}</td>
        <td>${(row.searchVolume || 0).toLocaleString()}</td>
        <td><span class="intent-badge ${intentClass}">${escapeHtml(row.intent || 'Informational')}</span></td>
        <td><span class="accent-kd">${row.difficulty}%</span></td>
        ${domCols}
        <td>
          ${isMissingForPrimary ? `<button class="kpi-badge badge-growth" style="cursor: pointer;" onclick="requestAiStrategy('${escapeHtml(primaryDomain)}', '${escapeHtml(row.bestDomain || compDomain)}', '${escapeHtml(row.keyword)}')">⚡ Outrank</button>` : '<span style="color: var(--accent-green); font-size: 0.8rem;">Ranking ✅</span>'}
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Failed to load multi-gap matrix:', err);
  }
}


/* ========================================================================== */
/* CELL 10: INTERACTIVE SVG VENN DIAGRAM VISUALIZER                          */
/* ========================================================================== */

/**
 * Generates an interactive SVG Venn diagram showing keyword distribution:
 *   - Circle 1: Keywords unique to Primary Domain (You)
 *   - Intersection: Shared overlapping terms
 *   - Circle 2: Missing keywords (Competitor opportunities)
 * Clicking circles or labels smoothly scrolls the user directly to the relevant list.
 * 
 * @param {string} d1 - Primary domain name
 * @param {string} d2 - Competitor domain name
 * @param {number} uniqueCount - Count of terms unique to d1
 * @param {number} sharedCount - Count of overlapping terms
 * @param {number} missingCount - Count of terms unique to d2 (missing for d1)
 */
function renderVennDiagram(d1, d2, uniqueCount, sharedCount, missingCount) {
  const container = document.getElementById('vennDiagramContainer');
  if (!container) return;

  // Geometric configuration
  const w = 500;
  const h = 220;
  const r1 = 80;
  const r2 = 80;
  const cx1 = 190;
  const cx2 = 310;
  const cy = 110;

  container.innerHTML = `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow: visible; max-width: 100%;">
      <!-- Circle 1 (You: Primary Domain) -->
      <circle cx="${cx1}" cy="${cy}" r="${r1}" fill="rgba(59, 130, 246, 0.22)" stroke="#3b82f6" stroke-width="2.5" style="cursor: pointer;" onclick="document.getElementById('gapUniqueList').scrollIntoView({ behavior: 'smooth' })">
        <title>${escapeHtml(d1)} - ${uniqueCount} unique keywords</title>
      </circle>

      <!-- Circle 2 (Competitor: Missing Opportunities) -->
      <circle cx="${cx2}" cy="${cy}" r="${r2}" fill="rgba(249, 115, 22, 0.22)" stroke="#f97316" stroke-width="2.5" style="cursor: pointer;" onclick="document.getElementById('gapMissingList').scrollIntoView({ behavior: 'smooth' })">
        <title>${escapeHtml(d2)} - ${missingCount} competitor opportunities</title>
      </circle>

      <!-- Circle 1 Label (Unique) -->
      <text x="${cx1 - 40}" y="${cy - 10}" fill="#93c5fd" font-size="12" font-weight="700" text-anchor="middle">${escapeHtml(d1)}</text>
      <text x="${cx1 - 40}" y="${cy + 12}" fill="#ffffff" font-size="14" font-weight="800" text-anchor="middle">${uniqueCount}</text>
      <text x="${cx1 - 40}" y="${cy + 26}" fill="#94a3b8" font-size="10" text-anchor="middle">Unique</text>

      <!-- Intersection Label (Shared Overlap) -->
      <text x="250" y="${cy - 8}" fill="#a78bfa" font-size="11" font-weight="700" text-anchor="middle" style="cursor: pointer;" onclick="document.getElementById('gapSharedList').scrollIntoView({ behavior: 'smooth' })">Shared</text>
      <text x="250" y="${cy + 12}" fill="#ffffff" font-size="15" font-weight="800" text-anchor="middle" style="cursor: pointer;" onclick="document.getElementById('gapSharedList').scrollIntoView({ behavior: 'smooth' })">${sharedCount}</text>
      <text x="250" y="${cy + 26}" fill="#94a3b8" font-size="10" text-anchor="middle">Overlap</text>

      <!-- Circle 2 Label (Missing) -->
      <text x="${cx2 + 40}" y="${cy - 10}" fill="#fdba74" font-size="12" font-weight="700" text-anchor="middle">${escapeHtml(d2)}</text>
      <text x="${cx2 + 40}" y="${cy + 12}" fill="#ffffff" font-size="14" font-weight="800" text-anchor="middle">${missingCount}</text>
      <text x="${cx2 + 40}" y="${cy + 26}" fill="#94a3b8" font-size="10" text-anchor="middle">Missing (Opp)</text>
    </svg>
  `;
}


/* ========================================================================== */
/* CELL 11: BACKLINK ANALYTICS, TOXICITY & ANCHOR TAXONOMY                    */
/* ========================================================================== */

/**
 * Initializes form submission listener for Backlink Analytics.
 */
function setupBacklinkAnalytics() {
  const form = document.getElementById('backlinkForm');
  const input = document.getElementById('backlinkInput');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const domain = input.value.trim();
    if (domain) {
      fetchBacklinkProfile(domain);
    }
  });
}

/**
 * Asynchronously queries `/api/backlinks` to inspect link graph metrics,
 * referring domains, dofollow vs nofollow ratios, Google Penguin toxicity risk,
 * Semrush anchor category distribution (branded, exact, naked, generic), and live backlink feed.
 * 
 * @param {string} domain - Target root domain (e.g. 'github.com')
 */
async function fetchBacklinkProfile(domain) {
  const loader = document.getElementById('backlinkLoading');
  const results = document.getElementById('backlinkResults');

  loader.classList.remove('hidden');
  results.classList.add('hidden');

  try {
    const res = await fetch(`/api/backlinks?domain=${encodeURIComponent(domain)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // 1. Core Link Metrics
    document.getElementById('blAuthority').textContent = data.authorityScore;
    document.getElementById('blAuthorityBar').style.width = `${data.authorityScore}%`;
    document.getElementById('blTotalCount').textContent = data.totalBacklinks.toLocaleString();
    document.getElementById('blRefDomains').textContent = data.totalReferringDomains.toLocaleString();

    // 2. Dofollow Ratio
    const dofollowPct = Math.round(data.dofollowRatio * 100);
    document.getElementById('blDofollowRatio').textContent = `${dofollowPct}%`;
    document.getElementById('blDofollowBar').style.width = `${dofollowPct}%`;

    // 3. Toxicity Score (Google Penguin Penalty Risk)
    if (data.toxicityScore !== undefined) {
      document.getElementById('blToxicity').textContent = `${data.toxicityScore}%`;
      document.getElementById('blToxicityBar').style.width = `${data.toxicityScore}%`;
      const badge = document.getElementById('blToxicityBadge');
      if (data.toxicityScore > 35) {
        badge.className = 'kpi-badge badge-error';
        badge.textContent = 'High Risk';
      } else if (data.toxicityScore > 18) {
        badge.className = 'kpi-badge badge-warning';
        badge.textContent = 'Moderate';
      } else {
        badge.className = 'kpi-badge badge-growth';
        badge.textContent = 'Low Risk';
      }
      document.getElementById('blToxicCount').textContent = `${(data.toxicLinksCount || 0).toLocaleString()} toxic links`;
    }

    // 4. Semrush Anchor Category Taxonomy (Branded, Exact Match, Naked URL, Generic)
    if (data.anchorDistribution) {
      document.getElementById('blAnchorBranded').textContent = `${Math.round(data.anchorDistribution.brandedRatio * 100)}%`;
      document.getElementById('blAnchorExact').textContent = `${Math.round(data.anchorDistribution.exactMatchRatio * 100)}%`;
      document.getElementById('blAnchorNaked').textContent = `${Math.round(data.anchorDistribution.nakedUrlRatio * 100)}%`;
      document.getElementById('blAnchorGeneric').textContent = `${Math.round(data.anchorDistribution.genericRatio * 100)}%`;
    }

    // 5. Top Anchor Text Table
    const anchorsTbody = document.getElementById('blAnchorsTableBody');
    anchorsTbody.innerHTML = '';
    (data.topAnchors || []).forEach(a => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600;">"${escapeHtml(a.text)}"</td>
        <td style="color: var(--accent-blue); font-weight: 600;">${a.count.toLocaleString()}</td>
      `;
      anchorsTbody.appendChild(tr);
    });

    // 6. Recent Backlink Feed
    const feed = document.getElementById('blFeedList');
    feed.innerHTML = '';
    (data.recentBacklinks || []).forEach(link => {
      const it = document.createElement('div');
      it.className = 'backlink-item';
      const badgeClass = link.isDofollow ? 'badge-growth' : 'badge-notice';
      it.innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span class="bl-source">${escapeHtml(link.sourceUrl)}</span>
          <span class="kpi-badge ${badgeClass}">${link.isDofollow ? 'dofollow' : 'nofollow'}</span>
        </div>
        <div class="bl-target">Target: ${escapeHtml(link.targetUrl)} • Anchor: "<strong>${escapeHtml(link.anchorText)}</strong>" (AS: ${link.sourceAuthorityScore})</div>
      `;
      feed.appendChild(it);
    });

    results.classList.remove('hidden');
  } catch (err) {
    alert(`Backlink profile error: ${err.message}`);
  } finally {
    loader.classList.add('hidden');
  }
}


/* ========================================================================== */
/* CELL 12: AI REMEDIATION MODAL DRAWER ("✨ FIX WITH AI")                     */
/* ========================================================================== */

/**
 * Wires close and clipboard copy buttons for modal dialogs.
 */
function setupModals() {
  document.getElementById('closeAiFixModal').addEventListener('click', () => {
    document.getElementById('aiFixModal').classList.add('hidden');
  });

  document.getElementById('closeAiStrategyModal').addEventListener('click', () => {
    document.getElementById('aiStrategyModal').classList.add('hidden');
  });

  // Clipboard copy handler for AI fix code snippets
  document.getElementById('copyFixBtn').addEventListener('click', () => {
    const code = document.getElementById('aiFixCodeSnippet').textContent;
    navigator.clipboard.writeText(code).then(() => {
      const btn = document.getElementById('copyFixBtn');
      btn.textContent = 'Copied! ✓';
      setTimeout(() => { btn.textContent = 'Copy Code'; }, 2000);
    });
  });
}

/**
 * Global function called when user clicks "✨ Fix with AI" on any audit issue.
 * Posts issue context to `/api/ai/fix` and streams the Gemini / OpenRouter
 * remediation snippet directly into the modal drawer.
 * 
 * @param {string} url - Target URL of the audited page
 * @param {string} issueCode - Error code (e.g. 'TITLE_TOO_LONG', 'MISSING_H1')
 * @param {string} originalVal - Current value of the tag or element
 * @param {string} message - Descriptive issue text
 */
window.requestAiFix = async function(url, issueCode, originalVal, message) {
  const modal = document.getElementById('aiFixModal');
  const titleEl = document.getElementById('aiFixTitle');
  const descEl = document.getElementById('aiFixDescription');
  const codeEl = document.getElementById('aiFixCodeSnippet');
  const expEl = document.getElementById('aiFixExplanation');

  titleEl.textContent = `Fixing: ${issueCode}`;
  descEl.textContent = 'Generating AI optimization via Gemini...';
  codeEl.textContent = '/* Thinking... */';
  expEl.textContent = 'Evaluating page topic and computing optimal search signals...';
  modal.classList.remove('hidden');

  try {
    const res = await fetch('/api/ai/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        issueCode,
        originalValue: originalVal,
        message,
      }),
    });
    const fix = await res.json();
    if (fix.error) throw new Error(fix.error);

    descEl.textContent = fix.suggestedFix;
    codeEl.textContent = fix.codeSnippet;
    expEl.textContent = fix.explanation;
  } catch (err) {
    descEl.textContent = `Error: ${err.message}`;
    codeEl.textContent = '<!-- Ensure GEMINI_API_KEY is configured in .env -->';
  }
};


/* ========================================================================== */
/* CELL 13: AI OUTRANK CONTENT STRATEGY MODAL ("⚡ OUTRANK PLAN")              */
/* ========================================================================== */

/**
 * Global function called when user clicks "⚡ Outrank Plan" on a missing keyword.
 * Posts gap context to `/api/ai/strategy` to produce a complete article blueprint:
 * High-CTR title, word count recommendation, heading hierarchy (H1, H2, H3),
 * and competitor-beating talking points.
 * 
 * @param {string} d1 - Primary domain
 * @param {string} d2 - Competitor domain ranking for this term
 * @param {string} keyword - Opportunity keyword
 */
window.requestAiStrategy = async function(d1, d2, keyword) {
  const modal = document.getElementById('aiStrategyModal');
  const titleEl = document.getElementById('aiStrategyTitle');
  const bodyEl = document.getElementById('aiStrategyBody');

  titleEl.textContent = `Outrank Strategy: "${keyword}"`;
  bodyEl.innerHTML = '<div style="padding: 30px; text-align: center;"><div class="spinner"></div><p style="margin-top: 12px;">Gemini is analyzing competitor keyword gaps and structuring article outline...</p></div>';
  modal.classList.remove('hidden');

  try {
    const res = await fetch('/api/ai/strategy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domainA: d1,
        competitorDomain: d2,
        missingKeyword: keyword,
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // Format Heading Hierarchy
    let headingsHtml = '';
    (data.headingStructure || []).forEach(h => {
      headingsHtml += `
        <div class="strategy-heading-row">
          <span class="strategy-tag">${h.level.toUpperCase()}</span>
          <span>${escapeHtml(h.text)}</span>
        </div>
      `;
    });

    // Format Talking Points
    let talkingPointsHtml = '';
    (data.keyTalkingPoints || []).forEach(pt => {
      talkingPointsHtml += `<li>${escapeHtml(pt)}</li>`;
    });

    // Inject Blueprint Layout
    bodyEl.innerHTML = `
      <div class="kpi-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 20px;">
        <div class="kpi-card">
          <div class="kpi-label">Target Intent</div>
          <div class="kpi-value" style="font-size: 1.2rem;">${data.targetIntent}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Recommended Length</div>
          <div class="kpi-value" style="font-size: 1.2rem;">${data.recommendedWordCount} words</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Keyword Difficulty</div>
          <div class="kpi-value accent-kd" style="font-size: 1.2rem;">${data.estimatedDifficulty}%</div>
        </div>
      </div>

      <div class="panel-card" style="margin-bottom: 16px;">
        <div class="panel-header"><h3>Recommended High-CTR Title</h3></div>
        <div class="fix-text">${escapeHtml(data.recommendedTitle)}</div>
      </div>

      <div class="panel-card" style="margin-bottom: 16px;">
        <div class="panel-header"><h3>Article Outline Structure</h3></div>
        <div>${headingsHtml}</div>
      </div>

      <div class="panel-card">
        <div class="panel-header"><h3>Crucial Talking Points to Outrank Competitor</h3></div>
        <ul style="padding-left: 20px; line-height: 1.8; color: var(--text-secondary);">${talkingPointsHtml}</ul>
      </div>
    `;
  } catch (err) {
    bodyEl.innerHTML = `<div style="color: var(--accent-rose); padding: 20px;">Error generating strategy: ${err.message}</div>`;
  }
};


/* ========================================================================== */
/* CELL 14: DATA PORTABILITY & REPORTING (CSV & EXECUTIVE PDF)                */
/* ========================================================================== */

/**
 * Initializes client-side CSV generator.
 * Converts `currentActiveDomainData.topOrganicKeywords` into a downloadable CSV blob.
 */
function setupExportCsv() {
  const btn = document.getElementById('exportCsvBtn');
  btn.addEventListener('click', () => {
    if (!currentActiveDomainData || !currentActiveDomainData.topOrganicKeywords) {
      alert('No active dataset to export. Run a Domain Overview query first.');
      return;
    }

    const data = currentActiveDomainData;
    let csv = 'Position,Keyword,Search Volume,Estimated Monthly Traffic,Intent\n';

    data.topOrganicKeywords.forEach(k => {
      // Escape internal double quotes for RFC 4180 compliance
      csv += `"${k.position}","${k.keyword.replace(/"/g, '""')}","${k.searchVolume}","${k.estimatedMonthlyTraffic}","${k.intent}"\n`;
    });

    // Create virtual blob link and trigger download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.domain}_keywords_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

/**
 * Initializes the Executive PDF print handler.
 * Leverages the `@media print` CSS stylesheet in `style.css` to format
 * high-resolution, unpaginated executive reports for client presentations.
 */
function setupExportPdf() {
  const btn = document.getElementById('exportPdfBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      window.print();
    });
  }
}


/* ========================================================================== */
/* CELL 15: HTML SANITIZATION UTILITY                                         */
/* ========================================================================== */

/**
 * Safely encodes untrusted string input into HTML entities to eliminate XSS vectors.
 * 
 * @param {string|number|null|undefined} str - Raw string or value
 * @returns {string} Sanitized string safe for DOM interpolation
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
