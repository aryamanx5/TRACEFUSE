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

## Requirement checklist
| Area | Status | Files / notes |
|---|---|---|
| Config, logging redaction | IMPLEMENTED | config.py, logging_setup.py |
| CHAIN adapters (Blockscout, Etherscan V2, Alchemy), HTTP retry/rate/cache/record-replay | IMPLEMENTED | providers/* |
| Storage schema + repositories | IMPLEMENTED | storage/* |
| OSINT: OFAC SDN + recent actions | IMPLEMENTED (parser checked manually) | intel/ofac.py |
| OSINT: GoPlus, GitHub, Blockscout labels, registry | NOT_STARTED | |
| GRAPH/QUANT/MATRIX/REPLAY analysis | NOT_STARTED | |
| RISK scoring, FUSION graph | NOT_STARTED | |
| CROSSCHAIN (OP deterministic + heuristic) | NOT_STARTED | |
| Pipeline + STREAM (SSE) | NOT_STARTED | |
| API routes, CASEBOOK | NOT_STARTED | |
| REPORT exports | NOT_STARTED | |
| CHALLENGE + historical Ronin case | NOT_STARTED | |
| Backend tests | NOT_STARTED | |
| Frontend (LANDING, UX, all views) | NOT_STARTED | |
| Docs (PRD, architecture, etc.) | NOT_STARTED | |
