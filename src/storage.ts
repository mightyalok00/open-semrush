import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TrackedProjectRecord } from './types.js';
import { DatabaseSync } from 'node:sqlite';

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
  forecasts?: import('./types.js').StoredForecastRecord[];
}

function emptyDb(): DatabaseSchema {
  return { projects: [], history: [], forecasts: [] };
}

function isSafeIntegerNonNegative(val: unknown): boolean {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0;
}

function isValidScore(val: unknown): boolean {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0 && val <= 100;
}

function validateForecastRecord(f: unknown): import('./types.js').StoredForecastRecord {
  if (!f || typeof f !== 'object' || Array.isArray(f)) {
    throw new Error('Stored forecast record must be an object.');
  }
  const r = f as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id.trim()) throw new Error('Forecast record id must be a string.');
  if (typeof r.domain !== 'string' || !r.domain.trim()) throw new Error('Forecast record domain must be a string.');
  if (typeof r.modelVersion !== 'string') throw new Error('Forecast record modelVersion must be a string.');
  if (typeof r.generatedAt !== 'string') throw new Error('Forecast record generatedAt must be a string.');
  if (r.horizonDays !== 30 && r.horizonDays !== 90 && r.horizonDays !== 180) {
    throw new Error('Forecast record horizonDays must be 30, 90, or 180.');
  }
  if (typeof r.targetEndDate !== 'string') throw new Error('Forecast record targetEndDate must be a string.');
  if (typeof r.expectedTotalClicks !== 'number' || Number.isNaN(r.expectedTotalClicks)) {
    throw new Error('Forecast record expectedTotalClicks must be a number.');
  }
  if (typeof r.lower95TotalClicks !== 'number' || Number.isNaN(r.lower95TotalClicks)) {
    throw new Error('Forecast record lower95TotalClicks must be a number.');
  }
  if (typeof r.upper95TotalClicks !== 'number' || Number.isNaN(r.upper95TotalClicks)) {
    throw new Error('Forecast record upper95TotalClicks must be a number.');
  }

  return {
    id: r.id.trim(),
    domain: r.domain.trim().toLowerCase(),
    modelVersion: r.modelVersion,
    generatedAt: r.generatedAt,
    horizonDays: r.horizonDays as import('./types.js').ForecastHorizon,
    targetEndDate: r.targetEndDate,
    expectedTotalClicks: r.expectedTotalClicks,
    lower95TotalClicks: r.lower95TotalClicks,
    upper95TotalClicks: r.upper95TotalClicks,
    ...(typeof r.actualOutcomeClicks === 'number' ? { actualOutcomeClicks: r.actualOutcomeClicks } : {}),
    ...(typeof r.evaluatedAt === 'string' ? { evaluatedAt: r.evaluatedAt } : {}),
  };
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
  const forecasts = Array.isArray(candidate.forecasts)
    ? candidate.forecasts.map(validateForecastRecord)
    : [];
  return { projects, history, forecasts };
}

export interface StorageAdapter {
  readonly name: string;
  getAllProjects(): TrackedProjectRecord[];
  getDomainAuditHistory(domain: string): AuditHistoryEntry[];
  recordAuditInHistory(domain: string, healthScore: number, errors: number, warnings: number, notices: number): void;
  recordForecast?(record: import('./types.js').StoredForecastRecord): void;
  getForecastsForDomain?(domain: string): import('./types.js').StoredForecastRecord[];
  recordForecastOutcome?(forecastId: string, actualOutcomeClicks: number): void;
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

export interface BackupResult {
  readonly backupPath: string;
  readonly projectsCount: number;
  readonly historyCount: number;
  readonly timestamp: string;
}

/** Atomically creates a durable snapshot backup of the current database. */
export function backupDb(destinationPath?: string): BackupResult {
  const db = ensureDbFile();
  const backupDir = destinationPath ? path.dirname(path.resolve(destinationPath)) : path.join(DATA_DIR, 'backups');
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const targetPath = destinationPath
    ? path.resolve(destinationPath)
    : path.join(backupDir, `seo_projects.backup.${Date.now()}.${randomUUID().slice(0, 8)}.json`);

  const tempFile = path.join(backupDir, `.backup.${process.pid}.${randomUUID()}.tmp`);
  const payload = JSON.stringify(db, null, 2);
  let fd: number | undefined;
  try {
    fd = fs.openSync(tempFile, 'wx', 0o600);
    fs.writeFileSync(fd, payload, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempFile, targetPath);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tempFile); } catch {}
  }

  return {
    backupPath: targetPath,
    projectsCount: db.projects.length,
    historyCount: db.history.length,
    timestamp: new Date().toISOString(),
  };
}

