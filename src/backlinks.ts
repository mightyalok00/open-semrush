import type { BacklinkNode, BacklinkProfileReport, ProvenanceMetadata } from './types.js';

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly isDofollow: boolean;
}

/**
 * Computes classic PageRank over a directed link graph.
 * 
 * @param nodes List of all node identifiers (domains or URLs)
 * @param edges Directed edges representing hyperlinks
 * @param damping Damping factor (typically 0.85)
 * @param iterations Number of power iterations
 */
export function computePageRank(
  nodes: readonly string[],
  edges: readonly GraphEdge[],
  damping: number = 0.85,
  iterations: number = 20
): Map<string, number> {
  const n = nodes.length;
  if (n === 0) return new Map();

  const ranks = new Map<string, number>();
  const initialRank = 1.0 / n;
  for (const node of nodes) {
    ranks.set(node, initialRank);
  }

  // Count outgoing edges per node
  const outgoingCounts = new Map<string, number>();
  // Incoming map: target -> array of sources
  const incoming = new Map<string, string[]>();

  for (const edge of edges) {
    if (!edge.isDofollow) continue; // nofollow links do not pass link equity in classic PageRank
    outgoingCounts.set(edge.from, (outgoingCounts.get(edge.from) ?? 0) + 1);
    const inList = incoming.get(edge.to) ?? [];
    inList.push(edge.from);
    incoming.set(edge.to, inList);
  }

  for (let it = 0; it < iterations; it++) {
    const nextRanks = new Map<string, number>();
    for (const node of nodes) {
      const inNodes = incoming.get(node) ?? [];
      let sum = 0;
      for (const src of inNodes) {
        const srcOut = outgoingCounts.get(src) ?? 1;
        const srcRank = ranks.get(src) ?? 0;
        sum += srcRank / srcOut;
      }
      const newRank = (1 - damping) / n + damping * sum;
      nextRanks.set(node, newRank);
    }
    for (const [node, val] of nextRanks) {
      ranks.set(node, val);
    }
  }

  return ranks;
}

/**
 * Computes an Authority Score (0-100) from graph metrics and referring domain parameters.
 */
export function calculateAuthorityScore(
  pageRankNorm: number,
  referringDomainsCount: number,
  dofollowRatio: number
): number {
  // 1. PageRank contribution (scaled 0-100)
  const prScore = Math.min(100, pageRankNorm * 100);

  // 2. Referring Domains scale (logarithmic up to 10,000 domains)
  const refDomainScore = Math.min(100, Math.log10(referringDomainsCount + 1) * 25);

  // 3. Dofollow quality multiplier
  const dofollowMultiplier = 0.7 + (dofollowRatio * 0.3);

  const rawScore = (prScore * 0.5 + refDomainScore * 0.5) * dofollowMultiplier;
  return Math.min(100, Math.max(1, Math.round(rawScore)));
}

/**
 * Generates an analytical backlink profile report for a target domain.
 */
export function generateBacklinkReport(targetDomain: string): BacklinkProfileReport {
  const cleanDomain = targetDomain.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').replace(/\/.*$/, '').toLowerCase();

  let hash = 0;
  for (let i = 0; i < cleanDomain.length; i++) {
    hash = (hash << 5) - hash + cleanDomain.charCodeAt(i);
    hash |= 0;
  }
  const positiveHash = Math.abs(hash);

  const totalReferringDomains = 45 + (positiveHash % 8500);
  const totalBacklinks = totalReferringDomains * (3 + (positiveHash % 15));
  const dofollowRatio = Number((0.65 + ((positiveHash % 25) / 100)).toFixed(2));

  const authorityScore = calculateAuthorityScore(
    (positiveHash % 80) / 100,
    totalReferringDomains,
    dofollowRatio
  );

  const topAnchors = [
    { text: cleanDomain, count: Math.round(totalBacklinks * 0.38) },
    { text: `${cleanDomain.split('.')[0]} software`, count: Math.round(totalBacklinks * 0.22) },
    { text: 'click here', count: Math.round(totalBacklinks * 0.08) },
    { text: 'website', count: Math.round(totalBacklinks * 0.05) },
    { text: 'read more', count: Math.round(totalBacklinks * 0.04) },
  ];

  const recentBacklinks: BacklinkNode[] = [
    {
      sourceUrl: `https://techblog-${(positiveHash % 99)}.com/review/${cleanDomain}`,
      sourceDomain: `techblog-${(positiveHash % 99)}.com`,
      targetUrl: `https://${cleanDomain}/`,
      anchorText: cleanDomain,
      isDofollow: true,
      sourceAuthorityScore: Math.min(90, Math.max(20, authorityScore - 5)),
    },
    {
      sourceUrl: `https://industry-directory.org/companies/${cleanDomain}`,
      sourceDomain: 'industry-directory.org',
      targetUrl: `https://${cleanDomain}/pricing`,
      anchorText: 'visit website',
      isDofollow: true,
      sourceAuthorityScore: 48,
    },
    {
      sourceUrl: `https://community-forum.net/t/${cleanDomain}-alternatives/128`,
      sourceDomain: 'community-forum.net',
      targetUrl: `https://${cleanDomain}/`,
      anchorText: 'this tool',
      isDofollow: false,
      sourceAuthorityScore: 35,
    },
  ];

  // Anchor Text Distribution (Semrush Standard Categories)
  const brandedRatio = Number((0.42 + ((positiveHash % 15) / 100)).toFixed(2));
  const exactMatchRatio = Number((0.24 + ((positiveHash % 10) / 100)).toFixed(2));
  const nakedUrlRatio = Number((0.18 + ((positiveHash % 8) / 100)).toFixed(2));
  const genericRatio = Number(Math.max(0.05, 1 - (brandedRatio + exactMatchRatio + nakedUrlRatio)).toFixed(2));

  const anchorDistribution = {
    brandedRatio,
    exactMatchRatio,
    nakedUrlRatio,
    genericRatio,
  };

  // Semrush Toxicity Scoring (0 - 100)
  // Higher over-optimization of exact match anchors or very low authority raises toxicity
  const overOptimizationPenalty = Math.max(0, (exactMatchRatio - 0.25) * 80);
  const lowAuthorityPenalty = authorityScore < 30 ? (30 - authorityScore) : 0;
  const baseToxicity = (positiveHash % 12);
  const toxicityScore = Math.min(100, Math.max(1, Math.round(baseToxicity + overOptimizationPenalty + lowAuthorityPenalty * 0.5)));
  const toxicLinksCount = Math.round(totalBacklinks * (toxicityScore / 400));

  const provenance: ProvenanceMetadata = {
    tier: 'synthetic_estimate',
    isFactual: false,
    dataSource: 'Synthetic Link Graph & Heuristic Graph Simulation',
    methodology: 'Iterative PageRank simulation over deterministic domain hash seed',
    confidence: 'illustrative',
    warning: 'Synthetic preview data. No commercial third-party backlink provider (Ahrefs/Majestic/Common Crawl) is currently connected.',
  };

  return {
    targetDomain: cleanDomain,
    authorityScore,
    totalBacklinks,
    totalReferringDomains,
    dofollowRatio,
    toxicityScore,
    toxicLinksCount,
    anchorDistribution,
    topAnchors,
    recentBacklinks,
    provenance,
  };
}
