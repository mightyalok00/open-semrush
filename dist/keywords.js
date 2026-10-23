import { classifySearchIntentProbabilities, predictCtrPowerLaw, calculateTrafficForecast, } from './ml.js';
export const KEYWORD_HEURISTIC_PROVENANCE = {
    tier: 'statistical_model',
    isFactual: false,
    dataSource: 'Lexical Intent Classifier & Statistical CTR Regression',
    methodology: 'Softmax intent probability distribution and empirical power-law volume decay modeling',
    confidence: 'modeled',
    warning: 'Modeled search volume and CPC. Use real keyword provider or Google Search Console for verified query data.',
};
/**
 * Classifies search intent into Informational, Navigational, Commercial, or Transactional
 * using a softmax probability distribution over lexical and structural signals.
 */
export function classifySearchIntent(keyword) {
    return classifySearchIntentProbabilities(keyword).primaryIntent;
}
/**
 * Calculates Semrush-style Keyword Difficulty (KD%) on a 0-100 scale.
 */
export function calculateKeywordDifficulty(query, topCompetitorAuthorityScores = [], topCompetitorReferringDomains = []) {
    const words = query.trim().split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    if (wordCount === 0)
        return 0;
    // 1. Long-tail vs Head term penalty: 1-word terms are intrinsically harder to rank for
    let baseDifficulty = 45;
    if (wordCount === 1)
        baseDifficulty = 75;
    else if (wordCount === 2)
        baseDifficulty = 60;
    else if (wordCount === 3)
        baseDifficulty = 45;
    else if (wordCount >= 4)
        baseDifficulty = 28; // Long-tail
    // 2. Average competitor authority influence (weight: 55%)
    let avgAuthority = 50;
    if (topCompetitorAuthorityScores.length > 0) {
        const sum = topCompetitorAuthorityScores.reduce((acc, v) => acc + v, 0);
        avgAuthority = sum / topCompetitorAuthorityScores.length;
    }
    // 3. Referring domains factor (weight: 25%)
    let refDomainsScore = 40;
    if (topCompetitorReferringDomains.length > 0) {
        const avgRefs = topCompetitorReferringDomains.reduce((acc, v) => acc + v, 0) / topCompetitorReferringDomains.length;
        refDomainsScore = Math.min(100, Math.log10(avgRefs + 1) * 25);
    }
    // Blended KD calculation
    const kdScore = (baseDifficulty * 0.20) + (avgAuthority * 0.55) + (refDomainsScore * 0.25);
    return Math.min(100, Math.max(0, Math.round(kdScore)));
}
/**
 * Maps numeric Keyword Difficulty (0 - 100) to 6 industry standard actionable difficulty tiers.
 */
export function getKdTier(kd) {
    const clamped = Math.min(100, Math.max(0, Math.round(kd)));
    if (clamped <= 14) {
        return {
            tier: 'Very Easy',
            range: '0 - 14%',
            description: 'New websites can rank on page 1 with basic content quality and zero backlinks.',
            minReferringDomainsNeeded: 0,
        };
    }
    else if (clamped <= 29) {
        return {
            tier: 'Easy',
            range: '15 - 29%',
            description: 'Target with well-structured on-page SEO and a couple of internal contextual links.',
            minReferringDomainsNeeded: 3,
        };
    }
    else if (clamped <= 49) {
        return {
            tier: 'Possible',
            range: '30 - 49%',
            description: 'Competitive search term; requires comprehensive content depth and several high-quality backlinks.',
            minReferringDomainsNeeded: 12,
        };
    }
    else if (clamped <= 69) {
        return {
            tier: 'Hard',
            range: '50 - 69%',
            description: 'Requires established topical authority, high domain rating, and active link-building outreach.',
            minReferringDomainsNeeded: 35,
        };
    }
    else if (clamped <= 84) {
        return {
            tier: 'Very Hard',
            range: '70 - 84%',
            description: 'Dominated by major enterprise authorities and publications; high effort required.',
            minReferringDomainsNeeded: 85,
        };
    }
    else {
        return {
            tier: 'Super Hard',
            range: '85 - 100%',
            description: 'Ultra-competitive head term with massive search volume; dominated by industry giants.',
            minReferringDomainsNeeded: 250,
        };
    }
}
/**
 * Predicts SERP layout feature opportunities based on query linguistic markers.
 */
