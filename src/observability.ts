/**
 * Open Semrush 2.0: Production Observability, Tracing, & Prometheus Metrics.
 * 
 * Provides:
 * - W3C TraceContext (traceparent) extraction and propagation
 * - Prometheus text exposition format (counters, gauges, histograms)
 * - Structured JSON logging with tenant & trace correlation
 * - Kubernetes Liveness, Readiness, and Startup health monitors
 */

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// 1. W3C Distributed Tracing (TraceContext)
// ---------------------------------------------------------------------------

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly traceFlags: string;
  readonly tenantId?: string;
}

export function generateTraceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function generateSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Parses standard W3C traceparent header: 00-{trace_id}-{parent_id}-{trace_flags}
 */
export function extractTraceContext(
  traceparentHeader?: string | null,
  tenantId?: string | null
): TraceContext {
  if (traceparentHeader) {
    const parts = traceparentHeader.trim().split('-');
    if (parts.length === 4 && parts[0] === '00' && parts[1]?.length === 32 && parts[2]?.length === 16) {
      return {
        traceId: parts[1],
        spanId: generateSpanId(),
        parentSpanId: parts[2],
        traceFlags: parts[3] ?? '01',
        tenantId: tenantId ?? undefined,
      };
    }
  }

  return {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    traceFlags: '01',
    tenantId: tenantId ?? undefined,
  };
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.traceFlags}`;
}

// ---------------------------------------------------------------------------
// 2. Structured JSON Logger
// ---------------------------------------------------------------------------

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface StructuredLogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly tenantId?: string;
  readonly durationMs?: number;
  readonly httpStatus?: number;
  readonly method?: string;
  readonly path?: string;
  readonly meta?: Record<string, any>;
}

export class StructuredLogger {
  private readonly defaultMeta: Record<string, any>;

  constructor(defaultMeta: Record<string, any> = {}) {
    this.defaultMeta = defaultMeta;
  }

  log(
    level: LogLevel,
    message: string,
    context?: Partial<StructuredLogEntry>
  ): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.defaultMeta,
      ...context,
    };

    if (process.env.NODE_ENV === 'production' || process.env.LOG_FORMAT === 'json') {
      const output = JSON.stringify(entry);
      if (level === 'ERROR') {
        process.stderr.write(output + '\n');
      } else {
        process.stdout.write(output + '\n');
      }
    }
    return entry;
  }

  info(message: string, context?: Partial<StructuredLogEntry>): StructuredLogEntry {
    return this.log('INFO', message, context);
  }

  warn(message: string, context?: Partial<StructuredLogEntry>): StructuredLogEntry {
    return this.log('WARN', message, context);
  }

  error(message: string, context?: Partial<StructuredLogEntry>): StructuredLogEntry {
    return this.log('ERROR', message, context);
  }
}

// ---------------------------------------------------------------------------
// 3. Prometheus Metrics Registry
// ---------------------------------------------------------------------------

export class PrometheusRegistry {
  private static instance: PrometheusRegistry;

  private counters = new Map<string, { help: string; values: Map<string, number> }>();
  private gauges = new Map<string, { help: string; values: Map<string, number> }>();
  private histograms = new Map<string, { help: string; buckets: number[]; values: Map<string, { count: number; sum: number; buckets: Map<number, number> }> }>();

  public static getInstance(): PrometheusRegistry {
    if (!PrometheusRegistry.instance) {
      PrometheusRegistry.instance = new PrometheusRegistry();
    }
    return PrometheusRegistry.instance;
  }

  registerCounter(name: string, help: string): void {
    if (!this.counters.has(name)) {
      this.counters.set(name, { help, values: new Map() });
    }
  }

  registerGauge(name: string, help: string): void {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, { help, values: new Map() });
    }
  }

  registerHistogram(name: string, help: string, buckets: number[] = [0.01, 0.05, 0.1, 0.5, 1.0, 2.5, 5.0, 10.0]): void {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, { help, buckets: [...buckets].sort((a, b) => a - b), values: new Map() });
    }
  }

  private labelsToKey(labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) return '';
    const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    return sorted.map(([k, v]) => `${k}="${v}"`).join(',');
  }

  incrementCounter(name: string, delta = 1, labels?: Record<string, string>): void {
    const counter = this.counters.get(name);
    if (!counter) return;
    const key = this.labelsToKey(labels);
    const curr = counter.values.get(key) || 0;
    counter.values.set(key, curr + delta);
  }

  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const gauge = this.gauges.get(name);
    if (!gauge) return;
    const key = this.labelsToKey(labels);
    gauge.values.set(key, value);
  }

  observeHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const hist = this.histograms.get(name);
    if (!hist) return;
    const key = this.labelsToKey(labels);
    let item = hist.values.get(key);
    if (!item) {
      item = { count: 0, sum: 0, buckets: new Map() };
      for (const b of hist.buckets) item.buckets.set(b, 0);
      hist.values.set(key, item);
    }
    item.count += 1;
    item.sum += value;
    for (const b of hist.buckets) {
      if (value <= b) {
        item.buckets.set(b, (item.buckets.get(b) || 0) + 1);
      }
    }
  }

  /**
   * Produces Prometheus standard exposition text (version 0.0.4).
   */
  exportPrometheusText(): string {
    const lines: string[] = [];

    // Counters
    for (const [name, counter] of this.counters.entries()) {
      lines.push(`# HELP ${name} ${counter.help}`);
      lines.push(`# TYPE ${name} counter`);
      if (counter.values.size === 0) {
        lines.push(`${name} 0`);
      } else {
        for (const [labels, val] of counter.values.entries()) {
          const lStr = labels ? `{${labels}}` : '';
          lines.push(`${name}${lStr} ${val}`);
        }
      }
    }

    // Gauges
    for (const [name, gauge] of this.gauges.entries()) {
      lines.push(`# HELP ${name} ${gauge.help}`);
      lines.push(`# TYPE ${name} gauge`);
      if (gauge.values.size === 0) {
        lines.push(`${name} 0`);
      } else {
        for (const [labels, val] of gauge.values.entries()) {
          const lStr = labels ? `{${labels}}` : '';
          lines.push(`${name}${lStr} ${val}`);
        }
      }
    }

    // Histograms
    for (const [name, hist] of this.histograms.entries()) {
      lines.push(`# HELP ${name} ${hist.help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const [labels, item] of hist.values.entries()) {
        const prefix = labels ? `${labels},` : '';
        for (const b of hist.buckets) {
          lines.push(`${name}_bucket{${prefix}le="${b}"} ${item.buckets.get(b) || 0}`);
        }
        const lStr = labels ? `{${labels}}` : '';
        lines.push(`${name}_bucket{${prefix}le="+Inf"} ${item.count}`);
        lines.push(`${name}_sum${lStr} ${item.sum.toFixed(4)}`);
        lines.push(`${name}_count${lStr} ${item.count}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

// ---------------------------------------------------------------------------
// 4. Default Standard Open Semrush Metrics Setup
// ---------------------------------------------------------------------------

export function initStandardMetrics(): PrometheusRegistry {
  const reg = PrometheusRegistry.getInstance();
  reg.registerCounter('http_requests_total', 'Total incoming HTTP requests partitioned by status code and method');
  reg.registerCounter('ml_forecast_evaluations_total', 'Total ML forecasts computed partitioned by model id');
  reg.registerCounter('seo_crawls_total', 'Total active URL crawl operations');
  reg.registerCounter('seo_opportunity_rankings_total', 'Total keyword candidate ranking runs executed');
  
  reg.registerGauge('open_semrush_active_requests', 'Currently active in-flight HTTP requests');
  reg.registerGauge('open_semrush_memory_heap_bytes', 'Node.js memory heap usage in bytes');
  reg.registerGauge('open_semrush_memory_rss_bytes', 'Node.js resident set size in bytes');
  reg.registerGauge('open_semrush_server_uptime_seconds', 'Process uptime in seconds');

  reg.registerHistogram('http_request_duration_seconds', 'HTTP request latency distribution in seconds');
  return reg;
}

// ---------------------------------------------------------------------------
// 5. Health Monitor (Liveness, Readiness, Startup)
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  readonly status: 'ok' | 'degraded' | 'failing';
  readonly uptimeSeconds: number;
  readonly timestamp: string;
  readonly checks: Record<string, { healthy: boolean; message?: string }>;
}

export class HealthMonitor {
  private startupComplete = false;
  private isDraining = false;
  private readonly startTime = Date.now();
  private readonly customChecks = new Map<string, () => Promise<boolean> | boolean>();

  registerCheck(name: string, fn: () => Promise<boolean> | boolean): void {
    this.customChecks.set(name, fn);
  }

  markStarted(): void {
    this.startupComplete = true;
  }

  markDraining(): void {
    this.isDraining = true;
  }

  async checkLiveness(): Promise<HealthCheckResult> {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      checks: {
        process_alive: { healthy: true },
      },
    };
  }

  async checkReadiness(): Promise<HealthCheckResult> {
    const checks: Record<string, { healthy: boolean; message?: string }> = {
      not_draining: { healthy: !this.isDraining },
    };

    let allHealthy = !this.isDraining;

    for (const [name, fn] of this.customChecks.entries()) {
      try {
        const ok = await fn();
        checks[name] = { healthy: ok };
        if (!ok) allHealthy = false;
      } catch (err: any) {
        checks[name] = { healthy: false, message: err.message };
        allHealthy = false;
      }
    }

    return {
      status: allHealthy ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  checkStartup(): HealthCheckResult {
    return {
      status: this.startupComplete ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      checks: {
        initialized: { healthy: this.startupComplete },
      },
    };
  }
}
