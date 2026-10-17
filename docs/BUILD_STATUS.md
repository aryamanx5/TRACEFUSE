# BUILD STATUS

Status values: NOT_STARTED · IN_PROGRESS · IMPLEMENTED · TESTED · BLOCKED · VERIFIED

## Resume instructions
1. Read this file, then `docs/PRD.md` (requirement IDs).
2. Backend venv: `backend/.venv` (already has deps). Run `cd backend && .venv/bin/pytest -q`.
3. Continue with the first row below that is not TESTED/VERIFIED.

## Verified research facts (2026-10-17, do not redo)
- Blockscout keyless works: eth.blockscout.com, explorer.optimism.io (RPC `/api?module=account` + `/api/v2`). Base/Arbitrum Blockscout → Cloudflare 403 for scripts.
- GoPlus `address_security` works keyless (Ronin exploiter → sanctioned=1, stealing_attack=1).
- GitHub search: issues/commits keyless (10/min); code search needs token.
- OFAC SDN.XML complete (CSV truncates remarks). Parsers verified on real data (Ronin addr → LAZARUS GROUP; Tornado designated 2022-08-08, removed+redesignated 2022-11-08, removed 2025-03-21).
- OP-Stack deposit L2 hash derivation verified exactly against Blockscout (L1 0x48e0d6…→ L2 0xc453ed…).
- Etherscan V2: OP/Base paid-tier only; Ethereum/Arbitrum free tier.

## Requirement checklist (2026-10-17)
| Area (PRD IDs) | Status | Key files | Evidence |
|---|---|---|---|
| LANDING-1..5 | TESTED | frontend/src/pages/Landing.tsx | vitest landing (2); manual scroll at 1024 px |
| INTAKE-1..5 | TESTED + live-verified | domain/validation.py, pages/NewInvestigation.tsx | pytest domain/api; vitest intake; live tx-hash run |
| CHAIN-1 Blockscout | VERIFIED (live) | providers/blockscout.py | Ronin recording, live run, unit tests |
| CHAIN-2 Etherscan V2 / CHAIN-3 Alchemy | TESTED (fixtures) · BLOCKED live (no keys) | providers/etherscan.py, alchemy.py | pytest mocked transports |
| CHAIN-4..11 | TESTED | providers/http.py, base.py, etherscan_compat.py | pytest http/providers/domain |
| GRAPH-1..8 | TESTED + manual UI | analysis/graph.py, pipeline/traversal.py, GraphView.tsx, Inspector.tsx | pytest; browser E2E |
| QUANT-1..9 | TESTED | analysis/metrics.py, MetricsView.tsx | pytest analysis |
| REPLAY-1..5 | TESTED + manual UI | analysis/timeline.py, ChronoReplay.tsx | pytest, vitest, browser play |
| MATRIX-1..4 | TESTED + manual UI | analysis/matrix.py, MatrixView.tsx | pytest, vitest (2), API drill-down |
| OSINT-1 GitHub | VERIFIED (unauth live) · code search BLOCKED (no token) | intel/github.py | recording, pytest |
| OSINT-3 GoPlus | VERIFIED (live keyless) | intel/goplus.py | recording + live run |
| OSINT-4/5 OFAC | VERIFIED (official files parsed) | intel/ofac.py, data/ofac/ | pytest on real notices |
| OSINT-6..8 | TESTED | intel/registry.py, extract.py, pipeline | pytest |
| FUSION-1..6 | TESTED + manual UI | analysis/fusion.py, FusionView.tsx | pytest, browser |
| RISK-1..6 | TESTED | analysis/scoring.py, ScoresView.tsx | pytest scoring, API rescore |
| CROSSCHAIN-1..6 | TESTED (OP derivation verified vs Blockscout); heuristic path fixture-tested | bridges/op_stack.py, analysis/crosschain.py | pytest |
| STREAM-1..4 | TESTED + live | pipeline/investigation.py, api routes, hooks.ts | pytest SSE; live cancel/retry |
| CASEBOOK-1..5 | TESTED | storage/repositories.py, routes/cases.py, CaseDetail.tsx | pytest, vitest |
| CHALLENGE-1..4 | TESTED | data/cases/ronin-2022/*, challenge/engine.py, Challenge.tsx | pytest, vitest; replay fidelity diff |
| REPORT-1..4 | TESTED | reports/builder.py | pytest journey |
| SECURITY-1..5 | TESTED | config, logging_setup, http.sanitize_url, api/app.py | pytest |
| UX-1..5 | IMPLEMENTED + partial tests | index.css, components/ui.tsx | vitest states; manual |
| OPS-1..5 | DONE | README.md, .env.example, migrations, scripts/ | — |

## Last successful checks
backend: pytest 62 passed · ruff clean · mypy clean. frontend: vitest 12 passed · tsc+vite build OK · oxlint 0 errors (5 warnings).

## Known gaps / next steps
1. Live verification of Etherscan V2, Alchemy, GitHub code search requires user credentials (adapters implemented + fixture-tested).
2. Cassette does not record transport-level timeouts (one request that timed out during recording replays as "not in historical dataset").
3. No Playwright suite; browser E2E was performed manually in the in-app browser.
4. Live mode for Base / Arbitrum requires ALCHEMY_API_KEY (or a paid Etherscan plan for Base/OP).
5. 5 oxlint `set-state-in-effect` warnings in data-fetch hooks.
