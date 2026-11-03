-- Migration 001: Initial Schema & Relational Foundation
-- Applied with ACID isolation and schema tracking

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    max_projects INTEGER NOT NULL DEFAULT 50,
    max_monthly_crawls INTEGER NOT NULL DEFAULT 10000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Seed default tenant for single-tenant / standalone compatibility
INSERT INTO tenants (id, name)
VALUES ('default', 'Primary Organization')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_audit_score INTEGER NOT NULL DEFAULT 0,
    tracked_keywords_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT uq_tenant_domain UNIQUE (tenant_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_projects_tenant_domain ON projects(tenant_id, domain);

CREATE TABLE IF NOT EXISTS audit_history (
    id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL,
    domain VARCHAR(255) NOT NULL,
    health_score INTEGER NOT NULL CHECK (health_score >= 0 AND health_score <= 100),
    errors INTEGER NOT NULL DEFAULT 0 CHECK (errors >= 0),
    warnings INTEGER NOT NULL DEFAULT 0 CHECK (warnings >= 0),
    notices INTEGER NOT NULL DEFAULT 0 CHECK (notices >= 0)
);

CREATE INDEX IF NOT EXISTS idx_audit_history_tenant_domain ON audit_history(tenant_id, domain, timestamp DESC);

CREATE TABLE IF NOT EXISTS forecasts (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    model_version VARCHAR(64) NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    horizon_days INTEGER NOT NULL CHECK (horizon_days IN (30, 90, 180)),
    target_end_date DATE NOT NULL,
    expected_total_clicks DOUBLE PRECISION NOT NULL,
    lower95_total_clicks DOUBLE PRECISION NOT NULL,
    upper95_total_clicks DOUBLE PRECISION NOT NULL,
    actual_outcome_clicks DOUBLE PRECISION,
    evaluated_at TIMESTAMPTZ,
    data_points_json JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_forecasts_tenant_domain ON forecasts(tenant_id, domain, horizon_days);

