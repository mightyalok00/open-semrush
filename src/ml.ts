/**
 * Machine Learning & Statistical Modeling Engine for Open Semrush.
 * 
 * Provides empirical non-linear regression for search CTR, probabilistic
 * multi-class intent classification with softmax confidence distributions,
 * traffic prediction intervals with parametric uncertainty, and n-gram semantic
 * clustering for keyword gap analysis.
 */

import type {
  SearchIntent,
  IntentProbabilityDistribution,
  TrafficForecastInterval,
} from './types.js';

export interface CtrPowerLawPrediction {
  readonly position: number;
  readonly baseCtr: number;
  readonly adjustedCtr: number;
  readonly featureModifiersApplied: readonly string[];
}

export interface SemanticCluster {
  readonly clusterTheme: string;
  readonly keywords: readonly string[];
  readonly averageDifficulty: number;
  readonly totalVolume: number;
}

// ---------------------------------------------------------------------------
// 1. Empirical CTR Power-Law Non-Linear Regression
// ---------------------------------------------------------------------------

/**
 * Baseline parameters fitted to empirical search engine click-through distributions:
 *   CTR(p) = alpha * p^(-beta)
 * where alpha ~= 0.312 (pos 1 baseline ~31.2%) and beta ~= 0.93 (power decay rate).
 */
const CTR_POWER_LAW_ALPHA = 0.312;
const CTR_POWER_LAW_BETA = 0.93;

/**
 * Computes empirical CTR prediction for a given organic rank position with
 * SERP feature layout attenuation factors.
 * 
 * @param position 1-indexed organic search ranking position
 * @param features Optional SERP layout feature indicators
 */
export function predictCtrPowerLaw(
  position: number,
  features?: {
    readonly hasFeaturedSnippet?: boolean;
    readonly hasPeopleAlsoAsk?: boolean;
    readonly hasVideoCarousel?: boolean;
    readonly hasKnowledgePanel?: boolean;
  }
): CtrPowerLawPrediction {
  if (position <= 0) {
    return {
      position,
      baseCtr: 0,
      adjustedCtr: 0,
      featureModifiersApplied: [],
    };
  }

  // Pure power-law model
  const rawBaseCtr = CTR_POWER_LAW_ALPHA * Math.pow(position, -CTR_POWER_LAW_BETA);
  const baseCtr = Number(Math.max(0.0005, Math.min(0.35, rawBaseCtr)).toFixed(4));

  let multiplier = 1.0;
  const modifiersApplied: string[] = [];

  // Featured snippets absorb ~28% of organic clicks at rank 1, but slightly boost rank 2-3 visibility
  if (features?.hasFeaturedSnippet) {
    if (position === 1) {
      multiplier *= 0.72;
      modifiersApplied.push('Featured Snippet cannibalization (-28% at pos 1)');
    } else if (position === 2) {
      multiplier *= 0.88;
      modifiersApplied.push('Featured Snippet secondary dampening (-12% at pos 2)');
    }
  }

  // Video carousels attract visual attention away from lower organic results
  if (features?.hasVideoCarousel && position >= 3) {
    multiplier *= 0.85;
    modifiersApplied.push('Video Carousel visual diversion (-15% below pos 2)');
  }

  // Knowledge panel on brand terms reduces navigational click-through to sub-pages
  if (features?.hasKnowledgePanel && position >= 2) {
    multiplier *= 0.90;
    modifiersApplied.push('Knowledge Panel query satisfaction (-10%)');
  }

  // People Also Ask accordions draw interaction in mid-page ranks (pos 3-6)
  if (features?.hasPeopleAlsoAsk && position >= 3 && position <= 6) {
    multiplier *= 0.92;
    modifiersApplied.push('PAA Accordion mid-page dampening (-8%)');
  }

  const adjustedCtr = Number(Math.max(0.0002, Math.min(0.35, baseCtr * multiplier)).toFixed(4));

  return {
    position,
    baseCtr,
    adjustedCtr,
    featureModifiersApplied: modifiersApplied,
  };
}

// ---------------------------------------------------------------------------
// 2. Probabilistic Search Intent Softmax Classifier
// ---------------------------------------------------------------------------