export function calculateSerpFeatureOpportunities(keyword) {
    const lower = keyword.toLowerCase().trim();
    // Snippet opportunity
    let snippet = 'low';
    if (/^(what|how|why|when|where|who|can|steps|definition|guide|recipe)\b/i.test(lower) || lower.includes('vs') || lower.includes('best')) {
        snippet = 'high';
    }
    else if (lower.split(/\s+/).length >= 4) {
        snippet = 'medium';
    }
    // PAA opportunity
    let paa = 'medium';
    if (/^(how|what|why|can|is|does)\b/i.test(lower)) {
        paa = 'high';
    }
    // Video opportunity
    let video = 'low';
    if (/\b(tutorial|how to|review|demo|workout|gameplay|trailer|song|unboxing|assembly)\b/i.test(lower)) {
        video = 'high';
    }
    else if (/^(install|setup|fix|repair)\b/i.test(lower)) {
        video = 'medium';
    }
    // Local pack opportunity
    let local = 'low';
    if (/\b(near me|near|in [a-z]+|store|doctor|dentist|plumber|restaurant|clinic|shop|repair)\b/i.test(lower)) {
        local = 'high';
    }
    return {
        snippetOpportunity: snippet,
        paaOpportunity: paa,
        videoOpportunity: video,
        localPackOpportunity: local,
    };
}
/**
 * Multi-Angle Keyword Suggestion Expansion across Questions, Comparisons, Prepositions, and Intent.
 */
export function expandKeywordMultiAngle(seedKeyword) {
    const seed = seedKeyword.trim().toLowerCase();
    const results = [];
    // 1. Question Angle
    const questionPatterns = [
        `how to use ${seed}`,
        `what is ${seed}`,
        `why use ${seed}`,
        `can you learn ${seed} for free`,
        `how does ${seed} work`,
    ];
    for (const q of questionPatterns) {
        results.push({
            keyword: q,
            source: 'heuristic',
            intent: 'Informational',
            category: 'question',
            searchVolume: 1200,
            keywordDifficulty: 24,
            cpcUsd: 1.15,
        });
    }
    // 2. Comparison Angle
    const comparisonPatterns = [
        `${seed} vs competitors`,
        `best alternative to ${seed}`,
        `is ${seed} worth it reviews`,
        `${seed} pros and cons comparison`,
    ];
    for (const c of comparisonPatterns) {
        results.push({
            keyword: c,
            source: 'heuristic',
            intent: 'Commercial',
            category: 'comparison',
            searchVolume: 2400,
            keywordDifficulty: 42,
            cpcUsd: 2.80,
        });
    }
    // 3. Preposition & Modifier Angle
    const prepositionPatterns = [
        `${seed} for beginners`,
        `${seed} with step by step guide`,
        `${seed} without coding`,
        `${seed} in 2026`,
    ];
    for (const p of prepositionPatterns) {
        results.push({
            keyword: p,
            source: 'heuristic',
            intent: 'Informational',
            category: 'long-tail',
            searchVolume: 3500,
            keywordDifficulty: 32,
            cpcUsd: 1.65,
        });
    }
    // 4. Commercial & Transactional Angle
    const transPatterns = [
        `buy ${seed} online`,
        `${seed} pricing plans`,
        `cheap ${seed} discount`,
    ];
    for (const t of transPatterns) {
        results.push({
            keyword: t,
            source: 'heuristic',
            intent: 'Transactional',
            category: 'autocomplete',
            searchVolume: 1800,
            keywordDifficulty: 55,
            cpcUsd: 4.50,
        });
    }
    return results;
}
/**
 * Generates modeled keyword metrics (volume, KD, intent, CPC, seasonality) for a query.
 */
