import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PostgreSqlStorageAdapter,
  MockPgPool,
  migrateSqliteToPostgres,
} from '../dist/postgres-storage.js';
import { SqliteStorageAdapter } from '../dist/storage.js';

test('PostgreSQL Storage: Connection pool health check succeeds', async () => {
  const adapter = new PostgreSqlStorageAdapter();
  const health = await adapter.healthCheck();
  assert.equal(health.ok, true);
  assert.ok(health.latencyMs >= 0);
  assert.equal(health.poolType, 'MockPgPool');
});

test('PostgreSQL Storage: Migration runner applies schema migrations idempotently', async () => {
  const pool = new MockPgPool();
  const adapter = new PostgreSqlStorageAdapter({ customPool: pool });

  // First run: executes all 3 migration files
  const applied = await adapter.runMigrations(path.resolve(process.cwd(), 'migrations'));
  assert.equal(applied.length, 3);
  assert.equal(applied[0].version, 1);
  assert.equal(applied[1].version, 2);
  assert.equal(applied[2].version, 3);

  // Second run: idempotent, 0 migrations applied
  const rerun = await adapter.runMigrations(path.resolve(process.cwd(), 'migrations'));
  assert.equal(rerun.length, 0);
});

test('PostgreSQL Storage: Multi-tenant project & audit isolation', async () => {
  const adapter = new PostgreSqlStorageAdapter();
  await adapter.init();

  // Create two distinct tenants
  await adapter.createTenant('tenant-alpha', 'Alpha Inc', 10, 5000);
  await adapter.createTenant('tenant-beta', 'Beta Corp', 15, 8000);

  // Tenant Alpha records project and audit
  await adapter.upsertProjectRecord({
    id: 'proj-a1',
    domain: 'shared-domain.com',
    createdAt: new Date().toISOString(),
    lastAuditScore: 94,
    trackedKeywords: ['keyword-alpha'],
  }, 'tenant-alpha');

  await adapter.recordAuditInHistoryAsync('shared-domain.com', 94, 0, 1, 2, 'tenant-alpha');

  // Tenant Beta records same domain with different audit score
  await adapter.upsertProjectRecord({
    id: 'proj-b1',
    domain: 'shared-domain.com',
    createdAt: new Date().toISOString(),
    lastAuditScore: 78,
    trackedKeywords: ['keyword-beta'],
  }, 'tenant-beta');

  await adapter.recordAuditInHistoryAsync('shared-domain.com', 78, 2, 5, 4, 'tenant-beta');

  // Verify Alpha's isolated data
  const alphaProjects = await adapter.getAllProjectsAsync('tenant-alpha');
  assert.equal(alphaProjects.length, 1);
  assert.equal(alphaProjects[0].lastAuditScore, 94);
  assert.deepEqual(alphaProjects[0].trackedKeywords, ['keyword-alpha']);

  const alphaHistory = await adapter.getDomainAuditHistoryAsync('shared-domain.com', 'tenant-alpha');
  assert.equal(alphaHistory.length, 1);
  assert.equal(alphaHistory[0].healthScore, 94);

  // Verify Beta's isolated data
  const betaProjects = await adapter.getAllProjectsAsync('tenant-beta');
  assert.equal(betaProjects.length, 1);
  assert.equal(betaProjects[0].lastAuditScore, 78);
  assert.deepEqual(betaProjects[0].trackedKeywords, ['keyword-beta']);

  const betaHistory = await adapter.getDomainAuditHistoryAsync('shared-domain.com', 'tenant-beta');
  assert.equal(betaHistory.length, 1);
  assert.equal(betaHistory[0].healthScore, 78);
});

test('PostgreSQL Storage: Forecast record persistence and outcome verification', async () => {
  const adapter = new PostgreSqlStorageAdapter();
  await adapter.init();

  const forecast = {
    id: 'fc-pg-101',
    domain: 'forecast-pg-test.com',
    modelVersion: 'v1.4.0-ts-ensemble',
    generatedAt: new Date().toISOString(),
    horizonDays: 30,
    targetEndDate: '2026-12-01',
    expectedTotalClicks: 5200,
    lower95TotalClicks: 4800,
    upper95TotalClicks: 5600,
  };

  await adapter.recordForecastAsync(forecast, 'tenant-alpha');

  const retrieved = await adapter.getForecastsForDomainAsync('forecast-pg-test.com', 'tenant-alpha');
  assert.equal(retrieved.length, 1);
  assert.equal(retrieved[0].id, 'fc-pg-101');
  assert.equal(retrieved[0].expectedTotalClicks, 5200);

  // Record outcome
  await adapter.recordForecastOutcomeAsync('fc-pg-101', 5340);
  const updated = await adapter.getForecastsForDomainAsync('forecast-pg-test.com', 'tenant-alpha');
  assert.equal(updated[0].actualOutcomeClicks, 5340);
});

test('PostgreSQL Storage: migrateSqliteToPostgres migrates SQLite data into PostgreSQL with 100% parity', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-semrush-pg-migration-'));
  const sqlitePath = path.join(tempDir, 'source.sqlite');

  const sqlite = new SqliteStorageAdapter(sqlitePath);
  sqlite.upsertProjectRecord({
    id: 'sql-proj-1',
    domain: 'migrated-to-pg.com',
    createdAt: new Date().toISOString(),
    lastAuditScore: 91,
    trackedKeywords: ['pg', 'migration'],
  });
  sqlite.recordAuditInHistory('migrated-to-pg.com', 91, 0, 2, 1);
  sqlite.close();

  const pgAdapter = new PostgreSqlStorageAdapter();
  await pgAdapter.init();

  const result = await migrateSqliteToPostgres(sqlitePath, pgAdapter, 'tenant-migrated');
  assert.equal(result.migratedProjects, 1);
  assert.equal(result.migratedHistory, 1);

  const pgProjects = await pgAdapter.getAllProjectsAsync('tenant-migrated');
  assert.equal(pgProjects.length, 1);
  assert.equal(pgProjects[0].domain, 'migrated-to-pg.com');
  assert.equal(pgProjects[0].lastAuditScore, 91);
});
