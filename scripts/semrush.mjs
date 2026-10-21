#!/usr/bin/env node
import fs from 'node:fs';

// Import compiled Semrush engine
let semrushModule;
for (const p of ['../dist/index.js', '../dist/semrush/index.js']) {
  try {
    semrushModule = await import(p);
    break;
  } catch {}
}

if (!semrushModule) {
  console.error('Error: Could not load Semrush engine. Run `npm run build` first.');
  process.exit(1);
}

const { 
  runSiteAudit, 
  auditSinglePage, 
  analyzeKeyword, 
  generateKeywordVariations, 
  generateDomainOverview, 
  compareKeywordGap,
  generateBacklinkReport 
} = semrushModule;

function printHelp() {
  console.log(`
Open Semrush — SEO & Competitive Intelligence CLI Suite

Usage:
  node scripts/semrush.mjs audit <url> [--pages <n>]
  node scripts/semrush.mjs keyword <term>
  node scripts/semrush.mjs domain <domain>
  node scripts/semrush.mjs gap <domainA> <domainB>
  node scripts/semrush.mjs backlinks <domain>

Commands:
  audit <url>               Run full Technical SEO crawl and health score evaluation
  keyword <term>            Analyze search intent, volume, CPC, and Keyword Difficulty (KD%)
  domain <domain>           Estimate organic traffic, top keywords, and competitors
  gap <domainA> <domainB>   Compare shared, missing, and unique keywords between two domains
  backlinks <domain>        Inspect backlink profile, anchor distribution, and Authority Score
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  try {
    switch (command) {
      case 'audit': {
        const url = args[1];
        if (!url) {
          console.error('Error: Please provide a target URL to audit.');
          process.exit(1);
        }
        let maxPages = 3;
        const pageIdx = args.indexOf('--pages');
        if (pageIdx !== -1 && args[pageIdx + 1]) {
          maxPages = parseInt(args[pageIdx + 1], 10) || 3;
        }

        console.log(`\n🔍 Initiating Site Audit on ${url} (max pages: ${maxPages})...\n`);
        const report = await runSiteAudit(url, { maxPages });

        console.log(`=======================================================`);
        console.log(`📊 SITE AUDIT REPORT: ${report.targetUrl}`);
        console.log(`=======================================================`);
        console.log(`Health Score:       ${report.healthScore} / 100`);
        console.log(`Pages Crawled:      ${report.scannedPagesCount}`);
        console.log(`Errors:             ${report.totalErrors}`);
        console.log(`Warnings:           ${report.totalWarnings}`);
        console.log(`Notices:            ${report.totalNotices}`);
        console.log(`Crawl Duration:     ${report.crawlDurationMs} ms`);
        console.log(`Robots.txt:         ${report.hasRobotsTxt ? 'Present' : 'Missing'}`);
        console.log(`Sitemap:            ${report.hasSitemap ? `Found (${report.discoveredSitemapUrlsCount} URLs)` : 'Missing'}`);
        console.log(`-------------------------------------------------------`);
        console.log(`Scanned Pages:`);
        report.pages.forEach(p => {
          console.log(`  • [${p.statusCode}] ${p.url}`);
          console.log(`    Title:  ${p.title || '(None)'}`);
          console.log(`    H1:     ${p.h1Count} | Words: ${p.wordCount} | Issues: ${p.issues.length}`);
          p.issues.forEach(iss => {
            console.log(`      - [${iss.severity.toUpperCase()}] ${iss.code}: ${iss.message}`);
          });
        });
        console.log(`=======================================================\n`);
        break;
      }

      case 'keyword': {
        const query = args[1];
        if (!query) {
          console.error('Error: Please provide a keyword phrase to analyze.');
          process.exit(1);
        }

        console.log(`\n⚡ Analyzing Keyword: "${query}"...\n`);
        const metrics = analyzeKeyword(query);
        const variations = generateKeywordVariations(query);

        console.log(`=======================================================`);
        console.log(`🔑 KEYWORD OVERVIEW: "${metrics.keyword}"`);
        console.log(`=======================================================`);
        console.log(`Search Volume:        ${metrics.searchVolume.toLocaleString()} / mo`);
        console.log(`Keyword Difficulty:   ${metrics.keywordDifficulty}% (${metrics.keywordDifficulty > 60 ? 'Hard' : (metrics.keywordDifficulty > 40 ? 'Moderate' : 'Easy')})`);
        console.log(`Search Intent:        ${metrics.intent}`);
        console.log(`Cost Per Click (CPC): $${metrics.cpcUsd.toFixed(2)} USD`);
        console.log(`Competitive Density:  ${metrics.competitiveDensity.toFixed(2)} (0.00 - 1.00)`);
        console.log(`-------------------------------------------------------`);
        console.log(`Related Variations & Questions:`);
        variations.forEach(v => console.log(`  • ${v}`));
        console.log(`=======================================================\n`);
        break;
      }

      case 'domain': {
        const domain = args[1];
        if (!domain) {
          console.error('Error: Please provide a domain name (e.g. github.com).');
          process.exit(1);
        }

        console.log(`\n🌐 Generating Domain Overview for: ${domain}...\n`);
        const overview = await generateDomainOverview(domain);

        console.log(`=======================================================`);
        console.log(`📊 DOMAIN OVERVIEW: ${overview.domain}`);
        console.log(`=======================================================`);
        console.log(`Authority Score:          ${overview.authorityScore} / 100`);
        console.log(`Est. Monthly Traffic:     ${overview.estimatedMonthlyOrganicTraffic.toLocaleString()} visits`);
        console.log(`Total Ranked Keywords:    ${overview.totalRankedKeywords.toLocaleString()}`);
        console.log(`Top Competitors:          ${overview.topCompetitors.join(', ')}`);
        console.log(`-------------------------------------------------------`);
        console.log(`Top Organic Keywords:`);
        overview.topOrganicKeywords.slice(0, 10).forEach(kw => {
          console.log(`  #${kw.position.toString().padEnd(2)} "${kw.keyword.padEnd(24)}" | Vol: ${kw.searchVolume.toString().padEnd(7)} | Est. Visits: ${kw.estimatedMonthlyTraffic.toString().padEnd(7)} | Intent: ${kw.intent}`);
        });
        console.log(`=======================================================\n`);
        break;
      }

      case 'gap': {
        const d1 = args[1];
        const d2 = args[2];
        if (!d1 || !d2) {
          console.error('Error: Please provide two domains to compare (e.g., node scripts/semrush.mjs gap github.com gitlab.com).');
          process.exit(1);
        }

        console.log(`\n⚔️ Comparing Keyword Gap: ${d1} vs ${d2}...\n`);
        const overviewA = await generateDomainOverview(d1);
        const overviewB = await generateDomainOverview(d2);

        const gap = compareKeywordGap(
          d1, 
          overviewA.topOrganicKeywords.map(k => k.keyword),
          d2,
          overviewB.topOrganicKeywords.map(k => k.keyword)
        );

        console.log(`=======================================================`);
        console.log(`🎯 KEYWORD GAP MATRIX: ${d1} vs ${d2}`);
        console.log(`=======================================================`);
        console.log(`Shared Keywords (${gap.sharedKeywords.length}):`);
        gap.sharedKeywords.slice(0, 8).forEach(k => console.log(`  🤝 ${k}`));

        console.log(`\nMissing for ${d1} (Ranked by ${d2}) (${gap.missingForDomainA.length}):`);
        gap.missingForDomainA.slice(0, 8).forEach(k => console.log(`  🚨 ${k}`));

        console.log(`\nUnique to ${d1} (${gap.uniqueToDomainA.length}):`);
        gap.uniqueToDomainA.slice(0, 8).forEach(k => console.log(`  ⭐ ${k}`));
        console.log(`=======================================================\n`);
        break;
      }

      case 'backlinks': {
        const domain = args[1];
        if (!domain) {
          console.error('Error: Please provide a domain name (e.g. github.com).');
          process.exit(1);
        }

        console.log(`\n🔗 Generating Backlink Profile for: ${domain}...\n`);
        const report = generateBacklinkReport(domain);

        console.log(`=======================================================`);
        console.log(`🔗 BACKLINK PROFILE: ${report.domain}`);
        console.log(`=======================================================`);
        console.log(`Authority Score:          ${report.authorityScore} / 100`);
        console.log(`Total Backlinks:          ${report.totalBacklinks.toLocaleString()}`);
        console.log(`Referring Domains:        ${report.totalReferringDomains.toLocaleString()}`);
        console.log(`Dofollow Ratio:           ${(report.dofollowRatio * 100).toFixed(1)}%`);
        console.log(`-------------------------------------------------------`);
        console.log(`Top Anchor Texts:`);
        report.topAnchors.forEach(a => console.log(`  • "${a.text}" (${a.count.toLocaleString()} links)`));
        console.log(`-------------------------------------------------------`);
        console.log(`Sample Inbound Backlinks:`);
        report.recentBacklinks.slice(0, 5).forEach(b => {
          console.log(`  [${b.isDofollow ? 'dofollow' : 'nofollow'}] ${b.sourceUrl}`);
          console.log(`    ↳ Target: ${b.targetUrl} (Anchor: "${b.anchorText}")`);
        });
        console.log(`=======================================================\n`);
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error(`Execution error: ${err.message}`);
    process.exit(1);
  }
}

main();
