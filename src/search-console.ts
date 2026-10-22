import type {
  SearchConsoleReport,
  SearchConsoleRow,
  SearchConsoleSite,
  SearchConsoleIntelligence,
  StrikingDistanceQuery,
  CannibalizationIssue,
  CtrOpportunity,
  ProvenanceMetadata,
} from './types.js';
import { predictCtrPowerLaw } from './ml.js';

type FetchLike = typeof fetch;

export interface SearchConsoleOptions {
  readonly siteUrl: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly dimensions?: readonly ('query' | 'page' | 'device' | 'country' | 'date')[];
  readonly query?: string;
  readonly pageFilter?: string;
  readonly countryFilter?: string;
  readonly deviceFilter?: 'DESKTOP' | 'MOBILE' | 'TABLET';
  readonly rowLimit?: number;
  readonly startRow?: number;
  readonly includeIntelligence?: boolean;
  readonly accessToken?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly refreshToken?: string;
  readonly fetchImpl?: FetchLike;
}

export interface ListSitesOptions {
  readonly accessToken?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly refreshToken?: string;
  readonly fetchImpl?: FetchLike;
}

function validDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v + 'T00:00:00Z')) &&
    new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
}

async function getToken(
  o: { accessToken?: string; clientId?: string; clientSecret?: string; refreshToken?: string },
  f: FetchLike
): Promise<string> {
  if (o.accessToken) return o.accessToken;
  if (!o.clientId || !o.clientSecret || !o.refreshToken) {
    throw new Error(
      'Google Search Console is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REFRESH_TOKEN, or GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN for a short-lived token.'
    );
  }
  const body = new URLSearchParams({
    client_id: o.clientId,
    client_secret: o.clientSecret,
    refresh_token: o.refreshToken,
    grant_type: 'refresh_token',
  });
  const r = await f('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    throw new Error(`Google OAuth token refresh failed with HTTP ${r.status}.`);
  }
  const d = await r.json() as { access_token?: unknown };
  if (typeof d.access_token !== 'string' || !d.access_token) {
    throw new Error('Google OAuth response did not contain an access token.');
  }
  return d.access_token;
}

/**
 * Lists all verified web properties in the authenticated Google Search Console account.
 */
export async function listSearchConsoleSites(options: ListSitesOptions): Promise<readonly SearchConsoleSite[]> {
  const f = options.fetchImpl ?? fetch;
  const token = await getToken(options, f);
  const endpoint = 'https://www.googleapis.com/webmasters/v3/sites';
  const r = await f(endpoint, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) {
    throw new Error(`Google Search Console sites API returned HTTP ${r.status}.`);
  }
  const data = await r.json() as { siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> };
  return (data.siteEntry ?? []).map(s => ({
    siteUrl: String(s.siteUrl ?? ''),
    permissionLevel: String(s.permissionLevel ?? 'siteUser'),
  })).filter(s => Boolean(s.siteUrl));
}

/**
 * Computes deep SEO intelligence from Search Console query/page rows:
 * - Striking distance keywords (positions 11-20 with high impression volume)
 * - Keyword cannibalization (queries where multiple pages compete)
 * - CTR opportunity gaps (actual CTR significantly underperforming power-law model)
 */
