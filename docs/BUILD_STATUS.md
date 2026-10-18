# BUILD STATUS

Status values: NOT_STARTED · IN_PROGRESS · IMPLEMENTED · TESTED · BLOCKED · VERIFIED

## Resume instructions
1. Read this file, then `docs/PRD.md` (requirement IDs).
2. Backend venv: `backend/.venv` (already has deps). Run `cd backend && .venv/bin/pytest -q`.
3. Continue with the first row below that is not TESTED/VERIFIED.

## Canonical version (decided 2026-10-18)
`main` is the final prototype: cinematic landing page + Investigation Room (layered 2D fund flow, interactive 3D network,
stable ChronoReplay) + one-command single-port app (`./run.sh`). Start every new session from `main`.
- Superseded, not merged: `claude/investigation-workspace-redesign-850214` (an earlier, parallel workspace redesign). Do not build on it.
- Run it: `./run.sh` → http://127.0.0.1:8000 (`--port N` if 8000 is taken, `--offline` for no live provider calls).

 (2026-10-17, do not redo)
- Blockscout keyless works: eth.blockscout.com, explorer.optimism.io (RPC `/api?module=account` + `/api/v2`). Base/Arbitrum Blockscout → Cloudflare 403 for scripts.
- GoPlus `address_security` works keyless (Ronin exploiter → sanctioned=1, stealing_attack=1).
- GitHub search: issues/commits keyless (10/min); code search needs token.
- OFAC SDN.XML complete (CSV truncates remarks). Parsers verified on real data (Ronin addr → LAZARUS GROUP; Tornado designated 2022-08-08, removed+redesignated 2022-11-08, removed 2025-03-21).
- OP-Stack deposit L2 hash derivation verified exactly against Blockscout (L1 0x48e0d6…→ L2 0xc453ed…).
- Etherscan V2: OP/Base paid-tier only; Ethereum/Arbitrum free tier.

## Requirement checklist (audited 2026-10-18 against docs/PRD.md — 105 requirement IDs)
Completion = requirements VERIFIED ÷ 105 PRD IDs = **100 / 105 = 95.2 %**. No implementable requirement is incomplete;
the remaining 5 are limited only by missing credentials (live verification), see "External blockers".

