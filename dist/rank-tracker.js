import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fetchLiveSerp } from './serp.js';
const DATA_DIR = path.resolve(process.env.OPEN_SEMRUSH_DATA_DIR || path.join(process.cwd(), 'data'));
const RANK_TRACKER_FILE = path.join(DATA_DIR, 'rank_tracker.json');
function emptyRankTrackerDb() {
    return { trackedKeywords: [], snapshots: [], alerts: [], competitors: {} };
}
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    }
}
/**
 * Reads rank tracking data with fallback to empty state.
 */
function readRankTrackerDb(filePath = RANK_TRACKER_FILE) {
    ensureDataDir();
    if (!fs.existsSync(filePath)) {
        return emptyRankTrackerDb();
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
            trackedKeywords: Array.isArray(parsed.trackedKeywords) ? parsed.trackedKeywords : [],
            snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
            alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
            competitors: parsed.competitors && typeof parsed.competitors === 'object' ? parsed.competitors : {},
        };
    }
    catch {
        return emptyRankTrackerDb();
    }
}
/**
 * Atomically writes rank tracker state via staging and fsync.
 */
function writeRankTrackerDb(data, filePath = RANK_TRACKER_FILE) {
    ensureDataDir();
    const dir = path.dirname(filePath);
    const tmpPath = path.join(dir, `.rank_tracker.${process.pid}.${randomUUID()}.tmp`);
    const serialized = JSON.stringify(data, null, 2);
    const fd = fs.openSync(tmpPath, 'w', 0o600);
    try {
        fs.writeFileSync(fd, serialized, 'utf-8');
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, filePath);
}
const RANK_TRACKING_PROVENANCE = {
    tier: 'empirical_observation',
    isFactual: true,
    dataSource: 'Active Live SERP Rank Engine',
    methodology: 'Scheduled organic SERP rank tracking across top 100 search positions with historical delta auditing',
    confidence: 'high',
};
function normalizeDomain(raw) {
    return raw
        .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
        .replace(/\/.*$/, '')
        .toLowerCase()
        .trim();
}
/**
 * Calculates weighted Visibility Index (0 - 100) based on ranking distribution.
 */
export function calculateVisibilityScore(positions) {
    if (positions.length === 0)
        return 0;
    let totalScore = 0;
    for (const pos of positions) {
        if (pos === null)
            continue;
        if (pos === 1)
            totalScore += 100;
        else if (pos === 2)
            totalScore += 80;
        else if (pos === 3)
            totalScore += 65;
        else if (pos >= 4 && pos <= 10)
            totalScore += Math.max(20, 50 - (pos - 4) * 5);
        else if (pos > 10 && pos <= 20)
            totalScore += 10;
        else if (pos > 20 && pos <= 50)
            totalScore += 5;
        else if (pos > 50 && pos <= 100)
            totalScore += 2;
    }
    return Number((totalScore / (positions.length * 100) * 100).toFixed(1));
}
/**
 * Adds a new keyword to track for a target domain.
 */
export function addTrackedKeyword(domain, keyword, options = {}) {
    const cleanDomain = normalizeDomain(domain);
    const cleanKeyword = keyword.trim().toLowerCase();
    if (!cleanDomain)
        throw new Error('domain must be a valid non-empty string.');
    if (!cleanKeyword)
        throw new Error('keyword must be a valid non-empty string.');
    const db = readRankTrackerDb(options.dbPath);
    const existing = db.trackedKeywords.find(k => k.domain === cleanDomain && k.keyword.toLowerCase() === cleanKeyword);
    if (existing) {
        return existing;
    }
    const newItem = {
        id: randomUUID(),
        domain: cleanDomain,
        keyword: cleanKeyword,
        targetUrl: options.targetUrl?.trim(),
        tags: options.tags ? [...options.tags] : [],
        active: true,
        createdAt: new Date().toISOString(),
        device: options.device ?? 'desktop',
        country: options.country ?? 'us',
        searchEngine: options.searchEngine ?? 'google',
        annotations: [],
    };
    db.trackedKeywords.push(newItem);
    writeRankTrackerDb(db, options.dbPath);
    return newItem;
}
/**
 * Attaches a historical note/annotation to a tracked keyword (e.g. site redesign, core update).
 */
export function addKeywordAnnotation(domain, keywordId, note, date, dbPath) {
    const cleanDomain = normalizeDomain(domain);
    const db = readRankTrackerDb(dbPath);
    const item = db.trackedKeywords.find(k => k.domain === cleanDomain && k.id === keywordId);
    if (!item)
        return false;
    const currentAnnotations = Array.isArray(item.annotations) ? [...item.annotations] : [];
    currentAnnotations.push({
        date: date ?? new Date().toISOString().slice(0, 10),
        note: note.trim(),
    });
    const updatedItem = {
        ...item,
        annotations: currentAnnotations,
    };
    db.trackedKeywords = db.trackedKeywords.map(k => k.id === keywordId ? updatedItem : k);
    writeRankTrackerDb(db, dbPath);
    return true;
}
/**
 * Removes a tracked keyword by ID.
 */
