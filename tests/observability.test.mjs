import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTraceContext,
  formatTraceparent,
  generateTraceId,
  generateSpanId,
  StructuredLogger,
  PrometheusRegistry,
  HealthMonitor,
} from '../dist/observability.js';

test('Observability: W3C TraceContext extraction and formatting', () => {
  const incomingHeader = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  const ctx = extractTraceContext(incomingHeader, 'tenant-alpha');

  assert.equal(ctx.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
  assert.equal(ctx.parentSpanId, '00f067aa0ba902b7');
  assert.equal(ctx.tenantId, 'tenant-alpha');
  assert.equal(ctx.spanId.length, 16);
  assert.notEqual(ctx.spanId, ctx.parentSpanId);

  const formatted = formatTraceparent(ctx);
  assert.equal(formatted, `00-4bf92f3577b34da6a3ce929d0e0e4736-${ctx.spanId}-01`);

  // Empty header generates fresh IDs
  const fresh = extractTraceContext(null);
  assert.equal(fresh.traceId.length, 32);
  assert.equal(fresh.spanId.length, 16);
  assert.equal(fresh.parentSpanId, undefined);
});

test('Observability: StructuredLogger formats log events with contextual metadata', () => {
  const logger = new StructuredLogger({ service: 'open-semrush' });
  const entry = logger.info('Benchmark completed', {
    traceId: 'abc123',
    tenantId: 'tenant-beta',
    durationMs: 42,
  });

  assert.equal(entry.level, 'INFO');
  assert.equal(entry.message, 'Benchmark completed');
  assert.equal(entry.traceId, 'abc123');
  assert.equal(entry.tenantId, 'tenant-beta');
  assert.equal(entry.durationMs, 42);
  assert.ok(entry.timestamp);
});

test('Observability: PrometheusRegistry counters, gauges, histograms and text export', () => {
  const reg = new PrometheusRegistry();
  reg.registerCounter('test_requests_total', 'Total HTTP requests');
  reg.registerGauge('test_memory_bytes', 'Heap memory bytes');
  reg.registerHistogram('test_latency_seconds', 'Request latency in seconds', [0.1, 0.5, 1.0]);

  reg.incrementCounter('test_requests_total', 1, { method: 'GET', status: '200' });
  reg.incrementCounter('test_requests_total', 2, { method: 'GET', status: '200' });
  reg.incrementCounter('test_requests_total', 1, { method: 'POST', status: '500' });

  reg.setGauge('test_memory_bytes', 1048576);

  reg.observeHistogram('test_latency_seconds', 0.05);
  reg.observeHistogram('test_latency_seconds', 0.4);
  reg.observeHistogram('test_latency_seconds', 0.8);

  const text = reg.exportPrometheusText();

  assert.ok(text.includes('# HELP test_requests_total Total HTTP requests'));
  assert.ok(text.includes('# TYPE test_requests_total counter'));
  assert.ok(text.includes('test_requests_total{method="GET",status="200"} 3'));
  assert.ok(text.includes('test_requests_total{method="POST",status="500"} 1'));

  assert.ok(text.includes('# HELP test_memory_bytes Heap memory bytes'));
  assert.ok(text.includes('# TYPE test_memory_bytes gauge'));
  assert.ok(text.includes('test_memory_bytes 1048576'));

  assert.ok(text.includes('# HELP test_latency_seconds Request latency in seconds'));
  assert.ok(text.includes('# TYPE test_latency_seconds histogram'));
  assert.ok(text.includes('test_latency_seconds_bucket{le="0.1"} 1'));
  assert.ok(text.includes('test_latency_seconds_bucket{le="0.5"} 2'));
  assert.ok(text.includes('test_latency_seconds_bucket{le="1"} 3'));
  assert.ok(text.includes('test_latency_seconds_bucket{le="+Inf"} 3'));
  assert.ok(text.includes('test_latency_seconds_count 3'));
});

test('Observability: HealthMonitor manages Liveness, Readiness, and Startup status', async () => {
  const monitor = new HealthMonitor();

  // Initial startup probe
  assert.equal(monitor.checkStartup().status, 'degraded');
  monitor.markStarted();
  assert.equal(monitor.checkStartup().status, 'ok');

  // Liveness
  const live = await monitor.checkLiveness();
  assert.equal(live.status, 'ok');

  // Readiness with custom dependency check
  let dbHealthy = true;
  monitor.registerCheck('database', () => dbHealthy);

  let ready = await monitor.checkReadiness();
  assert.equal(ready.status, 'ok');
  assert.equal(ready.checks.database.healthy, true);

  // Simulated DB degradation
  dbHealthy = false;
  ready = await monitor.checkReadiness();
  assert.equal(ready.status, 'degraded');
  assert.equal(ready.checks.database.healthy, false);

  // Draining
  monitor.markDraining();
  ready = await monitor.checkReadiness();
  assert.equal(ready.status, 'degraded');
  assert.equal(ready.checks.not_draining.healthy, false);
});

