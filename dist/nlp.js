/**
 * Local-First Natural Language Processing (NLP) Engine for Open Semrush.
 *
 * Provides pure-TypeScript, zero-dependency linguistic analysis:
 * 1. Rule-based Porter Stemmer and tokenization
 * 2. TF-IDF keyphrase salience and concept extraction
 * 3. Named Entity Recognition (Tech, Organizations, Products, Concepts, Questions)
 * 4. Content Quality, Lexical Diversity (Type-Token Ratio) & Repetition Analysis
 * 5. Page Intent Profiling and Query-Page Intent Alignment Auditing
 * 6. Semantic Content Gap Analysis vs Competitor Pages
 * 7. Enhanced Semantic Topic Clustering with Intent Distributions
 */
import { classifySearchIntentProbabilities } from './ml.js';
// ---------------------------------------------------------------------------
// 1. English Stopwords & Lexicons
// ---------------------------------------------------------------------------
export const ENGLISH_STOPWORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
    'any', 'are', 'aren\'t', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
    'below', 'between', 'both', 'but', 'by', 'can\'t', 'cannot', 'could', 'couldn\'t',
    'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during',
    'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t',
    'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'her', 'here',
    'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i',
    'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it',
    'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most', 'mustn\'t', 'my',
    'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
    'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'shan\'t',
    'she', 'she\'d', 'she\'ll', 'she\'s', 'should', 'shouldn\'t', 'so', 'some',
    'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves',
    'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re',
    'they\'ve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
    'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were',
    'weren\'t', 'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which',
    'while', 'who', 'who\'s', 'whom', 'why', 'why\'s', 'with', 'won\'t', 'would',
    'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours',
    'yourself', 'yourselves', 'also', 'just', 'like', 'even', 'one', 'two', 'new',
    'well', 'way', 'may', 'see', 'use', 'using', 'used', 'make', 'made', 'get',
]);
const KNOWN_ORGANIZATIONS = new Set([
    'google', 'microsoft', 'apple', 'amazon', 'meta', 'facebook', 'twitter', 'x',
    'github', 'gitlab', 'cloudflare', 'semrush', 'ahrefs', 'moz', 'openai',
    'anthropic', 'netflix', 'spotify', 'salesforce', 'hubspot', 'adobe', 'oracle',
    'ibm', 'intel', 'nvidia', 'uber', 'airbnb', 'stripe', 'shopify', 'vercel',
]);
const KNOWN_TECHNOLOGIES = new Set([
    'javascript', 'typescript', 'python', 'java', 'golang', 'rust', 'c++', 'c#',
    'php', 'ruby', 'swift', 'kotlin', 'react', 'vue', 'angular', 'next.js', 'nuxt',
    'svelte', 'node.js', 'express', 'nestjs', 'django', 'flask', 'fastapi',
    'postgresql', 'postgres', 'mysql', 'sqlite', 'mongodb', 'redis', 'elasticsearch',
    'docker', 'kubernetes', 'aws', 'gcp', 'azure', 'linux', 'git', 'graphql',
    'rest', 'api', 'http', 'https', 'dns', 'ssl', 'tls', 'html', 'css', 'json',
    'seo', 'sem', 'serp', 'crawler', 'sitemap', 'robots.txt', 'schema.org',
]);
// ---------------------------------------------------------------------------
// 2. Porter Stemming Algorithm
// ---------------------------------------------------------------------------
function isConsonant(str, i) {
    const ch = str[i];
    if (!ch)
        return false;
    if (ch === 'a' || ch === 'e' || ch === 'i' || ch === 'o' || ch === 'u')
        return false;
    if (ch === 'y') {
        if (i === 0)
            return true;
        return !isConsonant(str, i - 1);
    }
    return true;
}
function getMeasure(str) {
    let n = 0;
    let i = 0;
    const len = str.length;
    while (i < len) {
        if (!isConsonant(str, i))
            break;
        i++;
    }
    while (i < len) {
        while (i < len) {
            if (isConsonant(str, i))
                break;
            i++;
        }
        if (i >= len)
            break;
        i++;
        while (i < len) {
            if (!isConsonant(str, i))
                break;
            i++;
        }
        n++;
    }
    return n;
}
function hasVowel(str) {
    for (let i = 0; i < str.length; i++) {
        if (!isConsonant(str, i))
            return true;
    }
    return false;
}
function endsWithDoubleConsonant(str) {
    if (str.length < 2)
        return false;
    const c1 = str[str.length - 1];
    const c2 = str[str.length - 2];
    if (!c1 || c1 !== c2)
        return false;
    return isConsonant(str, str.length - 1);
}
function cvc(str) {
    const len = str.length;
    if (len < 3)
        return false;
    if (!isConsonant(str, len - 1) || isConsonant(str, len - 2) || !isConsonant(str, len - 3))
        return false;
    const last = str[len - 1];
    if (last === 'w' || last === 'x' || last === 'y')
        return false;
    return true;
}
/**
 * Reduces an English word to its root morphological stem via the Porter algorithm.
 */
