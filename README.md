# TRACEFUSE — The Intelligence Fusion Lab

**Follow the money. Find the signal.** A blockchain-forensics and OSINT investigation workspace built for
the *Ghost Attacks* problem: stolen crypto is split across wallets, routed through bridges and hidden in
privacy infrastructure. TRACEFUSE fuses **real on-chain transfers** with **attributable public-source
intelligence** and keeps every inferred connection explainable.

- Scroll-to-reveal landing page → working Investigation Room
- Live, bounded wallet tracing (Blockscout keyless; Etherscan V2 / Alchemy with keys)
- Directed wallet graph, **ChronoReplay** timeline, **Matrix Mode** heatmap with cell → transaction drill-down
- OSINT: official OFAC SDN list + designation/removal history, GoPlus flags, explorer labels, GitHub mentions
- **Evidence Fusion Graph** separating *verified on-chain facts*, *external assertions*, *algorithmic inferences*, *analyst hypotheses*
- Explainable, configurable **heuristic** suspicion ranking (never a probability, never an identity claim)
- Cross-chain: deterministic OP-Stack deposit derivation + labelled heuristic candidates + privacy-gap reporting
- Persistent Casebook (notes, bookmarks, evidence review, decisions, hypotheses, UI state)
- Historical **Ronin Bridge (2022)** case recorded from real public APIs + investigator challenge
- HTML / JSON / CSV reports

## Quick start

Requirements: Python ≥ 3.11 (tested on 3.14), Node ≥ 20 (tested on 24).

One command runs the whole app — landing page, Investigation Room, media and API — from a single process:

```bash
./run.sh
```

Open http://127.0.0.1:8000. On first run it creates `backend/.venv`, installs the UI dependencies and builds
`frontend/dist`; afterwards it rebuilds the UI only when its sources changed. Options: `--port 9000`, `--host 0.0.0.0`,
`--offline` (no outbound provider calls; the recorded Ronin case still works), `--rebuild`, `--no-build`
(`./run.sh --help`). The built UI location can be overridden with `TRACEFUSE_FRONTEND_DIST`.

### Developing the UI with hot reload

```bash
cd backend && .venv/bin/uvicorn tracefuse.api.app:app --host 127.0.0.1 --port 8000
```

```bash
cd frontend && npm run dev
```

Then open http://localhost:5173 (Vite proxies `/api` to port 8000).

No credentials are needed for the demo: Ethereum and OP Mainnet use keyless Blockscout, GoPlus works keyless,
GitHub issue/commit search works unauthenticated, and an official OFAC snapshot is bundled. Copy
`.env.example` to `backend/.env` to add keys (see the comments there).

## Demo flow (historical case)

1. Landing page → **Explore the Ronin case** → **Open case in workspace**.
2. Watch the real progress events (replayed recorded provider responses through the same pipeline).
3. Wallet graph: the seed (teal), OFAC-listed Lazarus wallets (red tint), the Tornado Cash router (octagon).
   Click `0x5967…3c0a` → it received 4,512.3 ETH from an OFAC-listed address and sent 45 × 100 ETH to Tornado Cash.
4. ChronoReplay → ▶ Play from 2022-03-23: the 173,600 ETH internal transfer from the Ronin Bridge appears first.
5. Matrix → *Transferred value* / ETH → click the brightest cell → underlying transactions with explorer links.
6. Evidence fusion → the conflict banner shows Tornado Cash designation (2022-08-08), removal/re-designation
   (2022-11-08) and delisting (2025-03-21) from official OFAC notices.
7. Ranking → *Explain* → per-signal values, weights, facts and missing inputs; toggle signals → Re-evaluate.
8. Export HTML / JSON / CSV; open the case in **Casebook**, add notes, bookmarks, review states.
9. **Challenge** → 8 evidence-based checkpoints checked against sourced labels.

A live investigation: **New investigation** → paste any Ethereum address → Start. Progress is streamed via SSE
from real backend stages.

## Tests and quality checks

```bash
cd backend && .venv/bin/pytest -q && .venv/bin/ruff check tracefuse tests scripts && .venv/bin/mypy tracefuse
```

```bash
cd frontend && npm test && npm run lint && npm run build
```

Browser E2E (Playwright with system Google Chrome; deterministic, offline, uses the recorded Ronin case):

```bash
cd frontend && npm run e2e
```

Opt-in genuine live-provider checks (network required; never part of the default suites):

```bash
cd backend && TRACEFUSE_LIVE_TESTS=1 .venv/bin/pytest tests/test_live.py -v
```


```bash
cd frontend && npm run e2e:live
```

Backend tests cover adapters (mocked transports), pagination, rate limits/timeouts/retries, decimal precision,
dedup, OFAC parsing on real notices, OP-Stack hash derivation against an independently published value,
graph/matrix/timeline maths, scoring guards, Casebook CRUD, honest provider-failure handling and a full
historical-case journey through the API.

## Data / scripts

- `backend/scripts/import_ofac.py --live` — download the official SDN.XML + recent-action notices.
- `backend/scripts/collect_historical_case.py ronin-2022` — re-record the historical dataset from live APIs.
- `backend/data/cases/ronin-2022/` — case definition, sources, recorded cassette, challenge + labels.

## Troubleshooting

- **Base / Arbitrum show "unconfigured" or "blocked"**: their public Blockscout instances serve a browser challenge
  to scripts; set `ALCHEMY_API_KEY` (or a paid `ETHERSCAN_API_KEY` for Base/OP).
- **HTTP 429 / "rate limited"**: public providers are rate limited; TRACEFUSE backs off, honours
  `x-ratelimit-*` headers and reports partial results instead of inventing data. Retry later or add keys.
- **GitHub "code search needs GITHUB_TOKEN"**: expected without a token.
- Reset local data: stop the server and delete `backend/var/`.

## Limitations (by design)

Scores are uncalibrated heuristics; labels and mentions are assertions by their sources; mixers break
deterministic links; heuristic cross-chain candidates are hypotheses; no USD valuation; traversal is bounded.
See `docs/PRD.md` and `docs/DATA_SOURCES.md`.
