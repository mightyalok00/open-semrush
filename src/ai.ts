import type { AiFixRecommendation, ContentStrategyOutline, DomainKeywordRanking } from './types.js';

export interface AiDomainAnalysis {
  readonly authorityScore: number;
  readonly estimatedMonthlyOrganicTraffic: number;
  readonly totalRankedKeywords: number;
  readonly topCompetitors: readonly string[];
  readonly topOrganicKeywords: readonly DomainKeywordRanking[];
}

/**
 * Universal fast AI query engine supporting OpenRouter (primary 1.2s) and Google Gemini (fallback).
 */
export async function queryAiJson<T>(
  prompt: string,
  preferredApiKey?: string,
  maxTokens: number = 1500
): Promise<T | null> {
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() || (preferredApiKey?.startsWith('sk-or-') ? preferredApiKey.trim() : undefined);
  const geminiKey = process.env.GEMINI_API_KEY?.trim() || (preferredApiKey && !preferredApiKey.startsWith('sk-or-') ? preferredApiKey.trim() : undefined);

  // 1. Try OpenRouter first (sub-second / 1.2s response time)
  if (openRouterKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openRouterKey}`,
          'HTTP-Referer': 'https://rea.tools',
          'X-Title': 'Semrush Studio',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json() as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const raw = data.choices?.[0]?.message?.content;
        if (raw) {
          const parsed = JSON.parse(raw);
          return parsed as T;
        }
      } else {
        console.warn(`OpenRouter non-200: ${res.status}`);
      }
    } catch (err) {
      console.warn('OpenRouter query failed, checking Gemini fallback...', err);
    }
  }

  // 2. Fallback to direct Google Gemini API
  if (geminiKey) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(geminiKey)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 40000);

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
        const data = await res.json() as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          return JSON.parse(rawText) as T;
        }
      } else {
        console.warn(`Gemini direct API non-200: ${res.status}`);
      }
    } catch (err) {
      console.error('Gemini query failed:', err);
    }
  }

  return null;
}

/**
 * Generates accurate SEO Domain Overview metrics using AI.
 */
export async function analyzeDomainWithAi(
  domain: string,
  apiKey?: string
): Promise<AiDomainAnalysis | null> {
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

  return queryAiJson<AiDomainAnalysis>(prompt, apiKey, 1500);
}

export async function analyzeDomainWithGemini(
  domain: string,
  apiKey: string
): Promise<AiDomainAnalysis | null> {
  return analyzeDomainWithAi(domain, apiKey);
}

export async function analyzeDomainWithOpenRouter(
  domain: string,
  apiKey: string
): Promise<AiDomainAnalysis | null> {
  return analyzeDomainWithAi(domain, apiKey);
}

/**
 * Generates an exact, production-ready SEO fix recommendation for an audit issue.
 */
export async function generateSeoFixWithAi(
  url: string,
  issueCode: string,
  originalValue: string | null,
  message: string,
  apiKey?: string
): Promise<AiFixRecommendation | null> {
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

  return queryAiJson<AiFixRecommendation>(prompt, apiKey, 1000);
}

/**
 * Generates an end-to-end content strategy outline from a competitor keyword gap.
 */
export async function generateContentStrategyWithAi(
  domainA: string,
  competitorDomain: string,
  missingKeyword: string,
  apiKey?: string
): Promise<ContentStrategyOutline | null> {
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

  return queryAiJson<ContentStrategyOutline>(prompt, apiKey, 1500);
}