export function stemWord(word) {
    let str = word.toLowerCase();
    if (str.length <= 2)
        return str;
    // Step 1a
    if (str.endsWith('sses'))
        str = str.slice(0, -2);
    else if (str.endsWith('ies'))
        str = str.slice(0, -2);
    else if (!str.endsWith('ss') && str.endsWith('s'))
        str = str.slice(0, -1);
    // Step 1b
    let extraStep1b = false;
    if (str.endsWith('eed')) {
        if (getMeasure(str.slice(0, -3)) > 0)
            str = str.slice(0, -1);
    }
    else if (str.endsWith('ed')) {
        const stem = str.slice(0, -2);
        if (hasVowel(stem)) {
            str = stem;
            extraStep1b = true;
        }
    }
    else if (str.endsWith('ing')) {
        const stem = str.slice(0, -3);
        if (hasVowel(stem)) {
            str = stem;
            extraStep1b = true;
        }
    }
    if (extraStep1b) {
        if (str.endsWith('at') || str.endsWith('bl') || str.endsWith('iz')) {
            str += 'e';
        }
        else if (endsWithDoubleConsonant(str) && !str.endsWith('l') && !str.endsWith('s') && !str.endsWith('z')) {
            str = str.slice(0, -1);
        }
        else if (getMeasure(str) === 1 && cvc(str)) {
            str += 'e';
        }
    }
    // Step 1c
    if (str.endsWith('y')) {
        const stem = str.slice(0, -1);
        if (hasVowel(stem))
            str = stem + 'i';
    }
    // Step 2
    const step2Suffixes = [
        ['ational', 'ate'], ['tional', 'tion'], ['enci', 'ence'], ['anci', 'ance'],
        ['izer', 'ize'], ['abli', 'able'], ['alli', 'al'], ['entli', 'ent'],
        ['eli', 'e'], ['ousli', 'ous'], ['ization', 'ize'], ['ation', 'ate'],
        ['ator', 'ate'], ['alism', 'al'], ['iveness', 'ive'], ['fulness', 'ful'],
        ['ousness', 'ous'], ['aliti', 'al'], ['iviti', 'ive'], ['biliti', 'ble'],
    ];
    for (const [suf, rep] of step2Suffixes) {
        if (str.endsWith(suf)) {
            const stem = str.slice(0, -suf.length);
            if (getMeasure(stem) > 0)
                str = stem + rep;
            break;
        }
    }
    // Step 3
    const step3Suffixes = [
        ['icate', 'ic'], ['ative', ''], ['alize', 'al'], ['iciti', 'ic'],
        ['ical', 'ic'], ['ful', ''], ['ness', ''],
    ];
    for (const [suf, rep] of step3Suffixes) {
        if (str.endsWith(suf)) {
            const stem = str.slice(0, -suf.length);
            if (getMeasure(stem) > 0)
                str = stem + rep;
            break;
        }
    }
    // Step 4
    const step4Suffixes = [
        'al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement',
        'ment', 'ent', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize',
    ];
    for (const suf of step4Suffixes) {
        if (str.endsWith(suf)) {
            const stem = str.slice(0, -suf.length);
            if (getMeasure(stem) > 1)
                str = stem;
            break;
        }
    }
    if (str.endsWith('sion') || str.endsWith('tion')) {
        const stem = str.slice(0, -3);
        if (getMeasure(stem) > 1)
            str = stem;
    }
    // Step 5a
    if (str.endsWith('e')) {
        const stem = str.slice(0, -1);
        const m = getMeasure(stem);
        if (m > 1 || (m === 1 && !cvc(stem)))
            str = stem;
    }
    // Step 5b
    if (getMeasure(str) > 1 && endsWithDoubleConsonant(str) && str.endsWith('l')) {
        str = str.slice(0, -1);
    }
    return str;
}
// ---------------------------------------------------------------------------
// 3. Text Preprocessing & Tokenization
// ---------------------------------------------------------------------------
/**
 * Strips HTML tags, script/style bodies, and normalizes unicode whitespace.
 */
