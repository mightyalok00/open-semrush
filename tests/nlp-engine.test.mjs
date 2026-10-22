import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stemWord,
  tokenizeWords,
  cleanHtmlToText,
  extractContentStems,
  extractSalientConcepts,
  extractEntities,
  extractQuestions,
  evaluateContentQuality,
  profilePageIntent,
  auditIntentAlignment,
  analyzeSemanticContentGap,
  calculateSemanticQuerySimilarity,
  clusterKeywordsSemantically,
} from '../dist/index.js';

test('NLP Porter Stemmer: Reduces inflected forms to consistent morphological roots', () => {
  assert.equal(stemWord('optimizations'), 'optim');
  assert.equal(stemWord('clustering'), 'cluster');
  assert.equal(stemWord('stemmed'), 'stem');
  assert.equal(stemWord('analytical'), 'analyt');
  assert.equal(stemWord('transactional'), 'transact');
  assert.equal(stemWord('competitors'), 'competitor');
  assert.equal(stemWord('crawling'), 'crawl');
});

test('NLP Tokenization & Cleaning: Strips HTML and extracts normalized content tokens', () => {
  const sampleHtml = `<div class="container">
    <h1>Technical SEO Audit &amp; Performance</h1>
    <p>Modern crawlers must inspect <a href="/links">canonical</a> declarations and schema markup.</p>
    <!-- Comment to remove -->
    <script>const x = 10;</script>
  </div>`;

  const cleanText = cleanHtmlToText(sampleHtml);
  assert.ok(!cleanText.includes('<div'));
  assert.ok(!cleanText.includes('<script'));
  assert.ok(!cleanText.includes('const x = 10;'));
  assert.ok(cleanText.includes('Technical SEO Audit & Performance'));

  const words = tokenizeWords(cleanText);
  assert.ok(words.includes('technical'));
  assert.ok(words.includes('seo'));
  assert.ok(words.includes('canonical'));

  const stems = extractContentStems(cleanText);
  assert.ok(stems.includes('canon'));
  assert.ok(stems.includes('perform'));
});

test('NLP Feature 1: Semantic Keyword Clustering groups queries by meaning and intent', () => {
  const querySet = [
    { keyword: 'learn python online', searchVolume: 12000, difficulty: 45 },
    { keyword: 'online python tutorial for beginners', searchVolume: 8500, difficulty: 42 },
    { keyword: 'how to learn python programming', searchVolume: 15000, difficulty: 50 },
    { keyword: 'buy running shoes discount', searchVolume: 9000, difficulty: 65 },
    { keyword: 'cheap sneakers order online', searchVolume: 6000, difficulty: 60 },
    { keyword: 'best running shoe reviews', searchVolume: 7500, difficulty: 58 },
  ];

  const clusters = clusterKeywordsSemantically(querySet, 0.25);

  // Expect distinct clusters for python programming vs footwear
  assert.ok(clusters.length >= 2, `Expected at least 2 distinct clusters, got ${clusters.length}`);

  const pythonCluster = clusters.find(c => c.keywords.some(k => k.includes('python')));
  assert.ok(pythonCluster, 'Should form a Python-focused thematic cluster');
  assert.equal(pythonCluster.primaryIntent, 'Informational');
  assert.ok(pythonCluster.totalVolume >= 30000);
  assert.ok(pythonCluster.keywords.length >= 3);

  const shoeCluster = clusters.find(c => c.keywords.some(k => k.includes('shoes') || k.includes('sneakers')));
  assert.ok(shoeCluster, 'Should form a shoe-focused cluster');
  assert.ok(shoeCluster.intentDistribution.Transactional > 0 || shoeCluster.intentDistribution.Commercial > 0);
});

