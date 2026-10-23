import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateEvidenceBackedRecommendations,
  addTrackedKeyword,
  addKeywordAnnotation,
  getTrackedKeywords,
} from '../dist/index.js';

test('Evidence-Backed Recommendations: maps crawl issues into actionable recommendations with empirical evidence', () => {
  const mockAuditReport = {
    targetUrl: 'https://example-saas.com',
    scannedPagesCount: 1,
    healthScore: 78,
    totalErrors: 1,
    totalWarnings: 2,
    totalNotices: 1,
    pages: [
      {
        url: 'https://example-saas.com/pricing',
        statusCode: 200,
        loadTimeMs: 450,
        ttfbMs: 1950,
        title: 'Pricing',
        metaDescription: null,
        canonical: null,
        h1Count: 0,
        wordCount: 120,
        imagesTotal: 4,
        imagesMissingAlt: 2,
        internalLinksCount: 12,
        externalLinksCount: 3,
        isIndexable: true,
        schemaTypes: [],
        openGraphComplete: false,
        pageSizeKb: 45,
        compression: 'gzip',
        securityHeaders: { hsts: false, csp: false, xFrameOptions: true, xContentTypeOptions: true },
        spaDetected: false,
        issues: [
          {
            code: 'H1_MISSING',
            severity: 'error',
            message: 'Missing <h1> tag',
            recommendation: 'Add a single prominent <h1> tag matching page search intent.',
            evidence: { metric: 'H1_COUNT', observed: 0, expected: 1 },
          },
          {
            code: 'SLOW_TTFB',
            severity: 'warning',
            message: 'Slow Time-to-First-Byte (TTFB): 1950ms (optimal < 800ms)',
            recommendation: 'Optimize backend response latency or leverage edge caching.',
            evidence: { metric: 'TTFB_MS', observed: 1950, expected: '<800ms' },
          },
          {
            code: 'TITLE_TOO_SHORT',
            severity: 'warning',
            message: 'Title is too short (7 characters)',
            recommendation: 'Expand title to 30-60 characters with commercial qualifiers.',
            evidence: { metric: 'TITLE_LENGTH', observed: 7, expected: '30-60' },
          },
        ],
      },
    ],
  };

  const recs = generateEvidenceBackedRecommendations(mockAuditReport);
  assert.ok(recs.length >= 3);

  const h1Rec = recs.find(r => r.title.includes('H1 MISSING'));
  assert.ok(h1Rec);
  assert.equal(h1Rec.expectedImpact, 'high');
  assert.equal(h1Rec.confidence, 0.95);
  assert.equal(h1Rec.evidence.metric, 'H1_MISSING');
  assert.equal(h1Rec.evidence.observedValue, 0);
  assert.equal(h1Rec.evidence.benchmarkValue, 1);
  assert.equal(h1Rec.evidence.sourceUrlOrQuery, 'https://example-saas.com/pricing');
  assert.ok(h1Rec.rationale.length > 20);

  const ttfbRec = recs.find(r => r.title.includes('SLOW TTFB'));
  assert.ok(ttfbRec);
  assert.equal(ttfbRec.category, 'technical');
  assert.equal(ttfbRec.evidence.observedValue, 1950);
});

test('Rank Tracker: addKeywordAnnotation attaches verifiable change notes to tracked keywords', () => {
  const dbPath = `data/test_annotations_${Date.now()}.json`;
  const domain = 'acme-corp.com';
  const kw = addTrackedKeyword(domain, 'b2b crm software', {
    dbPath,
    device: 'mobile',
    country: 'uk',
    searchEngine: 'google',
  });

  assert.equal(kw.domain, domain);
  assert.equal(kw.device, 'mobile');
  assert.equal(kw.country, 'uk');

  const ok = addKeywordAnnotation(domain, kw.id, 'Migrated pricing page and updated title tag', '2026-10-23', dbPath);
  assert.equal(ok, true);

  const keywords = getTrackedKeywords(domain, dbPath);
  assert.equal(keywords.length, 1);
  assert.equal(keywords[0].annotations?.length, 1);
  assert.equal(keywords[0].annotations[0].note, 'Migrated pricing page and updated title tag');
  assert.equal(keywords[0].annotations[0].date, '2026-10-23');

  // Cleanup
  import('node:fs').then(fs => {
    try { fs.unlinkSync(dbPath); } catch {}
  });
});
