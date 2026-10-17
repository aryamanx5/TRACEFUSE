# Implementation log

**2026-10-17 — research.** Verified reference repos (crypttrace, GraphSense dashboard/tagpacks, Orbit) and live API
behaviour: Blockscout keyless (eth, OP), GoPlus keyless, GitHub search limits, OFAC XML vs CSV truncation, OP deposit
hash derivation reproduced exactly. Chose Blockscout as the primary keyless provider with Etherscan V2 / Alchemy as keyed
adapters; Ronin Bridge (2022) as the historical case (official OFAC + Treasury sources).

**Backend.** Built providers with a shared resilient HTTP layer and transport-level record/replay so the historical case
re-runs the real adapters. Switched Blockscout address paging from the RPC API to REST v2 keyset cursors after observing
the RPC limit; added spam-token handling via `token=` filters; terminal treatment for labelled services and protocol
contracts. Analysis is pure and recomputed per filter. Scoring is an explicit heuristic with correlation guards and a
behaviour-only cap.

**Historical case.** Recorded with `scripts/collect_historical_case.py`; replay verified identical to the recording
(284 nodes, 1,642 transfer ids). Challenge answers are prepared labels with sources, checked server-side.

**Frontend.** React 19 + Vite 8 + Tailwind v4 tokens; scrollytelling landing with Framer Motion (GSAP not needed);
Cytoscape graph and fusion graph; custom matrix grid with keyboard-focusable cells; Recharts for distributions.
UI state persisted to the case.

**Quality loop.** Fixed issues listed in TEST_RESULTS.md; ruff/mypy/tsc clean.
