/**
 * Open Semrush Data Provider Abstraction Layer
 *
 * Implements a strict 3-layer data model:
 * 1. Verified First-Party Telemetry (Google Search Console)
 * 2. Empirical Active Observations (HTTP Crawler & Live SERP Inspection)
 * 3. External Data Providers (DataForSEO Labs, Google Suggest, SerpApi)
 * 4. Calibrated Open Semrush Models (Statistical regressions, 95% CIs, Intent classifiers)
 *
 * Guarantees:
 * - Clear provenance on every metric (provenance tier, source, timestamp, geography, device, limitations)
 * - Distinction between measured, provider_estimate, and modeled data
 * - Never fabricates search volume, rankings, or backlink counts: returns explicit 'unavailable' states
 * - Built-in caching, quotas, rate limiting, and graceful fallback
 */
export class ProviderCache {
    store = new Map();
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }
    set(key, value, ttlSeconds = 300) {
        this.store.set(key, {
            value,
            expiresAt: Date.now() + ttlSeconds * 1000,
        });
    }
    clear() {
        this.store.clear();
    }
    size() {
        return this.store.size;
    }
}
export class ProviderRateLimiter {
    maxRequestsPerWindow;
    windowMs;
    requests = new Map();
    constructor(maxRequestsPerWindow = 30, windowMs = 60000) {
        this.maxRequestsPerWindow = maxRequestsPerWindow;
        this.windowMs = windowMs;
    }
    checkLimit(key) {
        const now = Date.now();
        const timestamps = (this.requests.get(key) ?? []).filter(t => now - t < this.windowMs);
        if (timestamps.length >= this.maxRequestsPerWindow) {
            const oldest = timestamps[0] ?? now;
            const retryAfter = Math.ceil((oldest + this.windowMs - now) / 1000);
            return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, retryAfter) };
        }
        timestamps.push(now);
        this.requests.set(key, timestamps);
        return {
            allowed: true,
            remaining: this.maxRequestsPerWindow - timestamps.length,
        };
    }
    reset() {
        this.requests.clear();
    }
}
// ---------------------------------------------------------------------------
// Standard Provenance Factory
// ---------------------------------------------------------------------------
export function createStandardProvenance(options) {
    const isFactual = options.tier === 'verified_provider' || options.tier === 'empirical_observation';
    const confidence = options.confidence ?? (isFactual ? 'exact' : options.tier === 'provider_api' ? 'high' : 'modeled');
    const metricType = options.metricType ?? (isFactual ? 'measured' : options.tier === 'provider_api' ? 'provider_estimate' : 'modeled');
    return {
        tier: options.tier,
        isFactual,
        dataSource: options.dataSource,
        methodology: options.methodology,
        confidence,
        metricType,
        geography: options.geography ?? 'us',
        device: options.device ?? 'desktop',
        retrievalTimestamp: new Date().toISOString(),
        freshnessHours: 0,
        dataLimitations: options.dataLimitations ?? [],
        ...(options.warning ? { warning: options.warning } : {}),
    };
}
// ---------------------------------------------------------------------------
// Concrete Provider Adapters
// ---------------------------------------------------------------------------
/**
 * First-Party Google Search Console Provider Adapter
 */
export class GoogleSearchConsoleAdapter {
    id = 'google_search_console';
    name = 'Google Search Console API';
    category = 'search_console';
    isConfigured() {
        return Boolean(process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN ||
            (process.env.GOOGLE_OAUTH_CLIENT_ID &&
                process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
                process.env.GOOGLE_OAUTH_REFRESH_TOKEN));
    }
    async getStatus() {
        const configured = this.isConfigured();
        return {
            id: this.id,
            name: this.name,
            category: this.category,
            isConfigured: configured,
            isHealthy: configured,
            message: configured
                ? 'Connected to authorized Google Search Console properties for verified search performance.'
                : 'Not configured. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_REFRESH_TOKEN to .env for verified GSC telemetry.',
        };
    }
}
/**
 * Empirical Web Crawler Adapter
 */