test('NLP Feature 1: Semantic Query Similarity captures synonyms and token variations', () => {
  const identical = calculateSemanticQuerySimilarity('technical seo audit', 'technical seo audit');
  assert.equal(identical, 1.0);

  const highSimilarity = calculateSemanticQuerySimilarity(
    'best mechanical keyboards for typing',
    'best keyboards for typing mechanical'
  );
  assert.ok(highSimilarity >= 0.7, `Expected high similarity (got ${highSimilarity})`);

  const lowSimilarity = calculateSemanticQuerySimilarity(
    'python machine learning tutorial',
    'cheap flights to paris hotel'
  );
  assert.ok(lowSimilarity < 0.15, `Expected near zero similarity (got ${lowSimilarity})`);
});

test('NLP Feature 2: Search Intent vs Page Content Alignment detects high satisfaction', () => {
  const transactionalPageHtml = `
    <html>
      <head><title>Buy UltraFit Running Shoes | Official Store</title></head>
      <body>
        <h1>UltraFit Running Shoes - In Stock</h1>
        <p>Select your size and add to cart for free 2-day delivery.</p>
        <div class="pricing">$129.99 (20% discount applied)</div>
        <button type="submit">Add to Cart</button>
        <button type="button">Checkout Now</button>
        <form action="/checkout" method="POST">
          <input type="text" name="card_number" placeholder="Card number">
        </form>
      </body>
    </html>
  `;
  const cleanText = cleanHtmlToText(transactionalPageHtml);

  const audit = auditIntentAlignment('buy ultrafit running shoes online', transactionalPageHtml, cleanText, 'https://store.example.com/shoes');

  assert.equal(audit.queryIntent, 'Transactional');
  assert.equal(audit.pageIntent, 'Transactional');
  assert.ok(audit.isAligned, 'Query and page should be strongly aligned');
  assert.ok(audit.alignmentScore >= 80, `Expected alignment >= 80, got ${audit.alignmentScore}`);
  assert.equal(audit.mismatchReasons.length, 0);
  assert.equal(audit.provenance.tier, 'statistical_model');
});

test('NLP Feature 2: Search Intent vs Page Content Alignment flags severe mismatches', () => {
  const informationalBlogHtml = `
    <html>
      <head><title>The History of Running Shoes: 1890 to Modern Era</title></head>
      <body>
        <h1>The Evolution of Athletic Footwear</h1>
        <p>In the late 19th century, rubber-soled athletic shoes were first developed. This comprehensive educational guide explores the history of vulcanized rubber.</p>
        <h2>How Were Early Running Shoes Made?</h2>
        <p>Early marathoners wore leather spikes crafted by hand without synthetic foam.</p>
      </body>
    </html>
  `;
  const cleanText = cleanHtmlToText(informationalBlogHtml);

  // User query is commercial/transactional with intent to buy
  const audit = auditIntentAlignment('order custom marathon spikes discount price', informationalBlogHtml, cleanText, 'https://blog.example.com/history');

  assert.equal(audit.queryIntent, 'Transactional');
  assert.equal(audit.pageIntent, 'Informational');
  assert.equal(audit.isAligned, false, 'Transactional query must not align with pure historical blog');
  assert.ok(audit.alignmentScore < 65, `Expected alignment < 65, got ${audit.alignmentScore}`);
  assert.ok(audit.mismatchReasons.length > 0, 'Must provide explanatory mismatch reasons');
  assert.ok(audit.recommendations.some(r => r.includes('calls-to-action') || r.includes('pricing')), 'Must recommend transactional CTAs');
});