export function analyzeKeyword(keyword, options) {
    const intentDist = classifySearchIntentProbabilities(keyword);
    const intent = intentDist.primaryIntent;
    const kd = calculateKeywordDifficulty(keyword, options?.competitorAuthorityScores ?? [65, 72, 80, 58, 62, 75, 84, 50, 68, 70], options?.competitorRefDomains ?? [120, 350, 890, 80, 150, 420, 1200, 45, 230, 310]);
    const kdTier = getKdTier(kd);
    const serpFeatureOpportunities = calculateSerpFeatureOpportunities(keyword);
    // Deterministic seed simulation for volume and CPC based on keyword hash
    let hash = 0;
    for (let i = 0; i < keyword.length; i++) {
        hash = (hash << 5) - hash + keyword.charCodeAt(i);
        hash |= 0;
    }
    const positiveHash = Math.abs(hash);
    // Estimate search volume tiers based on term length and hash
    const wordCount = keyword.trim().split(/\s+/).length;
    let baseVol = 1000 + (positiveHash % 25000);
    if (wordCount === 1)
        baseVol *= 8;
    else if (wordCount === 2)
        baseVol *= 3;
    else if (wordCount >= 4)
        baseVol = Math.round(baseVol * 0.35);
    // CPC calculation based on commercial intent
    let cpc = Number(((positiveHash % 450) / 100 + 0.5).toFixed(2));
    if (intent === 'Transactional' || intent === 'Commercial') {
        cpc = Number((cpc * 2.2).toFixed(2));
    }
    const competitiveDensity = Number((Math.min(0.99, Math.max(0.05, (positiveHash % 100) / 100))).toFixed(2));
    // Seasonality: 12 months simulated relative search trend (0 to 100)
    const seasonalityTrend = [];
    const baseSeason = 50 + (positiveHash % 30);
    for (let m = 0; m < 12; m++) {
        const variance = Math.round(Math.sin((m + (positiveHash % 6)) * (Math.PI / 6)) * 25);
        seasonalityTrend.push(Math.max(10, Math.min(100, baseSeason + variance)));
    }
    // Empirical CTR expectation at rank 1 & 95% traffic forecast interval
    const ctrPred = predictCtrPowerLaw(1);
    const trafficForecast = calculateTrafficForecast(baseVol, ctrPred.adjustedCtr);
    return {
        keyword,
        searchVolume: baseVol,
        keywordDifficulty: kd,
        intent,
        cpcUsd: cpc,
        competitiveDensity,
        seasonalityTrend,
        intentDistribution: intentDist,
        trafficForecast,
        kdTier,
        serpFeatureOpportunities,
        provenance: KEYWORD_HEURISTIC_PROVENANCE,
    };
}
/**
 * Generates keyword variations (questions, broad match, and phrase variations).
 */
export function generateKeywordVariations(seedKeyword) {
    const seed = seedKeyword.trim().toLowerCase();
    return [
        `best ${seed}`,
        `how to use ${seed}`,
        `${seed} tutorial for beginners`,
        `top 10 ${seed} tools`,
        `free ${seed} alternative`,
        `${seed} pricing and reviews`,
        `what is ${seed}`,
        `${seed} vs competitors`,
    ];
}
/**
 * Fetches real query autocomplete completions directly from Google's official Suggest API.
 */
export async function fetchGoogleSuggestions(seed, options = {}) {
    const f = options.fetchImpl ?? fetch;
    const gl = options.country ?? 'us';
    const hl = options.language ?? 'en';
    const endpoint = `https://suggestqueries.google.com/complete/search?client=chrome&gl=${encodeURIComponent(gl)}&hl=${encodeURIComponent(hl)}&q=${encodeURIComponent(seed)}`;
    try {
        const r = await f(endpoint, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(6000),
        });
        if (!r.ok)
            return [];
        const data = await r.json();
        return Array.isArray(data[1]) ? data[1] : [];
    }
    catch {
        return [];
    }
}
/**
 * Performs real keyword research across Google Suggest or DataForSEO APIs.
 * Categorizes suggestions into questions, comparisons, long-tail, and autocomplete.
 */