| Area (PRD IDs) | Status | Key files | Evidence |
|---|---|---|---|
| LANDING-1..5 | VERIFIED | pages/Landing.tsx, features/landing/* | cinematic scroll story (2026-10-18): vitest; Playwright landing (5 chapters, video scrubs fwd/back, CTA → /app, replay, media-failure fallback)/responsive/keyboard (reduced motion); axe 0 |
| INTAKE-1..5 | VERIFIED | domain/validation.py, NewInvestigation.tsx | pytest; Playwright states; live tx-hash runs (Ethereum, OP) |
| CHAIN-1 Blockscout (Ethereum + OP Mainnet) | VERIFIED (live) | providers/blockscout.py | live pytest `test_live_op_mainnet_investigation`; Ronin recording; live E2E |
| CHAIN-4..11 | VERIFIED | providers/* | pytest |
| CHAIN-2 Etherscan V2 · CHAIN-3 Alchemy | IMPLEMENTED, fixture-tested · BLOCKED live | providers/etherscan.py, alchemy.py | needs ETHERSCAN_API_KEY / ALCHEMY_API_KEY |
| GRAPH-1..8 | VERIFIED | analysis/graph.py, features/workspace/flow/* (2D fund flow + 3D network, keyboard wallet list) | pytest; vitest flow.test; Playwright flow/historical/keyboard |
| QUANT-1..9, MATRIX-1..4, REPLAY-1..5 | VERIFIED | analysis/*, MatrixView/ChronoReplay | pytest; vitest; Playwright |
| OSINT-2..8 | VERIFIED (GoPlus, OFAC, labels live) | intel/* | pytest; recording |
| OSINT-1 GitHub | VERIFIED unauthenticated (issues/commits) · code search BLOCKED | intel/github.py | needs GITHUB_TOKEN |
| FUSION-1..6, RISK-1..6 | VERIFIED | analysis/fusion.py, scoring.py | pytest; Playwright fusion/ranking |
| CROSSCHAIN-2,3,5,6 | VERIFIED (OP-Stack deposit **confirmed live**; Across deposit decoded live) | bridges/op_stack.py, bridges/across.py, analysis/crosschain.py | live pytest `test_live_op_stack_deposit_confirmed`, `test_live_across_…`; fixtures from real logs |
| CROSSCHAIN-1 | Ethereum + OP VERIFIED live · Base/Arbitrum BLOCKED | chains.py | needs ALCHEMY_API_KEY |
| CROSSCHAIN-4 heuristic / Across fill confirmation | IMPLEMENTED, tested on real-log fixtures · live candidate/fill not observable keylessly | analysis/crosschain.py | recent Across deposits target Base/other chains (need ALCHEMY_API_KEY) |
| STREAM-1..4, CASEBOOK-1..5, CHALLENGE-1..4, REPORT-1..4, SECURITY-1..5 | VERIFIED | — | pytest; Playwright |
| UX-1..5 | VERIFIED (automated) | index.css, components/ui.tsx | axe 0 (dark+light), keyboard spec; see docs/ACCESSIBILITY_AUDIT.md (manual AT testing not performed) |
| OPS-1..5 | VERIFIED | README, scripts, migrations | — |

## One app, one command (2026-10-18)
- `./run.sh` (repo root): creates `backend/.venv` / installs UI deps when missing, rebuilds `frontend/dist` only when UI sources are
  newer, then `exec`s uvicorn — landing, Investigation Room, media and `/api` on one port (default 127.0.0.1:8000).
- `api/app.py::mount_frontend`: SPA fallback for client routes, `/assets` cached immutable, media via FileResponse (Range → 206),
  unknown `/api/*` stays JSON 404, path traversal blocked, 503 page with instructions when the UI is not built.
  Setting `tracefuse_frontend_dist` (env `TRACEFUSE_FRONTEND_DIST`). Tests: `tests/test_frontend_serving.py`.
- Verified: `./run.sh --offline --rebuild --port 8020` → landing video ready, historical case opens in the workspace, no console errors.
- Note: the desktop preview runner cannot exec scripts in this worktree (macOS "Operation not permitted"); run `./run.sh` from a terminal.

## Investigation Room — Phase 2: 2D fund flow + 3D network (2026-10-18, branch `claude/tracefuse-investigation-room`)
- `features/workspace/flow/model.ts`: one deterministic model for both views. Columns = hop distance from the starting
  wallet (negative = senders in); 2D rows centre-out by importance then barycentre; 3D = one disc per column with branches
  keeping their angle. Positions depend only on graph + analyst reveals, never on the replay cursor.
- Simplified view by default (start, flagged/service wallets, notable expansion states, largest flows, routes back to the
  start) with explicit “+N more” placeholders per column and a status line; “Show full graph” draws everything.
- 2D (`FlowGraph2D`, Cytoscape preset positions, taxi edges): search, fit, zoom, reset layout, expand one hop, trace path
  (BFS downstream → upstream → undirected), isolate, hover cards, column headers; elements diffed in place (no rebuild).
- 3D (`Network3D`, plain three.js 0.186 + OrbitControls, lazy chunk ~150 kB gz): orbit/pan/zoom, hover preview, click → Inspector,
  trace/isolate (glow tubes), expand downstream, focus/reset camera tweens, sparse HTML labels, particles on revealed real edges,
  reveal pulses during replay, WebGL-unavailable fallback to 2D; disabled < 768 px (2D on phones).
- ChronoReplay: one interval per play session (cursor in a ref), fixed-height rows; views only toggle classes/opacity on ticks.
  Playwright asserts layout version, canvas box and page height are unchanged during playback.
- Plain-language pass: status labels (Verified transaction / Source-reported information / Unverified hypothesis), Inspector
  (“Why this wallet was flagged”, tracing status, fan-in/out as funds coming together/splitting apart, advanced metrics folded),
  filters, tabs (Fund flow, Transfer matrix, Lead ranking, Flow patterns), compact status strip + Export menu.
- Optional overlay: algorithmic `coordinated_split` relationships as dotted amber “unverified pattern” edges (off by default).
- npm registry (registry.npmjs.org) times out from this machine; `three` was installed via `--registry=https://registry.yarnpkg.com`
  and lockfile URLs rewritten back to npmjs.org (same tarballs/integrity).

## Landing page — Phase 1 cinematic scroll story (2026-10-18, branch `claude/tracefuse-landing-page-b1b13c`)
- Hero media: `frontend/public/media/tracefuse-hero.mp4` = the supplied Gemini clip (10 s, 1280×720) re-encoded for scrubbing
  (H.264, keyframe every 6 frames, no audio, moov first) with Swift/AVFoundation — no ffmpeg on this machine. The original had a
  single keyframe, which makes every seek decode from frame 0. Poster = its first frame (`tracefuse-hero-poster.png` master,
  `.jpg` 270 KB used on the page). `reference-assets/cowboyspace.mp4` was not present; nothing was reproduced from it.
- `useScrubVideo` fetches the clip once as a blob after first paint, maps scroll progress → `currentTime` through one eased rAF
  loop (no overlapping seeks, sleeps off-screen / when settled), never plays. Poster-only when reduced motion or Save-Data; poster
  stays if the media fails (`data-media="failed"`).
- Chapters: `features/landing/chapters.ts` (ids signal · fragmentation · disconnected · fusion · enter). Diagrams are labelled
  illustrative; chapter 03 uses public Ronin facts from `backend/data/cases/ronin-2022/labels.json`.
- Fonts: Archivo (variable width) + JetBrains Mono via Google Fonts in `index.html`; system fallbacks if offline.

## Last successful checks (2026-10-18, finalization — branch `tracefuse-finalization`)
backend: pytest 68 passed, 7 skipped (one-app pass; was 66) (opt-in live; 4 of them additionally credential-gated) · ruff clean · mypy clean.
Earlier in this pass: `TRACEFUSE_LIVE_TESTS=1` live tests — OP Mainnet investigation, OP-Stack deposit confirmed, Across deposit decoded — 3 passed.
frontend (investigation-room pass): `npm test` 16 passed · tsc/oxlint clean · build OK · Playwright `npm run e2e` **28 passed** (2026-10-18). Landing pass: 26 passed. Earlier: Playwright **25 passed** (incl. axe dark/light, keyboard, dialog, reduced motion, responsive mobile).
Manual demo smoke (in-app browser): historical Ronin case opens, workspace renders with historical banner, exports and ChronoReplay.

## Outstanding requirements → required live check (all blocked: no credentials present in environment or backend/.env)
| Requirement | Credential | Ready-to-run check |
|---|---|---|
| CHAIN-2 Etherscan V2 | `ETHERSCAN_API_KEY` | `test_live_etherscan_v2_provider` |
| CHAIN-3 Alchemy | `ALCHEMY_API_KEY` | `test_live_alchemy_provider_ethereum` |
| CROSSCHAIN-1 Base/Arbitrum | `ALCHEMY_API_KEY` | `test_live_alchemy_base_and_across_fill` |
| CROSSCHAIN-4 live fill/candidate | `ALCHEMY_API_KEY` | `test_live_alchemy_base_and_across_fill` |
| OSINT-1 code search | `GITHUB_TOKEN` | `test_live_github_code_search` |
Run: `cd backend && TRACEFUSE_LIVE_TESTS=1 .venv/bin/pytest tests/test_live.py -v -rs` (tests skip with the variable name when absent).

## External blockers (credentials not present in environment or .env)
1. `ETHERSCAN_API_KEY` — CHAIN-2 live (free tier: Ethereum, Arbitrum; OP/Base paid).
2. `ALCHEMY_API_KEY` — CHAIN-3 live; Base/Arbitrum (CROSSCHAIN-1); live Across fill confirmation on Base (CROSSCHAIN-4).
3. `GITHUB_TOKEN` — GitHub code search (OSINT-1).
4. `GOPLUS_ACCESS_TOKEN` (optional) — authenticated GoPlus tier; keyless tier verified.

## Not claimed
Manual screen-reader / assistive-technology testing has not been performed.