test('NLP Feature 3: Semantic Content Gap identifies missing subtopics and unanswered questions', () => {
  const targetPageText = `
    Docker Container Deployment Guide.
    Learn how to build Docker container images, configure docker-compose, and deploy Node.js web applications on Linux servers.
    Containerization packages code and dependencies together for reliable execution across staging and production.
  `;

  const competitorPageText = `
    Complete Docker Production Guide: Microservices, Security & Kubernetes.
    Learn how to build Docker container images, configure docker-compose, and deploy Node.js applications.
    How do you configure multi-stage Docker builds to reduce image size?
    Multi-stage builds separate build dependencies from runtime binaries.
    Why is rootless container execution critical for production security?
    Rootless mode isolates privileges and prevents container breakout vulnerabilities.
    Deploying container pods to Kubernetes clusters using Helm charts and ingress controllers.
  `;

  const gap = analyzeSemanticContentGap(targetPageText, competitorPageText, 'https://my-site.com/docker', 'https://competitor.com/docker');

  assert.ok(gap.sharedConcepts.some(c => c.toLowerCase().includes('docker') || c.toLowerCase().includes('container') || c.toLowerCase().includes('build')));
  assert.ok(gap.missingSubtopics.some(s => s.toLowerCase().includes('secur') || s.toLowerCase().includes('kubernet') || s.toLowerCase().includes('microservic') || s.toLowerCase().includes('rootless')));
  assert.ok(gap.unansweredQuestions.length >= 1, 'Should detect unanswered questions from competitor');
  assert.ok(gap.unansweredQuestions.some(q => q.includes('multi-stage') || q.includes('rootless')));
  assert.ok(gap.topicalCoverageScore >= 20 && gap.topicalCoverageScore <= 80, `Expected bounded coverage score (got ${gap.topicalCoverageScore})`);
  assert.equal(gap.provenance.tier, 'statistical_model');
});

test('NLP Feature 4: Named Entity Extraction discovers tech, organizations, and concepts', () => {
  const content = `
    Google and Cloudflare announced next-generation DNS and SSL edge computing protocols.
    Developers using TypeScript, React, and Docker can deploy high-performance applications with schema markup.
    The OpenAI GPT-4 model integrates with GitHub workflows and PostgreSQL databases.
  `;

  const entities = extractEntities(content);

  const orgs = entities.filter(e => e.type === 'organization').map(e => e.name.toLowerCase());
  assert.ok(orgs.includes('google') || orgs.includes('cloudflare') || orgs.includes('github') || orgs.includes('openai'));

  const tech = entities.filter(e => e.type === 'technology').map(e => e.name.toLowerCase());
  assert.ok(tech.includes('typescript') || tech.includes('react') || tech.includes('docker') || tech.includes('dns') || tech.includes('postgresql'));

  assert.ok(entities.every(e => e.salience >= 0 && e.salience <= 1.0));
  assert.ok(entities.every(e => e.frequency >= 1));
});

test('NLP Feature 4: Content Quality Evaluation measures lexical diversity and flags stuffing', () => {
  // 1. High quality diverse content
  const richContent = `
    Search engine optimization encompasses technical site audits, informative keyword discovery,
    structural internal linking hierarchies, and mobile responsiveness. Modern web architectures
    prioritize performance indicators including Largest Contentful Paint, Cumulative Layout Shift,
    and Interaction to Next Paint. Server-side rendering reduces time to interactive while structured
    JSON-LD annotations enable rich interactive search snippets for users across mobile devices.
  `;
  const richQuality = evaluateContentQuality(richContent);
  assert.ok(richQuality.lexicalDiversity > 4.0, `Expected healthy lexical diversity (got ${richQuality.lexicalDiversity})`);
  assert.equal(richQuality.isKeywordStuffed, false);

  // 2. Keyword stuffed unnatural content
  const stuffedTokens = [];
  for (let i = 0; i < 20; i++) {
    stuffedTokens.push('cheap', 'loans', 'online', 'apply', 'cheap', 'loans', 'today', 'instant', 'cheap', 'loans', 'fast');
  }
  const stuffedContent = stuffedTokens.join(' ');
  const stuffedQuality = evaluateContentQuality(stuffedContent);

  assert.equal(stuffedQuality.isKeywordStuffed, true, 'Should detect aggressive keyword stuffing');
  assert.ok(stuffedQuality.stuffedTerms.length > 0);
  assert.ok(stuffedQuality.stuffedTerms.some(t => t.term === 'cheap' || t.term === 'loans'));
  assert.equal(stuffedQuality.qualityGrade, 'poor');

  // 3. Thin content
  const thinContent = 'This is just a few words on a page.';
  const thinQuality = evaluateContentQuality(thinContent);
  assert.equal(thinQuality.qualityGrade, 'thin');
});
