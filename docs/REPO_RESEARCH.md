# Reference repository research (verified 2026-10-17)

Repositories were inspected via their GitHub pages and, where noted, raw source files. No code was copied.

| Repo | Verified state | License | Learned | TRACEFUSE does differently |
|---|---|---|---|---|
| [bobslayerX/crypttrace](https://github.com/bobslayerX/crypttrace) | Exists; Python CLI + Flask UI; 83 commits; `selftest.py` offline check | MIT | Read `trace.py` and `bridges.py`: recursive depth/branching walk with a shared `seen` set; stops at exchange/mixer/bridge/DEX labels; cross-chain = same-address arrival within 48 h and 5 % tolerance, explicitly "a lead, not proof"; SQLite caching + per-host 429 backoff | Value-share branch ranking instead of provider order; deterministic OP-Stack linkage before heuristics; evidence for/against stored per candidate; full provenance per record; explainable scoring rather than fixed `risk: 30`; web workspace with replay/matrix |
| [graphsense/graphsense-tagpacks](https://github.com/graphsense/graphsense-tagpacks) | Exists; 422 commits; validation workflow | MIT | Public attribution packs require a dereferenceable source link and no PII; ActorPacks separate actors from addresses | Our registry follows the same rule (official URL per entry); labels are always "source-reported", never identity |
| [graphsense/graphsense-dashboard](https://github.com/graphsense/graphsense-dashboard) | Exists; Elm + Vite; ~4.1k commits; calendar versions | MIT | Pathfinder-style investigation, saved investigation files, backend-driven graph | TRACEFUSE is self-contained (no GraphSense cluster needed) and adds OSINT fusion + ChronoReplay |
| [s0md3v/Orbit](https://github.com/s0md3v/Orbit) | Exists; 26 commits; Bitcoin-oriented crawler | GPL-3.0 (not reused) | Level-by-level crawl with top-N pruning; edge thickness = frequency; graphml/json export | EVM, bounded by budgets, typed evidence; GPL code not incorporated |

## Official API documentation checked
- Blockscout REST API (`docs.blockscout.com/devs/apis/rest`): `next_page_params` pagination (50 items). Live checks:
  keyless eth/OP instances; `x-ratelimit-limit: 180` (v2) vs `10` (RPC); `token=` filter on address token-transfers;
  `/api/v2/optimism/deposits` (used to verify our OP-Stack derivation).
- Etherscan V2 supported chains (paid-only: OP, Base, BNB, Avalanche, Gnosis).
- Alchemy `alchemy_getAssetTransfers` (params, `internal` only on some networks, 1000/page, `pageKey`).
- GoPlus Malicious Address API + Response Details (flag semantics, optional bearer token).
- GitHub REST search (unauthenticated 10/min; code search requires auth; text-match media type; 1000-result cap).
- OFAC: SDN.XML / SDN.CSV exports (CSV truncates remarks: 87 vs 120 ETH identifiers in XML on 2026-10-15 data).
- OP superchain-registry, Base and Arbitrum contract-address pages for the bridge registry.
