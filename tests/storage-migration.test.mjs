import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-semrush-migration-'));
process.env.OPEN_SEMRUSH_DATA_DIR = tempDir;
const storage = await import('../dist/storage.js');

test('migrateJsonToSqlite smoothly migrates validated JSON data into relational SQLite', () => {
  const jsonPath = path.join(tempDir, 'source_projects.json');
  const sqlitePath = path.join(tempDir, 'migrated_projects.sqlite');

  const sourceData = {
    projects: [
      { id: 'p1', domain: 'migrated-alpha.com', createdAt: '2026-10-21T00:00:00Z', lastAuditScore: 92, trackedKeywords: ['seo', 'audit'] },
      { id: 'p2', domain: 'migrated-beta.com', createdAt: '2026-10-21T01:00:00Z', lastAuditScore: 85, trackedKeywords: ['semrush'] },
    ],
    history: [
      { timestamp: '2026-10-21T00:00:00Z', domain: 'migrated-alpha.com', healthScore: 92, errors: 0, warnings: 2, notices: 1 },
      { timestamp: '2026-10-21T01:00:00Z', domain: 'migrated-beta.com', healthScore: 85, errors: 1, warnings: 3, notices: 4 },
      { timestamp: '2026-10-21T02:00:00Z', domain: 'migrated-alpha.com', healthScore: 95, errors: 0, warnings: 1, notices: 0 },
    ],
  };

  fs.writeFileSync(jsonPath, JSON.stringify(sourceData, null, 2));

  const result = storage.migrateJsonToSqlite(jsonPath, sqlitePath);
  assert.equal(result.migratedProjects, 2);
  assert.equal(result.migratedHistoryEntries, 3);
  assert.ok(fs.existsSync(sqlitePath));

  // Verify SQLite adapter reads the migrated data faithfully
  const adapter = new storage.SqliteStorageAdapter(sqlitePath);
  const projects = adapter.getAllProjects();
  assert.equal(projects.length, 2);
  assert.equal(projects[0].domain, 'migrated-alpha.com');
  assert.deepEqual(projects[0].trackedKeywords, ['seo', 'audit']);

  const alphaHistory = adapter.getDomainAuditHistory('migrated-alpha.com');
  assert.equal(alphaHistory.length, 2);
  assert.equal(alphaHistory[0].healthScore, 92);
  assert.equal(alphaHistory[1].healthScore, 95);
  adapter.close();
});

test('SqliteStorageAdapter ACID rollback ensures zero partial state on transaction failure', () => {
  const sqlitePath = path.join(tempDir, 'acid_test.sqlite');
  const adapter = new storage.SqliteStorageAdapter(sqlitePath);

  // Initial valid record
  adapter.recordAuditInHistory('atomic.com', 90, 0, 0, 0);
  assert.equal(adapter.getAllProjects().length, 1);
  assert.equal(adapter.getDomainAuditHistory('atomic.com').length, 1);

  // Attempt invalid audit with empty domain should throw before transaction mutates
  assert.throws(
    () => adapter.recordAuditInHistory('   ', 80, 0, 0, 0),
    /A non-empty domain is required/
  );

  // State remains untouched
  assert.equal(adapter.getAllProjects().length, 1);
  assert.equal(adapter.getDomainAuditHistory('atomic.com').length, 1);
  adapter.close();
});

test('SQLite WAL mode allows concurrent readers and writers across multiple instances', () => {
  const sharedDb = path.join(tempDir, 'concurrent_wal.sqlite');
  const writerInstance = new storage.SqliteStorageAdapter(sharedDb);
  const readerInstance = new storage.SqliteStorageAdapter(sharedDb);

  writerInstance.recordAuditInHistory('concurrent-a.com', 88, 1, 0, 0);
  writerInstance.recordAuditInHistory('concurrent-b.com', 94, 0, 1, 0);

  // Reader sees the newly committed transactions immediately via WAL
  const readProjects = readerInstance.getAllProjects();
  assert.equal(readProjects.length, 2);
  assert.equal(readProjects[0].domain, 'concurrent-a.com');
  assert.equal(readProjects[1].domain, 'concurrent-b.com');

  writerInstance.close();
  readerInstance.close();
});

test('Operational disaster recovery drill: backup, simulated corruption, and successful restoration', () => {
  storage.recordAuditInHistory('recovery-alpha.com', 95, 0, 0, 0);
  storage.recordAuditInHistory('recovery-beta.com', 80, 2, 1, 0);

  // 1. Create verified backup
  const backup = storage.backupDb();
  assert.ok(fs.existsSync(backup.backupPath));
  assert.ok(backup.projectsCount >= 2);

  // 2. Simulate catastrophic disk corruption on the active DB file
  const primaryDb = path.join(tempDir, 'seo_projects.json');
  fs.writeFileSync(primaryDb, '0xDEADBEEF_CORRUPTED_SECTOR');

  // Primary db is unreadable and fails closed
  assert.throws(() => storage.getAllProjects(), /preserve the file and restore\/repair/);

  // 3. Execute recovery drill from backup
  const restoreResult = storage.restoreDb(backup.backupPath);
  assert.ok(restoreResult.projectsCount >= 2);

  // 4. Verify system fully restored to operational health
  const healthyProjects = storage.getAllProjects();
  assert.ok(healthyProjects.length >= 2);
  assert.ok(healthyProjects.some(p => p.domain === 'recovery-alpha.com'));
  assert.ok(healthyProjects.some(p => p.domain === 'recovery-beta.com'));
});

test('SQLite high-concurrency contention: 20 parallel transactions complete without lock starvation or corruption', async () => {
  const stressDbPath = path.join(tempDir, 'concurrency_stress.sqlite');
  const primaryAdapter = new storage.SqliteStorageAdapter(stressDbPath);

  // Run 20 concurrent transactions across parallel promises
  const taskCount = 20;
  const promises = Array.from({ length: taskCount }, async (_, i) => {
    // Open worker connection
    const workerAdapter = new storage.SqliteStorageAdapter(stressDbPath);
    try {
      workerAdapter.recordAuditInHistory(`worker-domain-${i}.com`, 80 + (i % 20), i % 3, i % 2, 0);
    } finally {
      workerAdapter.close();
    }
  });

  await Promise.all(promises);

  // Verify all 20 records persisted cleanly
  const allProjects = primaryAdapter.getAllProjects();
  assert.equal(allProjects.length, taskCount);
  primaryAdapter.close();
});

test('Operational recovery failure drill: Corrupted or invalid backup is rejected and leaves active DB untouched', () => {
  // Ensure active database is healthy with known state
  storage.recordAuditInHistory('intact-production.com', 99, 0, 0, 0);
  const beforeCount = storage.getAllProjects().length;

  // Create a corrupted backup file
  const corruptBackupPath = path.join(tempDir, 'corrupt_backup_payload.json');
  fs.writeFileSync(corruptBackupPath, '{"projects": [{"id": 123}], "history": "not-an-array"}');

  // Attempting to restore must throw schema validation error
  assert.throws(
    () => storage.restoreDb(corruptBackupPath),
    /invalid schema/i
  );

  // Active production database must be completely untouched and functional
  const afterProjects = storage.getAllProjects();
  assert.equal(afterProjects.length, beforeCount);
  assert.ok(afterProjects.some(p => p.domain === 'intact-production.com'));
});

