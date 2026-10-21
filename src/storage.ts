import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TrackedProjectRecord } from './types.js';

const DATA_DIR = path.resolve(process.env.OPEN_SEMRUSH_DATA_DIR || path.join(process.cwd(), 'data'));
const DB_FILE = path.join(DATA_DIR, 'seo_projects.json');
const MAX_HISTORY_ENTRIES = Math.max(100, Number(process.env.OPEN_SEMRUSH_MAX_HISTORY || 50000));

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

function emptyDb(): DatabaseSchema {
  return { projects: [], history: [] };
}

function validateDb(value: unknown): DatabaseSchema {
  if (!value || typeof value !== 'object') throw new Error('Stored SEO database is not a JSON object.');
  const candidate = value as Partial<DatabaseSchema>;
  if (!Array.isArray(candidate.projects) || !Array.isArray(candidate.history)) {
    throw new Error('Stored SEO database has an invalid schema; refusing to overwrite it.');
  }
  return { projects: candidate.projects, history: candidate.history };
}

function ensureDbFile(): DatabaseSchema {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(DB_FILE)) {
    const initial = emptyDb();
    saveDb(initial);
    return initial;
  }
  try {
    return validateDb(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as unknown);
  } catch (error) {
    // Do not silently return an empty database: that can hide data loss and overwrite recoverable history.
    throw new Error(`Unable to read ${DB_FILE}; preserve the file and restore/repair it before writing again. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Atomic replacement prevents readers from seeing partially-written JSON after a crash. */
function saveDb(data: DatabaseSchema): void {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const tempFile = path.join(DATA_DIR, `.seo_projects.${process.pid}.${randomUUID()}.tmp`);
  const payload = JSON.stringify(data, null, 2);
  let fd: number | undefined;
  try {
    fd = fs.openSync(tempFile, 'wx', 0o600);
    fs.writeFileSync(fd, payload, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempFile, DB_FILE);
    try {
      const dirFd = fs.openSync(DATA_DIR, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch {
      // Directory fsync is not supported on every filesystem (for example some Windows filesystems).
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tempFile); } catch { /* already renamed or absent */ }
  }
}

/** Records an audit in the historical tracking ledger. */
export function recordAuditInHistory(
  domain: string,
  healthScore: number,
  errors: number,
  warnings: number,
  notices: number
): void {
  const db = ensureDbFile();
  const normalizedDomain = domain.toLowerCase().trim();
  if (!normalizedDomain) throw new Error('A non-empty domain is required for audit history.');
  const entry: AuditHistoryEntry = {
    timestamp: new Date().toISOString(),
    domain: normalizedDomain,
    healthScore,
    errors,
    warnings,
    notices,
  };
  db.history.push(entry);
  if (db.history.length > MAX_HISTORY_ENTRIES) db.history.splice(0, db.history.length - MAX_HISTORY_ENTRIES);

  const existingProj = db.projects.find(p => p.domain === normalizedDomain);
  if (existingProj) {
    (existingProj as TrackedProjectRecord & { lastAuditScore: number }).lastAuditScore = healthScore;
  } else {
    db.projects.push({
      id: `proj_${Date.now()}_${randomUUID().slice(0, 8)}`,
      domain: normalizedDomain,
      createdAt: entry.timestamp,
      lastAuditScore: healthScore,
      trackedKeywords: [],
    });
  }
  saveDb(db);
}

/** Returns a detached snapshot so callers cannot mutate the in-memory representation. */
export function getAllProjects(): TrackedProjectRecord[] {
  return ensureDbFile().projects.map(project => ({ ...project, trackedKeywords: [...project.trackedKeywords] }));
}

/** Returns historical audit entries for a domain. */
export function getDomainAuditHistory(domain: string): AuditHistoryEntry[] {
  const clean = domain.toLowerCase().trim();
  return ensureDbFile().history.filter(entry => entry.domain === clean).map(entry => ({ ...entry }));
}