export function cleanHtmlToText(html) {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}
/**
 * Splits text into individual sentences based on punctuation boundaries.
 */
export function splitSentences(text) {
    return text
        .split(/(?<=[.?!])\s+(?=[A-Z0-9])/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}
/**
 * Splits text into lowercase normalized word tokens without punctuation.
 */
export function tokenizeWords(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .map(w => w.trim())
        .filter(w => w.length > 1);
}
/**
 * Extracts non-stopword stemmed tokens from a text.
 */
export function extractContentStems(text) {
    const words = tokenizeWords(text);
    return words
        .filter(w => !ENGLISH_STOPWORDS.has(w))
        .map(stemWord);
}
/**
 * Computes term frequencies and TF-IDF weights for unigrams and bigrams.
 */
export function extractSalientConcepts(text, topK = 20) {
    const words = tokenizeWords(text);
    if (words.length === 0)
        return [];
    const totalWords = words.length;
    const termCounts = new Map();
    // 1. Unigrams
    for (const word of words) {
        if (ENGLISH_STOPWORDS.has(word) || word.length <= 2)
            continue;
        const stem = stemWord(word);
        const existing = termCounts.get(stem);
        if (existing) {
            existing.count++;
        }
        else {
            termCounts.set(stem, { term: word, stem, count: 1 });
        }
    }
    // 2. Meaningful Bigrams
    for (let i = 0; i < words.length - 1; i++) {
        const w1 = words[i];
        const w2 = words[i + 1];
        if (ENGLISH_STOPWORDS.has(w1) || ENGLISH_STOPWORDS.has(w2))
            continue;
        const bigram = `${w1} ${w2}`;
        const stem = `${stemWord(w1)}_${stemWord(w2)}`;
        const existing = termCounts.get(stem);
        if (existing) {
            existing.count += 1.5; // Bigram boost
        }
        else {
            termCounts.set(stem, { term: bigram, stem, count: 1.5 });
        }
    }
    const results = [];
    for (const { term, stem, count } of termCounts.values()) {
        const tf = count / totalWords;
        // Single-document pseudo-IDF (augmented by term length and count)
        const pseudoIdf = Math.log(1 + (totalWords / (count + 1))) + 1;
        const tfIdf = Number((tf * pseudoIdf).toFixed(5));
        results.push({ term, stem, count: Math.round(count), tf: Number(tf.toFixed(4)), tfIdf });
    }
    results.sort((a, b) => b.tfIdf - a.tfIdf);
    return results.slice(0, topK);
}
// ---------------------------------------------------------------------------
// 5. Named Entity & Question Extraction
// ---------------------------------------------------------------------------
/**
 * Discovers questions asked or answered in the content (from headings or text).
 */
export function extractQuestions(text, headings = []) {
    const questionMap = new Map();
    const questionRegex = /\b(how|what|why|when|where|which|who|can|does|is|are)\b[^?.]+\?/gi;
    // 1. Check headings
    for (const h of headings) {
        const trimmed = h.trim();
        if (trimmed.endsWith('?') || /^(how|what|why|when|where|can|is)\b/i.test(trimmed)) {
            const q = trimmed.endsWith('?') ? trimmed : `${trimmed}?`;
            questionMap.set(q.toLowerCase(), {
                question: q,
                headingContext: trimmed,
                frequency: 2,
            });
        }
    }
    // 2. Check sentences in body
    const sentences = splitSentences(text);
    for (const s of sentences) {
        const matches = s.match(questionRegex);
        if (matches) {
            for (const m of matches) {
                const cleanQ = m.trim();
                const key = cleanQ.toLowerCase();
                const existing = questionMap.get(key);
                if (existing) {
                    questionMap.set(key, { ...existing, frequency: existing.frequency + 1 });
                }
                else {
                    questionMap.set(key, { question: cleanQ, frequency: 1 });
                }
            }
        }
    }
    return Array.from(questionMap.values())
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 15);
}
/**
 * Extracts entities (Organizations, Technologies, Products, Concepts) with salience scores.
 */
