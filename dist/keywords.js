/**
 * Classifies search intent into Informational, Navigational, Commercial, or Transactional.
 */
export function classifySearchIntent(keyword) {
    const lower = keyword.toLowerCase();
    // Transactional signals
    if (/\b(buy|purchase|pricing|price|cost|discount|coupon|deal|order|cheap|hire|quote)\b/i.test(lower)) {
        return 'Transactional';
    }
    // Commercial signals
    if (/\b(best|top|vs|versus|review|reviews|comparison|compare|alternative|alternatives|recommended)\b/i.test(lower)) {
        return 'Commercial';
    }
    // Navigational signals
    if (/\b(login|sign in|portal|dashboard|account|official|app download|website)\b/i.test(lower) ||
        /\.(com|org|net|io|ai|co)\b/i.test(lower)) {
        return 'Navigational';
    }
    // Default to Informational (how, what, why, guide, etc.)
    return 'Informational';
}
/**
 * Calculates Semrush-style Keyword Difficulty (KD%) on a 0-100 scale.
 *
 * @param query The search query string
 * @param topCompetitorAuthorityScores Array of Authority Scores (0-100) of top 10 ranking domains
 * @param topCompetitorReferringDomains Array of referring domain counts for top 10 URLs
 */
export function calculateKeywordDifficulty(query, topCompetitorAuthorityScores = [], topCompetitorReferringDomains = []) {
    const words = query.trim().split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    if (wordCount === 0)
        return 0;
    // 1. Long-tail vs Head term penalty: 1-word terms are intrinsically much harder to rank for
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
 * Generates modeled keyword metrics (volume, KD, intent, CPC, seasonality) for a query.
 */
export function analyzeKeyword(keyword, options) {
    const intent = classifySearchIntent(keyword);
    const kd = calculateKeywordDifficulty(keyword, options?.competitorAuthorityScores ?? [65, 72, 80, 58, 62, 75, 84, 50, 68, 70], options?.competitorRefDomains ?? [120, 350, 890, 80, 150, 420, 1200, 45, 230, 310]);
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
    return {
        keyword,
        searchVolume: baseVol,
        keywordDifficulty: kd,
        intent,
        cpcUsd: cpc,
        competitiveDensity,
        seasonalityTrend,
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
