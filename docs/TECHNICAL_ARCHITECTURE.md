# Technical architecture

```
Browser (React + Vite + TS, Tailwind v4, Cytoscape, Recharts, Framer Motion)
   │  /api (same origin or Vite proxy)              EventSource (SSE)
   ▼
FastAPI app (tracefuse/api) ── routes: system · investigations · cases
   │
   ├─ JobManager / EventBus (asyncio tasks; events persisted → SSE)
   │     └─ InvestigationRunner  validate → window → seed → acquire → normalise → OSINT → cross-chain → score
   │            ├─ Traverser (bounded BFS, value-share ranking, terminal services, budgets)
   │            ├─ ProviderRegistry → Blockscout | Etherscan V2 | Alchemy   (ChainProvider interface)
   │            ├─ Intel: OfacService · GoPlusClient · GitHubClient · registry · extract
   │            └─ CrossChainTracer (OP-Stack derivation · heuristic candidates · privacy gaps)
   ├─ AnalysisService (on demand, per filter): graph · metrics · matrix · timeline · scoring · fusion
   ├─ Reports: HTML / JSON / CSV
   └─ Storage (SQLite via repositories only): cases, investigations, transfers, artifacts, events,
        notes/bookmarks/reviews/decisions/hypotheses, http_cache, ofac_*, challenge_progress
External: eth.blockscout.com, explorer.optimism.io, api.etherscan.io/v2, *.g.alchemy.com, api.gopluslabs.io,
          api.github.com, sanctionslistservice.ofac.treas.gov, ofac.treasury.gov (fixed hosts only)
```

## Component boundaries
- **providers/** — network adapters only. `ResilientHttp` owns rate limiting (token bucket + upstream headers),
  retries/backoff, timeouts, caching, budgets, secret-free URL sanitisation, record/replay transports and health.
- **domain/** — Pydantic models + validation + decimal helpers; vendor-independent.
- **analysis/** — pure functions over `list[Transfer]` (tested without I/O); `service.py` loads stored data.
- **pipeline/** — orchestration and progress semantics; every event is emitted after real work completes.
- **storage/** — the only SQL; forward-only migrations in `storage/migrations/`.
- **historical.py** — loads a case definition + cassette and runs the *same* runner with a replay transport.

## Data flow & provenance
Each `Transfer` carries `provenance {provider, endpoint (sanitised), retrieved_at, data_origin, from_cache}`.
`data_origin` is `live`, `cached` or `historical_case` (replay sets the recorded timestamp). Evidence carries
`source`, `source_url`, `source_item_id`, `collected_at`, `published_at`, `confidence`, `assertion_status`, `caveats`.

## Trust boundaries & security
- Secrets read from env only; `credential_status()` exposes presence; `RedactingFilter` scrubs logs; secrets are
  removed from cache keys/cassettes by `sanitize_url` (credential params + Alchemy path key).
- Outbound requests target fixed hosts; OFAC notices limited to `ofac.treasury.gov/recent-actions/YYYYMMDD`.
- Untrusted text (GitHub, labels) is control-char stripped, length-bounded, stored as plain text, React-escaped,
  HTML-escaped in reports under a no-script CSP; CSV cells starting with `= + - @` are neutralised.
- XML parsed with `defusedxml` (entities rejected). Request bodies > 256 KiB rejected. CORS allowlist.
- Traversal bounds enforced by Pydantic + server limits; per-investigation provider-call budget.

## Storage
SQLite (WAL). Transfers stored as JSON with indexed columns (tx, from, to). Analysis artifacts (`nodes`,
`evidence`, `crosschain`, `privacy_gaps`, `seed`, `source_status`, `scores_default`) per investigation.
Migration to PostgreSQL only touches `storage/`.

## Key design decisions
- Blockscout REST v2 keyset cursor seeded at `end_block+1` for windowed paging (RPC endpoint limit observed at
  ~10 req / 2 min). Spam-token floods trigger per-canonical-token refetch (`token=` filter).
- Record/replay at the HTTP transport level so the historical case exercises the real adapters.
- Scores computed on demand per filter (reproducible); a default-weight snapshot is stored for reports.
- Pandas not used: NetworkX + exact integer arithmetic covered all needs with less weight.