export function extractEntities(text, html) {
    const entitiesMap = new Map();
    // 1. Scan for known technologies
    const lowerWords = tokenizeWords(text);
    for (const w of lowerWords) {
        if (KNOWN_TECHNOLOGIES.has(w)) {
            const key = `tech:${w}`;
            const existing = entitiesMap.get(key);
            if (existing)
                existing.frequency++;
            else
                entitiesMap.set(key, { name: w.toUpperCase() === 'SEO' ? 'SEO' : w[0].toUpperCase() + w.slice(1), type: 'technology', frequency: 1 });
        }
        if (KNOWN_ORGANIZATIONS.has(w)) {
            const key = `org:${w}`;
            const existing = entitiesMap.get(key);
            if (existing)
                existing.frequency++;
            else
                entitiesMap.set(key, { name: w[0].toUpperCase() + w.slice(1), type: 'organization', frequency: 1 });
        }
    }
    // 2. Scan for capitalized title entities (e.g., "Google Search Console", "Docker Container")
    const titlePattern = /\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)+)\b/g;
    const matches = text.matchAll(titlePattern);
    for (const m of matches) {
        const phrase = m[1]?.trim();
        if (!phrase)
            continue;
        const lowerPhrase = phrase.toLowerCase();
        const parts = lowerPhrase.split(/\s+/);
        if (parts.every(p => ENGLISH_STOPWORDS.has(p)))
            continue;
        let type = 'concept';
        if (parts.some(p => KNOWN_ORGANIZATIONS.has(p)) || /(inc|corp|llc|gmbh|ltd|labs|group|foundation)$/i.test(phrase)) {
            type = 'organization';
        }
        else if (parts.some(p => KNOWN_TECHNOLOGIES.has(p))) {
            type = 'technology';
        }
        else if (/(tool|software|platform|suite|app|engine|system|api)$/i.test(phrase)) {
            type = 'product';
        }
        const key = `${type}:${lowerPhrase}`;
        const existing = entitiesMap.get(key);
        if (existing)
            existing.frequency++;
        else
            entitiesMap.set(key, { name: phrase, type, frequency: 1 });
    }
    // 3. Schema.org entities from HTML if provided
    if (html) {
        const schemaMatches = html.matchAll(/"@type"\s*:\s*"([A-Za-z0-9]+)"/gi);
        for (const sm of schemaMatches) {
            if (sm[1]) {
                const schemaType = sm[1];
                const key = `concept:schema_${schemaType.toLowerCase()}`;
                if (!entitiesMap.has(key)) {
                    entitiesMap.set(key, { name: `Schema:${schemaType}`, type: 'concept', frequency: 2 });
                }
            }
        }
    }
    // Calculate salience relative to total entities detected
    const totalOccurrences = Array.from(entitiesMap.values()).reduce((sum, e) => sum + e.frequency, 0) || 1;
    const result = Array.from(entitiesMap.values()).map(e => ({
        name: e.name,
        type: e.type,
        frequency: e.frequency,
        salience: Number(Math.min(1.0, (e.frequency / totalOccurrences) * 3).toFixed(3)),
    }));
    result.sort((a, b) => b.frequency - a.frequency);
    return result.slice(0, 25);
}
// ---------------------------------------------------------------------------
// 6. Content Quality & Repetition Analysis
// ---------------------------------------------------------------------------
/**
 * Evaluates page content quality, lexical diversity, repetition entropy, and keyword stuffing.
 */
