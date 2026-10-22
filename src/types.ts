/**
 * Type definitions for Semrush-style SEO and Competitive Analysis Suite.
 */

export type IssueSeverity = 'error' | 'warning' | 'notice';

export interface SeoIssue {
  readonly code: string;
  readonly severity: IssueSeverity;
  readonly message: string;
  readonly recommendation: string;
}

/**
 * Data provenance classification hierarchy to distinguish verified telemetry from estimates.
 */
export type DataProvenanceTier =
  | 'verified_provider'     // Direct verified telemetry (e.g. Google Search Console API)
  | 'empirical_observation' // Active crawl observation (HTTP status, headers, HTML markup)
  | 'statistical_model'    // Calibrated mathematical regressions (CTR power law, 95% traffic CI, Softmax intent)
  | 'provider_api'         // Third-party data provider (DataForSEO, Google Suggest, SerpApi)
  | 'synthetic_estimate';  // Heuristic / illustrative simulations (when no external provider is connected)

export interface ProvenanceMetadata {
  readonly tier: DataProvenanceTier;
  readonly isFactual: boolean;
  readonly dataSource: string;
  readonly methodology: string;
  readonly confidence: 'exact' | 'high' | 'modeled' | 'illustrative';
  readonly warning?: string;
}

export interface PageAuditResult {
  readonly url: string;
  readonly statusCode: number;
  readonly loadTimeMs: number;
  readonly ttfbMs: number;
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly canonical: string | null;
  readonly h1Count: number;
  readonly wordCount: number;
  readonly imagesTotal: number;
  readonly imagesMissingAlt: number;
  readonly internalLinksCount: number;
  readonly externalLinksCount: number;
  readonly isIndexable: boolean;
  readonly schemaTypes: readonly string[];
  readonly openGraphComplete: boolean;
  readonly pageSizeKb: number;
  readonly compression: string | null;
  readonly securityHeaders: {
    readonly hsts: boolean;
    readonly csp: boolean;
    readonly xFrameOptions: boolean;
    readonly xContentTypeOptions: boolean;
  };
  readonly issues: readonly SeoIssue[];
  readonly spaDetected?: boolean;
  readonly renderEngine?: 'raw_html' | 'headless_browser';
  readonly provenance?: ProvenanceMetadata;
  readonly entities?: readonly ExtractedEntity[];
  readonly contentQuality?: ContentQualityMetrics;
  readonly intentProfile?: PageIntentProfile;
  readonly questionsAnswered?: readonly ExtractedQuestion[];
}

export type EntityType = 'organization' | 'product' | 'technology' | 'concept' | 'person' | 'location';

export interface ExtractedEntity {
  readonly name: string;
  readonly type: EntityType;
  readonly salience: number; // 0.0 to 1.0
  readonly frequency: number;
}

export interface ExtractedQuestion {
  readonly question: string;
  readonly headingContext?: string;
  readonly frequency: number;
}

export interface ContentQualityMetrics {
  readonly wordCount: number;
  readonly uniqueWordCount: number;
  readonly lexicalDiversity: number; // Root Type-Token Ratio
  readonly repetitionEntropy: number; // 0.0 to 1.0
  readonly isKeywordStuffed: boolean;
  readonly stuffedTerms: readonly { readonly term: string; readonly density: number }[];
  readonly qualityGrade: 'excellent' | 'good' | 'moderate' | 'thin' | 'poor';
}

export interface PageIntentProfile {
  readonly primaryIntent: SearchIntent;
  readonly confidence: number;
  readonly probabilities: {
    readonly Informational: number;
    readonly Commercial: number;
    readonly Navigational: number;
    readonly Transactional: number;
  };
  readonly intentSignals: readonly string[];
}

export interface IntentAlignmentAudit {
  readonly query: string;
  readonly targetUrl: string;
  readonly queryIntent: SearchIntent;
  readonly pageIntent: SearchIntent;
  readonly alignmentScore: number; // 0 to 100
  readonly isAligned: boolean;
  readonly mismatchReasons: readonly string[];
  readonly recommendations: readonly string[];
  readonly queryIntentDistribution: IntentProbabilityDistribution;
  readonly pageIntentProfile: PageIntentProfile;
  readonly provenance: ProvenanceMetadata;
}

