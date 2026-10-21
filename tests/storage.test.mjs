import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-semrush-storage-'));
process.env.OPEN_SEMRUSH_DATA_DIR = dataDir;
const storage = await import('../dist/storage.js');

test('audit history is durably stored and project reads are detached snapshots', () => {
  storage.recordAuditInHistory('Example.COM', 92, 1, 2, 3);
  const projects = storage.getAllProjects();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].domain, 'example.com');
  assert.equal(projects[0].lastAuditScore, 92);
  projects[0].trackedKeywords.push('mutated-in-caller');
  assert.deepEqual(storage.getAllProjects()[0].trackedKeywords, []);
  assert.equal(storage.getDomainAuditHistory('EXAMPLE.com').length, 1);
  const file = path.join(dataDir, 'seo_projects.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).history.length, 1);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0);
});

test('corrupt persistence fails closed without silently overwriting the original bytes', () => {
  const file = path.join(dataDir, 'seo_projects.json');
  const corrupt = '{not valid json';
  fs.writeFileSync(file, corrupt);
  assert.throws(() => storage.getAllProjects(), /Unable to read .*preserve the file/);
  assert.equal(fs.readFileSync(file, 'utf8'), corrupt);
});

test('validateDb enforces strict schema validation on persisted records', () => {
  assert.throws(() => storage.validateDb(null), /Stored SEO database is not a JSON object/);
  assert.throws(() => storage.validateDb([]), /invalid schema/);
  assert.throws(() => storage.validateDb({ projects: 'invalid', history: [] }), /invalid schema/);

  // Invalid project record
  assert.throws(
    () => storage.validateDb({
      projects: [{ id: '1', domain: '', createdAt: '2026-10-21T00:00:00Z', lastAuditScore: 90, trackedKeywords: [] }],
      history: []
    }),
    /Stored project domain must be a non-empty string/
  );
  assert.throws(
    () => storage.validateDb({
      projects: [{ id: '1', domain: 'test.com', createdAt: '2026-10-21T00:00:00Z', lastAuditScore: 150, trackedKeywords: [] }],
      history: []
    }),
    /Stored project lastAuditScore must be an integer between 0 and 100/
  );
  assert.throws(
    () => storage.validateDb({
      projects: [{ id: '1', domain: 'test.com', createdAt: '2026-10-21T00:00:00Z', lastAuditScore: 90, trackedKeywords: [123] }],
      history: []
    }),
    /Stored project trackedKeywords must be an array of strings/
  );

  // Invalid history entry
  assert.throws(
    () => storage.validateDb({
      projects: [],
      history: [{ timestamp: '2026-10-21', domain: 'test.com', healthScore: -5, errors: 0, warnings: 0, notices: 0 }]
    }),
    /Stored history healthScore must be an integer between 0 and 100/
  );
  assert.throws(
    () => storage.validateDb({
      projects: [],
      history: [{ timestamp: '2026-10-21', domain: 'test.com', healthScore: 80, errors: -1, warnings: 0, notices: 0 }]
    }),
    /Stored history errors must be a non-negative integer/
  );

  // Valid DB returns clean normalized structure
  const valid = storage.validateDb({
    projects: [{ id: 'p1', domain: '  EXAMPLE.COM ', createdAt: '2026-10-21T00:00:00Z', lastAuditScore: 95, trackedKeywords: ['seo', 'open'] }],
    history: [{ timestamp: '2026-10-21T00:00:00Z', domain: 'EXAMPLE.COM', healthScore: 95, errors: 0, warnings: 1, notices: 2 }]
  });
  assert.equal(valid.projects[0].domain, 'example.com');
  assert.equal(valid.projects[0].lastAuditScore, 95);
  assert.deepEqual(valid.projects[0].trackedKeywords, ['seo', 'open']);
  assert.equal(valid.history[0].domain, 'example.com');
});

test('JsonFileStorageAdapter and defaultStorageAdapter implement StorageAdapter interface', () => {
  assert.equal(storage.defaultStorageAdapter.name, 'json-file');
  const custom = new storage.JsonFileStorageAdapter();
  assert.equal(custom.name, 'json-file');
  assert.equal(typeof custom.getAllProjects, 'function');
  assert.equal(typeof custom.getDomainAuditHistory, 'function');
  assert.equal(typeof custom.recordAuditInHistory, 'function');
});
