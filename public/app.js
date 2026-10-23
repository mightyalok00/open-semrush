/**
 * Protected endpoints use a self-hosted bearer token. The token is requested only
 * when needed and held in sessionStorage for this browser tab/session, never in source.
 * For multi-user/public deployments, prefer an identity-aware reverse proxy or SSO.
 */
async function protectedFetch(url, init = {}) {
  let token = sessionStorage.getItem('openSemrushApiToken') || '';
  if (!token) {
    token = window.prompt('This endpoint requires OPEN_SEMRUSH_API_TOKEN. Enter the API bearer token for this browser session:') || '';
    if (token) sessionStorage.setItem('openSemrushApiToken', token);
  }
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', 'Bearer ' + token);
  let response = await fetch(url, { ...init, headers });
  if (response.status === 401 && token) {
    sessionStorage.removeItem('openSemrushApiToken');
    const replacement = window.prompt('The API token was rejected. Enter a valid bearer token:') || '';
    if (replacement) {
      sessionStorage.setItem('openSemrushApiToken', replacement);
      headers.set('Authorization', 'Bearer ' + replacement);
      response = await fetch(url, { ...init, headers });
    }
  }
  return response;
}

/**
 * ==============================================================================
 * SEMRUSH STUDIO — CLIENT-SIDE CONTROLLER & DATA VISUALIZATION ENGINE
 * ==============================================================================
 * Architecture: Modular vanilla JS client interacting with Semrush Studio REST APIs.
 * Supports:
 *   - Domain Overview with 24-month historical trajectory area chart
 *   - Illustrative timeline markers; no causal correlation is calculated
 *   - Keyword Magic Tool with 12-month seasonality trends & SERP features
 *   - SERP preview (AI-generated/demo) analyzer with CTR curve & PAA questions
 *   - Technical Site Audit with crawler, TTFB latency, security headers & Schema.org
 *   - Multi-Competitor Keyword Gap matrix with interactive SVG Venn diagram
 *   - Backlink demonstration with synthetic link-risk heuristic and anchor taxonomy
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
let currentDevice = 'desktop';

/**
 * Header metadata dictionary mapped by tab identifier.
 */
const tabMeta = {
  domain: {
    title: 'Domain Overview',
    desc: 'Explore modeled traffic, top landing pages, and keyword estimates; use Search Console for verified first-party performance.'
  },
  projects: {
    title: 'Managed Projects & Historical Audits',
    desc: 'Local SQLite project tracking, crawl health progression, and issue telemetry.'
  },
  audit: {
    title: 'Technical Site Audit',
    desc: 'Scan website pages for on-page SEO issues, broken tags, and compute Site Health with verified crawl evidence.'
  },
  recommendations: {
    title: 'Evidence-Backed Recommendations',
    desc: 'Actionable audit remediation with observed DOM evidence, rationale, and impact scores.'
  },
  keywords: {
    title: 'Keyword Magic Tool',
    desc: 'Discover search volumes, commercial intent, and calibrated Keyword Difficulty (KD%).'
  },
  clustering: {
    title: 'Semantic Keyword Clustering',
    desc: 'N-gram and stem overlap topic clusterer with intent distribution purity.'
  },
  gap: {
    title: 'Keyword Gap Analysis',
    desc: 'Compare keyword overlaps, discover competitor advantages and missing terms.'
  },
  'rank-tracker': {
    title: 'Persistent Rank Tracking',
    desc: 'Track organic search positions by device, country, and search engine with change annotations.'
  },
  backlinks: {
    title: 'Backlink Analytics',
    desc: 'Inspect a synthetic link-profile demonstration; no live backlink index is queried.'
  },
  'search-console': {
    title: 'Google Search Console',
    desc: 'First-party clicks, impressions, CTR and position for an authorized property.'
  },
  forecast: {
    title: 'Calibrated Traffic Forecasting',
    desc: 'Conformal prediction intervals (96.7% 30d, 97.2% 90d coverage) with zero temporal leakage.'
  },
  providers: {
    title: 'Data Provider Architecture',
    desc: 'Strict 4-layer separation of verified first-party, empirical crawl, external APIs, and statistical models.'
  },
  'content-brief': {
    title: 'SEO Content Brief & Heading Outline',
    desc: 'Generate data-backed content outlines, search intent word counts, and target entity densities for $0.'
  },
  'ai-visibility': {
    title: 'AI Search Visibility & Brand Citations',
    desc: 'Audit brand mentions, source citations, sentiment, and Share of AI Voice across LLM answer engines.'
  }
};

/**
 * Global helper to switch active tab and synchronize title and navigation states.
 */
function switchToTab(targetTab) {
  const navButtons = document.querySelectorAll('.nav-item');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const titleEl = document.getElementById('currentTabTitle');
  const descEl = document.getElementById('currentTabDescription');

  navButtons.forEach(b => {
    if (b.getAttribute('data-tab') === targetTab) b.classList.add('active');
    else b.classList.remove('active');
  });

  tabPanes.forEach(p => {
    if (p.id === `tab-${targetTab}`) p.classList.add('active');
    else p.classList.remove('active');
  });

  if (tabMeta[targetTab]) {
    if (titleEl) titleEl.textContent = tabMeta[targetTab].title;
    if (descEl) descEl.textContent = tabMeta[targetTab].desc;
  }
}

/**
 * Application Entry Point.
 * Listens for DOMContentLoaded to wire up all view controllers, modals,
 * data export listeners, and load default demo analysis.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Initialize sub-modules and event listeners
  setupTabs();
  setupGlobalSearch();
  setupRegionSelector();
  setupDeviceSelector();
  setupDomainOverview();
  setupProjects();
  setupRecommendations();
  setupKeywordMagic();
  setupClustering();
  setupSiteAudit();
  setupContentBrief();
  setupAiVisibility();
  setupKeywordGap();
  setupRankTracker();
  setupBacklinkAnalytics();
  setupSearchConsole();
  setupForecast();
  setupProviders();
  setupModals();
  setupExportCsv();
  setupExportPdf();

  // Load initial demo analysis for 'github.com' to populate Domain Overview
  fetchDomainOverview('github.com');
});


/* ========================================================================== */
/* CELL 1: REGION & DEVICE SELECTORS                                          */
/* ========================================================================== */

/**
 * Sets up the global country selector dropdown in the top navigation bar.
 */
function setupRegionSelector() {
  const sel = document.getElementById('globalCountrySelect');
  if (sel) {
    sel.addEventListener('change', () => {
      currentCountryCode = sel.value;
      const curDom = document.getElementById('domainInput').value.trim() || 'github.com';
      fetchDomainOverview(curDom);
    });
  }
}