export async function fetchRealKeywordResearch(options) {
    const seed = options.query.trim();
    const f = options.fetchImpl ?? fetch;
    // 1. DataForSEO provider if credentials provided or configured
    const dfLogin = options.dataForSeoCredentials?.login || process.env.DATAFORSEO_LOGIN;
    const dfPassword = options.dataForSeoCredentials?.password || process.env.DATAFORSEO_PASSWORD;
    if (options.provider === 'dataforseo' || (options.provider === 'auto' && dfLogin && dfPassword)) {
        try {
            const auth = Buffer.from(`${dfLogin}:${dfPassword}`).toString('base64');
            const endpoint = 'https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live';
            const r = await f(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${auth}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify([{
                        keyword: seed,
                        location_code: 2840, // US
                        language_code: 'en',
                        limit: 50,
                    }]),
                signal: AbortSignal.timeout(12000),
            });
            if (r.ok) {
                const respData = await r.json();
                const items = respData.tasks?.[0]?.result?.[0]?.items ?? [];
                if (items.length > 0) {
                    const suggestions = items.map(item => {
                        const kw = item.keyword;
                        const intent = classifySearchIntent(kw);
                        let category = 'autocomplete';
                        if (/^(who|what|where|when|why|how|can|is|are)\b/i.test(kw))
                            category = 'question';
                        else if (/\b(vs|versus|or|alternative|compare)\b/i.test(kw))
                            category = 'comparison';
                        else if (kw.split(/\s+/).length >= 4)
                            category = 'long-tail';
                        return {
                            keyword: kw,
                            source: 'dataforseo',
                            searchVolume: item.keyword_info?.search_volume ?? null,
                            searchVolumeStatus: item.keyword_info?.search_volume !== undefined ? 'measured' : 'unavailable',
                            cpcUsd: item.keyword_info?.cpc ?? null,
                            keywordDifficulty: calculateKeywordDifficulty(kw),
                            intent,
                            category,
                        };
                    });
                    return {
                        seedKeyword: seed,
                        provider: 'DataForSEO Labs API',
                        suggestions,
                        totalSuggestions: suggestions.length,
                        provenance: {
                            tier: 'provider_api',
                            isFactual: true,
                            dataSource: 'DataForSEO Labs Google Keyword Suggestions API',
                            methodology: 'Third-party commercial keyword volume and CPC database',
                            confidence: 'high',
                        },
                    };
                }
            }
        }
        catch {
            // Fallback to Google Suggest on failure
        }
    }
    // 2. Google Suggest Live Real Autocomplete Engine
    const queryPrefixes = [
        seed,
        `how ${seed}`,
        `what is ${seed}`,
        `best ${seed}`,
        `${seed} vs`,
        `${seed} for`,
    ];
    const results = await Promise.all(queryPrefixes.map(q => fetchGoogleSuggestions(q, { country: options.country, language: options.language, fetchImpl: f })));
    const seen = new Set();
    const suggestions = [];
    results.forEach((list, idx) => {
        const prefixType = queryPrefixes[idx] ?? '';
        let category = 'autocomplete';
        if (prefixType.startsWith('how') || prefixType.startsWith('what'))
            category = 'question';
        else if (prefixType.includes('vs') || prefixType.startsWith('best'))
            category = 'comparison';
        for (const item of list) {
            const clean = item.trim().toLowerCase();
            if (!clean || seen.has(clean))
                continue;
            seen.add(clean);
            const wordCount = clean.split(/\s+/).length;
            let finalCategory = category;
            if (finalCategory === 'autocomplete' && wordCount >= 4)
                finalCategory = 'long-tail';
            const analyzed = analyzeKeyword(clean);
            suggestions.push({
                keyword: clean,
                source: 'google-suggest',
                searchVolume: null,
                searchVolumeStatus: 'unavailable',
                modeledSearchVolume: analyzed.searchVolume,
                cpcUsd: null,
                keywordDifficulty: analyzed.keywordDifficulty,
                intent: analyzed.intent,
                category: finalCategory,
            });
        }
    });
    return {
        seedKeyword: seed,
        provider: 'Google Suggest Autocomplete API',
        suggestions,
        totalSuggestions: suggestions.length,
        provenance: {
            tier: 'provider_api',
            isFactual: true,
            dataSource: 'Google Suggest Search Engine Autocomplete',
            methodology: 'Real-time search engine query suggestions and question modifiers with lexical intent classification',
            confidence: 'high',
            metricType: 'unavailable',
            dataLimitations: [
                'Google Suggest provides real query autocomplete strings. Numerical search volume is unavailable without a licensed keyword data provider (e.g. DataForSEO).',
            ],
        },
    };
}
