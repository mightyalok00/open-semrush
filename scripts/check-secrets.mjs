#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(process.cwd());

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.github',
  'coverage',
  '.cache',
  '.turbo',
  'data',
]);

const IGNORED_FILES = new Set([
  '.env.example',
  'package-lock.json',
  'coverage-report.txt',
  'benchmark-results.json',
  'crawl-matrix-results.json',
  'load-benchmark.json',
]);

const SECRET_PATTERNS = [
  { name: 'Private Key', regex: /-----BEGIN (?:RSA|OPENSSH|DSA|EC|PGP)? ?PRIVATE KEY-----/ },
  { name: 'AWS Access Key ID', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google OAuth Access Token', regex: /\bya29\.[0-9A-Za-z_-]{25,}\b/ },
  { name: 'GitHub Personal Access Token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/ },
  { name: 'Slack API Token', regex: /\bxox[baprs]-[0-9A-Za-z_-]{10,}\b/ },
];

const violations = [];

function scanDirectory(currentDir) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        scanDirectory(path.join(currentDir, entry.name));
      }
    } else if (entry.isFile()) {
      if (IGNORED_FILES.has(entry.name) || entry.name.endsWith('.tmp') || entry.name.endsWith('.log')) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(ROOT_DIR, fullPath);
      let content;
      try {
        content = fs.readFileSync(fullPath, 'utf8');
      } catch {
        continue; // Binary or unreadable
      }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.regex.test(line)) {
            violations.push({
              file: relPath,
              line: i + 1,
              type: pattern.name,
              preview: line.trim().slice(0, 60),
            });
          }
        }
      }
    }
  }
}

scanDirectory(ROOT_DIR);

if (violations.length > 0) {
  console.error(`\x1b[31m[SECURITY FAILURE] Found ${violations.length} potential committed secret(s):\x1b[0m`);
  for (const v of violations) {
    console.error(`  - ${v.file}:${v.line} [${v.type}]: ${v.preview}...`);
  }
  process.exit(1);
} else {
  console.log('\x1b[32m[SECURITY AUDIT] Secret scan passed: 0 committed private keys or sensitive credentials found.\x1b[0m');
}
