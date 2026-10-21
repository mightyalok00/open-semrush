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
}

export type SearchIntent = 'Informational' | 'Navigational' | 'Commercial' | 'Transactional';

export interface KeywordMetrics {
  readonly keyword: string;
  readonly searchVolume: number;
  readonly keywordDifficulty: number; // 0 to 100
  readonly intent: SearchIntent;
  readonly cpcUsd: number;
  readonly competitiveDensity: number; // 0.0 to 1.0
  readonly seasonalityTrend: readonly number[]; // 12 months relative interest (0 - 100)
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