export function evaluateContentQuality(text) {
    const words = tokenizeWords(text);
    const wordCount = words.length;
    if (wordCount === 0) {
        return {
            wordCount: 0,
            uniqueWordCount: 0,
            lexicalDiversity: 0,
            repetitionEntropy: 0,
            isKeywordStuffed: false,
            stuffedTerms: [],
            qualityGrade: 'thin',
        };
    }
    // 1. Stemmed unique vocabulary
    const stems = words.map(stemWord);
    const uniqueStems = new Set(stems);
    const uniqueWordCount = uniqueStems.size;
    // Root Type-Token Ratio: R = V / sqrt(N). Standard robust metric for varying text lengths.
    const lexicalDiversity = Number((uniqueWordCount / Math.sqrt(wordCount)).toFixed(2));
    // 2. 3-gram repetition entropy
    let trigramCount = 0;
    const trigramSet = new Set();
    for (let i = 0; i < words.length - 2; i++) {
        const trigram = `${words[i]}_${words[i + 1]}_${words[i + 2]}`;
        trigramSet.add(trigram);
        trigramCount++;
    }
    const repetitionEntropy = trigramCount > 0
        ? Number((trigramSet.size / trigramCount).toFixed(3))
        : 1.0;
    // 3. Keyword Stuffing Detection: check non-stopword stem frequencies
    const stemFreqMap = new Map();
    for (let i = 0; i < words.length; i++) {
        const rawWord = words[i];
        if (ENGLISH_STOPWORDS.has(rawWord) || rawWord.length <= 2)
            continue;
        const stem = stems[i];
        const entry = stemFreqMap.get(stem);
        if (entry) {
            entry.count++;
        }
        else {
            stemFreqMap.set(stem, { term: rawWord, count: 1 });
        }
    }
    const stuffedTerms = [];
    // Stuffed if density > 7.0% and count >= 8 in a text of at least 100 words
    if (wordCount >= 100) {
        for (const { term, count } of stemFreqMap.values()) {
            const density = Number((count / wordCount).toFixed(4));
            if (density > 0.07 && count >= 8) {
                stuffedTerms.push({ term, density });
            }
        }
    }
    stuffedTerms.sort((a, b) => b.density - a.density);
    const isKeywordStuffed = stuffedTerms.length > 0;
    // 4. Quality Grade Assignment
    let qualityGrade;
    if (wordCount < 150) {
        qualityGrade = 'thin';
    }
    else if (isKeywordStuffed || repetitionEntropy < 0.25 || lexicalDiversity < 3.0) {
        qualityGrade = 'poor';
    }
    else if (wordCount >= 600 && lexicalDiversity >= 6.5 && repetitionEntropy >= 0.70) {
        qualityGrade = 'excellent';
    }
    else if (wordCount >= 300 && lexicalDiversity >= 5.0) {
        qualityGrade = 'good';
    }
    else {
        qualityGrade = 'moderate';
    }
    return {
        wordCount,
        uniqueWordCount,
        lexicalDiversity,
        repetitionEntropy,
        isKeywordStuffed,
        stuffedTerms,
        qualityGrade,
    };
}
// ---------------------------------------------------------------------------
// 7. Page Intent Profiler & Intent Alignment Auditing
// ---------------------------------------------------------------------------
/**
 * Analyzes HTML markup, schema types, buttons, forms, and body text
 * to determine the primary search intent supported by the page.
 */