export interface SemanticContentGapResult {
  readonly targetUrl: string;
  readonly competitorUrl: string;
  readonly topicalCoverageScore: number; // 0 to 100
  readonly sharedConcepts: readonly string[];
  readonly missingSubtopics: readonly string[];
  readonly unansweredQuestions: readonly string[];
  readonly targetConceptCount: number;
  readonly competitorConceptCount: number;
  readonly provenance: ProvenanceMetadata;
}

export interface SemanticTopicCluster {
  readonly clusterTheme: string;
  readonly keywords: readonly string[];
  readonly primaryIntent: SearchIntent;
  readonly intentDistribution: {
    readonly Informational: number;
    readonly Commercial: number;
    readonly Navigational: number;
    readonly Transactional: number;
  };
  readonly averageDifficulty: number;
  readonly totalVolume: number;
  readonly subtopics: readonly string[];
}

export type ApiUserRole = 'admin' | 'analyst' | 'viewer';

export interface AuthContext {
  readonly role: ApiUserRole;
  readonly tenantId: string;
}

export interface SiteAuditReport {
  readonly targetUrl: string;
  readonly scannedPagesCount: number;
  readonly healthScore: number; // 0 to 100
  readonly totalErrors: number;
  readonly totalWarnings: number;
  readonly totalNotices: number;
  readonly hasRobotsTxt: boolean;
  readonly hasSitemap: boolean;
  readonly discoveredSitemapUrlsCount: number;
  readonly pages: readonly PageAuditResult[];
  readonly crawlDurationMs: number;
  readonly provenance?: ProvenanceMetadata;
}

export type SearchIntent = 'Informational' | 'Navigational' | 'Commercial' | 'Transactional';

export interface IntentProbabilityDistribution {
  readonly primaryIntent: SearchIntent;
  readonly confidence: number;
  readonly probabilities: {
    readonly Informational: number;
    readonly Commercial: number;
    readonly Navigational: number;
    readonly Transactional: number;
  };
  readonly intentSignals: readonly string[];
}

export interface TrafficForecastInterval {
  readonly expectedVisits: number;
  readonly lower95: number;
  readonly upper95: number;
  readonly standardError: number;
  readonly confidenceLevel: number;
}

export interface KeywordMetrics {
  readonly keyword: string;
  readonly searchVolume: number;
  readonly keywordDifficulty: number; // 0 to 100
  readonly intent: SearchIntent;
  readonly cpcUsd: number;
  readonly competitiveDensity: number; // 0.0 to 1.0
  readonly seasonalityTrend: readonly number[]; // 12 months relative interest (0 - 100)
  readonly intentDistribution?: IntentProbabilityDistribution;
  readonly trafficForecast?: TrafficForecastInterval;
  readonly provenance?: ProvenanceMetadata;
}

export interface SerpRankingItem {
  readonly position: number;
  readonly title: string;
  readonly url: string;
  readonly domain: string;
  readonly snippet: string;
  readonly estimatedCtr: number;
}

export interface SerpFeatureSummary {
  readonly hasFeaturedSnippet: boolean;
  readonly hasPeopleAlsoAsk: boolean;
  readonly hasLocalPack: boolean;
  readonly hasVideoCarousel: boolean;
  readonly hasKnowledgePanel: boolean;
}

export interface SerpReport {
  readonly query: string;
  readonly location: string;
  readonly device: 'desktop' | 'mobile';
  readonly features: SerpFeatureSummary;
  readonly rankings: readonly SerpRankingItem[];
  readonly provenance?: ProvenanceMetadata;
}

export interface DomainKeywordRanking {
  readonly keyword: string;
  readonly position: number;
  readonly searchVolume: number;
  readonly estimatedMonthlyTraffic: number;
  readonly intent: SearchIntent;
}

export interface HistoricalTrafficMonth {
  readonly month: string;
  readonly organicTraffic: number;
  readonly rankedKeywords: number;
  readonly googleUpdate?: string | undefined;
}

