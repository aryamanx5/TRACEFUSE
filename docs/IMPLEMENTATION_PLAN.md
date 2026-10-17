# Implementation plan (dependency order) — all phases executed

1. **Foundation** — config, logging redaction, domain models, validation, decimal helpers. ✅
2. **HTTP + providers** — ResilientHttp (rate/backoff/cache/budget/record-replay), Blockscout, Etherscan V2, Alchemy, registry. ✅
3. **Storage** — schema, migrations, repositories (cases, investigations, transfers, artifacts, events, cache, OFAC, challenge). ✅
4. **Intel** — OFAC SDN + notices (bundled snapshot), GoPlus, GitHub, extraction, bridge registry. ✅
5. **Analysis** — filters, graph, metrics, matrix, timeline, scoring, fusion, cross-chain (OP-Stack derivation). ✅
6. **Pipeline** — traversal, runner stages, events/SSE, job manager (cancel/retry). ✅
7. **API + reports** — routes, exports (HTML/JSON/CSV), casebook, challenge, historical. ✅
8. **Historical case** — record Ronin dataset from live keyless APIs; verify replay fidelity. ✅
9. **Frontend** — tokens, landing scrollytelling, shell, intake, workspace (graph, matrix, replay, fusion, ranking, evidence, cross-chain, metrics, inspector), casebook, historical, challenge, status. ✅
10. **Quality** — pytest, ruff, mypy, vitest, oxlint, tsc, vite build, browser E2E (historical + live). ✅

## Remaining / next (not required for done, recorded honestly)
- Live verification of Etherscan V2 / Alchemy / GitHub code search needs credentials.
- Record transport-level timeouts into cassettes (currently replay reports "not in historical dataset" for the one request that timed out during recording).
- Playwright suite for automated browser E2E (manual browser E2E performed instead).