/** Restores database from a validated backup file, failing closed on schema error. */
export function restoreDb(backupPath: string): { projectsCount: number; historyCount: number } {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file does not exist: ${backupPath}`);
  }
  const raw = fs.readFileSync(backupPath, 'utf8');
  const candidate = JSON.parse(raw) as unknown;
  const validated = validateDb(candidate);
  saveDb(validated);
  return {
    projectsCount: validated.projects.length,
    historyCount: validated.history.length,
  };
}

/** Records a forecast in persistent storage. */
export function recordForecast(record: import('./types.js').StoredForecastRecord): void {
  const db = ensureDbFile();
  if (!db.forecasts) db.forecasts = [];
  db.forecasts.push(record);
  saveDb(db);
}

/** Retrieves forecasts for a domain. */
export function getForecastsForDomain(domain: string): import('./types.js').StoredForecastRecord[] {
  const clean = domain.toLowerCase().trim();
  const db = ensureDbFile();
  return (db.forecasts || []).filter(f => f.domain === clean).map(f => ({ ...f }));
}

/** Records an actual outcome for a previously stored forecast. */
export function recordForecastOutcome(forecastId: string, actualOutcomeClicks: number): void {
  const db = ensureDbFile();
  if (!db.forecasts) return;
  const match = db.forecasts.find(f => f.id === forecastId);
  if (match) {
    const mutable = match as unknown as { actualOutcomeClicks?: number; evaluatedAt?: string };
    mutable.actualOutcomeClicks = actualOutcomeClicks;
    mutable.evaluatedAt = new Date().toISOString();
    saveDb(db);
  }
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
  recordForecast(record: import('./types.js').StoredForecastRecord): void {
    recordForecast(record);
  }
  getForecastsForDomain(domain: string): import('./types.js').StoredForecastRecord[] {
    return getForecastsForDomain(domain);
  }
  recordForecastOutcome(forecastId: string, actualOutcomeClicks: number): void {
    recordForecastOutcome(forecastId, actualOutcomeClicks);
  }
  backup(destinationPath?: string): BackupResult {
    return backupDb(destinationPath);
  }
  restore(backupPath: string): { projectsCount: number; historyCount: number } {
    return restoreDb(backupPath);
  }
}

/**
 * Transactional SQLite persistence engine conforming to StorageAdapter interface.
 * Provides ACID transactions, crash resilience, write-ahead logging (WAL), and concurrent read scalability.
 */
export class SqliteStorageAdapter implements StorageAdapter {
  readonly name = 'sqlite';
  private db: DatabaseSync;
  private readonly isMemory: boolean;

  constructor(dbPath: string = path.join(DATA_DIR, 'seo_projects.sqlite')) {
    this.isMemory = dbPath === ':memory:';
    if (!this.isMemory) {
      fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(dbPath);
    if (!this.isMemory) {
      try {
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA synchronous = NORMAL;');
      } catch {}
    }
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        domain TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        last_audit_score INTEGER NOT NULL,
        tracked_keywords_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        domain TEXT NOT NULL,
        health_score INTEGER NOT NULL,
        errors INTEGER NOT NULL,
        warnings INTEGER NOT NULL,
        notices INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_history_domain ON audit_history(domain);
      CREATE TABLE IF NOT EXISTS forecasts (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        model_version TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        horizon_days INTEGER NOT NULL,
        target_end_date TEXT NOT NULL,
        expected_total_clicks REAL NOT NULL,
        lower95_total_clicks REAL NOT NULL,
        upper95_total_clicks REAL NOT NULL,
        actual_outcome_clicks REAL,
        evaluated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_forecasts_domain ON forecasts(domain);
    `);
  }

  getAllProjects(): TrackedProjectRecord[] {
    const stmt = this.db.prepare('SELECT id, domain, created_at, last_audit_score, tracked_keywords_json FROM projects ORDER BY domain ASC');
    const rows = stmt.all() as Array<{
      id: string;
      domain: string;
      created_at: string;
      last_audit_score: number;
      tracked_keywords_json: string;
    }>;
    return rows.map(r => ({
      id: r.id,
      domain: r.domain,
      createdAt: r.created_at,
      lastAuditScore: r.last_audit_score,
      trackedKeywords: JSON.parse(r.tracked_keywords_json || '[]') as string[],
    }));
  }

  getDomainAuditHistory(domain: string): AuditHistoryEntry[] {
    const clean = domain.toLowerCase().trim();
    const stmt = this.db.prepare('SELECT timestamp, domain, health_score, errors, warnings, notices FROM audit_history WHERE domain = ? ORDER BY id ASC');
    const rows = stmt.all(clean) as Array<{
      timestamp: string;
      domain: string;
      health_score: number;
      errors: number;
      warnings: number;
      notices: number;
    }>;
    return rows.map(r => ({
      timestamp: r.timestamp,
      domain: r.domain,
      healthScore: r.health_score,
      errors: r.errors,
      warnings: r.warnings,
      notices: r.notices,
    }));
  }

  recordAuditInHistory(domain: string, healthScore: number, errors: number, warnings: number, notices: number): void {
    const normalizedDomain = domain.toLowerCase().trim();
    if (!normalizedDomain) throw new Error('A non-empty domain is required for audit history.');
    const safeScore = Math.max(0, Math.min(100, Math.round(Number(healthScore) || 0)));
    const safeErrors = Math.max(0, Math.floor(Number(errors) || 0));
    const safeWarnings = Math.max(0, Math.floor(Number(warnings) || 0));
    const safeNotices = Math.max(0, Math.floor(Number(notices) || 0));
    const timestamp = new Date().toISOString();

    // Execute atomic ACID transaction
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const insertHistory = this.db.prepare(`
        INSERT INTO audit_history (timestamp, domain, health_score, errors, warnings, notices)
        VALUES (?, ?, ?, ?, ?, ?);
      `);
      insertHistory.run(timestamp, normalizedDomain, safeScore, safeErrors, safeWarnings, safeNotices);

      const upsertProject = this.db.prepare(`
        INSERT INTO projects (id, domain, created_at, last_audit_score, tracked_keywords_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(domain) DO UPDATE SET last_audit_score = excluded.last_audit_score;
      `);
      const projectId = `proj_${Date.now()}_${randomUUID().slice(0, 8)}`;
      upsertProject.run(projectId, normalizedDomain, timestamp, safeScore, '[]');

      this.db.exec('COMMIT;');
    } catch (err) {
      try { this.db.exec('ROLLBACK;'); } catch {}
      throw err;
    }
  }

  upsertProjectRecord(project: TrackedProjectRecord): void {
    const upsert = this.db.prepare(`
      INSERT INTO projects (id, domain, created_at, last_audit_score, tracked_keywords_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(domain) DO UPDATE SET
        last_audit_score = excluded.last_audit_score,
        tracked_keywords_json = excluded.tracked_keywords_json;
    `);
    upsert.run(
      project.id,
      project.domain.toLowerCase().trim(),
      project.createdAt,
      project.lastAuditScore,
      JSON.stringify(project.trackedKeywords || [])
    );
  }

  insertHistoryEntry(entry: AuditHistoryEntry): void {
    const insert = this.db.prepare(`
      INSERT INTO audit_history (timestamp, domain, health_score, errors, warnings, notices)
      VALUES (?, ?, ?, ?, ?, ?);
    `);
    insert.run(
      entry.timestamp,
      entry.domain.toLowerCase().trim(),
      entry.healthScore,
      entry.errors,
      entry.warnings,
      entry.notices
    );
  }

  recordForecast(record: import('./types.js').StoredForecastRecord): void {
    const insert = this.db.prepare(`
      INSERT INTO forecasts (
        id, domain, model_version, generated_at, horizon_days,
        target_end_date, expected_total_clicks, lower95_total_clicks, upper95_total_clicks,
        actual_outcome_clicks, evaluated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        actual_outcome_clicks = excluded.actual_outcome_clicks,
        evaluated_at = excluded.evaluated_at;
    `);
    insert.run(
      record.id,
      record.domain.toLowerCase().trim(),
      record.modelVersion,
      record.generatedAt,
      record.horizonDays,
      record.targetEndDate,
      record.expectedTotalClicks,
      record.lower95TotalClicks,
      record.upper95TotalClicks,
      record.actualOutcomeClicks ?? null,
      record.evaluatedAt ?? null
    );
  }

  getForecastsForDomain(domain: string): import('./types.js').StoredForecastRecord[] {
    const clean = domain.toLowerCase().trim();
    const stmt = this.db.prepare(`
      SELECT id, domain, model_version, generated_at, horizon_days, target_end_date,
             expected_total_clicks, lower95_total_clicks, upper95_total_clicks,
             actual_outcome_clicks, evaluated_at
      FROM forecasts
      WHERE domain = ?
      ORDER BY generated_at DESC;
    `);
    const rows = stmt.all(clean) as Array<{
      id: string;
      domain: string;
      model_version: string;
      generated_at: string;
      horizon_days: number;
      target_end_date: string;
      expected_total_clicks: number;
      lower95_total_clicks: number;
      upper95_total_clicks: number;
      actual_outcome_clicks: number | null;
      evaluated_at: string | null;
    }>;

    return rows.map(r => ({
      id: r.id,
      domain: r.domain,
      modelVersion: r.model_version,
      generatedAt: r.generated_at,
      horizonDays: r.horizon_days as import('./types.js').ForecastHorizon,
      targetEndDate: r.target_end_date,
      expectedTotalClicks: r.expected_total_clicks,
      lower95TotalClicks: r.lower95_total_clicks,
      upper95TotalClicks: r.upper95_total_clicks,
      ...(r.actual_outcome_clicks !== null ? { actualOutcomeClicks: r.actual_outcome_clicks } : {}),
      ...(r.evaluated_at !== null ? { evaluatedAt: r.evaluated_at } : {}),
    }));
  }

  recordForecastOutcome(forecastId: string, actualOutcomeClicks: number): void {
    const stmt = this.db.prepare(`
      UPDATE forecasts
      SET actual_outcome_clicks = ?, evaluated_at = ?
      WHERE id = ?;
    `);
    stmt.run(actualOutcomeClicks, new Date().toISOString(), forecastId);
  }

  close(): void {
    try {
      this.db.close();
    } catch {}
  }
}