export interface DomainOverviewReport {
  readonly domain: string;
  readonly countryCode?: string | undefined;
  readonly authorityScore: number; // 0 to 100
  readonly estimatedMonthlyOrganicTraffic: number;
  readonly totalRankedKeywords: number;
  readonly topOrganicKeywords: readonly DomainKeywordRanking[];
  readonly topCompetitors: readonly string[];
  readonly history24Months: readonly HistoricalTrafficMonth[];
  readonly provenance?: ProvenanceMetadata;
}

export interface KeywordGapComparison {
  readonly domainA: string;
  readonly domainB: string;
  readonly sharedKeywords: readonly string[];
  readonly missingForDomainA: readonly string[];
  readonly uniqueToDomainA: readonly string[];
}

export interface BacklinkNode {
  readonly sourceUrl: string;
  readonly sourceDomain: string;
  readonly targetUrl: string;
  readonly anchorText: string;
  readonly isDofollow: boolean;
  readonly sourceAuthorityScore: number;
}

export interface BacklinkProfileReport {
  readonly targetDomain: string;
  readonly authorityScore: number;
  readonly totalBacklinks: number;
  readonly totalReferringDomains: number;
  readonly dofollowRatio: number; // 0.0 to 1.0
  readonly toxicityScore: number; // 0 to 100
  readonly toxicLinksCount: number;
  readonly anchorDistribution: {
    readonly brandedRatio: number; // 0.0 to 1.0
    readonly exactMatchRatio: number;
    readonly nakedUrlRatio: number;
    readonly genericRatio: number;
  };
  readonly topAnchors: readonly { readonly text: string; readonly count: number }[];
  readonly recentBacklinks: readonly BacklinkNode[];
  readonly provenance?: ProvenanceMetadata;
}

export interface MultiCompetitorGapReport {
  readonly domains: readonly string[];
  readonly allKeywordsCount: number;
  readonly matrix: readonly {
    readonly keyword: string;
    readonly searchVolume: number;
    readonly intent: SearchIntent;
    readonly difficulty: number;
    readonly rankings: Record<string, number | null>;
    readonly bestDomain: string | null;
  }[];
  readonly sharedOpportunities: readonly string[];
  readonly provenance?: ProvenanceMetadata;
}

export interface LiveSerpResult {
  readonly query: string;
  readonly totalResults: number;
  readonly searchTimeSeconds: number;
  readonly features: {
    readonly hasFeaturedSnippet: boolean;
    readonly featuredSnippet?: {
      readonly title: string;
      readonly snippet: string;
      readonly sourceUrl: string;
      readonly sourceDomain: string;
    } | undefined;
    readonly peopleAlsoAsk: readonly string[];
    readonly hasVideoPack: boolean;
    readonly hasKnowledgePanel: boolean;
  };
  readonly topRankings: readonly {
    readonly position: number;
    readonly title: string;
    readonly url: string;
    readonly domain: string;
    readonly snippet: string;
    readonly estimatedCtr: number;
    readonly authorityScore: number;
  }[];
  readonly provenance?: ProvenanceMetadata;
}

export interface AiFixRecommendation {
  readonly issueCode: string;
  readonly originalValue: string | null;
  readonly suggestedFix: string;
  readonly codeSnippet: string;
  readonly explanation: string;
}

export interface ContentStrategyOutline {
  readonly targetKeyword: string;
  readonly recommendedTitle: string;
  readonly targetIntent: SearchIntent;
  readonly estimatedDifficulty: number;
  readonly recommendedWordCount: number;
  readonly headingStructure: readonly {
    readonly level: 'h2' | 'h3';
    readonly text: string;
  }[];
  readonly keyTalkingPoints: readonly string[];
}

export interface TrackedProjectRecord {
  readonly id: string;
  readonly domain: string;
  readonly createdAt: string;
  readonly lastAuditScore: number;
  readonly trackedKeywords: readonly string[];
}

/* =========================================================================
 * Google Search Console Intelligence Types
 * ========================================================================= */

export interface SearchConsoleRow {
  readonly query?: string;
  readonly page?: string;
  readonly device?: string;
  readonly country?: string;
  readonly date?: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly position: number;
}

