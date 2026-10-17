# Test results (2026-10-17, macOS, Python 3.14.2, Node 24.13)

## Backend
| Command | Result |
|---|---|
| `cd backend && .venv/bin/pytest -q` | **62 passed** (~10 s) |
| `.venv/bin/ruff check tracefuse tests scripts` | All checks passed (config: E501 and S105–S107 false positives ignored, documented in pyproject) |
| `.venv/bin/mypy tracefuse` | Success: no issues found in 56 source files |

## Frontend
| Command | Result |
|---|---|
| `cd frontend && npm test` (vitest) | **12 passed** |
| `npm run build` (tsc -b + vite build) | success; largest chunks: cytoscape 435 kB, recharts 360 kB (lazy-loaded routes) |
| `npm run lint` (oxlint) | 0 errors, 5 warnings (`set-state-in-effect` in data-fetch effects — accepted) |

## Live integrations exercised (no credentials)
| Integration | Evidence |
|---|---|
| Blockscout eth (v2 + RPC) | Ronin case recording (116 interactions); live tx-hash investigation `inv_524effe1085e089d` (22 transfers, partial due to one timed-out optional endpoint) |
| Blockscout OP (`explorer.optimism.io`) | deposit index used to verify OP-Stack derivation (hash match) |
| GoPlus | 25 lookups during recording (7 flag records); 6 lookups in live run |
| GitHub search (unauthenticated) | 6 queries during recording (12 mentions, developer tooling using the address as a sanctioned test vector) |
| OFAC | SDN.XML (published 10/15/2026) + 4 recent-action notices downloaded and parsed |

## Not live-verified (credentials unavailable) — BLOCKED (live), tested with fixtures
Etherscan V2, Alchemy Transfers, GitHub code search, GoPlus authenticated tier.

## Browser E2E (manual, in-app browser at 1024×768)
Landing (all 5 stages, CTA) → Historical case → open → SSE progress → graph (select node, neighbourhood focus)
→ inspector → all tabs render → matrix cell drill-down → ChronoReplay play with server snapshot → live intake
(validation, tx hash, window) → cancel → retry → live workspace. No console errors after the Cytoscape layout fix.

## Failures found and fixed during testing
- Recording transport re-sent gzip header on decoded body → stripped encoding headers.
- Spam-token flood (4,996 "CASH" transfers) truncated the seed → canonical-token refetch + seeds always expanded.
- Label slug substring matched "bridge" in "ronin-bridge-exploiter" → exact slugs only.
- `token=` treated as a secret param → cache/cassette key collisions across token filters (real bug) → fixed + regression test.
- RPC rate limit (10 / ~2 min) stalled block lookup → separate bucket + v2 interpolation fallback.
- Async job start from sync route (no running loop) → async routes.
- Cytoscape destroyed mid-layout → stop layouts before destroy.
- Base/Arbitrum shown as ready though Blockscout challenges scripts → honest readiness.

## Verification & hardening pass (2026-10-18)
| Command | Result |
|---|---|
| `cd frontend && npm run e2e` (Playwright, system Chrome, API in `TRACEFUSE_OFFLINE=1` + fresh DB, genuine Ronin cassette) | **18 passed** (16 desktop journeys + responsive desktop 1280 px + mobile Pixel 7) |
| `cd frontend && npm run e2e:live` (opt-in, real Blockscout/GoPlus) | **1 passed** — live tx-hash investigation, origin "Live", >0 transfers |
| `cd backend && .venv/bin/pytest -q` | **64 passed** |
| `.venv/bin/ruff check tracefuse tests scripts` / `.venv/bin/mypy tracefuse` | clean / no issues (56 files) |
| `cd frontend && npm test` · `npm run lint` · `npm run build` | 12 passed · **0 warnings** (5 set-state-in-effect warnings fixed structurally) · OK |

E2E covers: landing stages/progress/CTAs/unknown routes, all nav routes, historical case open (SSE), wallet inspection (correct selected wallet), sanctions evidence + source link, ChronoReplay play/pause/step/server snapshot/window/empty state, Matrix value measure + cell drill-down, Fusion conflicts + relationship details + status filter, ranking re-evaluation, filters (asset, hide/show), exports (HTML/JSON/CSV + downloads), casebook create/edit/reopen/delete, bookmarks/reviews/UI-state restore, challenge (server-side checks, no answer leakage, persistence, reset), offline-provider failure + real retry, validation, unconfigured providers, backend-unreachable recovery, no horizontal overflow at mobile. Every test fails on console/page errors.

Bugs found and fixed by this pass: challenge `inspect` hints leaked answers; graph search could not find decluttered wallets; ChronoReplay hid window controls when the window was empty (dead end); seed-only graph instead of empty state; duplicate fusion relationship IDs; Cytoscape animated fusion layout crashing on rebuild; all-seed-fetch failures reported as "partial" instead of "failed"; recorded timeouts replayed as "not in historical dataset" (cassette now records transport failures; replay raises a genuine timeout — re-recorded, replay identical: 284 nodes, 1,642 transfers, statuses).

Re-verified on the committed tree (after commit `b7f5b5f`, 2026-10-18): pytest 64 passed · ruff clean · mypy clean ·
vitest 12 passed · oxlint 0 warnings/errors · vite build OK · Playwright `npm run e2e` 18 passed. (Live E2E not re-run.)

## Accessibility + cross-chain pass (2026-10-18)
| Command | Result |
|---|---|
| `cd backend && .venv/bin/pytest -q` | 66 passed, 3 skipped (live, opt-in) |
| `TRACEFUSE_LIVE_TESTS=1 .venv/bin/pytest tests/test_live.py` | 3 passed: OP Mainnet investigation; OP-Stack deposit **confirmed** (L2 `0xc453…` fetched); Across deposit decoded (dest Base, depositId 4790238 → unresolved, names ALCHEMY_API_KEY) |
| ruff / mypy | clean / no issues (57 files) |
| `cd frontend && npm test` | 12 passed, **exit 0** (fixed: Vitest previously also collected Playwright specs and exited non-zero) |
| `npm run lint` / `npm run build` | 0 warnings / OK |
| `npm run e2e` | **24 passed** (adds axe dark+light, keyboard/focus/dialog/reduced-motion specs) |

Defects fixed: 11 accessibility issues (docs/ACCESSIBILITY_AUDIT.md); Vitest scope; bridge interactions now traced seed-first
(bounded tracing previously could skip the seed transaction's own bridge deposit); Across deposits decoded from the
documented `FundsDeposited` event instead of guessing the destination chain.

## Finalization pass (2026-10-18, branch `tracefuse-finalization`)
| Command | Result |
|---|---|
| `cd backend && .venv/bin/pytest -q` | 66 passed, 7 skipped (live, opt-in) |
| `TRACEFUSE_LIVE_TESTS=1 .venv/bin/pytest tests/test_live.py -rs -k "etherscan or alchemy or github"` | 4 skipped — ETHERSCAN_API_KEY / ALCHEMY_API_KEY / GITHUB_TOKEN not set (no live service called) |
| ruff / mypy | clean / no issues (57 files) |
| `cd frontend && npm test` · lint · build | 12 passed (exit 0) · 0 · OK |
| `npm run e2e` | **25 passed** |
Secret scan of diff + untracked files: no credentials; `backend/.env`, `.env`, `backend/var/` git-ignored.
Manual accessibility-tree review fixed 5 defects (see ACCESSIBILITY_AUDIT.md). No real assistive-technology testing performed.