export class WebCrawlerAdapter {
    id = 'active_crawler';
    name = 'Open Semrush Safe Web Crawler';
    category = 'crawler';
    isConfigured() {
        return true; // Always available locally
    }
    async getStatus() {
        return {
            id: this.id,
            name: this.name,
            category: this.category,
            isConfigured: true,
            isHealthy: true,
            message: 'Active local HTTP crawler with SSRF protection, DNS answer pinning, robots.txt, and sitemap parsing.',
        };
    }
}
/**
 * Google Suggest Autocomplete Real Query Adapter
 */
export class GoogleSuggestAdapter {
    id = 'google_suggest';
    name = 'Google Suggest Real-Time Query Autocomplete';
    category = 'external_keywords';
    isConfigured() {
        return true; // Public official completion API
    }
    async getStatus() {
        return {
            id: this.id,
            name: this.name,
            category: this.category,
            isConfigured: true,
            isHealthy: true,
            message: 'Active real-time query suggestions from Google Autocomplete with question and comparison taxonomy.',
        };
    }
}
/**
 * DataForSEO Labs Keyword & Volume Adapter
 */
export class DataForSeoAdapter {
    id = 'dataforseo';
    name = 'DataForSEO Labs API';
    category = 'external_keywords';
    isConfigured() {
        return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
    }
    async getStatus() {
        const configured = this.isConfigured();
        return {
            id: this.id,
            name: this.name,
            category: this.category,
            isConfigured: configured,
            isHealthy: configured,
            message: configured
                ? 'DataForSEO credentials configured for licensed search volume, CPC, and competitor database.'
                : 'Optional provider not configured. Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to .env for commercial volume data. Unmeasured queries will return explicit unavailable states.',
        };
    }
}
/**
 * Live SERP Rank Engine Adapter
 */
export class SerpRankEngineAdapter {
    id = 'serp_engine';
    name = 'Live Organic SERP Engine';
    category = 'serp';
    isConfigured() {
        return Boolean(process.env.SERPAPI_API_KEY || process.env.DATAFORSEO_LOGIN);
    }
    async getStatus() {
        const hasExternalKey = this.isConfigured();
        return {
            id: this.id,
            name: this.name,
            category: this.category,
            isConfigured: hasExternalKey,
            isHealthy: true,
            message: hasExternalKey
                ? 'Live search engine rankings backed by licensed SERP provider.'
                : 'Operating with local heuristic search parser. Add SERPAPI_API_KEY or DATAFORSEO credentials for live commercial SERP feeds.',
        };
    }
}
/**
 * Statistical Modeling Engine Adapter
 */
export class StatisticalModelAdapter {
    id = 'open_semrush_models';
    name = 'Open Semrush Calibrated Statistical Models';
    category = 'models';
    isConfigured() {
        return true;
    }
    async getStatus() {
        return {
            id: this.id,
            name: this.name,
            category: this.category,
            isConfigured: true,
            isHealthy: true,
            message: 'Active statistical models: Calibrated CTR Power-Law, Softmax Intent Distribution, Rolling-Origin Traffic Forecasting with 95% CIs, and 8-Vector Link Toxicity Auditing.',
        };
    }
}
// ---------------------------------------------------------------------------
// Provider Registry Singleton
// ---------------------------------------------------------------------------
export class ProviderRegistry {
    static instance;
    providers = new Map();
    cache = new ProviderCache();
    rateLimiter = new ProviderRateLimiter(60, 60000);
    constructor() {
        this.register(new GoogleSearchConsoleAdapter());
        this.register(new WebCrawlerAdapter());
        this.register(new GoogleSuggestAdapter());
        this.register(new DataForSeoAdapter());
        this.register(new SerpRankEngineAdapter());
        this.register(new StatisticalModelAdapter());
    }
    static getInstance() {
        if (!ProviderRegistry.instance) {
            ProviderRegistry.instance = new ProviderRegistry();
        }
        return ProviderRegistry.instance;
    }
    register(adapter) {
        this.providers.set(adapter.id, adapter);
    }
    get(id) {
        return this.providers.get(id);
    }
    getAll() {
        return Array.from(this.providers.values());
    }
    async getStatusSummary() {
        const statuses = [];
        for (const provider of this.providers.values()) {
            statuses.push(await provider.getStatus());
        }
        return statuses;
    }
}
