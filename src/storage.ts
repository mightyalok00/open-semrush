import fs from 'node:fs';
import path from 'node:path';
import type { TrackedProjectRecord } from './types.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'seo_projects.json');

export interface AuditHistoryEntry {
  readonly timestamp: string;
  readonly domain: string;
  readonly healthScore: number;
  readonly errors: number;
  readonly warnings: number;
  readonly notices: number;
}

interface DatabaseSchema {
  projects: TrackedProjectRecord[];
  history: AuditHistoryEntry[];
}

function ensureDbFile(): DatabaseSchema {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initial: DatabaseSchema = { projects: [], history: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw) as DatabaseSchema;
  } catch {
    return { projects: [], history: [] };
  }
}

function saveDb(data: DatabaseSchema): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Records an audit in the historical tracking ledger.
 */
export function recordAuditInHistory(
  domain: string,
  healthScore: number,
  errors: number,
  warnings: number,
  notices: number
): void {
  const db = ensureDbFile();
  const entry: AuditHistoryEntry = {
    timestamp: new Date().toISOString(),
    domain: domain.toLowerCase().trim(),
    healthScore,
    errors,
    warnings,
    notices,
  };
  db.history.push(entry);

  // Update or insert project
  const existingProj = db.projects.find(p => p.domain === entry.domain);
  if (existingProj) {
    (existingProj as any).lastAuditScore = healthScore;
  } else {
    db.projects.push({
      id: `proj_${Date.now()}`,
      domain: entry.domain,
      createdAt: new Date().toISOString(),
      lastAuditScore: healthScore,
      trackedKeywords: [],
    });
  }

  saveDb(db);
}

/**
 * Returns all tracked projects.
 */
export function getAllProjects(): TrackedProjectRecord[] {
  const db = ensureDbFile();
  return db.projects;
}

/**
 * Returns historical audit entries for a domain.
 */
export function getDomainAuditHistory(domain: string): AuditHistoryEntry[] {
  const db = ensureDbFile();
  const clean = domain.toLowerCase().trim();
  return db.history.filter(h => h.domain === clean);
}