export interface MigrationResult {
  readonly migratedProjects: number;
  readonly migratedHistoryEntries: number;
  readonly sqliteDbPath: string;
}

/** Migrates existing validated JSON persistence data into transactional SQLite storage. */
export function migrateJsonToSqlite(
  jsonDbPath: string = DB_FILE,
  sqliteDbPath: string = path.join(DATA_DIR, 'seo_projects.sqlite')
): MigrationResult {
  if (!fs.existsSync(jsonDbPath)) {
    throw new Error(`JSON database file does not exist at: ${jsonDbPath}`);
  }
  const raw = fs.readFileSync(jsonDbPath, 'utf8');
  const parsed = validateDb(JSON.parse(raw));
  const adapter = new SqliteStorageAdapter(sqliteDbPath);

  try {
    for (const project of parsed.projects) {
      adapter.upsertProjectRecord(project);
    }
    for (const entry of parsed.history) {
      adapter.insertHistoryEntry(entry);
    }
    for (const forecast of parsed.forecasts || []) {
      adapter.recordForecast(forecast);
    }
  } finally {
    adapter.close();
  }

  return {
    migratedProjects: parsed.projects.length,
    migratedHistoryEntries: parsed.history.length,
    sqliteDbPath,
  };
}

export const defaultStorageAdapter: StorageAdapter = new JsonFileStorageAdapter();

