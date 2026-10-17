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
| GRAPH-1..8 | VERIFIED | analysis/graph.py, GraphView.tsx (keyboard wallet list) | pytest; Playwright historical/keyboard |
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
backend: pytest 66 passed, 7 skipped (opt-in live; 4 of them additionally credential-gated) · ruff clean · mypy clean.
Earlier in this pass: `TRACEFUSE_LIVE_TESTS=1` live tests — OP Mainnet investigation, OP-Stack deposit confirmed, Across deposit decoded — 3 passed.
frontend (landing pass): `npm test` 12 passed · tsc/oxlint clean · build OK · Playwright `npm run e2e` **26 passed** (2026-10-18). Earlier: Playwright **25 passed** (incl. axe dark/light, keyboard, dialog, reduced motion, responsive mobile).
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
