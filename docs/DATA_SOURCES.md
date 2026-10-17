# Data sources

| Source | Use | Access | Limits observed / documented | Freshness & provenance | Caveats |
|---|---|---|---|---|---|
| Blockscout `eth.blockscout.com`, `explorer.optimism.io` | transfers (v2 address streams), tx detail, logs, address metadata/labels, OP deposit index | keyless | v2 `x-ratelimit-limit 180`/window; RPC `/api` 10 per ~2 min (block-by-time only, with v2 fallback) | live; cached 6 h; `retrieved_at` per record | labels come from Blockscout metadata / attribution partners (e.g. OLI); Base/Arbitrum instances challenge scripts |
| Etherscan API V2 | alternative transfers + proxy tx/receipt | `ETHERSCAN_API_KEY` | free tier excludes OP/Base | live/cached | no token metadata on proxy path; **not live-verified (no key)** |
| Alchemy Transfers API | alternative transfers (Base/Arbitrum/OP) | `ALCHEMY_API_KEY` | 1000/page, pageKey 10 min | live/cached | omits zero-value internal transfers & delegatecalls; **not live-verified (no key)** |
| GoPlus Malicious Address API | threat-intel flags | keyless (token optional) | not documented; 1 req/s used | cached 24 h | vendor assertions aggregated from `data_source`; no citations |
| GitHub REST search | public mentions (issues/PRs, commits; code with token) | keyless / `GITHUB_TOKEN` | 10/min unauth, 30/min auth, code 10/min; ≤6 queries per investigation | cached 24 h | exact-string only; mentions ≠ ownership/culpability |
| OFAC SDN.XML | sanctions listings | public | ~29 MB | bundled snapshot (published 10/15/2026, sha256 `0dee…`/XML hash stored), refresh endpoint | listing ≠ technical control; point in time |
| OFAC Recent Actions | designation/removal history | public, allowlisted URLs | — | 2022-04-14, 2022-08-08, 2022-11-08, 2025-03-21 imported | action parsed from notice section headings |
| Curated registry | bridge contract roles | official docs | — | static, cited | roles only |
| Historical case cassette | Ronin replay | recorded keyless responses | — | recorded 2026-10-17; `historical_case` origin | provider labels reflect recording time |

## Historical case authenticity — Ronin Bridge (2022)
- Seed `0x098B716B8Aaf21512996dC57EB0615e2383E2f96` — added to OFAC's LAZARUS GROUP entry on 2022-04-14
  (official notice). Exploit txs `0xc28fad5e…` (173,600 ETH internal transfer from Ronin Bridge V1
  `0x1A2a…54F2`) and `0xed2c72ef…` (25,500,000 USDC) verified via Blockscout.
- Treasury press release jy0916 (2022-08-08) links the heist to Tornado Cash laundering; Tornado Cash delisted 2025-03-21.
- Collection: `scripts/collect_historical_case.py` runs the live pipeline with a recording transport;
  window 2022-03-23 → 2022-05-01; 3 hops, 6 branches, 5000 records/address.
- Known gaps: bounded traversal; one high-activity contract timed out during recording; Tornado withdrawals
  untraceable; post-May bridging out of scope; labels reflect 2026 state.