/**
 * Sets up the global device selector dropdown (desktop / mobile).
 */
function setupDeviceSelector() {
  const sel = document.getElementById('globalDeviceSelect');
  if (sel) {
    sel.addEventListener('change', () => {
      currentDevice = sel.value;
      const curDom = document.getElementById('domainInput').value.trim() || 'github.com';
      fetchDomainOverview(curDom);
    });
  }
}


/* ========================================================================== */
/* CELL 2: TAB NAVIGATION ROUTER                                              */
/* ========================================================================== */

/**
 * Initializes the tab navigation bar.
 */
function setupTabs() {
  const navButtons = document.querySelectorAll('.nav-item');

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchToTab(targetTab);
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
    if (typeof data.shareOfVoice === 'number') {
      const badge = document.querySelector('#domainAsBar')?.closest('.kpi-card')?.querySelector('.kpi-badge');
      if (badge) badge.textContent = `SOV: ${data.shareOfVoice}%`;
    }

    // Render Competitor Tags with click-to-inspect shortcuts
    const compContainer = document.getElementById('domainCompetitors');
    compContainer.innerHTML = '';
    const competitors = data.topCompetitors || [];
    if (competitors.length === 0) {
      compContainer.innerHTML = '<span style="color: var(--text-secondary); font-size: 0.85rem; font-style: italic;">No direct vertical competitors detected for this domain.</span>';
    } else {
      competitors.forEach(comp => {
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
    }

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

    // Update KPI card data-observed attributes for Evidence Dossier
    const asCard = document.getElementById('domainAsCard');
    if (asCard) asCard.setAttribute('data-observed', `${data.authorityScore} / 100 (SOV: ${data.shareOfVoice || 0}%)`);
    const trafficCard = document.getElementById('domainTrafficCard');
    if (trafficCard) trafficCard.setAttribute('data-observed', `${data.estimatedMonthlyOrganicTraffic.toLocaleString()} clicks/mo (Geo: ${currentCountryCode.toUpperCase()} • ${currentDevice})`);
    const kwCard = document.getElementById('domainKeywordsCard');
    if (kwCard) kwCard.setAttribute('data-observed', `${data.totalRankedKeywords.toLocaleString()} ranked keywords across SERP`);

    // Render 24-Month Trajectory Area Chart if historical records exist
    if (data.history24Months && data.history24Months.length > 0) {
      render24MonthTrafficChart(data.history24Months);
    }

    // Populate Top Landing Pages Table
    const pagesTbody = document.getElementById('domainTopPagesTableBody');
    if (pagesTbody) {
      pagesTbody.innerHTML = '';
      const topPages = data.topPages || [];
      const badge = document.getElementById('topPagesCountBadge');
      if (badge) badge.textContent = `${topPages.length} Pages`;
      topPages.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><a href="${escapeHtml(p.url)}" target="_blank" style="color: var(--accent-blue); text-decoration: none; font-family: var(--font-mono); font-size: 0.85rem;">${escapeHtml(p.path)}</a></td>
          <td><span class="kpi-badge">${Math.round(p.estimatedTrafficShare * 100)}%</span></td>
          <td style="color: var(--accent-green); font-weight: 600;">${p.estimatedMonthlyClicks.toLocaleString()}</td>
          <td style="font-weight: 500;">${escapeHtml(p.primaryKeyword)}</td>
          <td><span class="provenance-tag tag-model">Modeled</span></td>
        `;
        pagesTbody.appendChild(tr);
      });
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
 * Calculates normalized coordinates and overlays illustrative timeline markers.
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

  // Generate illustrative timeline markers & periodic month labels
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
      <!-- Illustrative timeline markers, not causal correlation -->
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
 * Loads a demo SERP preview; fallback results are not verified live Google rankings.
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
    const volEl = document.getElementById('kwVolume');
    const volUnit = volEl.parentElement?.querySelector('.kpi-unit');
    if (m.searchVolume === null || m.searchVolumeStatus === 'unavailable') {
      volEl.textContent = 'Unavailable';
      volEl.style.fontSize = '1.3rem';
      volEl.style.opacity = '0.8';
      if (volUnit) volUnit.textContent = '(Connect DataForSEO)';
    } else {
      volEl.textContent = Number(m.searchVolume).toLocaleString();
      volEl.style.fontSize = '';
      volEl.style.opacity = '';
      if (volUnit) volUnit.textContent = m.provenance?.tier === 'statistical_model' ? '/ mo (modeled)' : '/ month';
    }
    document.getElementById('kwKd').textContent = `${m.keywordDifficulty}%`;
    document.getElementById('kwKdBar').style.width = `${m.keywordDifficulty}%`;

    // Dynamic color coding based on KD difficulty tier
    const kdBadge = document.getElementById('kwKdBadge');
    if (m.kdTier) {
      kdBadge.textContent = m.kdTier.tier;
      if (m.kdTier.tier === 'Super Hard' || m.kdTier.tier === 'Very Hard') {
        kdBadge.className = 'kpi-badge badge-error';
      } else if (m.kdTier.tier === 'Hard' || m.kdTier.tier === 'Possible') {
        kdBadge.className = 'kpi-badge badge-warning';
      } else {
        kdBadge.className = 'kpi-badge badge-growth';
      }
      const kdCard = document.getElementById('kwKdBar')?.closest('.kpi-card');
      const kdSub = kdCard?.querySelector('.kpi-sub');
      if (kdSub && m.kdTier.minReferringDomainsNeeded !== undefined) {
        kdSub.textContent = `Needs ~${m.kdTier.minReferringDomainsNeeded}+ referring domains (${m.kdTier.range})`;
      }
    } else if (m.keywordDifficulty > 70) {
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
    const cpcEl = document.getElementById('kwCpc');
    if (m.cpcUsd === null || m.cpcStatus === 'unavailable') {
      cpcEl.textContent = 'Unavailable';
      cpcEl.style.fontSize = '1.3rem';
    } else {
      cpcEl.textContent = `$${m.cpcUsd.toFixed(2)}${m.cpcStatus === 'modeled' ? ' (modeled)' : ''}`;
      cpcEl.style.fontSize = '';
    }
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
/* CELL 6: SERP DEMO PREVIEW & FEATURES INSPECTOR                              */
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
      paaBox.innerHTML = '';
      const titleDiv = document.createElement('div');
      titleDiv.style.fontWeight = '700';
      titleDiv.style.marginBottom = '8px';
      titleDiv.textContent = '❓ People Also Ask:';
      const grid = document.createElement('div');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(280px, 1fr))';
      grid.style.gap = '8px';
      feats.peopleAlsoAsk.forEach(q => {
        const item = document.createElement('div');
        item.style.cssText = 'background: rgba(255,255,255,0.02); padding: 8px 12px; border-radius: 6px; font-size: 0.85rem; border-left: 2px solid var(--accent-orange); cursor: pointer;';
        item.textContent = q;
        item.addEventListener('click', () => {
          document.getElementById('keywordInput').value = q;
          fetchKeywordData(q);
        });
        grid.appendChild(item);
      });
      paaBox.appendChild(titleDiv);
      paaBox.appendChild(grid);
    } else {
      paaBox.classList.add('hidden');
    }

    // 4. Render Google Top 10 SERP Table
    const tbody = document.getElementById('serpTableBody');
    tbody.innerHTML = '';
    (data.topRankings || []).forEach(r => {
      const tr = document.createElement('tr');
      const inspectBtn = document.createElement('button');
      inspectBtn.className = 'kpi-badge';
      inspectBtn.style.cssText = 'cursor: pointer; background: var(--bg-card);';
      inspectBtn.textContent = 'Inspect';
      inspectBtn.addEventListener('click', () => inspectDomainFromSerp(r.domain));

      tr.innerHTML = `
        <td><span class="rank-pos ${r.position === 1 ? 'pos-1' : ''}">${r.position}</span></td>
        <td>
          <a href="${escapeHtml(r.url)}" target="_blank" style="font-weight: 600; color: var(--accent-blue); text-decoration: none;">${escapeHtml(r.title)}</a>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">${escapeHtml(r.snippet)}</div>
        </td>
        <td><span class="kpi-badge badge-high">${r.authorityScore}</span></td>
        <td style="font-weight: 600; color: var(--accent-green);">${(r.estimatedCtr * 100).toFixed(1)}%</td>
        <td class="inspect-cell"></td>
      `;
      tr.querySelector('.inspect-cell').appendChild(inspectBtn);
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
      const res = await protectedFetch('/api/audit', {
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
                <button class="btn-ai-fix" data-url="${escapeHtml(page.url)}" data-code="${escapeHtml(iss.code)}" data-original="${escapeHtml(originalVal)}" data-message="${escapeHtml(iss.message)}">
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
              <span class="kpi-badge" title="Crawl click distance from start URL">Depth: ${page.clickDepth ?? 0}</span>
              ${page.isOrphan ? '<span class="kpi-badge badge-warning">⚠️ Orphan Page</span>' : ''}
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
        item.querySelectorAll('.btn-ai-fix').forEach(btn => {
          btn.addEventListener('click', () => {
            requestAiFix(btn.dataset.url, btn.dataset.code, btn.dataset.original, btn.dataset.message);
          });
        });
        acc.appendChild(item);
      });

      results.classList.remove('hidden');
    } catch (err) {
      alert(`Site audit error: ${err.message}`);
    } finally {
      loader.classList.add('hidden');
    }
  });

  // PageSpeed / Core Web Vitals Tester
  const pageSpeedBtn = document.getElementById('runPageSpeedBtn');
  if (pageSpeedBtn) {
    pageSpeedBtn.addEventListener('click', async () => {
      const targetUrl = urlInput.value.trim();
      if (!targetUrl) return;
      pageSpeedBtn.disabled = true;
      pageSpeedBtn.textContent = 'Testing...';
      try {
        const res = await fetch(`/api/audit/pagespeed?url=${encodeURIComponent(targetUrl)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const scoreEl = document.getElementById('cwvScore');
        if (scoreEl) {
          scoreEl.textContent = data.performanceScore;
          scoreEl.style.color = data.performanceScore >= 90 ? '#10b981' : (data.performanceScore >= 50 ? '#f59e0b' : '#ef4444');
        }
        const assessEl = document.getElementById('cwvAssessment');
        if (assessEl) {
          assessEl.textContent = data.assessment.replace('_', ' ').toUpperCase();
          assessEl.className = `kpi-badge ${data.assessment === 'good' ? 'badge-growth' : (data.assessment === 'needs_improvement' ? 'badge-warning' : 'badge-error')}`;
        }
        document.getElementById('cwvLcp').textContent = `${(data.lcpMs / 1000).toFixed(2)}s`;
        document.getElementById('cwvFcp').textContent = `${(data.fcpMs / 1000).toFixed(2)}s`;
        document.getElementById('cwvCls').textContent = data.cls.toFixed(3);
        document.getElementById('cwvTbt').textContent = `${data.tbtMs}ms`;
      } catch (err) {
        alert('Could not test PageSpeed: ' + err.message);
      } finally {
        pageSpeedBtn.disabled = false;
        pageSpeedBtn.textContent = 'Test URL PageSpeed';
      }
    });
  }
}

