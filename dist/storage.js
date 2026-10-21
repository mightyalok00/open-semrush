import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const DATA_DIR = path.resolve(process.env.OPEN_SEMRUSH_DATA_DIR || path.join(process.cwd(), 'data'));
const DB_FILE = path.join(DATA_DIR, 'seo_projects.json');
const configuredMaxHistory = Number(process.env.OPEN_SEMRUSH_MAX_HISTORY || 50000);
const MAX_HISTORY_ENTRIES = Number.isSafeInteger(configuredMaxHistory) && configuredMaxHistory >= 100 && configuredMaxHistory <= 1_000_000
    ? configuredMaxHistory
    : 50_000;
function emptyDb() {
    return { projects: [], history: [] };
}
function isSafeIntegerNonNegative(val) {
    return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0;
}
function isValidScore(val) {
    return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0 && val <= 100;
}
function validateProject(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
        throw new Error('Stored project entry must be an object.');
    }
    const rec = p;
    if (typeof rec.id !== 'string' || !rec.id.trim())
        throw new Error('Stored project ID must be a non-empty string.');
    if (typeof rec.domain !== 'string' || !rec.domain.trim())
        throw new Error('Stored project domain must be a non-empty string.');
    if (typeof rec.createdAt !== 'string' || !rec.createdAt.trim())
        throw new Error('Stored project createdAt must be a valid timestamp string.');
    if (!isValidScore(rec.lastAuditScore))
        throw new Error('Stored project lastAuditScore must be an integer between 0 and 100.');
    if (!Array.isArray(rec.trackedKeywords) || rec.trackedKeywords.some(k => typeof k !== 'string')) {
        throw new Error('Stored project trackedKeywords must be an array of strings.');
    }
    return {
        id: rec.id.trim(),
        domain: rec.domain.trim().toLowerCase(),
        createdAt: rec.createdAt,
        lastAuditScore: rec.lastAuditScore,
        trackedKeywords: [...rec.trackedKeywords],
    };
}
function validateHistoryEntry(h) {
    if (!h || typeof h !== 'object' || Array.isArray(h)) {
        throw new Error('Stored history entry must be an object.');
    }
    const rec = h;
    if (typeof rec.timestamp !== 'string' || !rec.timestamp.trim())
        throw new Error('Stored history timestamp must be a valid string.');
    if (typeof rec.domain !== 'string' || !rec.domain.trim())
        throw new Error('Stored history domain must be a non-empty string.');
    if (!isValidScore(rec.healthScore))
        throw new Error('Stored history healthScore must be an integer between 0 and 100.');
    if (!isSafeIntegerNonNegative(rec.errors))
        throw new Error('Stored history errors must be a non-negative integer.');
    if (!isSafeIntegerNonNegative(rec.warnings))
        throw new Error('Stored history warnings must be a non-negative integer.');
    if (!isSafeIntegerNonNegative(rec.notices))
        throw new Error('Stored history notices must be a non-negative integer.');
    return {
        timestamp: rec.timestamp,
        domain: rec.domain.trim().toLowerCase(),
        healthScore: rec.healthScore,
        errors: rec.errors,
        warnings: rec.warnings,
        notices: rec.notices,
    };
}
export function validateDb(value) {
    if (!value || typeof value !== 'object')
        throw new Error('Stored SEO database is not a JSON object.');
    const candidate = value;
    if (!Array.isArray(candidate.projects) || !Array.isArray(candidate.history)) {
        throw new Error('Stored SEO database has an invalid schema; refusing to overwrite it.');
    }
    const projects = candidate.projects.map(validateProject);
    const history = candidate.history.map(validateHistoryEntry);
    return { projects, history };
}
function ensureDbFile() {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(DB_FILE)) {
        const initial = emptyDb();
        saveDb(initial);
        return initial;
    }
    try {
        return validateDb(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
    }
    catch (error) {
        // Do not silently return an empty database: that can hide data loss and overwrite recoverable history.
        throw new Error(`Unable to read ${DB_FILE}; preserve the file and restore/repair it before writing again. ${error instanceof Error ? error.message : String(error)}`);
    }
}
/** Atomic replacement prevents readers from seeing partially-written JSON after a crash. */
function saveDb(data) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const tempFile = path.join(DATA_DIR, `.seo_projects.${process.pid}.${randomUUID()}.tmp`);
    const payload = JSON.stringify(data, null, 2);
    let fd;
    try {
        fd = fs.openSync(tempFile, 'wx', 0o600);
        fs.writeFileSync(fd, payload, 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(tempFile, DB_FILE);
        try {
            const dirFd = fs.openSync(DATA_DIR, 'r');
            try {
                fs.fsyncSync(dirFd);
            }
            finally {
                fs.closeSync(dirFd);
            }
        }
        catch {
            // Directory fsync is not supported on every filesystem (for example some Windows filesystems).
        }
    }
    finally {
        if (fd !== undefined)
            fs.closeSync(fd);
        try {
            fs.unlinkSync(tempFile);
        }
        catch { /* already renamed or absent */ }
    }
}
/** Records an audit in the historical tracking ledger. */
export function recordAuditInHistory(domain, healthScore, errors, warnings, notices) {
    const db = ensureDbFile();
    const normalizedDomain = domain.toLowerCase().trim();
    if (!normalizedDomain)
        throw new Error('A non-empty domain is required for audit history.');
    const safeScore = Math.max(0, Math.min(100, Math.round(Number(healthScore) || 0)));
    const safeErrors = Math.max(0, Math.floor(Number(errors) || 0));
    const safeWarnings = Math.max(0, Math.floor(Number(warnings) || 0));
    const safeNotices = Math.max(0, Math.floor(Number(notices) || 0));
    const entry = {
        timestamp: new Date().toISOString(),
        domain: normalizedDomain,
        healthScore: safeScore,
        errors: safeErrors,
        warnings: safeWarnings,
        notices: safeNotices,
    };
    db.history.push(entry);
    if (db.history.length > MAX_HISTORY_ENTRIES)
        db.history.splice(0, db.history.length - MAX_HISTORY_ENTRIES);
    const existingProj = db.projects.find(p => p.domain === normalizedDomain);
    if (existingProj) {
        existingProj.lastAuditScore = safeScore;
    }
    else {
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
export function getAllProjects() {
    return ensureDbFile().projects.map(project => ({ ...project, trackedKeywords: [...project.trackedKeywords] }));
}
/** Returns historical audit entries for a domain. */
export function getDomainAuditHistory(domain) {
    const clean = domain.toLowerCase().trim();
    return ensureDbFile().history.filter(entry => entry.domain === clean).map(entry => ({ ...entry }));
}
/** Atomically creates a durable snapshot backup of the current database. */
export function backupDb(destinationPath) {
    const db = ensureDbFile();
    const backupDir = destinationPath ? path.dirname(path.resolve(destinationPath)) : path.join(DATA_DIR, 'backups');
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const targetPath = destinationPath
        ? path.resolve(destinationPath)
        : path.join(backupDir, `seo_projects.backup.${Date.now()}.${randomUUID().slice(0, 8)}.json`);
    const tempFile = path.join(backupDir, `.backup.${process.pid}.${randomUUID()}.tmp`);
    const payload = JSON.stringify(db, null, 2);
    let fd;
    try {
        fd = fs.openSync(tempFile, 'wx', 0o600);
        fs.writeFileSync(fd, payload, 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(tempFile, targetPath);
    }
    finally {
        if (fd !== undefined)
            fs.closeSync(fd);
        try {
            fs.unlinkSync(tempFile);
        }
        catch { }
    }
    return {
        backupPath: targetPath,
        projectsCount: db.projects.length,
        historyCount: db.history.length,
        timestamp: new Date().toISOString(),
    };
}
/** Restores database from a validated backup file, failing closed on schema error. */
export function restoreDb(backupPath) {
    if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup file does not exist: ${backupPath}`);
    }
    const raw = fs.readFileSync(backupPath, 'utf8');
    const candidate = JSON.parse(raw);
    const validated = validateDb(candidate);
    saveDb(validated);
    return {
        projectsCount: validated.projects.length,
        historyCount: validated.history.length,
    };
}
/** Standard file-based JSON persistence engine conforming to StorageAdapter interface. */
export class JsonFileStorageAdapter {
    name = 'json-file';
    getAllProjects() {
        return getAllProjects();
    }
    getDomainAuditHistory(domain) {
        return getDomainAuditHistory(domain);
    }
    recordAuditInHistory(domain, healthScore, errors, warnings, notices) {
        recordAuditInHistory(domain, healthScore, errors, warnings, notices);
    }
    backup(destinationPath) {
        return backupDb(destinationPath);
    }
    restore(backupPath) {
        return restoreDb(backupPath);
    }
}
/**
 * Transactional SQLite persistence engine conforming to StorageAdapter interface.
 * Provides ACID transactions, crash resilience, write-ahead logging (WAL), and concurrent read scalability.
 */
export class SqliteStorageAdapter {
    name = 'sqlite';
    db;
    isMemory;
    constructor(dbPath = path.join(DATA_DIR, 'seo_projects.sqlite')) {
        this.isMemory = dbPath === ':memory:';
        if (!this.isMemory) {
            fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true, mode: 0o700 });
        }
        this.db = new DatabaseSync(dbPath);
        if (!this.isMemory) {
            try {
                this.db.exec('PRAGMA journal_mode = WAL;');
                this.db.exec('PRAGMA synchronous = NORMAL;');
            }
            catch { }
        }
        this.initTables();
    }
    initTables() {
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
    `);
    }
    getAllProjects() {
        const stmt = this.db.prepare('SELECT id, domain, created_at, last_audit_score, tracked_keywords_json FROM projects ORDER BY domain ASC');
        const rows = stmt.all();
        return rows.map(r => ({
            id: r.id,
            domain: r.domain,
            createdAt: r.created_at,
            lastAuditScore: r.last_audit_score,
            trackedKeywords: JSON.parse(r.tracked_keywords_json || '[]'),
        }));
    }
    getDomainAuditHistory(domain) {
        const clean = domain.toLowerCase().trim();
        const stmt = this.db.prepare('SELECT timestamp, domain, health_score, errors, warnings, notices FROM audit_history WHERE domain = ? ORDER BY id ASC');
        const rows = stmt.all(clean);
        return rows.map(r => ({
            timestamp: r.timestamp,
            domain: r.domain,
            healthScore: r.health_score,
            errors: r.errors,
            warnings: r.warnings,
            notices: r.notices,
        }));
    }
    recordAuditInHistory(domain, healthScore, errors, warnings, notices) {
        const normalizedDomain = domain.toLowerCase().trim();
        if (!normalizedDomain)
            throw new Error('A non-empty domain is required for audit history.');
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
        }
        catch (err) {
            try {
                this.db.exec('ROLLBACK;');
            }
            catch { }
            throw err;
        }
    }
    upsertProjectRecord(project) {
        const upsert = this.db.prepare(`
      INSERT INTO projects (id, domain, created_at, last_audit_score, tracked_keywords_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(domain) DO UPDATE SET
        last_audit_score = excluded.last_audit_score,
        tracked_keywords_json = excluded.tracked_keywords_json;
    `);
        upsert.run(project.id, project.domain.toLowerCase().trim(), project.createdAt, project.lastAuditScore, JSON.stringify(project.trackedKeywords || []));
    }
    insertHistoryEntry(entry) {
        const insert = this.db.prepare(`
      INSERT INTO audit_history (timestamp, domain, health_score, errors, warnings, notices)
      VALUES (?, ?, ?, ?, ?, ?);
    `);
        insert.run(entry.timestamp, entry.domain.toLowerCase().trim(), entry.healthScore, entry.errors, entry.warnings, entry.notices);
    }
    close() {
        try {
            this.db.close();
        }
        catch { }
    }
}
/** Migrates existing validated JSON persistence data into transactional SQLite storage. */
export function migrateJsonToSqlite(jsonDbPath = DB_FILE, sqliteDbPath = path.join(DATA_DIR, 'seo_projects.sqlite')) {
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
    }
    finally {
        adapter.close();
    }
    return {
        migratedProjects: parsed.projects.length,
        migratedHistoryEntries: parsed.history.length,
        sqliteDbPath,
    };
}
export const defaultStorageAdapter = new JsonFileStorageAdapter();