export function removeTrackedKeyword(domain, keywordId, dbPath) {
    const cleanDomain = normalizeDomain(domain);
    const db = readRankTrackerDb(dbPath);
    const initialCount = db.trackedKeywords.length;
    db.trackedKeywords = db.trackedKeywords.filter(k => !(k.domain === cleanDomain && k.id === keywordId));
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
export function getTrackedKeywords(domain, dbPath) {
    const cleanDomain = normalizeDomain(domain);
    const db = readRankTrackerDb(dbPath);
    return db.trackedKeywords.filter(k => k.domain === cleanDomain);
}
/**
 * Adds a competitor domain to track against a target domain.
 */
export function addTrackedCompetitor(domain, competitorDomain, dbPath) {
    const cleanDomain = normalizeDomain(domain);
    const cleanComp = normalizeDomain(competitorDomain);
    const db = readRankTrackerDb(dbPath);
    if (!db.competitors)
        db.competitors = {};
    const list = db.competitors[cleanDomain] || [];
    if (!list.includes(cleanComp)) {
        list.push(cleanComp);
        db.competitors[cleanDomain] = list;
        writeRankTrackerDb(db, dbPath);
    }
}
/**
 * Returns all competitors tracked against a domain.
 */
export function getTrackedCompetitors(domain, dbPath) {
    const cleanDomain = normalizeDomain(domain);
    const db = readRankTrackerDb(dbPath);
    return db.competitors?.[cleanDomain] || [];
}
/**
 * Returns automated ranking volatility alerts for a domain.
 */
export function getRankingAlerts(domain, dbPath) {
    const cleanDomain = normalizeDomain(domain);
    const db = readRankTrackerDb(dbPath);
    return (db.alerts || []).filter(a => a.domain === cleanDomain).reverse();
}
/**
 * Polls the current live SERP ranking position for a keyword against a target domain.
 */
export async function pollKeywordRank(keyword, domain, options = {}) {
    const cleanDomain = normalizeDomain(domain);
    const fetchSerp = options.fetchSerpImpl ?? fetchLiveSerp;
    const serpReport = await fetchSerp(keyword);
    const serpFeatures = [];
    if (serpReport.features.hasFeaturedSnippet)
        serpFeatures.push('featured_snippet');
    if (serpReport.features.peopleAlsoAsk.length > 0)
        serpFeatures.push('people_also_ask');
    if (serpReport.features.hasVideoPack)
        serpFeatures.push('video_pack');
    if (serpReport.features.hasKnowledgePanel)
        serpFeatures.push('knowledge_panel');
    const ownsFeaturedSnippet = Boolean(serpReport.features.hasFeaturedSnippet &&
        serpReport.features.featuredSnippet &&
        normalizeDomain(serpReport.features.featuredSnippet.sourceDomain) === cleanDomain);
    for (const item of serpReport.topRankings) {
        const itemDomain = normalizeDomain(item.domain || item.url);
        if (itemDomain === cleanDomain || itemDomain.endsWith(`.${cleanDomain}`)) {
            return {
                position: item.position,
                foundUrl: item.url,
                pageTitle: item.title,
                serpFeatures,
                ownsFeaturedSnippet,
                ownsSiteLinks: item.position === 1,
            };
        }
    }
    return {
        position: null,
        serpFeatures,
        ownsFeaturedSnippet,
        ownsSiteLinks: false,
    };
}
/**
 * Runs a batch rank check across all active tracked keywords for a domain and commits snapshots.
 */
export async function runScheduledRankCheck(domain, options = {}) {
    const cleanDomain = normalizeDomain(domain);
    const db = readRankTrackerDb(options.dbPath);
    const domainKeywords = db.trackedKeywords.filter(k => k.domain === cleanDomain && k.active);
    if (domainKeywords.length === 0)
        return [];
    const timestamp = new Date().toISOString();
    const createdSnapshots = [];
    if (!db.alerts)
        db.alerts = [];
    for (const kw of domainKeywords) {
        const rankResult = await pollKeywordRank(kw.keyword, cleanDomain, { fetchSerpImpl: options.fetchSerpImpl });
        const snapshot = {
            id: randomUUID(),
            keywordId: kw.id,
            domain: cleanDomain,
            keyword: kw.keyword,
            timestamp,
            position: rankResult.position,
            foundUrl: rankResult.foundUrl,
            pageTitle: rankResult.pageTitle,
            serpFeatures: rankResult.serpFeatures,
            ownsFeaturedSnippet: rankResult.ownsFeaturedSnippet,
            ownsSiteLinks: rankResult.ownsSiteLinks,
        };
        createdSnapshots.push(snapshot);
        db.snapshots.push(snapshot);
        // Update keyword latest and previous positions
        const previousPosition = kw.latestPosition;
        const positionDelta = (previousPosition !== undefined && previousPosition !== null && rankResult.position !== null)
            ? previousPosition - rankResult.position // Positive delta means improved ranking!
            : 0;
        // Generate automated volatility alerts
        if (previousPosition !== undefined && previousPosition !== null && rankResult.position !== null) {
            if (positionDelta <= -5) {
                db.alerts.push({
                    id: randomUUID(),
                    type: 'CRITICAL_DROP',
                    domain: cleanDomain,
                    keyword: kw.keyword,
                    previousPosition,
                    currentPosition: rankResult.position,
                    delta: positionDelta,
                    message: `Rank dropped ${Math.abs(positionDelta)} spots from #${previousPosition} to #${rankResult.position}`,
                    severity: 'critical',
                    timestamp,
                });
            }
            else if (previousPosition > 10 && rankResult.position <= 10) {
                db.alerts.push({
                    id: randomUUID(),
                    type: 'PAGE_ONE_ENTRY',
                    domain: cleanDomain,
                    keyword: kw.keyword,
                    previousPosition,
                    currentPosition: rankResult.position,
                    delta: positionDelta,
                    message: `Breakthrough to Page 1! Entered at rank #${rankResult.position}`,
                    severity: 'success',
                    timestamp,
                });
            }
            else if (rankResult.position === 1 && previousPosition !== 1) {
                db.alerts.push({
                    id: randomUUID(),
                    type: 'RANK_ONE_GAINED',
                    domain: cleanDomain,
                    keyword: kw.keyword,
                    previousPosition,
                    currentPosition: 1,
                    delta: positionDelta,
                    message: `Rank #1 achieved for "${kw.keyword}"!`,
                    severity: 'success',
                    timestamp,
                });
            }
        }
        else if (previousPosition !== undefined && previousPosition !== null && rankResult.position === null) {
            db.alerts.push({
                id: randomUUID(),
                type: 'OUT_OF_INDEX',
                domain: cleanDomain,
                keyword: kw.keyword,
                previousPosition,
                currentPosition: null,
                delta: -100,
                message: `Dropped out of Top 100 search results`,
                severity: 'warning',
                timestamp,
            });
        }
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
export function getRankTrackingOverview(domain, dbPath) {
    const cleanDomain = normalizeDomain(domain);
    const db = readRankTrackerDb(dbPath);
    const keywords = db.trackedKeywords.filter(k => k.domain === cleanDomain);
    const rankedPositions = keywords
        .map(k => k.latestPosition)
        .filter((pos) => typeof pos === 'number' && pos > 0);
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
        if (pos === null || pos === undefined)
            distribution.unranked++;
        else if (pos <= 3)
            distribution.top3++;
        else if (pos <= 10)
            distribution.top10++;
        else if (pos <= 20)
            distribution.top20++;
        else if (pos <= 100)
            distribution.top100++;
        else
            distribution.unranked++;
    }
    // Identify winners and losers (improved vs dropped)
    const winners = [];
    const losers = [];
    for (const k of keywords) {
        if (k.latestPosition && k.previousPosition && k.positionDelta !== undefined) {
            if (k.positionDelta > 0) {
                winners.push({
                    keyword: k.keyword,
                    currentPosition: k.latestPosition,
                    previousPosition: k.previousPosition,
                    delta: k.positionDelta,
                });
            }
            else if (k.positionDelta < 0) {
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
    const domainAlerts = (db.alerts || []).filter(a => a.domain === cleanDomain).slice(-20);
    // Competitor Head-to-Head Comparison
    const trackedComps = db.competitors?.[cleanDomain] || [];
    const competitorComparisons = [];
    for (const comp of trackedComps) {
        const compKeywords = db.trackedKeywords.filter(k => k.domain === comp);
        let targetHigher = 0;
        let compHigher = 0;
        let tied = 0;
        for (const kw of keywords) {
            const compKw = compKeywords.find(ck => ck.keyword.toLowerCase() === kw.keyword.toLowerCase());
            if (!compKw || kw.latestPosition === null || kw.latestPosition === undefined)
                continue;
            if (compKw.latestPosition === null || compKw.latestPosition === undefined) {
                targetHigher++;
            }
            else if (kw.latestPosition < compKw.latestPosition) {
                targetHigher++;
            }
            else if (kw.latestPosition > compKw.latestPosition) {
                compHigher++;
            }
            else {
                tied++;
            }
        }
        const totalCompared = targetHigher + compHigher + tied;
        const winRate = totalCompared > 0 ? Number((targetHigher / totalCompared).toFixed(2)) : 0.5;
        competitorComparisons.push({
            competitorDomain: comp,
            winRate,
            targetHigherCount: targetHigher,
            competitorHigherCount: compHigher,
            tiedCount: tied,
        });
    }
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
        alerts: domainAlerts,
        competitorComparisons,
        provenance: RANK_TRACKING_PROVENANCE,
    };
}
/**
 * Returns historical rank snapshots for a specific keyword.
 */
export function getRankHistoryForKeyword(keywordId, dbPath) {
    const db = readRankTrackerDb(dbPath);
    return db.snapshots.filter(s => s.keywordId === keywordId).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