/**
 * Sets up SEO Content Brief generator.
 */
function setupContentBrief() {
  const form = document.getElementById('contentBriefForm');
  if (!form) return;
  const keywordInput = document.getElementById('briefKeywordInput');
  const intentSelect = document.getElementById('briefIntentSelect');
  const loader = document.getElementById('briefLoading');
  const results = document.getElementById('briefResults');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const keyword = keywordInput.value.trim();
    if (!keyword) return;

    loader.classList.remove('hidden');
    results.classList.add('hidden');

    try {
      const res = await protectedFetch('/api/content/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword,
          searchIntent: intentSelect.value || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      document.getElementById('briefIntentBadge').textContent = data.searchIntent;
      document.getElementById('briefWordCount').textContent = data.recommendedWordCount.toLocaleString();
      document.getElementById('briefCompetitorWords').textContent = data.competitorBenchmark.medianWordCount.toLocaleString();
      document.getElementById('briefTitleBox').textContent = data.recommendedTitle;

      // Headings Outline
      const headingsContainer = document.getElementById('briefHeadingsContainer');
      headingsContainer.innerHTML = '';
      (data.headingsOutline || []).forEach(h => {
        const row = document.createElement('div');
        row.style.cssText = `padding: 10px 14px; background: rgba(15, 23, 42, 0.4); border-radius: 6px; border-left: 3px solid ${h.level === 'h2' ? '#38bdf8' : '#a855f7'}; margin-left: ${h.level === 'h3' ? '24px' : '0'}; display: flex; justify-content: space-between; align-items: center;`;
        row.innerHTML = `
          <div>
            <span style="font-weight: 700; font-size: 11px; padding: 2px 6px; border-radius: 4px; background: ${h.level === 'h2' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(168, 85, 247, 0.2)'}; color: ${h.level === 'h2' ? '#38bdf8' : '#c084fc'}; margin-right: 8px;">${h.level.toUpperCase()}</span>
            <span style="font-size: 14px; font-weight: ${h.level === 'h2' ? '600' : '400'}; color: #fff;">${escapeHtml(h.text)}</span>
          </div>
          <span class="kpi-badge badge-notice" style="font-size: 11px;">${escapeHtml(h.intent)}</span>
        `;
        headingsContainer.appendChild(row);
      });

      // Questions List
      const questionsList = document.getElementById('briefQuestionsList');
      questionsList.innerHTML = '';
      (data.essentialQuestions || []).forEach(q => {
        const li = document.createElement('li');
        li.textContent = q;
        questionsList.appendChild(li);
      });

      // Target Entities
      const entitiesContainer = document.getElementById('briefEntitiesContainer');
      entitiesContainer.innerHTML = '';
      (data.targetEntities || []).forEach(ent => {
        const pill = document.createElement('div');
        pill.className = 'kpi-badge badge-growth';
        pill.style.cssText = 'padding: 6px 12px; font-size: 13px; display: inline-flex; align-items: center; gap: 6px;';
        pill.innerHTML = `<strong>${escapeHtml(ent.name)}</strong> <span style="opacity: 0.8; font-size: 11px;">(${escapeHtml(ent.recommendedDensity)})</span>`;
        entitiesContainer.appendChild(pill);
      });

      results.classList.remove('hidden');
    } catch (err) {
      alert('Error generating Content Brief: ' + err.message);
    } finally {
      loader.classList.add('hidden');
    }
  });
}

