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

## Run it on your laptop

No API keys and no account are needed. The first run takes a few minutes, because it installs dependencies and builds the UI.

### 1. Install the two prerequisites

| Tool | Version | Check with |
|---|---|---|
| **Python** | 3.11 or newer | `python3 --version` (Windows: `py --version`) |
| **Node.js** (includes npm) | 20 or newer | `node --version` |

If either is missing, install it from [python.org](https://www.python.org/downloads/) or [nodejs.org](https://nodejs.org/) (choose the LTS version).
On Windows, tick **"Add Python to PATH"** in the installer.

### 2. Get the code

```bash
git clone https://github.com/aryamanx5/TRACEFUSE.git
cd TRACEFUSE
```

No git? On the GitHub page, click **Code → Download ZIP**, unzip it and open a terminal in the unzipped folder.

### 3. Start TRACEFUSE

**macOS / Linux**: one command sets everything up and starts the app:

```bash
./run.sh
```

**Windows (PowerShell)**: run these from the `TRACEFUSE` folder, one at a time:

```powershell
cd backend
py -m venv .venv
.venv\Scripts\pip install -e .
cd ..\frontend
npm ci
npm run build
cd ..\backend
.venv\Scripts\uvicorn tracefuse.api.app:app --port 8000
```

### 4. Open it

Go to **http://127.0.0.1:8000** in Chrome, Edge, Firefox or Safari.

- `/` is the story (landing page). Click **Enter the investigation** to open the app.
- For a ready-made demo, click **Historical case → Open case in workspace** (the 2022 Ronin Bridge exploit, recorded from real public data).

To stop the app, press **Ctrl + C** in the terminal. Next time you only need step 3. On Windows, run just the last two lines.

### If something goes wrong

| Problem | Fix |
|---|---|
| `permission denied: ./run.sh` | `chmod +x run.sh`, then run it again |
| Port 8000 already in use | `./run.sh --port 9000` (Windows: `--port 9000` at the end of the uvicorn line), then open http://127.0.0.1:9000 |
| Workshop Wi-Fi is slow or blocks outside sites | `./run.sh --offline`: the historical Ronin case still works fully |
| `npm ci` is very slow or times out | `npm ci --registry=https://registry.yarnpkg.com` |
| Page says the UI is not built | Run `npm run build` inside `frontend`, then start again |

Want live data from more chains? Copy `.env.example` to `backend/.env` and add keys. The comments in that file explain each one. This is optional.

### Developing the UI with hot reload

```bash
cd backend && .venv/bin/uvicorn tracefuse.api.app:app --host 127.0.0.1 --port 8000
```

```bash
cd frontend && npm run dev
```

Then open http://localhost:5173 (Vite proxies `/api` to port 8000). More `run.sh` options: `./run.sh --help`.

## Demo flow (historical case)

1. Landing page → **Explore the Ronin case** → **Open case in workspace**.
2. Watch the real progress events (replayed recorded provider responses through the same pipeline).
3. Money flow: the starting wallet (mint square), OFAC-listed Lazarus wallets (amber), the Tornado Cash router (orange octagon).
   Click `0x5967…3c0a` → it received 4,512.3 ETH from an OFAC-listed address and sent 45 × 100 ETH to Tornado Cash.
4. ChronoReplay → ▶ Play from 2022-03-23: the 173,600 ETH internal transfer from the Ronin Bridge appears first.
5. Transfer matrix → *Transferred value* / ETH → click the brightest cell → underlying transactions with explorer links.
6. Connected evidence → the conflict banner shows Tornado Cash designation (2022-08-08), removal/re-designation
   (2022-11-08) and delisting (2025-03-21) from official OFAC notices.
7. Priority leads → *Explain* → per-signal values, weights, facts and missing inputs; toggle signals → Re-evaluate.
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
