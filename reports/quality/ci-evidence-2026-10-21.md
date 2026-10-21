# CI quality evidence — 2026-10-21

This report records one reproducible GitHub Actions run for code revision d7db2237a959b74529c1289157ebac38270e8e2d, subsequently merged through PR #2.

- Workflow run: https://github.com/mightyalok00/open-semrush/actions/runs/39578129166
- Result: unit/API test job passed; Docker integration job passed.
- Runtime: Node v22.23.3, Ubuntu 26.04 x64.
- Test suite: 20 passed, 0 failed, 0 skipped; test duration 388.93 ms (reported by Node test runner).
- Docker check: clean Compose build/start, health endpoint, modeled keyword API, POST audit, persisted project lookup, container restart, and persistence re-check all passed.

## Coverage

Node's built-in test coverage report for the full project:

| Scope | Line coverage | Branch coverage | Function coverage |
|---|---:|---:|---:|
| All measured source and tests | 47.76% | 78.97% | 79.73% |
| Google Search Console provider module | 100.00% | 76.60% | 100.00% |
| SSRF URL safety module | 67.80% | 83.51% | 88.89% |
| Search Console provider tests | 100.00% | 100.00% | 87.50% |
| URL safety regression tests | 100.00% | 93.75% | 100.00% |

The project-wide line coverage remains modest because several AI, domain and SERP paths are not exercised. The provider's 100% line coverage is not proof of correctness or live Google-property validation.

## Reproducible microbenchmark

Command: node scripts/benchmark.mjs  
Warm-up: 1,000 calls per operation. Measured iterations: 10,000 per operation.

| Operation | Elapsed time | Operations / second |
|---|---:|---:|
| analyzeKeyword | 22.700 ms | 440,529 |
| calculateCtrByPosition | 1.009 ms | 9,909,703 |

Environment: Node v22.23.3, Linux x64, GitHub-hosted Ubuntu runner. This is a single-run microbenchmark snapshot, not a statistical benchmark, SLA, crawl-throughput measurement or production-performance promise. Runner load affects results. CI uploads raw JSON and coverage output as the quality-evidence artifact.

## Data source validation

Search Console provider tests use a known fixture with 15 clicks, 150 impressions, 10% CTR, and weighted average position 4.3333. Tests cover OAuth refresh, query filtering, date/property validation, aggregate totals and provider errors. This verifies parsing and aggregation against a deterministic example. CI did not query a live Search Console property because that requires user-provided OAuth credentials and property access.

## Remaining limitations

- No production authentication, rate limiting, distributed persistence, backups or multi-tenant controls.
- Modeled SEO metrics are illustrative; Search Console only reports properties available to the configured OAuth account.
- DNS pinning and regression tests reduce SSRF/DNS-rebinding risk but do not replace network egress restrictions.
- Microbenchmarks do not measure network crawls or full Docker workload performance.