/**
 * Sets up AI Search Visibility auditor.
 */
function setupAiVisibility() {
  const form = document.getElementById('aiVisibilityForm');
  if (!form) return;
  const domainInput = document.getElementById('aiVisDomainInput');
  const brandInput = document.getElementById('aiVisBrandInput');
  const loader = document.getElementById('aiVisLoading');
  const results = document.getElementById('aiVisResults');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const domain = domainInput.value.trim();
    if (!domain) return;
    const brandName = brandInput.value.trim() || undefined;

    loader.classList.remove('hidden');
    results.classList.add('hidden');

    try {
      const res = await protectedFetch('/api/ai-visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, brandName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      document.getElementById('aiVisRate').textContent = `${Math.round(data.visibilityRate * 100)}%`;
      document.getElementById('aiVisCitationRate').textContent = `${Math.round(data.citationRate * 100)}%`;
      document.getElementById('aiVisShareVoice').textContent = `${data.shareOfAiVoice}%`;
      document.getElementById('aiVisModelBadge').textContent = data.modelTested;
      document.getElementById('aiVisDate').textContent = `Audited ${data.date}`;
      document.getElementById('aiVisSampleCount').textContent = `${data.sampleSize} Prompts Audited`;

      const tbody = document.getElementById('aiVisTableBody');
      tbody.innerHTML = '';
      (data.results || []).forEach(r => {
        const tr = document.createElement('tr');
        const citedHtml = r.brandCited
          ? `<span class="kpi-badge badge-growth">✅ Cited (${r.citedUrls.length})</span>`
          : `<span class="kpi-badge badge-notice">❌ Uncited</span>`;

        const sentClass = r.sentiment === 'positive' ? 'badge-growth' : (r.sentiment === 'negative' ? 'badge-error' : 'badge-notice');
        const compHtml = r.competitorMentions.length > 0
          ? r.competitorMentions.map(c => `<span class="kpi-badge" style="margin-right: 4px;">${escapeHtml(c)}</span>`).join('')
          : '<span style="color: var(--text-muted); font-size: 12px;">None</span>';

        tr.innerHTML = `
          <td>
            <div style="font-weight: 500; color: #fff;">${escapeHtml(r.prompt)}</div>
            ${r.excerpt ? `<div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">"${escapeHtml(r.excerpt)}"</div>` : ''}
          </td>
          <td><span class="kpi-badge ${r.brandMentioned ? 'badge-growth' : 'badge-error'}">${r.brandMentioned ? 'Mentioned' : 'Absent'}</span></td>
          <td>${citedHtml}</td>
          <td><span class="kpi-badge ${sentClass}" style="text-transform: capitalize;">${escapeHtml(r.sentiment)}</span></td>
          <td>${compHtml}</td>
        `;
        tbody.appendChild(tr);
      });

      results.classList.remove('hidden');
    } catch (err) {
      alert('Error evaluating AI Visibility: ' + err.message);
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
 * synthetic anchor category examples and generated sample links.
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
    const links = data.recentBacklinks || [];
    if (links.length === 0) {
      feed.innerHTML = `
        <div style="padding: 18px; color: var(--text-muted); font-size: 13px; text-align: center; border: 1px dashed var(--border-subtle); border-radius: 8px;">
          ℹ️ No external backlink index connected for this domain. Run a <strong>Technical Site Audit</strong> to extract verified in-page crawl links, or configure <code>DATAFORSEO_LOGIN</code> in .env for global backlink indexes.
        </div>
      `;
    } else {
      links.forEach(link => {
        const it = document.createElement('div');
        it.className = 'backlink-item';
        const badgeClass = link.isDofollow ? 'badge-growth' : 'badge-notice';
        it.innerHTML = `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <a href="${escapeHtml(link.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="bl-source" style="color: var(--accent-blue); text-decoration: none;">${escapeHtml(link.sourceUrl)}</a>
            <span class="kpi-badge ${badgeClass}">${link.isDofollow ? 'dofollow' : 'nofollow'}</span>
          </div>
          <div class="bl-target">Target: ${escapeHtml(link.targetUrl)} • Anchor: "<strong>${escapeHtml(link.anchorText)}</strong>" (AS: ${link.sourceAuthorityScore})</div>
        `;
        feed.appendChild(it);
      });
    }

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
  document.getElementById('closeAiFixModal')?.addEventListener('click', () => {
    document.getElementById('aiFixModal').classList.add('hidden');
  });

  document.getElementById('closeAiStrategyModal')?.addEventListener('click', () => {
    document.getElementById('aiStrategyModal').classList.add('hidden');
  });

  document.getElementById('closeEvidenceModal')?.addEventListener('click', () => {
    document.getElementById('evidenceModal').classList.add('hidden');
  });

  document.getElementById('closeAnnotateModal')?.addEventListener('click', () => {
    document.getElementById('annotateModal').classList.add('hidden');
  });

  // KPI Card click delegation for Evidence Dossier
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.kpi-card.clickable');
    if (card) {
      const metric = card.getAttribute('data-metric') || 'SEO Metric';
      const tier = card.getAttribute('data-tier') || 'Statistical Model';
      const source = card.getAttribute('data-source') || 'Internal Open Semrush Engine';
      const observed = card.getAttribute('data-observed') || 'Observed Value';
      const formula = card.getAttribute('data-formula') || 'Empirical algorithm';
      const limitations = card.getAttribute('data-limitations') || 'Model outputs should be cross-referenced with first-party GSC telemetry.';

      document.getElementById('dossierMetric').textContent = metric;
      document.getElementById('dossierTier').textContent = tier;
      document.getElementById('dossierSource').textContent = source;
      document.getElementById('dossierObserved').textContent = observed;
      document.getElementById('dossierFormula').textContent = formula;
      document.getElementById('dossierLimitations').textContent = limitations;

      document.getElementById('evidenceModal').classList.remove('hidden');
    }
  });

  // Clipboard copy handler for AI fix code snippets
  document.getElementById('copyFixBtn')?.addEventListener('click', () => {
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
  descEl.textContent = 'Generating AI optimization via OpenRouter / Gemini cascade...';
  codeEl.textContent = '/* Thinking... */';
  expEl.textContent = 'Evaluating page topic and computing optimal search signals...';
  modal.classList.remove('hidden');

  try {
    const res = await protectedFetch('/api/ai/fix', {
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
    codeEl.textContent = '<!-- Ensure OPENROUTER_API_KEY or GEMINI_API_KEY is configured in .env -->';
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
  bodyEl.innerHTML = '<div style="padding: 30px; text-align: center;"><div class="spinner"></div><p style="margin-top: 12px;">AI Engine (OpenRouter / Gemini) is analyzing competitor keyword gaps and structuring article outline...</p></div>';
  modal.classList.remove('hidden');

  try {
    const res = await protectedFetch('/api/ai/strategy', {
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
          <div class="kpi-value" style="font-size: 1.2rem;">${escapeHtml(data.targetIntent)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Recommended Length</div>
          <div class="kpi-value" style="font-size: 1.2rem;">${escapeHtml(data.recommendedWordCount)} words</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Keyword Difficulty</div>
          <div class="kpi-value accent-kd" style="font-size: 1.2rem;">${escapeHtml(data.estimatedDifficulty)}%</div>
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
    bodyEl.innerHTML = `<div style="color: var(--accent-rose); padding: 20px;">Error generating strategy: ${escapeHtml(err.message)}</div>`;
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
    let csv = 'Position,Keyword,Search Volume,Estimated Monthly Traffic,Intent,Provenance\n';

    data.topOrganicKeywords.forEach(k => {
      // Escape internal double quotes for RFC 4180 compliance
      const volStr = k.searchVolume === null || k.searchVolume === undefined || k.searchVolumeStatus === 'unavailable'
        ? 'Unavailable'
        : String(k.searchVolume);
      const provStr = k.searchVolumeStatus === 'measured' ? 'verified_provider' : 'statistical_model';
      csv += `"${k.position}","${k.keyword.replace(/"/g, '""')}","${volStr}","${k.estimatedMonthlyTraffic}","${k.intent}","${provStr}"\n`;
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
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/`/g, '&#x60;');
}


/* Provider-backed Google Search Console data only; no synthetic fallback. */
function setupSearchConsole() {
  const form = document.getElementById('searchConsoleForm');
  if (!form) return;
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 28);
  const toDate = (date) => date.toISOString().slice(0, 10);
  document.getElementById('gscStartDate').value = toDate(start);
  document.getElementById('gscEndDate').value = toDate(end);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.getElementById('gscStatus');
    const results = document.getElementById('gscResults');
    status.textContent = 'Requesting Google Search Console data…';
    results.classList.add('hidden');
    const params = new URLSearchParams({
      siteUrl: document.getElementById('gscSiteUrl').value.trim(),
      startDate: document.getElementById('gscStartDate').value,
      endDate: document.getElementById('gscEndDate').value
    });
    const query = document.getElementById('gscQuery').value.trim();
    if (query) params.set('query', query);
    try {
      const response = await protectedFetch('/api/search-console?' + params.toString());
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Google Search Console request failed.');
      document.getElementById('gscClicks').textContent = Number(data.totals.clicks).toLocaleString();
      document.getElementById('gscImpressions').textContent = Number(data.totals.impressions).toLocaleString();
      document.getElementById('gscCtr').textContent = (Number(data.totals.ctr) * 100).toFixed(2) + '%';
      document.getElementById('gscPosition').textContent = Number(data.totals.averagePosition).toFixed(2);
      const tbody = document.getElementById('gscRows');
      tbody.replaceChildren();
      for (const row of data.rows) {
        const tr = document.createElement('tr');
        for (const value of [row.query, Number(row.clicks).toLocaleString(), Number(row.impressions).toLocaleString(), (Number(row.ctr) * 100).toFixed(2) + '%', Number(row.position).toFixed(2)]) {
          const td = document.createElement('td');
          td.textContent = String(value);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      results.classList.remove('hidden');
      status.textContent = 'Source: Google Search Console · property API response · ' + data.startDate + ' to ' + data.endDate;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Unable to load Search Console data.';
    }
  });
}


/* ========================================================================== */
/* CELL 16: GLOBAL SEARCH BAR CONTROLLER                                      */
/* ========================================================================== */

/**
 * Initializes the unified global search bar in the top navigation header.
 * Dispatches queries to Domain Overview, Keyword Magic, or Site Audit based
 * on the selector type.
 */
function setupGlobalSearch() {
  const btn = document.getElementById('globalSearchBtn');
  const input = document.getElementById('globalSearchInput');
  const typeSel = document.getElementById('globalSearchType');

  function executeSearch() {
    const val = input.value.trim();
    if (!val) return;
    const type = typeSel.value;
    if (type === 'domain') {
      const domInput = document.getElementById('domainInput');
      if (domInput) domInput.value = val;
      switchToTab('domain');
      fetchDomainOverview(val);
    } else if (type === 'keyword') {
      const kwInput = document.getElementById('keywordInput');
      if (kwInput) kwInput.value = val;
      switchToTab('keywords');
      const kwForm = document.getElementById('keywordForm');
      if (kwForm) kwForm.dispatchEvent(new Event('submit', { cancelable: true }));
    } else if (type === 'url') {
      const fullUrl = val.startsWith('http') ? val : `https://${val}`;
      const auditInput = document.getElementById('auditUrlInput');
      if (auditInput) auditInput.value = fullUrl;
      switchToTab('audit');
      const auditForm = document.getElementById('auditForm');
      if (auditForm) auditForm.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  }

  if (btn) btn.addEventListener('click', executeSearch);
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') executeSearch();
    });
  }

  if (typeSel) {
    typeSel.addEventListener('change', () => {
      if (typeSel.value === 'domain') input.placeholder = 'Enter target domain (e.g. github.com)...';
      else if (typeSel.value === 'keyword') input.placeholder = 'Enter search keyword (e.g. best crm)...';
      else if (typeSel.value === 'url') input.placeholder = 'Enter full URL to audit (e.g. https://example.com)...';
    });
  }
}


