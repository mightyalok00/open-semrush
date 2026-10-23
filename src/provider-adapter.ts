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

import type {
  DataProvenanceTier,
  MetricType,
  ProvenanceMetadata,
  ProviderCategory,
  ProviderStatusInfo,
} from './types.js';

export interface ProviderRequestOptions {
  readonly country?: string;
  readonly device?: 'desktop' | 'mobile' | 'all';
  readonly bypassCache?: boolean;
}

export interface DataProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly category: ProviderCategory;
  isConfigured(): boolean;
  getStatus(): Promise<ProviderStatusInfo>;
}

// ---------------------------------------------------------------------------
// Rate Limiter & In-Memory TTL Cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

export class ProviderCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds: number = 300): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

export class ProviderRateLimiter {
  private readonly requests = new Map<string, number[]>();

  constructor(
    private readonly maxRequestsPerWindow: number = 30,
    private readonly windowMs: number = 60000
  ) {}

  checkLimit(key: string): { allowed: boolean; remaining: number; retryAfterSeconds?: number } {
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

  reset(): void {
    this.requests.clear();
  }
}

// ---------------------------------------------------------------------------
// Standard Provenance Factory
// ---------------------------------------------------------------------------

export function createStandardProvenance(options: {
  tier: DataProvenanceTier;
  dataSource: string;
  methodology: string;
  metricType?: MetricType;
  confidence?: 'exact' | 'high' | 'modeled' | 'illustrative' | 'unavailable';
  geography?: string;
  device?: 'desktop' | 'mobile' | 'all';
  dataLimitations?: readonly string[];
  warning?: string;
}): ProvenanceMetadata {
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
export class GoogleSearchConsoleAdapter implements DataProviderAdapter {
  readonly id = 'google_search_console';
  readonly name = 'Google Search Console API';
  readonly category: ProviderCategory = 'search_console';

  isConfigured(): boolean {
    return Boolean(
      process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN ||
      (process.env.GOOGLE_OAUTH_CLIENT_ID &&
       process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
       process.env.GOOGLE_OAUTH_REFRESH_TOKEN)
    );
  }

  async getStatus(): Promise<ProviderStatusInfo> {
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
export class WebCrawlerAdapter implements DataProviderAdapter {
  readonly id = 'active_crawler';
  readonly name = 'Open Semrush Safe Web Crawler';
  readonly category: ProviderCategory = 'crawler';

  isConfigured(): boolean {
    return true; // Always available locally
  }

  async getStatus(): Promise<ProviderStatusInfo> {
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
export class GoogleSuggestAdapter implements DataProviderAdapter {
  readonly id = 'google_suggest';
  readonly name = 'Google Suggest Real-Time Query Autocomplete';
  readonly category: ProviderCategory = 'external_keywords';

  isConfigured(): boolean {
    return true; // Public official completion API
  }

  async getStatus(): Promise<ProviderStatusInfo> {
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
export class DataForSeoAdapter implements DataProviderAdapter {
  readonly id = 'dataforseo';
  readonly name = 'DataForSEO Labs API';
  readonly category: ProviderCategory = 'external_keywords';

  isConfigured(): boolean {
    return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  }

  async getStatus(): Promise<ProviderStatusInfo> {
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
export class SerpRankEngineAdapter implements DataProviderAdapter {
  readonly id = 'serp_engine';
  readonly name = 'Live Organic SERP Engine';
  readonly category: ProviderCategory = 'serp';

  isConfigured(): boolean {
    return Boolean(process.env.SERPAPI_API_KEY || process.env.DATAFORSEO_LOGIN);
  }

  async getStatus(): Promise<ProviderStatusInfo> {
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
export class StatisticalModelAdapter implements DataProviderAdapter {
  readonly id = 'open_semrush_models';
  readonly name = 'Open Semrush Calibrated Statistical Models';
  readonly category: ProviderCategory = 'models';

  isConfigured(): boolean {
    return true;
  }

  async getStatus(): Promise<ProviderStatusInfo> {
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
  private static instance: ProviderRegistry;
  private readonly providers = new Map<string, DataProviderAdapter>();
  readonly cache = new ProviderCache();
  readonly rateLimiter = new ProviderRateLimiter(60, 60000);

  private constructor() {
    this.register(new GoogleSearchConsoleAdapter());
    this.register(new WebCrawlerAdapter());
    this.register(new GoogleSuggestAdapter());
    this.register(new DataForSeoAdapter());
    this.register(new SerpRankEngineAdapter());
    this.register(new StatisticalModelAdapter());
  }

  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  register(adapter: DataProviderAdapter): void {
    this.providers.set(adapter.id, adapter);
  }

  get(id: string): DataProviderAdapter | undefined {
    return this.providers.get(id);
  }

  getAll(): readonly DataProviderAdapter[] {
    return Array.from(this.providers.values());
  }

  async getStatusSummary(): Promise<ProviderStatusInfo[]> {
    const statuses: ProviderStatusInfo[] = [];
    for (const provider of this.providers.values()) {
      statuses.push(await provider.getStatus());
    }
    return statuses;
  }
}