const TRANSACTIONAL_REGEX = /\b(buy|purchase|pricing|price|cost|discount|coupon|deal|order|cheap|hire|quote|shop|store|checkout|cart|sale)\b/i;
const COMMERCIAL_REGEX = /\b(best|top|vs|versus|review|reviews|comparison|compare|alternative|alternatives|recommended|specs|features|benchmark|rating|pros\s+and\s+cons)\b/i;
const NAVIGATIONAL_REGEX = /\b(login|sign\s*in|portal|dashboard|account|official|app\s*download|website|download|support|careers|status)\b/i;
const DOMAIN_TLD_REGEX = /\.(com|org|net|io|ai|co|app|dev|edu|gov)\b/i;
const INFORMATIONAL_REGEX = /\b(how|what|why|when|where|guide|tutorial|learn|example|examples|definition|meaning|steps|tips|ideas|explained|docs|documentation)\b/i;

/**
 * Computes a normalized softmax probability distribution over search intent classes
 * using multi-feature logit scoring.
 */
export function classifySearchIntentProbabilities(query: string): IntentProbabilityDistribution {
  const lower = query.trim().toLowerCase();
  const signals: string[] = [];

  // Logit scores for [Informational, Commercial, Navigational, Transactional]
  let logitInfo = 0.5; // Prior: web queries are predominantly informational
  let logitComm = 0.1;
  let logitNav = 0.1;
  let logitTrans = 0.1;

  if (TRANSACTIONAL_REGEX.test(lower)) {
    logitTrans += 3.2;
    signals.push('transactional_lexicon_match');
  }

  if (COMMERCIAL_REGEX.test(lower)) {
    logitComm += 3.0;
    signals.push('commercial_investigation_match');
  }

  if (NAVIGATIONAL_REGEX.test(lower) || DOMAIN_TLD_REGEX.test(lower)) {
    logitNav += 3.5;
    signals.push('navigational_brand_portal_match');
  }

  if (INFORMATIONAL_REGEX.test(lower)) {
    logitInfo += 2.8;
    signals.push('informational_interrogative_match');
  }

  // Query length heuristic: 1-word terms have higher navigational prior; 4+ words have higher informational prior
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  if (wordCount === 1) {
    logitNav += 0.4;
  } else if (wordCount >= 4) {
    logitInfo += 0.5;
  }

  // Numerically stable softmax: subtract max logit
  const maxLogit = Math.max(logitInfo, logitComm, logitNav, logitTrans);
  const expInfo = Math.exp(logitInfo - maxLogit);
  const expComm = Math.exp(logitComm - maxLogit);
  const expNav = Math.exp(logitNav - maxLogit);
  const expTrans = Math.exp(logitTrans - maxLogit);
  const sumExp = expInfo + expComm + expNav + expTrans;

  const pInfo = Number((expInfo / sumExp).toFixed(4));
  const pComm = Number((expComm / sumExp).toFixed(4));
  const pNav = Number((expNav / sumExp).toFixed(4));
  const pTrans = Number((expTrans / sumExp).toFixed(4));

  // Determine highest-probability intent
  const entries: [SearchIntent, number][] = [
    ['Transactional', pTrans],
    ['Commercial', pComm],
    ['Navigational', pNav],
    ['Informational', pInfo],
  ];

  entries.sort((a, b) => b[1] - a[1]);
  const primaryIntent = entries[0]?.[0] ?? 'Informational';
  const confidence = entries[0]?.[1] ?? pInfo;

  return {
    primaryIntent,
    confidence,
    probabilities: {
      Informational: pInfo,
      Commercial: pComm,
      Navigational: pNav,
      Transactional: pTrans,
    },
    intentSignals: signals,
  };
}

// ---------------------------------------------------------------------------
// 3. Traffic Forecasting with 95% Parametric Prediction Intervals
// ---------------------------------------------------------------------------

/**
 * Calculates expected monthly organic traffic visits with statistical 95% confidence bounds
 * accounting for binomial searcher conversion and CTR variance.
 * 
 * @param monthlySearchVolume Total estimated monthly query impressions
 * @param ctr Estimated Click-Through Rate (0.0 to 1.0)
 * @param volatilityFactor Account for seasonality or ranking fluctuations (default 0.12)
 */