export function computeSearchConsoleIntelligence(rows: readonly SearchConsoleRow[]): SearchConsoleIntelligence {
  const strikingDistanceQueries: StrikingDistanceQuery[] = [];
  const queryPageMap = new Map<string, Array<{ page: string; clicks: number; impressions: number; position: number }>>();
  const ctrOpportunities: CtrOpportunity[] = [];

  for (const row of rows) {
    const query = row.query ?? '';
    const pos = row.position;
    const imp = row.impressions;
    const ctr = row.ctr;

    // 1. Striking Distance: rank 10.5 to 20.0 (Page 2) with >= 20 impressions
    if (query && pos >= 10.5 && pos <= 20.0 && imp >= 20) {
      // Opportunity score scales with impressions and proximity to position 10
      const opportunityScore = Math.round(imp * (21 - pos) * 0.1);
      strikingDistanceQueries.push({
        query,
        impressions: imp,
        clicks: row.clicks,
        ctr,
        position: Number(pos.toFixed(1)),
        ...(row.page ? { page: row.page } : {}),
        opportunityScore,
      });
    }

    // 2. Track query -> pages for cannibalization detection
    if (query && row.page) {
      const existing = queryPageMap.get(query) ?? [];
      existing.push({ page: row.page, clicks: row.clicks, impressions: imp, position: pos });
      queryPageMap.set(query, existing);
    }

    // 3. CTR Opportunity: high impressions, underperforming expected CTR
    if (query && imp >= 50 && pos >= 1 && pos <= 10) {
      const expected = predictCtrPowerLaw(pos).adjustedCtr;
      const ctrGap = expected - ctr;
      if (ctrGap >= 0.03) {
        const potentialExtraClicks = Math.round(imp * ctrGap);
        ctrOpportunities.push({
          query,
          ...(row.page ? { page: row.page } : {}),
          impressions: imp,
          actualCtr: Number(ctr.toFixed(4)),
          expectedCtr: Number(expected.toFixed(4)),
          ctrGap: Number(ctrGap.toFixed(4)),
          potentialExtraClicks,
        });
      }
    }
  }

  // Sort striking distance by highest opportunity score
  strikingDistanceQueries.sort((a, b) => b.opportunityScore - a.opportunityScore);

  // Identify cannibalization where >= 2 distinct URLs each get meaningful impressions (>= 10)
  const cannibalizationIssues: CannibalizationIssue[] = [];
  for (const [q, pages] of queryPageMap.entries()) {
    if (pages.length >= 2) {
      const meaningfulPages = pages.filter(p => p.impressions >= 10);
      if (meaningfulPages.length >= 2) {
        const totalClicks = pages.reduce((sum, p) => sum + p.clicks, 0);
        const totalImpressions = pages.reduce((sum, p) => sum + p.impressions, 0);
        cannibalizationIssues.push({
          query: q,
          competingPages: pages.map(p => ({
            page: p.page,
            clicks: p.clicks,
            impressions: p.impressions,
            averagePosition: Number(p.position.toFixed(1)),
          })),
          totalClicks,
          totalImpressions,
        });
      }
    }
  }
  cannibalizationIssues.sort((a, b) => b.totalImpressions - a.totalImpressions);

  // Sort CTR opportunities by potential extra clicks
  ctrOpportunities.sort((a, b) => b.potentialExtraClicks - a.potentialExtraClicks);

  return {
    strikingDistanceQueries: strikingDistanceQueries.slice(0, 50),
    cannibalizationIssues: cannibalizationIssues.slice(0, 25),
    ctrOpportunities: ctrOpportunities.slice(0, 50),
  };
}

/**
 * Fetches verified first-party Search Console telemetry from Google's official Search Analytics API.
 */
