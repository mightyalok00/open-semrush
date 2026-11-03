-- Migration 003: ML Opportunity Ranking & Model Registry

CREATE TABLE IF NOT EXISTS ml_opportunity_rankings (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    query VARCHAR(255) NOT NULL,
    landing_page TEXT NOT NULL,
    current_position DOUBLE PRECISION NOT NULL,
    current_ctr DOUBLE PRECISION NOT NULL,
    impressions INTEGER NOT NULL,
    keyword_difficulty INTEGER NOT NULL,
    predicted_impact_score DOUBLE PRECISION NOT NULL,
    expected_incremental_clicks INTEGER NOT NULL,
    ranking_tier VARCHAR(32) NOT NULL DEFAULT 'medium' CHECK (ranking_tier IN ('critical', 'high', 'medium', 'low')),
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_opp_domain ON ml_opportunity_rankings(tenant_id, domain, predicted_impact_score DESC);

CREATE TABLE IF NOT EXISTS ml_calibrated_models (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    model_type VARCHAR(64) NOT NULL,
    alpha DOUBLE PRECISION NOT NULL,
    beta DOUBLE PRECISION NOT NULL,
    r_squared DOUBLE PRECISION,
    sample_size INTEGER NOT NULL DEFAULT 0,
    trained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_domain_model UNIQUE (tenant_id, domain, model_type)
);

