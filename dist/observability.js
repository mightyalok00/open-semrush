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
export function generateTraceId() {
    return crypto.randomBytes(16).toString('hex');
}
export function generateSpanId() {
    return crypto.randomBytes(8).toString('hex');
}
/**
 * Parses standard W3C traceparent header: 00-{trace_id}-{parent_id}-{trace_flags}
 */
export function extractTraceContext(traceparentHeader, tenantId) {
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
export function formatTraceparent(context) {
    return `00-${context.traceId}-${context.spanId}-${context.traceFlags}`;
}
export class StructuredLogger {
    defaultMeta;
    constructor(defaultMeta = {}) {
        this.defaultMeta = defaultMeta;
    }
    log(level, message, context) {
        const entry = {
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
            }
            else {
                process.stdout.write(output + '\n');
            }
        }
        return entry;
    }
    info(message, context) {
        return this.log('INFO', message, context);
    }
    warn(message, context) {
        return this.log('WARN', message, context);
    }
    error(message, context) {
        return this.log('ERROR', message, context);
    }
}
// ---------------------------------------------------------------------------
// 3. Prometheus Metrics Registry
// ---------------------------------------------------------------------------
export class PrometheusRegistry {
    static instance;
    counters = new Map();
    gauges = new Map();
    histograms = new Map();
    static getInstance() {
        if (!PrometheusRegistry.instance) {
            PrometheusRegistry.instance = new PrometheusRegistry();
        }
        return PrometheusRegistry.instance;
    }
    registerCounter(name, help) {
        if (!this.counters.has(name)) {
            this.counters.set(name, { help, values: new Map() });
        }
    }
    registerGauge(name, help) {
        if (!this.gauges.has(name)) {
            this.gauges.set(name, { help, values: new Map() });
        }
    }
    registerHistogram(name, help, buckets = [0.01, 0.05, 0.1, 0.5, 1.0, 2.5, 5.0, 10.0]) {
        if (!this.histograms.has(name)) {
            this.histograms.set(name, { help, buckets: [...buckets].sort((a, b) => a - b), values: new Map() });
        }
    }
    labelsToKey(labels) {
        if (!labels || Object.keys(labels).length === 0)
            return '';
        const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
        return sorted.map(([k, v]) => `${k}="${v}"`).join(',');
    }
    incrementCounter(name, delta = 1, labels) {
        const counter = this.counters.get(name);
        if (!counter)
            return;
        const key = this.labelsToKey(labels);
        const curr = counter.values.get(key) || 0;
        counter.values.set(key, curr + delta);
    }
    setGauge(name, value, labels) {
        const gauge = this.gauges.get(name);
        if (!gauge)
            return;
        const key = this.labelsToKey(labels);
        gauge.values.set(key, value);
    }
    observeHistogram(name, value, labels) {
        const hist = this.histograms.get(name);
        if (!hist)
            return;
        const key = this.labelsToKey(labels);
        let item = hist.values.get(key);
        if (!item) {
            item = { count: 0, sum: 0, buckets: new Map() };
            for (const b of hist.buckets)
                item.buckets.set(b, 0);
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
    exportPrometheusText() {
        const lines = [];
        // Counters
        for (const [name, counter] of this.counters.entries()) {
            lines.push(`# HELP ${name} ${counter.help}`);
            lines.push(`# TYPE ${name} counter`);
            if (counter.values.size === 0) {
                lines.push(`${name} 0`);
            }
            else {
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
            }
            else {
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
    reset() {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
    }
}
// ---------------------------------------------------------------------------
// 4. Default Standard Open Semrush Metrics Setup
// ---------------------------------------------------------------------------
export function initStandardMetrics() {
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
export class HealthMonitor {
    startupComplete = false;
    isDraining = false;
    startTime = Date.now();
    customChecks = new Map();
    registerCheck(name, fn) {
        this.customChecks.set(name, fn);
    }
    markStarted() {
        this.startupComplete = true;
    }
    markDraining() {
        this.isDraining = true;
    }
    async checkLiveness() {
        return {
            status: 'ok',
            uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
            timestamp: new Date().toISOString(),
            checks: {
                process_alive: { healthy: true },
            },
        };
    }
    async checkReadiness() {
        const checks = {
            not_draining: { healthy: !this.isDraining },
        };
        let allHealthy = !this.isDraining;
        for (const [name, fn] of this.customChecks.entries()) {
            try {
                const ok = await fn();
                checks[name] = { healthy: ok };
                if (!ok)
                    allHealthy = false;
            }
            catch (err) {
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
    checkStartup() {
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
