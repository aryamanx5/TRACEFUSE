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
