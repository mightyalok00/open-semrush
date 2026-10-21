import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TrackedProjectRecord } from './types.js';

const DATA_DIR = path.resolve(process.env.OPEN_SEMRUSH_DATA_DIR || path.join(process.cwd(), 'data'));
const DB_FILE = path.join(DATA_DIR, 'seo_projects.json');
const configuredMaxHistory = Number(process.env.OPEN_SEMRUSH_MAX_HISTORY || 50000);
const MAX_HISTORY_ENTRIES = Number.isSafeInteger(configuredMaxHistory) && configuredMaxHistory >= 100 && configuredMaxHistory <= 1_000_000
  ? configuredMaxHistory
  : 50_000;

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

function isSafeIntegerNonNegative(val: unknown): boolean {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0;
}

function isValidScore(val: unknown): boolean {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0 && val <= 100;
}

function validateProject(p: unknown): TrackedProjectRecord {
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    throw new Error('Stored project entry must be an object.');
  }
  const rec = p as Record<string, unknown>;
  if (typeof rec.id !== 'string' || !rec.id.trim()) throw new Error('Stored project ID must be a non-empty string.');
  if (typeof rec.domain !== 'string' || !rec.domain.trim()) throw new Error('Stored project domain must be a non-empty string.');
  if (typeof rec.createdAt !== 'string' || !rec.createdAt.trim()) throw new Error('Stored project createdAt must be a valid timestamp string.');
  if (!isValidScore(rec.lastAuditScore)) throw new Error('Stored project lastAuditScore must be an integer between 0 and 100.');
  if (!Array.isArray(rec.trackedKeywords) || rec.trackedKeywords.some(k => typeof k !== 'string')) {
    throw new Error('Stored project trackedKeywords must be an array of strings.');
  }
  return {
    id: rec.id.trim(),
    domain: rec.domain.trim().toLowerCase(),
    createdAt: rec.createdAt,
    lastAuditScore: rec.lastAuditScore as number,
    trackedKeywords: [...(rec.trackedKeywords as string[])],
  };
}

function validateHistoryEntry(h: unknown): AuditHistoryEntry {
  if (!h || typeof h !== 'object' || Array.isArray(h)) {
    throw new Error('Stored history entry must be an object.');
  }
  const rec = h as Record<string, unknown>;
  if (typeof rec.timestamp !== 'string' || !rec.timestamp.trim()) throw new Error('Stored history timestamp must be a valid string.');
  if (typeof rec.domain !== 'string' || !rec.domain.trim()) throw new Error('Stored history domain must be a non-empty string.');
  if (!isValidScore(rec.healthScore)) throw new Error('Stored history healthScore must be an integer between 0 and 100.');
  if (!isSafeIntegerNonNegative(rec.errors)) throw new Error('Stored history errors must be a non-negative integer.');
  if (!isSafeIntegerNonNegative(rec.warnings)) throw new Error('Stored history warnings must be a non-negative integer.');
  if (!isSafeIntegerNonNegative(rec.notices)) throw new Error('Stored history notices must be a non-negative integer.');
  return {
    timestamp: rec.timestamp,
    domain: rec.domain.trim().toLowerCase(),
    healthScore: rec.healthScore as number,
    errors: rec.errors as number,
    warnings: rec.warnings as number,
    notices: rec.notices as number,
  };
}

export function validateDb(value: unknown): DatabaseSchema {
  if (!value || typeof value !== 'object') throw new Error('Stored SEO database is not a JSON object.');
  const candidate = value as Partial<DatabaseSchema>;
  if (!Array.isArray(candidate.projects) || !Array.isArray(candidate.history)) {
    throw new Error('Stored SEO database has an invalid schema; refusing to overwrite it.');
  }
  const projects = candidate.projects.map(validateProject);
  const history = candidate.history.map(validateHistoryEntry);
  return { projects, history };
}

export interface StorageAdapter {
  readonly name: string;
  getAllProjects(): TrackedProjectRecord[];
  getDomainAuditHistory(domain: string): AuditHistoryEntry[];
  recordAuditInHistory(domain: string, healthScore: number, errors: number, warnings: number, notices: number): void;
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
  const safeScore = Math.max(0, Math.min(100, Math.round(Number(healthScore) || 0)));
  const safeErrors = Math.max(0, Math.floor(Number(errors) || 0));
  const safeWarnings = Math.max(0, Math.floor(Number(warnings) || 0));
  const safeNotices = Math.max(0, Math.floor(Number(notices) || 0));
  const entry: AuditHistoryEntry = {
    timestamp: new Date().toISOString(),
    domain: normalizedDomain,
    healthScore: safeScore,
    errors: safeErrors,
    warnings: safeWarnings,
    notices: safeNotices,
  };
  db.history.push(entry);
  if (db.history.length > MAX_HISTORY_ENTRIES) db.history.splice(0, db.history.length - MAX_HISTORY_ENTRIES);

  const existingProj = db.projects.find(p => p.domain === normalizedDomain);
  if (existingProj) {
    (existingProj as TrackedProjectRecord & { lastAuditScore: number }).lastAuditScore = safeScore;
  } else {
    db.projects.push({
      id: `proj_${Date.now()}_${randomUUID().slice(0, 8)}`,
      domain: normalizedDomain,
      createdAt: entry.timestamp,
      lastAuditScore: safeScore,
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

/** Standard file-based JSON persistence engine conforming to StorageAdapter interface. */
export class JsonFileStorageAdapter implements StorageAdapter {
  readonly name = 'json-file';
  getAllProjects(): TrackedProjectRecord[] {
    return getAllProjects();
  }
  getDomainAuditHistory(domain: string): AuditHistoryEntry[] {
    return getDomainAuditHistory(domain);
  }
  recordAuditInHistory(domain: string, healthScore: number, errors: number, warnings: number, notices: number): void {
    recordAuditInHistory(domain, healthScore, errors, warnings, notices);
  }
}

export const defaultStorageAdapter: StorageAdapter = new JsonFileStorageAdapter();