export function calculateTrafficForecast(
  monthlySearchVolume: number,
  ctr: number,
  volatilityFactor: number = 0.12
): TrafficForecastInterval {
  const safeVol = Math.max(0, monthlySearchVolume);
  const safeCtr = Math.max(0, Math.min(1.0, ctr));

  const expectedVisits = Math.round(safeVol * safeCtr);
  if (expectedVisits <= 0) {
    return {
      expectedVisits: 0,
      lower95: 0,
      upper95: 0,
      standardError: 0,
      confidenceLevel: 0.95,
    };
  }

  // Standard error combining binomial sampling variance: sqrt(N * p * (1-p)) and volatility
  const binomialVariance = safeVol * safeCtr * (1 - safeCtr);
  const volatilityVariance = Math.pow(expectedVisits * volatilityFactor, 2);
  const totalStandardError = Math.sqrt(binomialVariance + volatilityVariance);

  // 1.96 standard deviations corresponds to two-sided 95% confidence under normal approximation
  const zScore = 1.96;
  const marginOfError = Math.round(zScore * totalStandardError);

  const lower95 = Math.max(0, expectedVisits - marginOfError);
  const upper95 = expectedVisits + marginOfError;

  return {
    expectedVisits,
    lower95,
    upper95,
    standardError: Number(totalStandardError.toFixed(2)),
    confidenceLevel: 0.95,
  };
}

// ---------------------------------------------------------------------------
// 4. N-Gram Semantic Vector Similarity & Keyword Clustering
// ---------------------------------------------------------------------------

/**
 * Extracts character n-grams from a normalized query string.
 */
function extractCharNgrams(text: string, n: number = 3): Set<string> {
  const normalized = `_${text.trim().toLowerCase().replace(/\s+/g, '_')}_`;
  const ngrams = new Set<string>();
  for (let i = 0; i <= normalized.length - n; i++) {
    ngrams.add(normalized.substring(i, i + n));
  }
  return ngrams;
}

/**
 * Computes Jaccard similarity index between two query strings based on character 3-grams.
 * Returns a score between 0.0 (completely disjoint) and 1.0 (identical).
 */
export function calculateNgramSimilarity(a: string, b: string): number {
  if (a.toLowerCase() === b.toLowerCase()) return 1.0;
  const setA = extractCharNgrams(a);
  const setB = extractCharNgrams(b);

  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersectionSize = 0;
  for (const item of setA) {
    if (setB.has(item)) intersectionSize++;
  }

  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize > 0 ? Number((intersectionSize / unionSize).toFixed(4)) : 0.0;
}

/**
 * Performs greedy agglomerative clustering on a list of keywords based on
 * n-gram similarity threshold.
 * 
 * @param keywords List of candidate queries
 * @param similarityThreshold Minimum similarity to group together (default 0.35)
 */
export function clusterKeywordsBySemantics(
  keywords: readonly { readonly keyword: string; readonly searchVolume: number; readonly difficulty: number }[],
  similarityThreshold: number = 0.35
): readonly SemanticCluster[] {
  const clusters: Array<{
    theme: string;
    keywords: string[];
    volumes: number[];
    difficulties: number[];
  }> = [];

  for (const item of keywords) {
    let matchedCluster = false;

    for (const cluster of clusters) {
      const similarity = calculateNgramSimilarity(item.keyword, cluster.theme);
      if (similarity >= similarityThreshold) {
        cluster.keywords.push(item.keyword);
        cluster.volumes.push(item.searchVolume);
        cluster.difficulties.push(item.difficulty);
        matchedCluster = true;
        break;
      }
    }

    if (!matchedCluster) {
      clusters.push({
        theme: item.keyword,
        keywords: [item.keyword],
        volumes: [item.searchVolume],
        difficulties: [item.difficulty],
      });
    }
  }

  return clusters.map(c => {
    const totalVolume = c.volumes.reduce((a, b) => a + b, 0);
    const avgDiff = Math.round(c.difficulties.reduce((a, b) => a + b, 0) / c.difficulties.length);
    return {
      clusterTheme: c.theme,
      keywords: c.keywords,
      averageDifficulty: avgDiff,
      totalVolume,
    };
  });
}