export interface StrikingDistanceQuery {
  readonly query: string;
  readonly impressions: number;
  readonly clicks: number;
  readonly ctr: number;
  readonly position: number;
  readonly page?: string;
  readonly opportunityScore: number;
}

export interface CannibalizationIssue {
  readonly query: string;
  readonly competingPages: readonly {
    readonly page: string;
    readonly clicks: number;
    readonly impressions: number;
    readonly averagePosition: number;
  }[];
  readonly totalClicks: number;
  readonly totalImpressions: number;
}

export interface CtrOpportunity {
  readonly query: string;
  readonly page?: string;
  readonly impressions: number;
  readonly actualCtr: number;
  readonly expectedCtr: number;
  readonly ctrGap: number;
  readonly potentialExtraClicks: number;
}

export interface SearchConsoleIntelligence {
  readonly strikingDistanceQueries: readonly StrikingDistanceQuery[];
  readonly cannibalizationIssues: readonly CannibalizationIssue[];
  readonly ctrOpportunities: readonly CtrOpportunity[];
}

export interface SearchConsoleSite {
  readonly siteUrl: string;
  readonly permissionLevel: string;
}

export interface SearchConsoleReport {
  readonly provider: 'google-search-console';
  readonly verified: true;
  readonly siteUrl: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly dimensions?: readonly string[];
  readonly rows: readonly SearchConsoleRow[];
  readonly totals: {
    readonly clicks: number;
    readonly impressions: number;
    readonly ctr: number;
    readonly averagePosition: number;
  };
  readonly intelligence?: SearchConsoleIntelligence;
  readonly provenance: ProvenanceMetadata;
}

/* =========================================================================
 * Real Keyword Research & Provider Types
 * ========================================================================= */

export interface RealKeywordSuggestion {
  readonly keyword: string;
  readonly source: 'google-suggest' | 'gsc-queries' | 'dataforseo' | 'heuristic';
  readonly searchVolume?: number;
  readonly cpcUsd?: number;
  readonly keywordDifficulty?: number;
  readonly intent: SearchIntent;
  readonly category: 'question' | 'comparison' | 'long-tail' | 'autocomplete';
}

export interface RealKeywordResearchReport {
  readonly seedKeyword: string;
  readonly provider: string;
  readonly suggestions: readonly RealKeywordSuggestion[];
  readonly totalSuggestions: number;
  readonly provenance: ProvenanceMetadata;
}

/* =========================================================================
 * Scheduled Rank Tracking Types
 * ========================================================================= */

export interface TrackedKeywordItem {
  readonly id: string;
  readonly domain: string;
  readonly keyword: string;
  readonly targetUrl?: string;
  readonly tags: readonly string[];
  readonly active: boolean;
  readonly createdAt: string;
  readonly latestPosition?: number | null;
  readonly previousPosition?: number | null;
  readonly positionDelta?: number;
  readonly lastCheckedAt?: string;
}

export interface RankSnapshotRecord {
  readonly id: string;
  readonly keywordId: string;
  readonly domain: string;
  readonly keyword: string;
  readonly timestamp: string;
  readonly position: number | null; // null if unranked (not in top 100)
  readonly foundUrl?: string;
  readonly pageTitle?: string;
  readonly serpFeatures?: readonly string[];
}

export interface RankTrackingOverview {
  readonly domain: string;
  readonly totalTrackedKeywords: number;
  readonly averagePosition: number;
  readonly visibilityScore: number; // 0 to 100 weighted visibility
  readonly distribution: {
    readonly top3: number;
    readonly top10: number;
    readonly top20: number;
    readonly top100: number;
    readonly unranked: number;
  };
  readonly winners: readonly {
    readonly keyword: string;
    readonly currentPosition: number;
    readonly previousPosition: number;
    readonly delta: number;
  }[];
  readonly losers: readonly {
    readonly keyword: string;
    readonly currentPosition: number;
    readonly previousPosition: number;
    readonly delta: number;
  }[];
  readonly keywords: readonly TrackedKeywordItem[];
  readonly lastUpdated: string;
  readonly provenance: ProvenanceMetadata;
}
