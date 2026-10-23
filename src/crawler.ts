import type { PageAuditResult, ProvenanceMetadata, SeoIssue, SiteAuditReport } from './types.js';
import { assertPublicHttpUrl, safeFetch } from './url-safety.js';
import {
  evaluateContentQuality,
  extractEntities,
  profilePageIntent,
  extractQuestions,
} from './nlp.js';

export interface CrawlerOptions {
  readonly maxPages?: number;
  readonly timeoutMs?: number;
  readonly userAgent?: string;
  readonly respectSitemap?: boolean;
  readonly renderEngine?: 'raw_html' | 'headless_browser';
  readonly politenessDelayMs?: number;
  readonly safeFetchDependencies?: {
    resolver?: (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>;
    requester?: (url: URL, address: string, family: number, init: RequestInit) => Promise<Response>;
  };
}

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; REA-SemrushBot/2.0; +https://rea.tools)';

const PAGE_AUDIT_PROVENANCE: ProvenanceMetadata = {
  tier: 'empirical_observation',
  isFactual: true,
  dataSource: 'Active HTTP crawl and DOM inspection',
  methodology: 'Direct socket fetch with IP pinning, response header parsing, and HTML semantic extraction',
  confidence: 'exact',
};

const SITE_AUDIT_PROVENANCE: ProvenanceMetadata = {
  tier: 'empirical_observation',
  isFactual: true,
  dataSource: 'Multi-page HTTP crawl session with robots.txt & sitemap discovery',
  methodology: 'Bounded asynchronous crawling, link graph traversal, and heuristic health score penalty weighting',
  confidence: 'high',
};

/**
 * Checks for robots.txt and extracts sitemap directives.
 */
async function inspectRobotsTxt(origin: string, userAgent: string, deps?: CrawlerOptions['safeFetchDependencies']): Promise<{ exists: boolean; sitemaps: string[] }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await safeFetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': userAgent },
      signal: controller.signal,
    }, deps);
    clearTimeout(timeout);

    if (res.status !== 200) return { exists: false, sitemaps: [] };

    const text = await res.text();
    const sitemaps: string[] = [];
    const lines = text.split('\n');
    for (const line of lines) {
      const match = /^Sitemap:\s*(https?:\/\/[^\s]+)/i.exec(line.trim());
      if (match && match[1]) {
        sitemaps.push(match[1]);
      }
    }
    return { exists: true, sitemaps };
  } catch {
    return { exists: false, sitemaps: [] };
  }
}

/**
 * Fetches and parses an XML sitemap to extract page URLs.
 */
async function discoverSitemapUrls(sitemapUrl: string, userAgent: string, maxLimit = 50, deps?: CrawlerOptions['safeFetchDependencies']): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await safeFetch(sitemapUrl, {
      headers: { 'User-Agent': userAgent },
      signal: controller.signal,
    }, deps);
    clearTimeout(timeout);

    if (!res.ok) return [];

    const xml = await res.text();
    const matches = xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi);
    const urls: string[] = [];

    for (const match of matches) {
      if (match[1]) {
        const u = match[1].trim();
        // Ignore sub-sitemap indexes for now, only take page URLs
        if (!u.endsWith('.xml') && !/\.(png|jpg|jpeg|gif|svg|pdf)$/i.test(u)) {
          urls.push(u);
          if (urls.length >= maxLimit) break;
        }
      }
    }
    return urls;
  } catch {
    return [];
  }
}

/**
 * Audits a single web page inspecting HTTP, HTML, Schema, and On-Page signals.
 */
