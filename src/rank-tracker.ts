import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  TrackedKeywordItem,
  RankSnapshotRecord,
  RankTrackingOverview,
  ProvenanceMetadata,
} from './types.js';
import { fetchLiveSerp } from './serp.js';

const DATA_DIR = path.resolve(process.env.OPEN_SEMRUSH_DATA_DIR || path.join(process.cwd(), 'data'));
const RANK_TRACKER_FILE = path.join(DATA_DIR, 'rank_tracker.json');

interface RankTrackerDatabaseSchema {
  trackedKeywords: TrackedKeywordItem[];
  snapshots: RankSnapshotRecord[];
}

function emptyRankTrackerDb(): RankTrackerDatabaseSchema {
  return { trackedKeywords: [], snapshots: [] };
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Reads rank tracking data with fallback to empty state.
 */
function readRankTrackerDb(filePath = RANK_TRACKER_FILE): RankTrackerDatabaseSchema {
  ensureDataDir();
  if (!fs.existsSync(filePath)) {
    return emptyRankTrackerDb();
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<RankTrackerDatabaseSchema>;
    return {
      trackedKeywords: Array.isArray(parsed.trackedKeywords) ? parsed.trackedKeywords : [],
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
    };
  } catch {
    return emptyRankTrackerDb();
  }
}

/**
 * Atomically writes rank tracker state via staging and fsync.
 */
function writeRankTrackerDb(data: RankTrackerDatabaseSchema, filePath = RANK_TRACKER_FILE): void {
  ensureDataDir();
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.rank_tracker.${process.pid}.${randomUUID()}.tmp`);
  const serialized = JSON.stringify(data, null, 2);

  const fd = fs.openSync(tmpPath, 'w', 0o600);
  try {
    fs.writeFileSync(fd, serialized, 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
}

const RANK_TRACKING_PROVENANCE: ProvenanceMetadata = {
  tier: 'empirical_observation',
  isFactual: true,
  dataSource: 'Active Live SERP Rank Engine',
  methodology: 'Scheduled organic SERP rank tracking across top 100 search positions with historical delta auditing',
  confidence: 'high',
};

function normalizeDomain(raw: string): string {
  return raw
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
    .trim();
}

/**
 * Calculates weighted Visibility Index (0 - 100) based on ranking distribution.
 */
export function calculateVisibilityScore(positions: readonly (number | null)[]): number {
  if (positions.length === 0) return 0;
  let totalScore = 0;
  for (const pos of positions) {
    if (pos === null) continue;
    if (pos === 1) totalScore += 100;
    else if (pos === 2) totalScore += 80;
    else if (pos === 3) totalScore += 65;
    else if (pos >= 4 && pos <= 10) totalScore += Math.max(20, 50 - (pos - 4) * 5);
    else if (pos > 10 && pos <= 20) totalScore += 10;
    else if (pos > 20 && pos <= 50) totalScore += 5;
    else if (pos > 50 && pos <= 100) totalScore += 2;
  }
  return Number((totalScore / (positions.length * 100) * 100).toFixed(1));
}

/**
 * Adds a new keyword to track for a target domain.
 */
export function addTrackedKeyword(
  domain: string,
  keyword: string,
  options: { targetUrl?: string; tags?: readonly string[]; dbPath?: string } = {}
): TrackedKeywordItem {
  const cleanDomain = normalizeDomain(domain);
  const cleanKeyword = keyword.trim().toLowerCase();
  if (!cleanDomain) throw new Error('domain must be a valid non-empty string.');
  if (!cleanKeyword) throw new Error('keyword must be a valid non-empty string.');

  const db = readRankTrackerDb(options.dbPath);
  const existing = db.trackedKeywords.find(
    k => k.domain === cleanDomain && k.keyword.toLowerCase() === cleanKeyword
  );
  if (existing) {
    return existing;
  }

  const newItem: TrackedKeywordItem = {
    id: randomUUID(),
    domain: cleanDomain,
    keyword: cleanKeyword,
    targetUrl: options.targetUrl?.trim(),
    tags: options.tags ? [...options.tags] : [],
    active: true,
    createdAt: new Date().toISOString(),
  };

  db.trackedKeywords.push(newItem);
  writeRankTrackerDb(db, options.dbPath);
  return newItem;
}

/**
 * Removes a tracked keyword by ID.
 */
export function removeTrackedKeyword(domain: string, keywordId: string, dbPath?: string): boolean {
  const cleanDomain = normalizeDomain(domain);
  const db = readRankTrackerDb(dbPath);
  const initialCount = db.trackedKeywords.length;
  db.trackedKeywords = db.trackedKeywords.filter(
    k => !(k.domain === cleanDomain && k.id === keywordId)
  );
  if (db.trackedKeywords.length < initialCount) {
    // Also remove associated snapshots
    db.snapshots = db.snapshots.filter(s => s.keywordId !== keywordId);
    writeRankTrackerDb(db, dbPath);
    return true;
  }
  return false;
}

/**
 * Returns all tracked keywords for a given domain.
 */
export function getTrackedKeywords(domain: string, dbPath?: string): readonly TrackedKeywordItem[] {
  const cleanDomain = normalizeDomain(domain);
  const db = readRankTrackerDb(dbPath);
  return db.trackedKeywords.filter(k => k.domain === cleanDomain);
}

/**
 * Polls the current live SERP ranking position for a keyword against a target domain.
 */
export async function pollKeywordRank(
  keyword: string,
  domain: string,
  options: { fetchSerpImpl?: typeof fetchLiveSerp } = {}
): Promise<{
  position: number | null;
  foundUrl?: string;
  pageTitle?: string;
  serpFeatures: string[];
}> {
  const cleanDomain = normalizeDomain(domain);
  const fetchSerp = options.fetchSerpImpl ?? fetchLiveSerp;
  const serpReport = await fetchSerp(keyword);

  const serpFeatures: string[] = [];
  if (serpReport.features.hasFeaturedSnippet) serpFeatures.push('featured_snippet');
  if (serpReport.features.peopleAlsoAsk.length > 0) serpFeatures.push('people_also_ask');
  if (serpReport.features.hasVideoPack) serpFeatures.push('video_pack');
  if (serpReport.features.hasKnowledgePanel) serpFeatures.push('knowledge_panel');

  for (const item of serpReport.topRankings) {
    const itemDomain = normalizeDomain(item.domain || item.url);
    if (itemDomain === cleanDomain || itemDomain.endsWith(`.${cleanDomain}`)) {
      return {
        position: item.position,
        foundUrl: item.url,
        pageTitle: item.title,
        serpFeatures,
      };
    }
  }

  return {
    position: null,
    serpFeatures,
  };
}

/**
 * Runs a batch rank check across all active tracked keywords for a domain and commits snapshots.
 */
export async function runScheduledRankCheck(
  domain: string,
  options: { fetchSerpImpl?: typeof fetchLiveSerp; dbPath?: string } = {}
): Promise<readonly RankSnapshotRecord[]> {
  const cleanDomain = normalizeDomain(domain);
  const db = readRankTrackerDb(options.dbPath);
  const domainKeywords = db.trackedKeywords.filter(k => k.domain === cleanDomain && k.active);

  if (domainKeywords.length === 0) return [];

  const timestamp = new Date().toISOString();
  const createdSnapshots: RankSnapshotRecord[] = [];

  for (const kw of domainKeywords) {
    const rankResult = await pollKeywordRank(kw.keyword, cleanDomain, { fetchSerpImpl: options.fetchSerpImpl });
    const snapshot: RankSnapshotRecord = {
      id: randomUUID(),
      keywordId: kw.id,
      domain: cleanDomain,
      keyword: kw.keyword,
      timestamp,
      position: rankResult.position,
      foundUrl: rankResult.foundUrl,
      pageTitle: rankResult.pageTitle,
      serpFeatures: rankResult.serpFeatures,
    };
    createdSnapshots.push(snapshot);
    db.snapshots.push(snapshot);

    // Update keyword latest and previous positions
    const previousPosition = kw.latestPosition;
    const positionDelta = (previousPosition !== undefined && previousPosition !== null && rankResult.position !== null)
      ? previousPosition - rankResult.position // Positive delta means improved ranking!
      : 0;

    const idx = db.trackedKeywords.findIndex(k => k.id === kw.id);
    if (idx !== -1 && db.trackedKeywords[idx]) {
      db.trackedKeywords[idx] = {
        ...db.trackedKeywords[idx],
        previousPosition: previousPosition ?? undefined,
        latestPosition: rankResult.position,
        positionDelta,
        lastCheckedAt: timestamp,
      };
    }
  }

  writeRankTrackerDb(db, options.dbPath);
  return createdSnapshots;
}

/**
 * Compiles a full Rank Tracking Overview report for a target domain.
 */
export function getRankTrackingOverview(domain: string, dbPath?: string): RankTrackingOverview {
  const cleanDomain = normalizeDomain(domain);
  const db = readRankTrackerDb(dbPath);
  const keywords = db.trackedKeywords.filter(k => k.domain === cleanDomain);

  const rankedPositions = keywords
    .map(k => k.latestPosition)
    .filter((pos): pos is number => typeof pos === 'number' && pos > 0);

  const averagePosition = rankedPositions.length > 0
    ? Number((rankedPositions.reduce((a, b) => a + b, 0) / rankedPositions.length).toFixed(1))
    : 0;

  const visibilityScore = calculateVisibilityScore(keywords.map(k => k.latestPosition ?? null));

  const distribution = {
    top3: 0,
    top10: 0,
    top20: 0,
    top100: 0,
    unranked: 0,
  };

  for (const k of keywords) {
    const pos = k.latestPosition;
    if (pos === null || pos === undefined) distribution.unranked++;
    else if (pos <= 3) distribution.top3++;
    else if (pos <= 10) distribution.top10++;
    else if (pos <= 20) distribution.top20++;
    else if (pos <= 100) distribution.top100++;
    else distribution.unranked++;
  }

  // Identify winners and losers (improved vs dropped)
  const winners: Array<{ keyword: string; currentPosition: number; previousPosition: number; delta: number }> = [];
  const losers: Array<{ keyword: string; currentPosition: number; previousPosition: number; delta: number }> = [];

  for (const k of keywords) {
    if (k.latestPosition && k.previousPosition && k.positionDelta !== undefined) {
      if (k.positionDelta > 0) {
        winners.push({
          keyword: k.keyword,
          currentPosition: k.latestPosition,
          previousPosition: k.previousPosition,
          delta: k.positionDelta,
        });
      } else if (k.positionDelta < 0) {
        losers.push({
          keyword: k.keyword,
          currentPosition: k.latestPosition,
          previousPosition: k.previousPosition,
          delta: k.positionDelta,
        });
      }
    }
  }

  winners.sort((a, b) => b.delta - a.delta);
  losers.sort((a, b) => a.delta - b.delta);

  const latestChecked = keywords
    .map(k => k.lastCheckedAt)
    .filter(Boolean)
    .sort()
    .reverse()[0] || new Date().toISOString();

  return {
    domain: cleanDomain,
    totalTrackedKeywords: keywords.length,
    averagePosition,
    visibilityScore,
    distribution,
    winners,
    losers,
    keywords,
    lastUpdated: latestChecked,
    provenance: RANK_TRACKING_PROVENANCE,
  };
}

/**
 * Returns historical rank snapshots for a specific keyword.
 */
export function getRankHistoryForKeyword(keywordId: string, dbPath?: string): readonly RankSnapshotRecord[] {
  const db = readRankTrackerDb(dbPath);
  return db.snapshots.filter(s => s.keywordId === keywordId).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
