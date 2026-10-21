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
