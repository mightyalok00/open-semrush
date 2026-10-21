import { assertPublicHttpUrl, safeFetch } from './url-safety.js';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; REA-SemrushBot/2.0; +https://rea.tools)';
/**
 * Checks for robots.txt and extracts sitemap directives.
 */
async function inspectRobotsTxt(origin, userAgent) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const res = await safeFetch(`${origin}/robots.txt`, {
            headers: { 'User-Agent': userAgent },
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.status !== 200)
            return { exists: false, sitemaps: [] };
        const text = await res.text();
        const sitemaps = [];
        const lines = text.split('\n');
        for (const line of lines) {
            const match = /^Sitemap:\s*(https?:\/\/[^\s]+)/i.exec(line.trim());
            if (match && match[1]) {
                sitemaps.push(match[1]);
            }
        }
        return { exists: true, sitemaps };
    }
    catch {
        return { exists: false, sitemaps: [] };
    }
}
/**
 * Fetches and parses an XML sitemap to extract page URLs.
 */
async function discoverSitemapUrls(sitemapUrl, userAgent, maxLimit = 50) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await safeFetch(sitemapUrl, {
            headers: { 'User-Agent': userAgent },
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok)
            return [];
        const xml = await res.text();
        const matches = xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi);
        const urls = [];
        for (const match of matches) {
            if (match[1]) {
                const u = match[1].trim();
                // Ignore sub-sitemap indexes for now, only take page URLs
                if (!u.endsWith('.xml') && !/\.(png|jpg|jpeg|gif|svg|pdf)$/i.test(u)) {
                    urls.push(u);
                    if (urls.length >= maxLimit)
                        break;
                }
            }
        }
        return urls;
    }
    catch {
        return [];
    }
}
/**
 * Audits a single web page inspecting HTTP, HTML, Schema, and On-Page signals.
 */
export async function auditSinglePage(url, timeoutMs = 10000, userAgent = DEFAULT_USER_AGENT) {
    const issues = [];
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
        });
        clearTimeout(timeoutId);
        ttfbMs = Date.now() - startTime;
        const statusCode = res.status;
        if (statusCode >= 400 && statusCode < 500) {
            issues.push({
                code: 'HTTP_CLIENT_ERROR',
                severity: 'error',
                message: `Client error HTTP status ${statusCode}`,
                recommendation: 'Fix broken link or configure a 301 permanent redirect.',
            });
        }
        else if (statusCode >= 500) {
            issues.push({
                code: 'HTTP_SERVER_ERROR',
                severity: 'error',
                message: `Server returned HTTP status ${statusCode}`,
                recommendation: 'Investigate application logs and server health.',
            });
        }
        if (ttfbMs > 1800) {
            issues.push({
                code: 'SLOW_TTFB',
                severity: 'warning',
                message: `Slow Time-to-First-Byte (TTFB): ${ttfbMs}ms (optimal < 800ms)`,
                recommendation: 'Optimize server response time (TTFB), leverage caching, or deploy behind a CDN.',
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
            });
        }
        if (!csp) {
            issues.push({
                code: 'MISSING_CSP',
                severity: 'notice',
                message: 'Content-Security-Policy (CSP) header is missing',
                recommendation: 'Implement a Content-Security-Policy to mitigate XSS and injection vulnerabilities.',
            });
        }
        if (!xFrameOptions) {
            issues.push({
                code: 'MISSING_X_FRAME_OPTIONS',
                severity: 'notice',
                message: 'X-Frame-Options clickjacking protection header is missing',
                recommendation: 'Configure X-Frame-Options: SAMEORIGIN to prevent unauthorized framing.',
            });
        }
        if (pageSizeKb > 250) {
            issues.push({
                code: 'HEAVY_PAGE_SIZE',
                severity: 'warning',
                message: `HTML page size is heavy (${pageSizeKb} KB, optimal < 100 KB)`,
                recommendation: 'Minify HTML and defer non-essential scripts and assets to reduce payload.',
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
            });
        }
        else {
            if (title.length < 30) {
                issues.push({
                    code: 'TITLE_TOO_SHORT',
                    severity: 'warning',
                    message: `Title is too short (${title.length} characters)`,
                    recommendation: 'Expand title to at least 30 characters with target keywords.',
                });
            }
            else if (title.length > 60) {
                issues.push({
                    code: 'TITLE_TOO_LONG',
                    severity: 'warning',
                    message: `Title exceeds 60 characters (${title.length} characters)`,
                    recommendation: 'Keep title under 60 characters to avoid SERP truncation.',
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
            });
        }
        else if (metaDescription.length < 70 || metaDescription.length > 160) {
            issues.push({
                code: 'META_DESC_LENGTH',
                severity: 'notice',
                message: `Meta description length (${metaDescription.length} chars) is outside optimal 70-160 range`,
                recommendation: 'Refine meta description length to maximize click-through rate.',
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
            });
        }
        else if (h1Count > 1) {
            issues.push({
                code: 'H1_MULTIPLE',
                severity: 'warning',
                message: `Multiple <h1> tags detected (${h1Count} found)`,
                recommendation: 'Use only one <h1> per page for clearer topic hierarchy.',
            });
        }
        // 5. Schema.org / JSON-LD Detection
        const schemaTypes = [];
        const ldJsonMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
        for (const m of ldJsonMatches) {
            if (m[1]) {
                try {
                    const parsed = JSON.parse(m[1].trim());
                    if (Array.isArray(parsed)) {
                        for (const item of parsed) {
                            if (item['@type'])
                                schemaTypes.push(String(item['@type']));
                        }
                    }
                    else if (parsed['@type']) {
                        schemaTypes.push(String(parsed['@type']));
                    }
                }
                catch {
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
            });
        }
        // 10. Links Count
        const anchorMatches = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi);
        let internalCount = 0;
        let externalCount = 0;
        const urlObj = new URL(url);
        for (const match of anchorMatches) {
            const href = match[1];
            if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:'))
                continue;
            try {
                const resolved = new URL(href, url);
                if (resolved.hostname === urlObj.hostname)
                    internalCount++;
                else
                    externalCount++;
            }
            catch {
                // Invalid link format
            }
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
        };
    }
    catch (err) {
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
        };
    }
}
/**
 * Runs a multi-page Technical Site Audit crawl on a given target domain with sitemap auto-discovery.
 */
