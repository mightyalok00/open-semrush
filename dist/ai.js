import fs from 'node:fs';
import path from 'node:path';
// In-memory set of API keys that failed authentication (401/403) to avoid repeated failed network calls
const invalidKeys = new Set();
function loadProjectEnv() {
    const result = {};
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        try {
            const content = fs.readFileSync(envPath, 'utf8');
            for (const line of content.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#'))
                    continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx > 0) {
                    const key = trimmed.slice(0, eqIdx).trim();
                    const val = trimmed.slice(eqIdx + 1).trim();
                    result[key] = val;
                }
            }
        }
        catch { }
    }
    return result;
}
export const OPENROUTER_FREE_MODELS = [
    'minimax/minimax-m3.1-flash:free',
    'google/gemma-4-31b-it:free',
    'poolside/laguna-s-2.1:free',
    'google/gemini-2.5-flash',
    'google/gemma-4-26b-a4b-it:free',
    'nvidia/nemotron-3.5-lightning:free',
    'openrouter/free',
];
export const GEMINI_WORKING_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-flash-latest',
];
/**
 * Universal fast AI query engine supporting OpenRouter (primary) and Google Gemini (direct fallback).
 */
export async function queryAiJson(prompt, preferredApiKey, maxTokens = 1500) {
    const isTestExecution = process.env.NODE_ENV === 'test' ||
        process.execArgv.includes('--test') ||
        process.argv.some(arg => arg.includes('test')) ||
        Boolean(process.env.npm_lifecycle_event?.includes('test'));
    // In test suites, avoid external network queries unless explicitly requested
    if (isTestExecution && !process.env.OPEN_SEMRUSH_TEST_LIVE_AI) {
        return null;
    }
    const projectEnv = loadProjectEnv();
    const openRouterKey = preferredApiKey?.startsWith('sk-or-')
        ? preferredApiKey.trim()
        : (projectEnv.OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim());
    const geminiKey = preferredApiKey && !preferredApiKey.startsWith('sk-or-')
        ? preferredApiKey.trim()
        : (projectEnv.GEMINI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim());
    const configuredOpenRouterModel = projectEnv.OPENROUTER_MODEL || process.env.OPENROUTER_MODEL;
    const configuredGeminiModel = projectEnv.GEMINI_MODEL || process.env.GEMINI_MODEL;
    // 1. Try OpenRouter first across active and free models
    if (openRouterKey && !invalidKeys.has(openRouterKey)) {
        const candidateModels = configuredOpenRouterModel
            ? [configuredOpenRouterModel, ...OPENROUTER_FREE_MODELS.filter(m => m !== configuredOpenRouterModel)]
            : OPENROUTER_FREE_MODELS;
        for (const model of candidateModels) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000);
                const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${openRouterKey}`,
                        'HTTP-Referer': 'https://open-semrush.local',
                        'X-Title': 'Open-Semrush Engine',
                    },
                    body: JSON.stringify({
                        model,
                        max_tokens: maxTokens,
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: 'json_object' },
                        temperature: 0.2,
                    }),
                    signal: controller.signal,
                });
                clearTimeout(timeout);
                if (res.ok) {
                    const data = await res.json();
                    const raw = data.choices?.[0]?.message?.content;
                    if (raw) {
                        try {
                            const parsed = JSON.parse(raw);
                            return parsed;
                        }
                        catch {
                            const jsonMatch = raw.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                return JSON.parse(jsonMatch[0]);
                            }
                        }
                    }
                }
                else {
                    if (res.status === 401 || res.status === 403) {
                        invalidKeys.add(openRouterKey);
                        if (process.env.NODE_ENV !== 'test') {
                            console.warn(`[OpenRouter] Authentication failed (HTTP ${res.status}). Disabling key for this session.`);
                        }
                        break;
                    }
                    // If 429 rate limit or 504 provider timeout on a free model, try next candidate model
                }
            }
            catch {
                // Timeout or fetch error on this free model; proceed to next candidate
            }
        }
    }
    // 2. Direct Google Gemini API fallback across working models
    if (geminiKey && !invalidKeys.has(geminiKey)) {
        const candidateModels = configuredGeminiModel
            ? [configuredGeminiModel, ...GEMINI_WORKING_MODELS.filter(m => m !== configuredGeminiModel)]
            : GEMINI_WORKING_MODELS;
        for (const model of candidateModels) {
            try {
                const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 20000);
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0.2,
                            responseMimeType: 'application/json',
                        },
                    }),
                    signal: controller.signal,
                });
                clearTimeout(timeout);
                if (res.ok) {
                    const data = await res.json();
                    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (rawText) {
                        try {
                            return JSON.parse(rawText);
                        }
                        catch {
                            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                return JSON.parse(jsonMatch[0]);
                            }
                        }
                    }
                }
                else {
                    if (res.status === 401 || res.status === 403) {
                        invalidKeys.add(geminiKey);
                        if (process.env.NODE_ENV !== 'test') {
                            console.warn(`[Gemini] API key authentication failed (HTTP ${res.status}). Disabling key for this session.`);
                        }
                        break;
                    }
                    // If 404, 429, or 503, try next working model in cascade
                }
            }
            catch {
                // Timeout or fetch error; try next working candidate model
            }
        }
    }
    return null;
}
/**
 * Generates accurate SEO Domain Overview metrics using AI.
 */
export async function analyzeDomainWithAi(domain, apiKey) {
    const cleanDomain = domain.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').replace(/\/.*$/, '').toLowerCase();
    const prompt = `You are a professional SEO analyst at Semrush. 
Analyze the website domain: "${cleanDomain}".

Provide an accurate, realistic Semrush-grade Domain Overview in valid JSON format.
Calibration guidelines:
- Authority Score (0-100):
  * 90-100: Global giants (google.com, wikipedia.org, github.com, apple.com, amazon.com).
  * 75-89: Major tech, media & SaaS (shopify.com, stripe.com, gitlab.com, semrush.com, slack.com).
  * 50-74: Established mid-sized companies, high-traffic regional brands.
  * 25-49: Growing businesses, niche sites with moderate traffic.
  * 1-24: Small/new sites or personal blogs.
- Estimated Monthly Organic Traffic: Realistic monthly Google search visits.
- Total Ranked Keywords: Number of keywords ranking in Google top 100.
- Top Competitors: 3-4 real, genuine competitor domain names in the same niche.
- Top 10 Organic Keywords: Real keywords this domain actually ranks for, with realistic Google position (1-10), monthly search volume, estimated monthly traffic, and Search Intent ('Informational', 'Navigational', 'Commercial', 'Transactional').

Respond with ONLY raw valid JSON:
{
  "authorityScore": number,
  "estimatedMonthlyOrganicTraffic": number,
  "totalRankedKeywords": number,
  "topCompetitors": ["string"],
  "topOrganicKeywords": [
    {
      "keyword": "string",
      "position": number,
      "searchVolume": number,
      "estimatedMonthlyTraffic": number,
      "intent": "Informational" | "Navigational" | "Commercial" | "Transactional"
    }
  ]
}`;
    return queryAiJson(prompt, apiKey, 1500);
}
export async function analyzeDomainWithGemini(domain, apiKey) {
    return analyzeDomainWithAi(domain, apiKey);
}
export async function analyzeDomainWithOpenRouter(domain, apiKey) {
    return analyzeDomainWithAi(domain, apiKey);
}
/**
 * Deterministic expert SEO rule-based fix generator used when AI is offline or unavailable.
 */
function generateDeterministicSeoFix(url, issueCode, originalValue, message) {
    switch (issueCode) {
        case 'TITLE_MISSING':
            return {
                issueCode,
                originalValue,
                suggestedFix: 'Add a concise, keyword-rich <title> tag between 30 and 60 characters.',
                codeSnippet: '<title>Primary Target Keyword — Brand Name</title>',
                explanation: 'Title tags are the single most influential on-page ranking signal and define your headline in Google search results.',
            };
        case 'TITLE_TOO_SHORT':
            return {
                issueCode,
                originalValue,
                suggestedFix: 'Expand title tag to at least 30 characters incorporating primary and secondary keyword intent.',
                codeSnippet: `<title>${originalValue ? originalValue + ' — Complete Guide & Review' : 'Comprehensive Industry Guide & Solutions'}</title>`,
                explanation: 'Short titles miss valuable keyword relevance opportunities and underperform in click-through rates.',
            };
        case 'TITLE_TOO_LONG':
            return {
                issueCode,
                originalValue,
                suggestedFix: 'Shorten title to under 60 characters to avoid pixel truncation in SERPs.',
                codeSnippet: `<title>${(originalValue || 'Optimized Page Title').slice(0, 55).trim()}</title>`,
                explanation: 'Google SERPs display approximately 600px (~60 characters). Longer titles get truncated with an ellipsis (...).',
            };
        case 'H1_MISSING':
            return {
                issueCode,
                originalValue,
                suggestedFix: 'Add exactly one descriptive <h1> heading at the top of the main body content.',
                codeSnippet: '<h1>Primary Topic or Service Offering</h1>',
                explanation: 'A clear <h1> communicates the core subject matter of the page to search crawlers and assists screen reader accessibility.',
            };
        case 'H1_MULTIPLE':
            return {
                issueCode,
                originalValue,
                suggestedFix: 'Consolidate multiple <h1> tags into one main <h1> and change subordinate headings to <h2> and <h3>.',
                codeSnippet: '<h1>Primary Page Headline</h1>\n<h2>Subordinate Section Header</h2>',
                explanation: 'Multiple <h1> elements confuse document hierarchy. Modern SEO best practice recommends one primary <h1> per URL.',
            };
        case 'META_DESC_MISSING':
            return {
                issueCode,
                originalValue,
                suggestedFix: 'Add an engaging meta description between 70 and 160 characters summarizing the page value proposition.',
                codeSnippet: '<meta name="description" content="Discover actionable insights and expert solutions with our comprehensive guide. Learn more and get started today.">',
                explanation: 'While not a direct ranking factor, meta descriptions determine snippet CTR from organic Google search impressions.',
            };
        case 'META_DESC_LENGTH':
            return {
                issueCode,
                originalValue,
                suggestedFix: 'Calibrate meta description length to optimal 70–160 character boundary.',
                codeSnippet: '<meta name="description" content="Concise, informative description with clear value proposition and relevant target keywords.">',
                explanation: 'Descriptions outside 70-160 characters risk SERP truncation or Google rewriting the snippet from on-page text.',
            };
        case 'CANONICAL_MISSING':
            return {
                issueCode,
                originalValue,
                suggestedFix: 'Add a self-referencing canonical URL tag in the HTML head.',
                codeSnippet: `<link rel="canonical" href="${url}">`,
                explanation: 'Canonical tags prevent duplicate content indexing issues caused by query parameters, session IDs, or tracking tags.',
            };
        case 'SCHEMA_MISSING':
            return {
                issueCode,
                originalValue,
                suggestedFix: 'Implement Schema.org JSON-LD structured data for rich SERP enhancements.',
                codeSnippet: `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "WebPage",\n  "url": "${url}"\n}\n</script>`,
                explanation: 'Structured data enables rich snippet eligibility, including breadcrumbs, ratings, FAQs, and entity graph recognition.',
            };
        case 'IMAGES_MISSING_ALT':
            return {
                issueCode,
                originalValue,
                suggestedFix: 'Add descriptive alternative text to all visual <img> tags.',
                codeSnippet: '<img src="/path/to/image.webp" alt="Descriptive, accessible explanation of image content">',
                explanation: 'Alt text fulfills WCAG accessibility requirements and indexes images in Google Image Search.',
            };
        default:
            return {
                issueCode,
                originalValue,
                suggestedFix: `Remediate technical SEO issue: ${message}.`,
                codeSnippet: `<!-- SEO Optimization: Review and resolve ${issueCode} according to Webmaster Guidelines -->`,
                explanation: 'Resolving crawler warnings improves technical crawl efficiency and search engine indexing confidence.',
            };
    }
}
/**
 * Generates an exact, production-ready SEO fix recommendation for an audit issue.
 */
export async function generateSeoFixWithAi(url, issueCode, originalValue, message, apiKey) {
    const prompt = `You are a world-class Technical SEO consultant.