export function profilePageIntent(html, text) {
    const lowerHtml = html.toLowerCase();
    const lowerText = text.toLowerCase();
    const signals = [];
    let transScore = 0.1;
    let commScore = 0.1;
    let navScore = 0.1;
    let infoScore = 0.3; // Web baseline prior
    // Transactional signals: checkout, cart, buy now, pricing tables, payment inputs
    if (/\b(add\s*to\s*cart|buy\s*now|checkout|order\s*now|subscribe\s*now|purchase)\b/i.test(lowerHtml)) {
        transScore += 3.5;
        signals.push('transactional_cta_buttons');
    }
    if (/"@type"\s*:\s*"(Product|Offer)"/i.test(lowerHtml)) {
        transScore += 2.5;
        signals.push('schema_product_offer');
    }
    if (/<input[^>]+name=["'](card|cvv|cc|payment|stripe)/i.test(lowerHtml)) {
        transScore += 3.0;
        signals.push('payment_input_fields');
    }
    // Commercial signals: comparison tables, review scores, pros and cons, top alternatives
    if (/\b(vs|versus|comparison|review|reviews|best\s+\w+|top\s+\d+|pros\s+and\s+cons)\b/i.test(lowerText)) {
        commScore += 2.5;
        signals.push('commercial_investigation_keywords');
    }
    if (/"@type"\s*:\s*"(Review|AggregateRating)"/i.test(lowerHtml)) {
        commScore += 2.8;
        signals.push('schema_review_ratings');
    }
    if (/<table\b/i.test(lowerHtml) && /\b(feature|plan|tier|spec)/i.test(lowerText)) {
        commScore += 1.8;
        signals.push('comparison_matrix_table');
    }
    // Navigational signals: sign-in/login forms, account dashboards, portal links
    if (/\b(sign\s*in|login|log\s*in|my\s*account|customer\s*portal|client\s*login)\b/i.test(lowerHtml)) {
        navScore += 3.0;
        signals.push('portal_login_interface');
    }
    if (/<form\b[^>]*\b(login|signin|auth)/i.test(lowerHtml)) {
        navScore += 2.5;
        signals.push('auth_form_detected');
    }
    // Informational signals: guides, FAQs, how-to, documentation, long-form articles
    if (/\b(how\s*to|guide|tutorial|explained|what\s*is|documentation|overview|step-by-step)\b/i.test(lowerText)) {
        infoScore += 2.6;
        signals.push('educational_guide_language');
    }
    if (/"@type"\s*:\s*"(Article|NewsArticle|TechArticle|BlogPosting|FAQPage|HowTo)"/i.test(lowerHtml)) {
        infoScore += 2.8;
        signals.push('schema_article_faq');
    }
    const headingQuestions = (html.match(/<h[23][^>]*>[^<]*\?[^<]*<\/h[23]>/gi) || []).length;
    if (headingQuestions >= 2) {
        infoScore += 1.5;
        signals.push('interrogative_faq_headings');
    }
    // Softmax normalization
    const maxScore = Math.max(transScore, commScore, navScore, infoScore);
    const expTrans = Math.exp(transScore - maxScore);
    const expComm = Math.exp(commScore - maxScore);
    const expNav = Math.exp(navScore - maxScore);
    const expInfo = Math.exp(infoScore - maxScore);
    const sumExp = expTrans + expComm + expNav + expInfo;
    const pTrans = Number((expTrans / sumExp).toFixed(4));
    const pComm = Number((expComm / sumExp).toFixed(4));
    const pNav = Number((expNav / sumExp).toFixed(4));
    const pInfo = Number((expInfo / sumExp).toFixed(4));
    const entries = [
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
/**
 * Audits whether a landing page satisfies the search intent of a target query.
 */
export function auditIntentAlignment(query, pageHtml, pageText, targetUrl = '') {
    const queryDist = classifySearchIntentProbabilities(query);
    const pageDist = profilePageIntent(pageHtml, pageText);
    // Compute intent compatibility vector product
    const intents = ['Informational', 'Commercial', 'Navigational', 'Transactional'];
    let dotProduct = 0;
    for (const intent of intents) {
        dotProduct += queryDist.probabilities[intent] * pageDist.probabilities[intent];
    }
    // Rescale to 0 - 100 with baseline boost for compatible neighbors (e.g. Commercial <-> Transactional)
    let baseScore = Math.round(dotProduct * 100);
    if (queryDist.primaryIntent === pageDist.primaryIntent) {
        baseScore = Math.max(85, baseScore);
    }
    else if ((queryDist.primaryIntent === 'Commercial' && pageDist.primaryIntent === 'Transactional') ||
        (queryDist.primaryIntent === 'Transactional' && pageDist.primaryIntent === 'Commercial')) {
        baseScore = Math.max(68, baseScore);
    }
    else if ((queryDist.primaryIntent === 'Informational' && pageDist.primaryIntent === 'Commercial') ||
        (queryDist.primaryIntent === 'Commercial' && pageDist.primaryIntent === 'Informational')) {
        baseScore = Math.max(60, baseScore);
    }
    const alignmentScore = Math.min(100, Math.max(10, baseScore));
    const isAligned = alignmentScore >= 65;
    const mismatchReasons = [];
    const recommendations = [];
    if (!isAligned) {
        mismatchReasons.push(`Search query intent is primarily ${queryDist.primaryIntent} (${Math.round(queryDist.confidence * 100)}%), but page is designed for ${pageDist.primaryIntent} (${Math.round(pageDist.confidence * 100)}%).`);
        if (queryDist.primaryIntent === 'Transactional' && pageDist.primaryIntent === 'Informational') {
            mismatchReasons.push('Searcher intends to purchase, but the page provides educational content with no clear checkout or conversion path.');
            recommendations.push('Add prominent purchase/pricing calls-to-action (CTAs) and product specifications above the fold.');
        }
        else if (queryDist.primaryIntent === 'Informational' && pageDist.primaryIntent === 'Transactional') {
            mismatchReasons.push('Searcher seeks educational answers or tutorials, but is confronted with a direct sales pitch.');
            recommendations.push('Add comprehensive informational sections, FAQs, and step-by-step guides before sales CTAs.');
        }
        else if (queryDist.primaryIntent === 'Commercial' && pageDist.primaryIntent === 'Navigational') {
            mismatchReasons.push('Searcher is evaluating options and comparisons, but landed on an account login portal.');
            recommendations.push('Provide feature comparison tables, reviews, and product differentiators.');
        }
        else {
            recommendations.push(`Align content headings and page elements with ${queryDist.primaryIntent} search intent.`);
        }
    }
    return {
        query,
        targetUrl,
        queryIntent: queryDist.primaryIntent,
        pageIntent: pageDist.primaryIntent,
        alignmentScore,
        isAligned,
        mismatchReasons,
        recommendations,
        queryIntentDistribution: queryDist,
        pageIntentProfile: pageDist,
        provenance: {
            tier: 'statistical_model',
            isFactual: false,
            dataSource: 'Open Semrush Local NLP Intent Matcher',
            methodology: 'Cosine dot-product over 4-class multi-signal intent distributions',
            confidence: 'modeled',
            warning: 'Intent alignment indicates topical relevance; search engine rankings depend on additional off-page and user signals.',
        },
    };
}
// ---------------------------------------------------------------------------
// 8. Semantic Content Gap Analysis
// ---------------------------------------------------------------------------
/**
 * Compares target page content against competitor page content to discover
 * missing concepts, subtopics, and unanswered questions.
 */
export function analyzeSemanticContentGap(targetHtmlOrText, competitorHtmlOrText, targetUrl = 'target-page', competitorUrl = 'competitor-page') {
    const targetText = targetHtmlOrText.includes('<') ? cleanHtmlToText(targetHtmlOrText) : targetHtmlOrText;
    const competitorText = competitorHtmlOrText.includes('<') ? cleanHtmlToText(competitorHtmlOrText) : competitorHtmlOrText;
    const targetConcepts = extractSalientConcepts(targetText, 40);
    const competitorConcepts = extractSalientConcepts(competitorText, 40);
    const targetStemSet = new Set(targetConcepts.map(c => c.stem));
    const competitorStemSet = new Set(competitorConcepts.map(c => c.stem));
    const sharedConcepts = [];
    const missingSubtopics = [];
    for (const c of competitorConcepts) {
        if (targetStemSet.has(c.stem)) {
            sharedConcepts.push(c.term);
        }
        else {
            missingSubtopics.push(c.term);
        }
    }
    // Extract questions answered
    const targetQuestions = extractQuestions(targetText);
    const competitorQuestions = extractQuestions(competitorText);
    const targetQText = targetQuestions.map(q => q.question.toLowerCase()).join(' ');
    const unansweredQuestions = [];
    for (const cq of competitorQuestions) {
        const qWords = tokenizeWords(cq.question).filter(w => !ENGLISH_STOPWORDS.has(w));
        const matchedCount = qWords.filter(w => targetQText.includes(w)).length;
        // If less than half the key question words appear in target, mark as unanswered
        if (matchedCount < Math.max(1, Math.floor(qWords.length * 0.5))) {
            unansweredQuestions.push(cq.question);
        }
    }
    const unionCount = new Set([...targetStemSet, ...competitorStemSet]).size || 1;
    const topicalCoverageScore = Math.round((sharedConcepts.length / Math.min(competitorConcepts.length || 1, unionCount)) * 100);
    return {
        targetUrl,
        competitorUrl,
        topicalCoverageScore: Math.min(100, Math.max(0, topicalCoverageScore)),
        sharedConcepts: Array.from(new Set(sharedConcepts)).slice(0, 20),
        missingSubtopics: Array.from(new Set(missingSubtopics)).slice(0, 20),
        unansweredQuestions: Array.from(new Set(unansweredQuestions)).slice(0, 10),
        targetConceptCount: targetConcepts.length,
        competitorConceptCount: competitorConcepts.length,
        provenance: {
            tier: 'statistical_model',
            isFactual: false,
            dataSource: 'Open Semrush Local TF-IDF Concept Comparator',
            methodology: 'TF-IDF concept salience difference & interrogative sentence coverage',
            confidence: 'modeled',
            warning: 'Content gap identifies topical coverage differences; search engine algorithms evaluate qualitative authority and user interaction beyond raw subtopics.',
        },
    };
}
// ---------------------------------------------------------------------------
// 9. Semantic Topic Clustering with Intent Distributions
// ---------------------------------------------------------------------------
/**
 * Computes semantic similarity between two keyword strings using hybrid
 * word-stem overlap and character n-gram Jaccard index.
 */
export function calculateSemanticQuerySimilarity(a, b) {
    if (a.toLowerCase() === b.toLowerCase())
        return 1.0;
    const stemsA = new Set(extractContentStems(a));
    const stemsB = new Set(extractContentStems(b));
    if (stemsA.size === 0 || stemsB.size === 0)
        return 0.0;
    let stemOverlap = 0;
    for (const s of stemsA) {
        if (stemsB.has(s))
            stemOverlap++;
    }
    const stemUnion = stemsA.size + stemsB.size - stemOverlap;
    const stemJaccard = stemUnion > 0 ? stemOverlap / stemUnion : 0;
    // Character 3-gram fallback for spelling variations
    const charNgramsA = new Set();
    const normA = `_${a.toLowerCase().replace(/\s+/g, '_')}_`;
    for (let i = 0; i <= normA.length - 3; i++)
        charNgramsA.add(normA.substring(i, i + 3));
    const charNgramsB = new Set();
    const normB = `_${b.toLowerCase().replace(/\s+/g, '_')}_`;
    for (let i = 0; i <= normB.length - 3; i++)
        charNgramsB.add(normB.substring(i, i + 3));
    let charOverlap = 0;
    for (const cn of charNgramsA) {
        if (charNgramsB.has(cn))
            charOverlap++;
    }
    const charUnion = charNgramsA.size + charNgramsB.size - charOverlap;
    const charJaccard = charUnion > 0 ? charOverlap / charUnion : 0;
    // 70% weight on stemmed token overlap, 30% weight on char n-gram similarity
    return Number((stemJaccard * 0.7 + charJaccard * 0.3).toFixed(4));
}
/**
 * Groups keywords into semantic topic clusters with subtopic breakdown
 * and intent distributions.
 */
export function clusterKeywordsSemantically(keywords, similarityThreshold = 0.35) {
    const clusters = [];
    for (const item of keywords) {
        const vol = item.searchVolume ?? 0;
        const diff = item.difficulty ?? 0;
        const intentDist = classifySearchIntentProbabilities(item.keyword);
        const intent = intentDist.primaryIntent;
        let matched = false;
        for (const cluster of clusters) {
            const sim = calculateSemanticQuerySimilarity(item.keyword, cluster.theme);
            if (sim >= similarityThreshold) {
                cluster.items.push({ keyword: item.keyword, volume: vol, difficulty: diff, intent });
                // Update theme to highest-volume keyword in cluster
                if (vol > (cluster.items[0]?.volume ?? 0)) {
                    cluster.theme = item.keyword;
                }
                matched = true;
                break;
            }
        }
        if (!matched) {
            clusters.push({
                theme: item.keyword,
                items: [{ keyword: item.keyword, volume: vol, difficulty: diff, intent }],
            });
        }
    }
    return clusters.map(c => {
        const totalVolume = c.items.reduce((sum, i) => sum + i.volume, 0);
        const avgDiff = Math.round(c.items.reduce((sum, i) => sum + i.difficulty, 0) / (c.items.length || 1));
        // Calculate intent distribution
        const intentCounts = { Informational: 0, Commercial: 0, Navigational: 0, Transactional: 0 };
        for (const item of c.items) {
            intentCounts[item.intent]++;
        }
        const totalItems = c.items.length || 1;
        const intentDistribution = {
            Informational: Number((intentCounts.Informational / totalItems).toFixed(2)),
            Commercial: Number((intentCounts.Commercial / totalItems).toFixed(2)),
            Navigational: Number((intentCounts.Navigational / totalItems).toFixed(2)),
            Transactional: Number((intentCounts.Transactional / totalItems).toFixed(2)),
        };
        // Determine primary cluster intent
        const entries = Object.entries(intentDistribution);
        entries.sort((a, b) => b[1] - a[1]);
        const primaryIntent = entries[0]?.[0] ?? 'Informational';
        // Extract subtopics (unique words that appear alongside cluster theme)
        const themeWords = new Set(tokenizeWords(c.theme));
        const subtopicSet = new Set();
        for (const item of c.items) {
            const words = tokenizeWords(item.keyword);
            for (const w of words) {
                if (!themeWords.has(w) && !ENGLISH_STOPWORDS.has(w)) {
                    subtopicSet.add(w);
                }
            }
        }
        return {
            clusterTheme: c.theme,
            keywords: c.items.map(i => i.keyword),
            primaryIntent,
            intentDistribution,
            averageDifficulty: avgDiff,
            totalVolume,
            subtopics: Array.from(subtopicSet).slice(0, 8),
        };
    });
}