export async function auditSinglePage(
  url: string,
  timeoutMs: number = 10000,
  userAgent: string = DEFAULT_USER_AGENT,
  deps?: CrawlerOptions['safeFetchDependencies']
): Promise<PageAuditResult> {
  const issues: SeoIssue[] = [];
  const startTime = Date.now();
  let ttfbMs = 0;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const res = await safeFetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    }, deps);
    clearTimeout(timeoutId);

    ttfbMs = Date.now() - startTime;
    const statusCode = res.status;

    if (statusCode >= 400 && statusCode < 500) {
      issues.push({
        code: 'HTTP_CLIENT_ERROR',
        severity: 'error',
        message: `Client error HTTP status ${statusCode}`,
        recommendation: 'Fix broken link or configure a 301 permanent redirect.',
        evidence: { metric: 'HTTP_STATUS', observed: statusCode, expected: 200 },
      });
    } else if (statusCode >= 500) {
      issues.push({
        code: 'HTTP_SERVER_ERROR',
        severity: 'error',
        message: `Server returned HTTP status ${statusCode}`,
        recommendation: 'Investigate application logs and server health.',
        evidence: { metric: 'HTTP_STATUS', observed: statusCode, expected: 200 },
      });
    }

    if (ttfbMs > 1800) {
      issues.push({
        code: 'SLOW_TTFB',
        severity: 'warning',
        message: `Slow Time-to-First-Byte (TTFB): ${ttfbMs}ms (optimal < 800ms)`,
        recommendation: 'Optimize server response time (TTFB), leverage caching, or deploy behind a CDN.',
        evidence: { metric: 'TTFB_MS', observed: ttfbMs, expected: '<800ms' },
      });
    }

    const html = await res.text();
    const loadTimeMs = Date.now() - startTime;
    const pageSizeKb = Math.round((Buffer.byteLength(html, 'utf8') / 1024) * 10) / 10;
    const compression = res.headers.get('content-encoding') || null;

    // Security Headers
    const hsts = Boolean(res.headers.get('strict-transport-security'));
    const csp = Boolean(res.headers.get('content-security-policy'));
    const xFrameOptions = Boolean(res.headers.get('x-frame-options'));
    const xContentTypeOptions = Boolean(res.headers.get('x-content-type-options'));
    const securityHeaders = { hsts, csp, xFrameOptions, xContentTypeOptions };

    if (!hsts && url.startsWith('https://')) {
      issues.push({
        code: 'MISSING_HSTS',
        severity: 'warning',
        message: 'Strict-Transport-Security (HSTS) header is missing',
        recommendation: 'Add Strict-Transport-Security header to enforce secure HTTPS connections.',
        evidence: { metric: 'STRICT_TRANSPORT_SECURITY', observed: 'missing', expected: 'max-age=31536000' },
      });
    }

    if (!csp) {
      issues.push({
        code: 'MISSING_CSP',
        severity: 'notice',
        message: 'Content-Security-Policy (CSP) header is missing',
        recommendation: 'Implement a Content-Security-Policy to mitigate XSS and injection vulnerabilities.',
        evidence: { metric: 'CONTENT_SECURITY_POLICY', observed: 'missing', expected: 'default-src \'self\'' },
      });
    }

    if (!xFrameOptions) {
      issues.push({
        code: 'MISSING_X_FRAME_OPTIONS',
        severity: 'notice',
        message: 'X-Frame-Options clickjacking protection header is missing',
        recommendation: 'Configure X-Frame-Options: SAMEORIGIN to prevent unauthorized framing.',
        evidence: { metric: 'X_FRAME_OPTIONS', observed: 'missing', expected: 'SAMEORIGIN' },
      });
    }

    if (pageSizeKb > 250) {
      issues.push({
        code: 'HEAVY_PAGE_SIZE',
        severity: 'warning',
        message: `HTML page size is heavy (${pageSizeKb} KB, optimal < 100 KB)`,
        recommendation: 'Minify HTML and defer non-essential scripts and assets to reduce payload.',
        evidence: { metric: 'PAGE_SIZE_KB', observed: pageSizeKb, expected: '<100KB' },
      });
    }

    // 1. Title Tag
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const title = titleMatch && titleMatch[1] !== undefined ? titleMatch[1].trim() : null;
    if (!title) {
      issues.push({
        code: 'TITLE_MISSING',
        severity: 'error',
        message: 'Missing <title> tag in HTML head',
        recommendation: 'Add a concise, descriptive title tag (30-60 characters).',
        evidence: { metric: 'TITLE_TAG', observed: 'none', expected: '30-60 characters' },
      });
    } else {
      if (title.length < 30) {
        issues.push({
          code: 'TITLE_TOO_SHORT',
          severity: 'warning',
          message: `Title is too short (${title.length} characters)`,
          recommendation: 'Expand title to at least 30 characters with target keywords.',
          evidence: { metric: 'TITLE_LENGTH', observed: title.length, expected: '30-60' },
        });
      } else if (title.length > 60) {
        issues.push({
          code: 'TITLE_TOO_LONG',
          severity: 'warning',
          message: `Title exceeds 60 characters (${title.length} characters)`,
          recommendation: 'Keep title under 60 characters to avoid SERP truncation.',
          evidence: { metric: 'TITLE_LENGTH', observed: title.length, expected: '30-60' },
        });
      }
    }

    // 2. Meta Description
    const metaDescMatch = /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html) ??
                          /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html);
    const metaDescription = metaDescMatch && metaDescMatch[1] !== undefined ? metaDescMatch[1].trim() : null;
    if (!metaDescription) {
      issues.push({
        code: 'META_DESC_MISSING',
        severity: 'warning',
        message: 'Missing meta description tag',
        recommendation: 'Add an engaging meta description between 70 and 160 characters.',
        evidence: { metric: 'META_DESCRIPTION', observed: 'none', expected: '70-160 characters' },
      });
    } else if (metaDescription.length < 70 || metaDescription.length > 160) {
      issues.push({
        code: 'META_DESC_LENGTH',
        severity: 'notice',
        message: `Meta description length (${metaDescription.length} chars) is outside optimal 70-160 range`,
        recommendation: 'Refine meta description length to maximize click-through rate.',
        evidence: { metric: 'META_DESC_LENGTH', observed: metaDescription.length, expected: '70-160' },
      });
    }

    // 3. Canonical Tag
    const canonicalMatch = /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i.exec(html);
    const canonical = canonicalMatch && canonicalMatch[1] !== undefined ? canonicalMatch[1].trim() : null;
    if (!canonical) {
      issues.push({
        code: 'CANONICAL_MISSING',
        severity: 'notice',
        message: 'No canonical URL specified',
        recommendation: 'Add a self-referencing <link rel="canonical"> to prevent duplicate content issues.',
        evidence: { metric: 'CANONICAL_URL', observed: 'none', expected: 'Self-referencing canonical URL' },
      });
    }

    // 4. Headings (H1)
    const h1Matches = html.match(/<h1[^>]*>/gi);
    const h1Count = h1Matches ? h1Matches.length : 0;
    if (h1Count === 0) {
      issues.push({
        code: 'H1_MISSING',
        severity: 'error',
        message: 'Missing <h1> tag',
        recommendation: 'Ensure each page has exactly one main <h1> heading.',
        evidence: { metric: 'H1_COUNT', observed: 0, expected: 1 },
      });
    } else if (h1Count > 1) {
      issues.push({
        code: 'H1_MULTIPLE',
        severity: 'warning',
        message: `Multiple <h1> tags detected (${h1Count} found)`,
        recommendation: 'Use only one <h1> per page for clearer topic hierarchy.',
        evidence: { metric: 'H1_COUNT', observed: h1Count, expected: 1 },
      });
    }

    // 5. Schema.org / JSON-LD Detection
    const schemaTypes: string[] = [];
    const ldJsonMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const m of ldJsonMatches) {
      if (m[1]) {
        try {
          const parsed = JSON.parse(m[1].trim());
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item['@type']) schemaTypes.push(String(item['@type']));
            }
          } else if (parsed['@type']) {
            schemaTypes.push(String(parsed['@type']));
          }
        } catch {
          // malformed JSON-LD
        }
      }
    }
    if (schemaTypes.length === 0) {
      issues.push({
        code: 'SCHEMA_MISSING',
        severity: 'notice',
        message: 'No Schema.org structured data (JSON-LD) detected',
        recommendation: 'Implement JSON-LD structured data (Organization, WebPage, Article, or Product) for rich SERP snippets.',
        evidence: { metric: 'SCHEMA_TYPES_COUNT', observed: 0, expected: '>=1 Schema.org JSON-LD' },
      });
    }

    // 6. OpenGraph Completeness
    const hasOgTitle = /<meta[^>]*property=["']og:title["']/i.test(html);
    const hasOgDesc = /<meta[^>]*property=["']og:description["']/i.test(html);
    const hasOgImg = /<meta[^>]*property=["']og:image["']/i.test(html);
    const openGraphComplete = hasOgTitle && hasOgDesc && hasOgImg;
    if (!openGraphComplete) {
      issues.push({
        code: 'OPENGRAPH_INCOMPLETE',
        severity: 'notice',
        message: 'Incomplete Open Graph metadata (missing og:title, og:description, or og:image)',
        recommendation: 'Add complete Open Graph meta tags to ensure clean preview cards on social platforms.',
        evidence: { metric: 'OPENGRAPH_STATUS', observed: `title:${hasOgTitle}, desc:${hasOgDesc}, img:${hasOgImg}`, expected: 'Complete og:title, og:description, and og:image' },
      });
    }

    // 7. Robots directives
    const robotsMetaMatch = /<meta[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/i.exec(html);
    const robotsContent = robotsMetaMatch && robotsMetaMatch[1] !== undefined ? robotsMetaMatch[1].toLowerCase() : '';
    const isIndexable = !robotsContent.includes('noindex');
    if (!isIndexable) {
      issues.push({
        code: 'ROBOTS_NOINDEX',
        severity: 'notice',
        message: 'Page has a noindex directive',
        recommendation: 'Confirm that this page is intended to be excluded from search indexes.',
        evidence: { metric: 'ROBOTS_DIRECTIVE', observed: 'noindex', expected: 'index, follow' },
      });
    }

    // 8. Images & Alt Attributes
    const imgTags = html.match(/<img[^>]*>/gi) ?? [];
    let missingAltCount = 0;
    for (const img of imgTags) {
      if (!/alt=["'][^"']*["']/i.test(img)) {
        missingAltCount++;
      }
    }
    if (missingAltCount > 0) {
      issues.push({
        code: 'IMAGES_MISSING_ALT',
        severity: 'warning',
        message: `${missingAltCount} image(s) missing descriptive alt attributes`,
        recommendation: 'Add informative alt text to all visual images for accessibility and image search.',
        evidence: { metric: 'IMAGES_MISSING_ALT_COUNT', observed: missingAltCount, expected: 0 },
      });
    }

    // 9. Word Count & Content Thinness
    const strippedText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = strippedText.length > 0 ? strippedText.split(/\s+/) : [];
    const wordCount = words.length;

    if (wordCount < 200 && isIndexable) {
      issues.push({
        code: 'LOW_WORD_COUNT',
        severity: 'warning',
        message: `Low word count (${wordCount} words)`,
        recommendation: 'Expand content with valuable information to avoid thin content penalties.',
        evidence: { metric: 'WORD_COUNT', observed: wordCount, expected: '>=200 words' },
      });
    }

    // 10. Links Count
    const anchorMatches = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi);
    let internalCount = 0;
    let externalCount = 0;
    const urlObj = new URL(url);

    for (const match of anchorMatches) {
      const href = match[1];
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
      try {
        const resolved = new URL(href, url);
        if (resolved.hostname === urlObj.hostname) internalCount++;
        else externalCount++;
      } catch {
        // Invalid link format
      }
    }

    // 11. Single Page Application (SPA) / Client-Side Hydration Detection
    const hasSpaRoot = /<div\b[^>]*\bid=["'](?:root|app|__next|app-root)["'][^>]*>\s*<\/div>/i.test(html) ||
                       /<div\b[^>]*\bid=["'](?:root|app)["'][^>]*>\s*<noscript/i.test(html);
    const hasFrameworkBundle = /__NEXT_DATA__|webpackChunk|vite\/client|\/_next\/static|react-dom/i.test(html);
    const spaDetected = Boolean((hasSpaRoot || hasFrameworkBundle) && wordCount < 60 && h1Count === 0);
    if (spaDetected) {
      issues.push({
        code: 'SPA_CLIENT_RENDER_DETECTED',
        severity: 'warning',
        message: 'Client-rendered Single Page Application (SPA) detected with minimal initial HTML markup.',
        recommendation: 'Implement Server-Side Rendering (SSR) or dynamic pre-rendering so search engine crawlers can index text and internal links without client-side JavaScript execution.',
      });
    }

    // 12. NLP Content Quality, Entity & Question Extraction, and Intent Profiling
    const contentQuality = evaluateContentQuality(strippedText);
    const headings = Array.from(html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi))
      .map(m => m[1]?.replace(/<[^>]+>/g, '').trim())
      .filter((h): h is string => Boolean(h));
    const questionsAnswered = extractQuestions(strippedText, headings);
    const entities = extractEntities(strippedText, html);
    const intentProfile = profilePageIntent(html, strippedText);

    if (contentQuality.isKeywordStuffed && contentQuality.stuffedTerms[0]) {
      issues.push({
        code: 'KEYWORD_STUFFING',
        severity: 'notice',
        message: `High keyword density detected: "${contentQuality.stuffedTerms[0].term}" has ${(contentQuality.stuffedTerms[0].density * 100).toFixed(1)}% frequency`,
        recommendation: 'Ensure natural keyword distribution and avoid repetitive phrases.',
      });
    }

    return {
      url,
      statusCode,
      loadTimeMs,
      ttfbMs,
      title,
      metaDescription,
      canonical,
      h1Count,
      wordCount,
      imagesTotal: imgTags.length,
      imagesMissingAlt: missingAltCount,
      internalLinksCount: internalCount,
      externalLinksCount: externalCount,
      isIndexable,
      schemaTypes,
      openGraphComplete,
      pageSizeKb,
      compression,
      securityHeaders,
      issues,
      spaDetected,
      renderEngine: 'raw_html',
      provenance: PAGE_AUDIT_PROVENANCE,
      entities,
      contentQuality,
      intentProfile,
      questionsAnswered,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    issues.push({
      code: 'FETCH_FAILED',
      severity: 'error',
      message: `Failed to fetch URL: ${message}`,
      recommendation: 'Verify URL accessibility and network connection.',
    });

    return {
      url,
      statusCode: 0,
      loadTimeMs: Date.now() - startTime,
      ttfbMs: 0,
      title: null,
      metaDescription: null,
      canonical: null,
      h1Count: 0,
      wordCount: 0,
      imagesTotal: 0,
      imagesMissingAlt: 0,
      internalLinksCount: 0,
      externalLinksCount: 0,
      isIndexable: false,
      schemaTypes: [],
      openGraphComplete: false,
      pageSizeKb: 0,
      compression: null,
      securityHeaders: { hsts: false, csp: false, xFrameOptions: false, xContentTypeOptions: false },
      issues,
      provenance: PAGE_AUDIT_PROVENANCE,
    };
  }
}

/**
 * Runs a multi-page Technical Site Audit crawl on a given target domain with sitemap auto-discovery.
 */
export async function runSiteAudit(
  startUrl: string,
  options: CrawlerOptions = {}
): Promise<SiteAuditReport> {
  const maxPages = Math.max(1, Math.min(100, Math.floor(options.maxPages ?? 5)));
  const timeoutMs = Math.max(1000, Math.min(30000, Math.floor(options.timeoutMs ?? 10000)));
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const deps = options.safeFetchDependencies;
  const validatedStartUrl = await assertPublicHttpUrl(startUrl, deps?.resolver);
  const normalizedStartUrl = validatedStartUrl.href;

  const startTime = Date.now();
  const startOrigin = validatedStartUrl.origin;

  // Step A: Inspect robots.txt
  const robotsInfo = await inspectRobotsTxt(startOrigin, userAgent, deps);

  // Step B: Discover sitemap URLs if available
  const sitemapCandidate = robotsInfo.sitemaps[0] ?? `${startOrigin}/sitemap.xml`;
  let sitemapTarget = `${startOrigin}/sitemap.xml`;
  try {
    const candidateUrl = await assertPublicHttpUrl(sitemapCandidate, deps?.resolver);
    if (candidateUrl.origin === startOrigin) sitemapTarget = candidateUrl.href;
  } catch {
    // Ignore unsafe sitemap declarations and use the target origin's default sitemap.
  }
  const discoveredSitemapUrls = (await discoverSitemapUrls(sitemapTarget, userAgent, 30, deps))
    .filter((candidate) => {
      try { return new URL(candidate).origin === startOrigin; } catch { return false; }
    });
  const hasSitemap = discoveredSitemapUrls.length > 0;

  // Step C: Initialize crawl queue
  const queue: string[] = [normalizedStartUrl];
  for (const sUrl of discoveredSitemapUrls) {
    if (!queue.includes(sUrl)) queue.push(sUrl);
  }

  const visited = new Set<string>();
  const pageResults: PageAuditResult[] = [];

  while (queue.length > 0 && pageResults.length < maxPages) {
    const currentUrl = queue.shift();
    if (!currentUrl || visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    const audit = await auditSinglePage(currentUrl, timeoutMs, userAgent, deps);
    pageResults.push(audit);

    // Fallback recursive link discovery if sitemap didn't provide enough URLs
    if (pageResults.length < maxPages && audit.statusCode === 200) {
      try {
        const res = await safeFetch(currentUrl, {
          method: 'GET',
          headers: { 'User-Agent': userAgent },
        }, deps);
        const html = await res.text();
        const matches = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi);

        for (const match of matches) {
          const href = match[1];
          if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
          try {
            const nextUrl = new URL(href, currentUrl);
            if (nextUrl.origin === startOrigin && !visited.has(nextUrl.href)) {
              if (!/\.(png|jpg|jpeg|svg|gif|pdf|zip|css|js)$/i.test(nextUrl.pathname)) {
                queue.push(nextUrl.href);
              }
            }
          } catch {
            // invalid URL
          }
        }
      } catch {
        // ignore discovery error
      }
    }

    if (options.politenessDelayMs && options.politenessDelayMs > 0 && queue.length > 0) {
      await new Promise(r => setTimeout(r, options.politenessDelayMs));
    }
  }

  // Calculate Aggregates & Health Score
  let errors = 0;
  let warnings = 0;
  let notices = 0;

  for (const page of pageResults) {
    for (const issue of page.issues) {
      if (issue.severity === 'error') errors++;
      else if (issue.severity === 'warning') warnings++;
      else if (issue.severity === 'notice') notices++;
    }
  }

  const penalty = (errors * 4.0 + warnings * 1.5 + notices * 0.3) / Math.max(1, pageResults.length);
  const healthScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  return {
    targetUrl: normalizedStartUrl,
    scannedPagesCount: pageResults.length,
    healthScore,
    totalErrors: errors,
    totalWarnings: warnings,
    totalNotices: notices,
    hasRobotsTxt: robotsInfo.exists,
    hasSitemap,
    discoveredSitemapUrlsCount: discoveredSitemapUrls.length,
    pages: pageResults,
    crawlDurationMs: Date.now() - startTime,
    provenance: SITE_AUDIT_PROVENANCE,
  };
}