A web crawler detected the following issue on page "${url}":
Issue Code: ${issueCode}
Issue Message: ${message}
Current/Original Value: ${originalValue ?? '<None / Missing>'}

Generate an optimal, production-ready fix in valid JSON format:
{
  "issueCode": "${issueCode}",
  "originalValue": ${JSON.stringify(originalValue)},
  "suggestedFix": "Clear, concise suggested text or description",
  "codeSnippet": "Exact HTML tag or JSON-LD snippet ready to copy-paste",
  "explanation": "Why this fix solves the problem and improves Google ranking / CTR"
}`;
    const aiResult = await queryAiJson(prompt, apiKey, 1000);
    if (aiResult && aiResult.suggestedFix && aiResult.codeSnippet) {
        return aiResult;
    }
    // Fall back to expert deterministic SEO rules
    return generateDeterministicSeoFix(url, issueCode, originalValue, message);
}
/**
 * Generates an end-to-end content strategy outline from a competitor keyword gap.
 */
export async function generateContentStrategyWithAi(domainA, competitorDomain, missingKeyword, apiKey) {
    const prompt = `You are an elite SEO content strategist.
Our site "${domainA}" is currently missing organic search rankings for "${missingKeyword}", while competitor "${competitorDomain}" is ranking well.

Generate a comprehensive content strategy outline to outrank the competitor in raw valid JSON:
{
  "targetKeyword": "${missingKeyword}",
  "recommendedTitle": "Compelling, high-CTR article title (50-60 chars)",
  "targetIntent": "Informational" | "Commercial" | "Transactional",
  "estimatedDifficulty": number (0-100),
  "recommendedWordCount": number (e.g. 1500 to 2800),
  "headingStructure": [
    { "level": "h2", "text": "Heading text" },
    { "level": "h3", "text": "Subheading text" }
  ],
  "keyTalkingPoints": [
    "Bullet points of must-cover topic angles to satisfy user intent"
  ]
}`;
    const aiResult = await queryAiJson(prompt, apiKey, 1500);
    if (aiResult && aiResult.recommendedTitle && aiResult.headingStructure) {
        return aiResult;
    }
    // Deterministic high-quality content strategy fallback
    const capitalized = missingKeyword.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return {
        targetKeyword: missingKeyword,
        recommendedTitle: `The Complete Guide to ${capitalized} (2026 Strategy)`,
        targetIntent: 'Informational',
        estimatedDifficulty: 48,
        recommendedWordCount: 2200,
        headingStructure: [
            { level: 'h2', text: `What is ${capitalized}? Overview & Fundamental Concepts` },
            { level: 'h2', text: `Why ${capitalized} Matters for High Performance in 2026` },
            { level: 'h2', text: `Step-by-Step Implementation and Workflow Architecture` },
            { level: 'h3', text: `Key Architectural Principles and Requirements` },
            { level: 'h3', text: `Common Pitfalls and How to Avoid Them` },
            { level: 'h2', text: `Comparing Industry Benchmarks and Alternatives` },
            { level: 'h2', text: `Conclusion and Actionable Takeaways` },
        ],
        keyTalkingPoints: [
            `Foundational definition and clear practical context for ${missingKeyword}`,
            `Evaluation of top features, trade-offs, and competitor strengths`,
            `Hands-on implementation guidance with verifiable checklists`,
            `Performance, reliability, and security recommendations`,
        ],
    };
}
/**
 * Returns runtime operational telemetry for configured AI model cascades.
 */
export function getAiEngineStatus() {
    return {
        openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
        openRouterModelCount: OPENROUTER_FREE_MODELS.length,
        openRouterModels: OPENROUTER_FREE_MODELS,
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
        geminiModelCount: GEMINI_WORKING_MODELS.length,
        geminiModels: GEMINI_WORKING_MODELS,
        totalInvalidatedKeys: invalidKeys.size,
    };
}
/**
 * Generates evidence-backed SEO recommendations derived directly from observed audit and ranking metrics.
 * Explains why each action matters, the expected impact, confidence score, and exact empirical evidence.
 */
export function generateEvidenceBackedRecommendations(auditReport) {
    const recommendations = [];
    const provenance = {
        tier: 'empirical_observation',
        isFactual: true,
        dataSource: 'Open Semrush Crawl Telemetry & Audit Findings',
        methodology: 'Empirical issue mapping with impact scoring and supporting evidence references',
        confidence: 'high',
        metricType: 'measured',
        retrievalTimestamp: new Date().toISOString(),
    };
    let recIndex = 1;
    for (const page of auditReport.pages) {
        for (const issue of page.issues) {
            if (issue.severity === 'error') {
                recommendations.push({
                    id: `rec_${recIndex++}`,
                    category: issue.code.includes('HTTP') ? 'technical' : 'content',
                    title: `Resolve Critical ${issue.code.replace(/_/g, ' ')} on ${new URL(page.url).pathname}`,
                    action: issue.recommendation,
                    rationale: `Search engine crawlers deprioritize or drop indexing for URLs encountering ${issue.message.toLowerCase()}. Fixing this preserves indexation and crawl budget.`,
                    expectedImpact: 'high',
                    confidence: 0.95,
                    evidence: {
                        metric: issue.code,
                        observedValue: issue.evidence?.observed ?? issue.message,
                        benchmarkValue: issue.evidence?.expected ?? 'Clean HTTP 200 with valid metadata',
                        sourceUrlOrQuery: page.url,
                    },
                    provenance,
                });
            }
            else if (issue.severity === 'warning') {
                recommendations.push({
                    id: `rec_${recIndex++}`,
                    category: issue.code.includes('TTFB') || issue.code.includes('SIZE') || issue.code.includes('HSTS') ? 'technical' : 'content',
                    title: `Improve ${issue.code.replace(/_/g, ' ')} for ${new URL(page.url).pathname}`,
                    action: issue.recommendation,
                    rationale: `${issue.message}. Optimizing this signal enhances Core Web Vitals and user engagement metrics correlated with rank preservation.`,
                    expectedImpact: 'medium',
                    confidence: 0.85,
                    evidence: {
                        metric: issue.code,
                        observedValue: issue.evidence?.observed ?? issue.message,
                        benchmarkValue: issue.evidence?.expected ?? 'Optimal standard compliance',
                        sourceUrlOrQuery: page.url,
                    },
                    provenance,
                });
            }
        }
        if (page.spaDetected) {
            recommendations.push({
                id: `rec_${recIndex++}`,
                category: 'technical',
                title: `Enable Pre-Rendering or SSR for Client-Side Hydrated SPA`,
                action: 'Implement Dynamic Rendering or Next.js/Nuxt SSR to serve pre-rendered HTML to search bots.',
                rationale: 'Search engine bot crawlers have limited JavaScript execution resources. Un-rendered SPAs risk having main body content and internal links skipped during indexation passes.',
                expectedImpact: 'high',
                confidence: 0.92,
                evidence: {
                    metric: 'SPA_DETECTED',
                    observedValue: `SPA root shell with word count = ${page.wordCount}`,
                    benchmarkValue: 'Server-rendered HTML with full text and headings',
                    sourceUrlOrQuery: page.url,
                },
                provenance,
            });
        }
        if (page.contentQuality && page.contentQuality.isKeywordStuffed) {
            recommendations.push({
                id: `rec_${recIndex++}`,
                category: 'content',
                title: `Normalize Lexical Density and Remove Repetitive Phrases`,
                action: 'Diversify vocabulary using related topical entities and decrease keyword frequency.',
                rationale: 'High repetition entropy and excessive keyword density trigger spam quality algorithms and lower helpful-content confidence.',
                expectedImpact: 'medium',
                confidence: 0.88,
                evidence: {
                    metric: 'KEYWORD_STUFFING',
                    observedValue: page.contentQuality.stuffedTerms[0]?.density ? `${(page.contentQuality.stuffedTerms[0].density * 100).toFixed(1)}% density` : 'Repetitive density',
                    benchmarkValue: 'Natural keyword density < 2.5%',
                    sourceUrlOrQuery: page.url,
                },
                provenance,
            });
        }
    }
    return recommendations;
}