export async function fetchSearchConsoleReport(o: SearchConsoleOptions): Promise<SearchConsoleReport> {
  const { siteUrl, startDate, endDate } = o;
  if (!siteUrl || (!siteUrl.startsWith('sc-domain:') && !/^https?:\/\/[^/]+\/?$/i.test(siteUrl))) {
    throw new Error('siteUrl must be a Search Console URL-prefix property or sc-domain: property.');
  }
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    throw new Error('startDate and endDate must be valid YYYY-MM-DD dates with startDate no later than endDate.');
  }

  const f = o.fetchImpl ?? fetch;
  const token = await getToken(o, f);
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

  const dimensions = o.dimensions && o.dimensions.length > 0 ? o.dimensions : ['query'];
  const rowLimit = o.rowLimit ? Math.min(25000, Math.max(1, o.rowLimit)) : 25000;

  const filters: Array<{ dimension: string; operator: string; expression: string }> = [];
  if (o.query?.trim()) {
    filters.push({ dimension: 'query', operator: 'contains', expression: o.query.trim() });
  }
  if (o.pageFilter?.trim()) {
    filters.push({ dimension: 'page', operator: 'contains', expression: o.pageFilter.trim() });
  }
  if (o.countryFilter?.trim()) {
    filters.push({ dimension: 'country', operator: 'equals', expression: o.countryFilter.trim().toLowerCase() });
  }
  if (o.deviceFilter) {
    filters.push({ dimension: 'device', operator: 'equals', expression: o.deviceFilter });
  }

  const body: Record<string, unknown> = {
    startDate,
    endDate,
    dimensions,
    rowLimit,
    dataState: 'final',
  };
  if (o.startRow && o.startRow > 0) {
    body.startRow = o.startRow;
  }
  if (filters.length > 0) {
    body.dimensionFilterGroups = [{ filters }];
  }

  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };

  const r = await f(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!r.ok) {
    throw new Error(`Google Search Console API returned HTTP ${r.status}. Confirm the property and OAuth permission.`);
  }

  const p = await r.json() as {
    rows?: Array<{
      keys?: string[];
      clicks?: number;
      impressions?: number;
      ctr?: number;
      position?: number;
    }>;
  };

  const rows: SearchConsoleRow[] = (p.rows ?? []).map(x => {
    const rowObj: Record<string, unknown> = {
      clicks: Number(x.clicks ?? 0),
      impressions: Number(x.impressions ?? 0),
      ctr: Number(x.ctr ?? 0),
      position: Number(x.position ?? 0),
    };
    if (x.keys) {
      dimensions.forEach((dim, idx) => {
        if (x.keys && x.keys[idx] !== undefined) {
          rowObj[dim] = String(x.keys[idx]);
        }
      });
    }
    return rowObj as unknown as SearchConsoleRow;
  }).filter(x => [x.clicks, x.impressions, x.ctr, x.position].every(Number.isFinite));

  // Fetch verified overall totals
  const totalsBody: Record<string, unknown> = {
    startDate,
    endDate,
    dataState: 'final',
  };
  if (filters.length > 0) {
    totalsBody.dimensionFilterGroups = [{ filters }];
  }

  const tr = await f(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(totalsBody),
    signal: AbortSignal.timeout(15000),
  });

  if (!tr.ok) {
    throw new Error(`Google Search Console totals request returned HTTP ${tr.status}. Confirm the property and OAuth permission.`);
  }

  const tp = await tr.json() as {
    rows?: Array<{
      clicks?: number;
      impressions?: number;
      ctr?: number;
      position?: number;
    }>;
  };
  const total = tp.rows?.[0];

  // Optional intelligence calculations
  const shouldComputeIntelligence = o.includeIntelligence !== false && dimensions.includes('query');
  const intelligence = shouldComputeIntelligence ? computeSearchConsoleIntelligence(rows) : undefined;

  const provenance: ProvenanceMetadata = {
    tier: 'verified_provider',
    isFactual: true,
    dataSource: 'Google Search Console Search Analytics API',
    methodology: 'First-party Google OAuth2 telemetry with empirical ML CTR comparison',
    confidence: 'exact',
  };

  return {
    provider: 'google-search-console',
    verified: true,
    siteUrl,
    startDate,
    endDate,
    dimensions,
    rows,
    totals: {
      clicks: Number(total?.clicks ?? 0),
      impressions: Number(total?.impressions ?? 0),
      ctr: Number(total?.ctr ?? 0),
      averagePosition: Number(total?.position ?? 0),
    },
    ...(intelligence ? { intelligence } : {}),
    provenance,
  };
}

/**
 * Extracts normalized, chronologically sorted daily observations from a SearchConsoleReport
 * that was fetched with 'date' in its dimensions.
 */
export function extractDailyObservations(
  report: SearchConsoleReport
): import('./types.js').DailyObservation[] {
  const dims = report.dimensions ?? [];
  const dateDimIdx = dims.indexOf('date');
  if (dateDimIdx === -1 && !report.rows.some(r => r.date)) {
    return [];
  }

  const byDate = new Map<string, { clicks: number; impressions: number; positionSum: number; count: number }>();

  for (const row of report.rows) {
    const rawKeys = (row as unknown as { keys?: string[] }).keys;
    const d = row.date ?? (Array.isArray(rawKeys) && dateDimIdx >= 0 ? rawKeys[dateDimIdx] : undefined);
    if (!d || !validDate(d)) continue;

    const existing = byDate.get(d) ?? { clicks: 0, impressions: 0, positionSum: 0, count: 0 };
    existing.clicks += row.clicks;
    existing.impressions += row.impressions;
    existing.positionSum += row.position * (row.impressions || 1);
    existing.count += row.impressions || 1;
    byDate.set(d, existing);
  }

  const result: import('./types.js').DailyObservation[] = [];
  for (const [date, acc] of byDate.entries()) {
    const ctr = acc.impressions > 0 ? Number((acc.clicks / acc.impressions).toFixed(4)) : 0;
    const avgPos = acc.count > 0 ? Number((acc.positionSum / acc.count).toFixed(2)) : 0;
    result.push({
      date,
      clicks: acc.clicks,
      impressions: acc.impressions,
      ctr,
      averagePosition: avgPos,
    });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