/* ========================================================================== */
/* CELL 17: MANAGED PROJECTS & AUDIT HISTORY                                  */
/* ========================================================================== */

function setupProjects() {
  const refreshBtn = document.getElementById('refreshProjectsBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadProjects);

  async function loadProjects() {
    const tbody = document.getElementById('projectsTableBody');
    const badge = document.getElementById('projectsCountBadge');
    if (!tbody) return;
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const projects = await res.json();
      if (badge) badge.textContent = `${projects.length} Domains`;
      tbody.innerHTML = '';
      if (!projects || projects.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 24px;">No audit projects recorded yet. Run a Technical Site Audit to record your first property.</td></tr>';
        return;
      }
      projects.forEach(p => {
        const tr = document.createElement('tr');
        const healthClass = p.healthScore >= 90 ? 'badge-growth' : (p.healthScore >= 70 ? 'badge-warning' : 'badge-error');
        tr.innerHTML = `
          <td style="font-weight: 700; color: #fff;">${escapeHtml(p.domain)}</td>
          <td><span class="kpi-badge ${healthClass}">${p.healthScore} / 100</span></td>
          <td style="color: var(--accent-rose); font-weight: 600;">${p.totalErrors}</td>
          <td style="color: var(--accent-amber); font-weight: 600;">${p.totalWarnings}</td>
          <td style="color: var(--accent-blue); font-weight: 600;">${p.totalNotices}</td>
          <td style="color: var(--text-secondary); font-size: 0.85rem;">${new Date(p.lastCrawlDate).toLocaleDateString()}</td>
          <td>
            <button class="btn-secondary re-audit-btn" data-domain="${escapeHtml(p.domain)}" style="padding: 3px 10px; font-size: 0.75rem;">Re-Audit</button>
          </td>
        `;
        tr.querySelector('.re-audit-btn')?.addEventListener('click', () => {
          const auditInput = document.getElementById('auditUrlInput');
          if (auditInput) auditInput.value = `https://${p.domain}`;
          switchToTab('audit');
          const auditForm = document.getElementById('auditForm');
          if (auditForm) auditForm.dispatchEvent(new Event('submit', { cancelable: true }));
        });
        tbody.appendChild(tr);
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" style="color: var(--accent-rose); padding: 16px;">Failed to load projects: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  const projectsNavBtn = document.querySelector('.nav-item[data-tab="projects"]');
  if (projectsNavBtn) {
    projectsNavBtn.addEventListener('click', loadProjects);
  }
}


/* ========================================================================== */
/* CELL 18: EVIDENCE-BACKED AUDIT RECOMMENDATIONS                            */
/* ========================================================================== */

function setupRecommendations() {
  const form = document.getElementById('recommendationsForm');
  const input = document.getElementById('recommendationsUrlInput');
  const loader = document.getElementById('recommendationsLoading');
  const results = document.getElementById('recommendationsResults');
  const list = document.getElementById('recommendationsList');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!url) return;

    loader.classList.remove('hidden');
    results.classList.add('hidden');

    try {
      const res = await fetch(`/api/recommendations?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      document.getElementById('recHealthScore').textContent = `${data.healthScore ?? 90} / 100`;
      document.getElementById('recTotalCount').textContent = data.totalRecommendations ?? 0;
      document.getElementById('recBadgeCount').textContent = `${data.totalRecommendations ?? 0} Recommendations`;

      list.innerHTML = '';
      const recs = data.recommendations || [];
      if (recs.length === 0) {
        list.innerHTML = '<div style="color: var(--accent-green); padding: 24px; text-align: center; background: rgba(16, 185, 129, 0.05); border-radius: 8px;">No critical SEO bottlenecks detected. Excellent on-page hygiene!</div>';
      } else {
        recs.forEach(r => {
          const item = document.createElement('div');
          item.className = 'rec-card';
          const badgeClass = r.impact === 'high' ? 'rec-badge-high' : 'rec-badge-medium';
          const confPct = Math.round((r.confidence ?? 0.85) * 100);

          let evidenceHtml = '';
          if (r.evidence) {
            evidenceHtml = `
              <div class="rec-evidence-block" style="margin-top: 10px;">
                <div><strong>Metric:</strong> ${escapeHtml(r.evidence.metric)}</div>
                <div><strong>Observed:</strong> <span style="color: var(--accent-rose);">${escapeHtml(String(r.evidence.observed))}</span></div>
                <div><strong>Target Standard:</strong> <span style="color: var(--accent-green);">${escapeHtml(String(r.evidence.expected))}</span></div>
              </div>
            `;
          }

          item.innerHTML = `
            <div class="rec-header-row">
              <div class="rec-title">${escapeHtml(r.title)}</div>
              <div style="display: flex; gap: 8px; align-items: center;">
                <span class="${badgeClass}">${escapeHtml(r.impact)} IMPACT</span>
                <span class="kpi-badge">Confidence: ${confPct}%</span>
              </div>
            </div>
            <div style="color: var(--text-secondary); font-size: 0.88rem; line-height: 1.5; margin-bottom: 8px;">
              <strong>Why it matters:</strong> ${escapeHtml(r.rationale)}
            </div>
            <div class="rec-action-box">
              <strong>Prescribed Remediation:</strong> ${escapeHtml(r.action)}
            </div>
            ${evidenceHtml}
          `;
          list.appendChild(item);
        });
      }

      results.classList.remove('hidden');
    } catch (err) {
      alert(`Recommendations error: ${err.message}`);
    } finally {
      loader.classList.add('hidden');
    }
  });
}


/* ========================================================================== */
/* CELL 19: SEMANTIC KEYWORD CLUSTERING                                       */
/* ========================================================================== */

function setupClustering() {
  const form = document.getElementById('clusteringForm');
  const input = document.getElementById('clusteringKeywordsInput');
  const thresh = document.getElementById('clusteringThresholdInput');
  const loader = document.getElementById('clusteringLoading');
  const results = document.getElementById('clusteringResults');
  const container = document.getElementById('clustersContainer');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = input.value.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (raw.length === 0) return;

    loader.classList.remove('hidden');
    results.classList.add('hidden');

    try {
      const res = await fetch('/api/nlp/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: raw.map(k => ({ keyword: k, searchVolume: 1200, difficulty: 45 })),
          threshold: parseFloat(thresh.value) || 0.35,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      document.getElementById('clusterTotalKeywords').textContent = data.totalKeywords;
      document.getElementById('clusterTotalClusters').textContent = data.totalClusters;

      container.innerHTML = '';
      (data.clusters || []).forEach((c, idx) => {
        const card = document.createElement('div');
        card.className = 'panel-card';
        card.style.background = 'rgba(15, 23, 42, 0.7)';

        let pillsHtml = '';
        (c.keywords || []).forEach(k => {
          pillsHtml += `<span class="tag" style="margin: 3px; font-size: 0.78rem;">${escapeHtml(k.keyword)}</span>`;
        });

        card.innerHTML = `
          <div class="panel-header" style="margin-bottom: 12px;">
            <div>
              <span class="kpi-badge badge-high" style="font-size: 0.7rem; text-transform: uppercase;">Cluster #${idx + 1}</span>
              <h4 style="font-size: 1rem; font-weight: 700; margin-top: 4px; color: #fff;">${escapeHtml(c.representativeLabel || c.name)}</h4>
            </div>
            <span class="intent-badge intent-${(c.dominantIntent || 'informational').toLowerCase()}">${escapeHtml(c.dominantIntent || 'Info')}</span>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 12px; display: flex; justify-content: space-between;">
            <span>${c.keywords?.length || 0} terms</span>
            <span>Est. Vol: ${(c.totalSearchVolume || 0).toLocaleString()}/mo</span>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
            ${pillsHtml}
          </div>
        `;
        container.appendChild(card);
      });

      results.classList.remove('hidden');
    } catch (err) {
      alert(`Clustering failed: ${err.message}`);
    } finally {
      loader.classList.add('hidden');
    }
  });
}


/* ========================================================================== */
/* CELL 20: PERSISTENT RANK TRACKING & CHANGE LOGS                            */
/* ========================================================================== */

function setupRankTracker() {
  const addForm = document.getElementById('rankTrackerAddForm');
  const checkBtn = document.getElementById('rtCheckRankingsBtn');
  const domInput = document.getElementById('rtDomainInput');
  const kwInput = document.getElementById('rtKeywordInput');
  const devSelect = document.getElementById('rtDeviceSelect');
  const geoSelect = document.getElementById('rtCountrySelect');
  const loader = document.getElementById('rtLoading');
  const tbody = document.getElementById('rtTableBody');

  async function loadRankOverview(domain) {
    if (!domain) return;
    try {
      const res = await fetch(`/api/rank-tracker/overview?domain=${encodeURIComponent(domain)}`);
      if (!res.ok) return;
      const data = await res.json();
      document.getElementById('rtTotalKeywords').textContent = data.totalKeywords;
      document.getElementById('rtTop3Count').textContent = data.top3Count;
      document.getElementById('rtTop10Count').textContent = data.top10Count;
      document.getElementById('rtVisibilityScore').textContent = `${(data.visibilityIndex || 0).toFixed(1)}%`;
      document.getElementById('rtTableCountBadge').textContent = `${(data.keywords || []).length} Keywords`;

      tbody.innerHTML = '';
      if (!data.keywords || data.keywords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-secondary); padding: 24px;">No keywords tracked yet for this domain. Add keywords above to start tracking.</td></tr>';
        return;
      }

      data.keywords.forEach(k => {
        const tr = document.createElement('tr');
        const changeVal = k.changeSinceLastCheck || 0;
        const changeClass = changeVal > 0 ? 'color: var(--accent-green);' : (changeVal < 0 ? 'color: var(--accent-rose);' : 'color: var(--text-muted);');
        const changeText = changeVal > 0 ? `+${changeVal}` : (changeVal < 0 ? `${changeVal}` : '0');
        const devIcon = k.device === 'mobile' ? '📱' : '💻';
        const flag = k.country === 'uk' ? '🇬🇧' : (k.country === 'in' ? '🇮🇳' : '🇺🇸');

        tr.innerHTML = `
          <td style="font-weight: 600; color: #fff;">${escapeHtml(k.keyword)}</td>
          <td>${devIcon} ${escapeHtml(k.device || 'desktop')}</td>
          <td>${flag} ${escapeHtml((k.country || 'us').toUpperCase())}</td>
          <td><span class="pos-badge ${k.currentRank && k.currentRank <= 3 ? 'pos-1' : ''}">${k.currentRank ?? '—'}</span></td>
          <td><span class="pos-badge">${k.bestRank ?? '—'}</span></td>
          <td style="${changeClass} font-weight: 700;">${changeText}</td>
          <td style="font-size: 0.8rem; color: var(--text-secondary);">${k.lastChecked ? new Date(k.lastChecked).toLocaleDateString() : 'Pending'}</td>
          <td>
            <button class="btn-secondary add-note-btn" style="padding: 2px 8px; font-size: 0.72rem; display: inline-block;">+ Note</button>
            <button class="btn-secondary del-kw-btn" style="padding: 2px 8px; font-size: 0.72rem; display: inline-block; color: var(--accent-rose);">Delete</button>
          </td>
        `;

        tr.querySelector('.add-note-btn')?.addEventListener('click', () => {
          document.getElementById('annotateKeywordId').value = k.id;
          document.getElementById('annotateDomain').value = domain;
          document.getElementById('annotateKeywordText').textContent = `${k.keyword} (${k.device} • ${k.country.toUpperCase()})`;
          document.getElementById('annotateDateInput').value = new Date().toISOString().slice(0, 10);
          document.getElementById('annotateModal').classList.remove('hidden');
        });

        tr.querySelector('.del-kw-btn')?.addEventListener('click', async () => {
          if (!confirm(`Stop tracking "${k.keyword}"?`)) return;
          await fetch('/api/rank-tracker/keywords', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain, keywordId: k.id }),
          });
          loadRankOverview(domain);
        });

        tbody.appendChild(tr);
      });
    } catch (err) {
      console.error('Failed to load rank overview', err);
    }
  }

  if (addForm) {
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const domain = domInput.value.trim();
      const keyword = kwInput.value.trim();
      const device = devSelect.value;
      const country = geoSelect.value;
      if (!domain || !keyword) return;

      try {
        const res = await fetch('/api/rank-tracker/keywords', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain, keyword, device, country }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        kwInput.value = '';
        await loadRankOverview(domain);
      } catch (err) {
        alert(`Failed to add keyword: ${err.message}`);
      }
    });
  }

  if (checkBtn) {
    checkBtn.addEventListener('click', async () => {
      const domain = domInput.value.trim();
      if (!domain) return;
      loader.classList.remove('hidden');
      try {
        const res = await fetch('/api/rank-tracker/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await loadRankOverview(domain);
      } catch (err) {
        alert(`SERP check failed: ${err.message}`);
      } finally {
        loader.classList.add('hidden');
      }
    });
  }

  const annotateForm = document.getElementById('annotateForm');
  if (annotateForm) {
    annotateForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const keywordId = document.getElementById('annotateKeywordId').value;
      const domain = document.getElementById('annotateDomain').value;
      const date = document.getElementById('annotateDateInput').value;
      const note = document.getElementById('annotateNoteInput').value.trim();

      try {
        const res = await fetch('/api/rank-tracker/annotate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain, keywordId, date, note }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        document.getElementById('annotateModal').classList.add('hidden');
        document.getElementById('annotateNoteInput').value = '';
        alert('Annotation recorded in rank history!');
        loadRankOverview(domain);
      } catch (err) {
        alert(`Failed to save annotation: ${err.message}`);
      }
    });
  }

  const rtNavBtn = document.querySelector('.nav-item[data-tab="rank-tracker"]');
  if (rtNavBtn) {
    rtNavBtn.addEventListener('click', () => {
      loadRankOverview(domInput.value.trim() || 'github.com');
    });
  }
}


/* ========================================================================== */
/* CELL 21: CALIBRATED TRAFFIC FORECASTING                                    */
/* ========================================================================== */

function setupForecast() {
  const form = document.getElementById('forecastForm');
  const domInput = document.getElementById('forecastDomainInput');
  const foldsInput = document.getElementById('forecastFoldsInput');
  const loader = document.getElementById('forecastLoading');
  const results = document.getElementById('forecastResults');
  const tbody = document.getElementById('forecastTableBody');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const domain = domInput.value.trim();
    if (!domain) return;

    loader.classList.remove('hidden');
    results.classList.add('hidden');

    try {
      const res = await fetch('/api/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          backtestFolds: parseInt(foldsInput.value, 10) || 4,
          minClicksThreshold: 50,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      tbody.innerHTML = '';
      const forecasts = data.forecast || [];
      forecasts.forEach(f => {
        const tr = document.createElement('tr');
        const width = f.upperBound - f.lowerBound;
        tr.innerHTML = `
          <td><strong>Day +${f.horizonDays}</strong></td>
          <td>${escapeHtml(f.date)}</td>
          <td style="color: var(--accent-traffic); font-weight: 700;">${f.forecastClicks.toLocaleString()}</td>
          <td style="color: var(--text-secondary);">${f.lowerBound.toLocaleString()}</td>
          <td style="color: var(--text-secondary);">${f.upperBound.toLocaleString()}</td>
          <td><span class="kpi-badge">±${Math.round(width / 2).toLocaleString()}</span></td>
        `;
        tbody.appendChild(tr);
      });

      results.classList.remove('hidden');
    } catch (err) {
      alert(`Forecast calculation failed: ${err.message}`);
    } finally {
      loader.classList.add('hidden');
    }
  });
}


/* ========================================================================== */
/* CELL 22: DATA PROVIDERS ARCHITECTURE & STATUS MONITOR                      */
/* ========================================================================== */

function setupProviders() {
  const badgeBtn = document.getElementById('providersStatusBadge');
  const refreshBtn = document.getElementById('refreshProvidersBtn');
  const grid = document.getElementById('providersGrid');
  const statusText = document.getElementById('providersStatusText');

  async function checkProviders() {
    try {
      const res = await fetch('/api/providers/status');
      if (!res.ok) return;
      const data = await res.json();
      const providers = data.providers || [];

      if (statusText) {
        const healthyCount = providers.filter(p => p.status === 'healthy').length;
        statusText.textContent = `Providers (${healthyCount}/${providers.length} Active)`;
      }

      if (!grid) return;
      grid.innerHTML = '';

      providers.forEach(p => {
        const card = document.createElement('div');
        card.className = 'panel-card';
        card.style.background = 'rgba(15, 23, 42, 0.7)';
        const statusClass = p.status === 'healthy' ? 'badge-growth' : (p.status === 'degraded' ? 'badge-warning' : 'badge-error');
        const tierTag = p.tier === 'first_party_verified' ? 'tag-verified' : (p.tier === 'empirical_observation' ? 'tag-empirical' : (p.tier === 'external_provider' ? 'tag-provider' : 'tag-model'));

        card.innerHTML = `
          <div class="panel-header" style="margin-bottom: 12px;">
            <div>
              <span class="provenance-tag ${tierTag}" style="font-size: 0.7rem; text-transform: uppercase;">${escapeHtml(p.tier.replace(/_/g, ' '))}</span>
              <h4 style="font-size: 1.05rem; font-weight: 700; margin-top: 6px; color: #fff;">${escapeHtml(p.name)}</h4>
            </div>
            <span class="kpi-badge ${statusClass}">${escapeHtml(p.status.toUpperCase())}</span>
          </div>
          <div style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 12px;">
            ${escapeHtml(p.description)}
          </div>
          <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 6px; font-size: 0.78rem; display: flex; flex-direction: column; gap: 4px;">
            <div><strong>Latency:</strong> ${p.latencyMs}ms</div>
            <div><strong>Quota Remaining:</strong> ${p.quotaRemaining} / ${p.quotaLimit} calls</div>
            <div><strong>Cache Entries:</strong> ${p.cacheEntries} cached</div>
            <div style="color: var(--text-muted); font-size: 0.75rem; margin-top: 4px;"><strong>Limitations:</strong> ${escapeHtml(p.limitations)}</div>
          </div>
        `;
        grid.appendChild(card);
      });
    } catch (err) {
      console.error('Failed to fetch provider status', err);
    }
  }

  if (badgeBtn) {
    badgeBtn.addEventListener('click', () => {
      switchToTab('providers');
      checkProviders();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', checkProviders);
  }

  const providersNavBtn = document.querySelector('.nav-item[data-tab="providers"]');
  if (providersNavBtn) {
    providersNavBtn.addEventListener('click', checkProviders);
  }

  checkProviders();
}

