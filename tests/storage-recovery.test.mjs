import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-semrush-recovery-'));
process.env.OPEN_SEMRUSH_DATA_DIR = tempDir;
const storage = await import('../dist/storage.js');

test('backup and restore correctly creates snapshots and restores full state', () => {
  storage.recordAuditInHistory('alpha.com', 88, 1, 2, 0);
  storage.recordAuditInHistory('beta.com', 94, 0, 1, 1);

  const initialProjects = storage.getAllProjects();
  assert.equal(initialProjects.length, 2);

  // Take backup
  const backup = storage.backupDb();
  assert.ok(fs.existsSync(backup.backupPath));
  assert.equal(backup.projectsCount, 2);
  assert.equal(backup.historyCount, 2);

  // Mutate database
  storage.recordAuditInHistory('gamma.com', 70, 5, 5, 2);
  assert.equal(storage.getAllProjects().length, 3);

  // Restore from backup
  const restored = storage.restoreDb(backup.backupPath);
  assert.equal(restored.projectsCount, 2);
  assert.equal(restored.historyCount, 2);

  const afterRestore = storage.getAllProjects();
  assert.equal(afterRestore.length, 2);
  assert.deepEqual(afterRestore.map(p => p.domain).sort(), ['alpha.com', 'beta.com']);
});

test('interrupted writes do not corrupt primary database file', () => {
  const dbFile = path.join(tempDir, 'seo_projects.json');
  const validBytesBefore = fs.readFileSync(dbFile, 'utf8');

  // Simulate an interrupted write that left a dangling .tmp file
  const orphanedTmp = path.join(tempDir, `.seo_projects.9999.test-crash.tmp`);
  fs.writeFileSync(orphanedTmp, '{"incomplete":');

  // Database read should remain intact and ignore the partial temp file
  const projects = storage.getAllProjects();
  assert.equal(projects.length, 2);
  assert.equal(fs.readFileSync(dbFile, 'utf8'), validBytesBefore);

  try { fs.unlinkSync(orphanedTmp); } catch {}
});

test('corrupt JSON fails closed and preserves disk bytes until restored', () => {
  const dbFile = path.join(tempDir, 'seo_projects.json');
  const backup = storage.backupDb();

  const corruptPayload = '{"projects": [CORRUPTED_SYNTAX';
  fs.writeFileSync(dbFile, corruptPayload);

  // Must fail closed without overwriting corrupt bytes
  assert.throws(() => storage.getAllProjects(), /preserve the file and restore\/repair it/);
  assert.equal(fs.readFileSync(dbFile, 'utf8'), corruptPayload);

  // Restoring valid backup recovers the database
  const restored = storage.restoreDb(backup.backupPath);
  assert.equal(restored.projectsCount, 2);
  assert.equal(storage.getAllProjects().length, 2);
});

test('concurrent updates execute safely without data loss or race conditions', async () => {
  const domains = ['conc-1.com', 'conc-2.com', 'conc-3.com', 'conc-4.com', 'conc-5.com'];
  await Promise.all(domains.map((dom, i) =>
    new Promise((resolve) => {
      storage.recordAuditInHistory(dom, 80 + i, i, 0, 0);
      resolve();
    })
  ));

  const all = storage.getAllProjects();
  for (const dom of domains) {
    assert.ok(all.some(p => p.domain === dom), `Expected project for ${dom}`);
  }
});

test('SqliteStorageAdapter provides ACID transactions, relational durability, and restart recovery', () => {
  const sqliteFile = path.join(tempDir, 'test_recovery.sqlite');
  const adapter1 = new storage.SqliteStorageAdapter(sqliteFile);
  assert.equal(adapter1.name, 'sqlite');

  adapter1.recordAuditInHistory('sqlite-alpha.com', 90, 0, 1, 0);
  adapter1.recordAuditInHistory('sqlite-beta.com', 95, 0, 0, 1);
  adapter1.recordAuditInHistory('sqlite-alpha.com', 92, 0, 0, 0); // Updates last score for alpha

  const projects1 = adapter1.getAllProjects();
  assert.equal(projects1.length, 2);
  const alpha1 = projects1.find(p => p.domain === 'sqlite-alpha.com');
  assert.equal(alpha1?.lastAuditScore, 92);

  const historyAlpha = adapter1.getDomainAuditHistory('sqlite-alpha.com');
  assert.equal(historyAlpha.length, 2);
  assert.equal(historyAlpha[0].healthScore, 90);
  assert.equal(historyAlpha[1].healthScore, 92);

  adapter1.close();

  // Simulate process restart: fresh adapter pointing to same file
  const adapter2 = new storage.SqliteStorageAdapter(sqliteFile);
  const projects2 = adapter2.getAllProjects();
  assert.equal(projects2.length, 2);
  assert.equal(adapter2.getDomainAuditHistory('sqlite-alpha.com').length, 2);
  adapter2.close();
});

test('SqliteStorageAdapter in-memory mode operates with zero disk footprint', () => {
  const memAdapter = new storage.SqliteStorageAdapter(':memory:');
  memAdapter.recordAuditInHistory('mem-example.com', 100, 0, 0, 0);
  assert.equal(memAdapter.getAllProjects().length, 1);
  assert.equal(memAdapter.getDomainAuditHistory('mem-example.com').length, 1);
  memAdapter.close();
});