export async function runSiteAudit(startUrl, options = {}) {
    const maxPages = Math.max(1, Math.min(100, Math.floor(options.maxPages ?? 5)));
    const timeoutMs = Math.max(1000, Math.min(30000, Math.floor(options.timeoutMs ?? 10000)));
    const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    const validatedStartUrl = await assertPublicHttpUrl(startUrl);
    const normalizedStartUrl = validatedStartUrl.href;
    const startTime = Date.now();
    const startOrigin = validatedStartUrl.origin;
    // Step A: Inspect robots.txt
    const robotsInfo = await inspectRobotsTxt(startOrigin, userAgent);
    // Step B: Discover sitemap URLs if available
    let sitemapTarget = robotsInfo.sitemaps[0] ?? `${startOrigin}/sitemap.xml`;
    const discoveredSitemapUrls = await discoverSitemapUrls(sitemapTarget, userAgent, 30);
    const hasSitemap = discoveredSitemapUrls.length > 0;
    // Step C: Initialize crawl queue
    const queue = [normalizedStartUrl];
    for (const sUrl of discoveredSitemapUrls) {
        if (!queue.includes(sUrl))
            queue.push(sUrl);
    }
    const visited = new Set();
    const pageResults = [];
    while (queue.length > 0 && pageResults.length < maxPages) {
        const currentUrl = queue.shift();
        if (!currentUrl || visited.has(currentUrl))
            continue;
        visited.add(currentUrl);
        const audit = await auditSinglePage(currentUrl, timeoutMs, userAgent);
        pageResults.push(audit);
        // Fallback recursive link discovery if sitemap didn't provide enough URLs
        if (pageResults.length < maxPages && audit.statusCode === 200) {
            try {
                const res = await safeFetch(currentUrl, {
                    method: 'GET',
                    headers: { 'User-Agent': userAgent },
                });
                const html = await res.text();
                const matches = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi);
                for (const match of matches) {
                    const href = match[1];
                    if (!href || href.startsWith('#') || href.startsWith('javascript:'))
                        continue;
                    try {
                        const nextUrl = new URL(href, currentUrl);
                        if (nextUrl.origin === startOrigin && !visited.has(nextUrl.href)) {
                            if (!/\.(png|jpg|jpeg|svg|gif|pdf|zip|css|js)$/i.test(nextUrl.pathname)) {
                                queue.push(nextUrl.href);
                            }
                        }
                    }
                    catch {
                        // invalid URL
                    }
                }
            }
            catch {
                // ignore discovery error
            }
        }
    }
    // Calculate Aggregates & Health Score
    let errors = 0;
    let warnings = 0;
    let notices = 0;
    for (const page of pageResults) {
        for (const issue of page.issues) {
            if (issue.severity === 'error')
                errors++;
            else if (issue.severity === 'warning')
                warnings++;
            else if (issue.severity === 'notice')
                notices++;
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
    };
}
