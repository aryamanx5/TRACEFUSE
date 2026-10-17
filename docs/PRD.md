# TRACEFUSE — Product Requirements

**Product:** TRACEFUSE — The Intelligence Fusion Lab · **Promise:** Follow the money. Find the signal.
**Principle:** Every transaction leaves evidence. Every clue needs a source. Every inferred connection must explain why it exists.

## 1. Problem & personas

*Ghost Attacks*: stolen assets are split across wallets, relayed quickly, bridged across chains and pushed into
privacy infrastructure. Evidence lives in two disconnected worlds — explorers and public sources.

| Persona | Need |
|---|---|
| Incident responder (protocol team) | Trace where exploited funds went within hours; export evidence for exchanges/law enforcement |
| Compliance / AML analyst | Check exposure to sanctioned or flagged addresses with defensible citations |
| OSINT researcher / journalist | Connect public mentions to on-chain activity without over-claiming |
| Hackathon judge / student | Learn the workflow on a real, labelled historical case |

## 2. Core workflows

1. **Investigate** — enter address/tx hash + chain + bounds → real backend job with streamed progress → workspace.
2. **Analyse** — graph, ChronoReplay, Matrix, metrics, explainable ranking, fusion graph, cross-chain.
3. **Document** — casebook notes, bookmarks, evidence reviews, decisions, analyst hypotheses, UI state.
4. **Report** — HTML / JSON / CSV that separate facts, claims and hypotheses.
5. **Learn** — open the historical Ronin case and complete the challenge.

## 3. Requirements (stable IDs)

Status of each ID is tracked in `docs/BUILD_STATUS.md`; verification steps in `docs/ACCEPTANCE_TESTS.md`.

### LANDING
- **LANDING-1** Five story stages: THE SIGNAL, FRAGMENTATION, DISCONNECTED INTELLIGENCE, EVIDENCE FUSION, THE INVESTIGATION ROOM.
- **LANDING-2** Sticky, scroll-linked illustrated network; progress marker; stage navigation.
- **LANDING-3** Verified vs inferred links visually distinct; illustration labelled "Illustrative — not a live investigation".
- **LANDING-4** Reduced-motion / no-animation alternative; readable on small screens (inline illustration per stage).
- **LANDING-5** Working CTAs into the app (Start an Investigation, Open Investigation Room, Explore the Ronin case).

### INTAKE
- **INTAKE-1** Accept EVM address or tx hash; auto-detect type; EIP-55 checksum validation; helpful errors (BTC/Tron/ENS/length).
- **INTAKE-2** Chain selection from server-reported readiness; unsupported/unconfigured chains explained.
- **INTAKE-3** Configurable direction, time window, hop depth (1–4), branching (1–20), records/address, tokens/internal, OSINT and cross-chain toggles; server-enforced bounds.
- **INTAKE-4** Tx-hash seeds resolved via provider into seed addresses and seed transfers.
- **INTAKE-5** Starts a real backend job; lifecycle queued → running → completed | partial | failed | cancelled.

### CHAIN
- **CHAIN-1** Blockscout adapter (keyless): REST v2 address streams with keyset cursor windowing; tx detail; logs; address metadata.
- **CHAIN-2** Etherscan V2 adapter (key) and **CHAIN-3** Alchemy Transfers adapter (key) behind the same interface.
- **CHAIN-4** Native, internal (trace) and ERC-20 transfers; ERC-721 recorded but excluded from value analytics.
- **CHAIN-5** Pagination, per-provider token buckets, `x-ratelimit-*` awareness, timeouts, retries with backoff + jitter, budgets.
- **CHAIN-6** SQLite response cache with explicit cached/live provenance.
- **CHAIN-7** Normalised record: chain id, tx hash, block, timestamp (+quality), from/to, kind, asset (symbol, contract, decimals, canonical flag), raw amount (int string), decimal display amount, provider, endpoint (secret-free), retrieval time, data origin, explorer URL.
- **CHAIN-8** Decimal-safe amounts (arbitrary precision integers; Decimal display); no float totals.
- **CHAIN-9** Deduplication by stable transfer IDs before any totals/counts.
- **CHAIN-10** Partial-result warnings (caps, spam floods, provider errors, budgets).
- **CHAIN-11** Canonical-token registry by contract address (spoofed symbols are not trusted).

### GRAPH
- **GRAPH-1** Directed graph: addresses = nodes, observed transfers = aggregated edges with transfer drill-down.
- **GRAPH-2** Bounded forward / backward / both traversal; value-share branch ranking; node and call budgets.
- **GRAPH-3** Expansion status per node (seed, expanded, depth_limit, branch_pruned, terminal_service, truncated, budget_exhausted, provider_error, not_expanded) with reason.
- **GRAPH-4** Services (bridges, mixers, exchanges, DEX, labelled protocol contracts) are terminal, not crawled.
- **GRAPH-5** UI: pan, zoom, fit, layouts, search, labels toggle, hide/show nodes, leaf decluttering, focus neighbourhood, selection.
- **GRAPH-6** Node inspector: metrics, labels with sources, evidence, score explanation, transfers with provenance, limitations.
- **GRAPH-7** Edge inspector: totals per asset and all underlying transfers.
- **GRAPH-8** No common-ownership assertion; caveat shown.

### QUANT
- **QUANT-1** Hop distance (forward/backward/undirected). **QUANT-2** In/out counts, fan-in/out.
- **QUANT-3** Frequency, active span, median dwell time, pass-through ratio. **QUANT-4** Amount distribution, near-equal split sets.
- **QUANT-5** Temporal deltas, fan-out bursts, relay links. **QUANT-6** Components, Louvain communities (seeded).
- **QUANT-7** PageRank, betweenness. **QUANT-8** Metric catalog (unit, requirements, limitations); nulls when unavailable.
- **QUANT-9** All metrics recomputed server-side for the active filter.

### REPLAY
- **REPLAY-1** Chronological event stream, histogram buckets, gaps, missing-timestamp count.
- **REPLAY-2** Play/pause, step, seek slider, speed, cursor display; cursor hides future edges/nodes in the graph.
- **REPLAY-3** Backend snapshot at cursor (stats as of time T). **REPLAY-4** Analysis window controls applying to every view.
- **REPLAY-5** Select the revealed transfer to inspect it.

### MATRIX
- **MATRIX-1** Directed sender×recipient heatmap; count and per-asset value measures.
- **MATRIX-2** Time window via shared filter; ordering (hop, activity, community, address); size limit with truncation notice.
- **MATRIX-3** Legend (linear/log), hover details, keyboard-focusable cells, highlight search, selection sync.
- **MATRIX-4** Cell drill-down to underlying transfers; sparse representation; empty state.

### OSINT
- **OSINT-1** GitHub search (issues/PRs + commits keyless; code with token); exact-string matches only; bounded queries.
- **OSINT-2** Indicator extraction + snippet + match offset + context terms + co-mentioned indicators (plain text).
- **OSINT-3** GoPlus Malicious Address API with documented field semantics; correlated `sanctioned` flag guarded.
- **OSINT-4** OFAC SDN.XML importer (hash, publish date, record count) + bundled official snapshot + live refresh.
- **OSINT-5** OFAC recent-action notices → designation/removal history (allowlisted official URLs only).
- **OSINT-6** Explorer metadata labels and curated registry (official docs) as source-reported labels.
- **OSINT-7** Common Evidence model; kinds kept distinct (mention, label, sanctions listing/history, threat flag, malicious code, public report, identity — never auto-generated); dedup by fingerprint.
- **OSINT-8** Source status per investigation (ok / unconfigured / disabled / rate_limited / partial).

### FUSION
- **FUSION-1** Typed entities (wallet, contract, transaction, document, label, sanctions entry/notice, intel indicator, public report, bridge event, analyst entity).
- **FUSION-2** Typed relationships: observed_transfer, documented_bridge_event, exact_public_source_match, source_reported_label, sanctions_listing/history, threat_intel_flag, public_report, heuristic_candidate, coordinated_split, analyst_note.
- **FUSION-3** Assertion status (verified_onchain / external_assertion / algorithmic_inference / analyst_hypothesis) visually distinct.
- **FUSION-4** Relationship inspector: evidence, URL, tx hashes, timestamps, method, criteria, confidence, caveats.
- **FUSION-5** Filters by status, type, confidence; navigation wallet ↔ source. **FUSION-6** Conflicting evidence surfaced.

### RISK
- **RISK-1** Heuristic score with documented signals/weights (versioned spec endpoint).
- **RISK-2** Per-signal value, weight, contribution, facts, missing inputs, coverage, limitations.
- **RISK-3** Toggle signals / change weights → server re-evaluation; deterministic.
- **RISK-4** Correlation guards (OFAC vs GoPlus sanctioned; shared upstream; copied mentions).
- **RISK-5** Behaviour-only cap; infrastructure not ranked; seed not ranked. **RISK-6** No probability or identity language.

### CROSSCHAIN
- **CROSSCHAIN-1** Two EVM networks live without keys (Ethereum, OP Mainnet); Base/Arbitrum with keys.
- **CROSSCHAIN-2** Bridge registry with official citations.
- **CROSSCHAIN-3** Deterministic OP-Stack L1→L2 deposit hash derivation, confirmed by fetching the L2 tx when possible.
- **CROSSCHAIN-4** Heuristic candidates (window, token mapping, fee-adjusted amount, same EOA) with evidence for/against.
- **CROSSCHAIN-5** Classification confirmed / derived / candidate / unresolved. **CROSSCHAIN-6** Privacy-protocol gaps reported as unresolved.

### STREAM
- **STREAM-1** SSE progress from persisted backend events (resumable via Last-Event-ID; JSON fallback).
- **STREAM-2** Provider configuration, health, rate-limit headers, cache stats; active probe.
- **STREAM-3** Cancel and retry. **STREAM-4** Warnings surfaced as events.

### CASEBOOK
- **CASEBOOK-1** Create, list, rename, edit, review state, delete (cascade). **CASEBOOK-2** Investigations persisted with config + data + provenance.
- **CASEBOOK-3** Notes (any target), bookmarks, evidence review states, decisions, analyst hypotheses.
- **CASEBOOK-4** UI state (tab, filters, selection) persisted and restored. **CASEBOOK-5** Live vs historical origin preserved.

### CHALLENGE
- **CHALLENGE-1** Genuine labelled historical case (Ronin Bridge, 2022) with sources, method, time range, gaps.
- **CHALLENGE-2** Replayed through the same adapters + pipeline (record/replay HTTP transport).
- **CHALLENGE-3** Checkpoints, hints, attempts, evidence links. **CHALLENGE-4** Answers checked server-side against sourced labels.

### REPORT
- **REPORT-1** HTML (self-contained, escaped, CSP, no scripts). **REPORT-2** JSON. **REPORT-3** CSV (transfers, scores, evidence) with formula-injection guard.
- **REPORT-4** Scope, retrieval times, transfers + explorer links, evidence with URLs/dates, statistics, scoring explanation, cross-chain, provenance, unresolved leads, blind spots, limitations, explicit no-identity statement.

### SECURITY
- **SECURITY-1** Secrets server-side only; redacted logs; never in cache keys, cassettes, reports or API responses.
- **SECURITY-2** Input validation (Pydantic) and bounds. **SECURITY-3** No user-controlled outbound URLs (SSRF).
- **SECURITY-4** Untrusted text handled as plain text; React escaping; safe link schemes; defusedxml.
- **SECURITY-5** Request body size limit; CORS allowlist.

### UX
- **UX-1** Design tokens (dark-first, light supported), consistent components. **UX-2** Loading, empty, offline, unconfigured, rate-limited, partial, error states.
- **UX-3** Keyboard access (tabs, cells, sliders), focus styles, ARIA labels, skip links. **UX-4** Responsive layouts. **UX-5** Feedback toasts; intake draft persisted.

### OPS
- **OPS-1** README, `.env.example`. **OPS-2** SQLite migrations. **OPS-3** `/api/health`, `/api/ready`.
- **OPS-4** Test, lint, type-check, build commands. **OPS-5** Scripts for OFAC import and case recording.

## 4. Data contracts
See `backend/tracefuse/domain/models.py` (Transfer, Evidence, InvestigationConfig, ProgressEvent) and
`frontend/src/lib/types.ts`. All amounts are strings; timestamps ISO-8601 UTC or unix seconds.

## 5. Non-functional
Bounded traversal (≤4 hops, ≤20 branches, ≤400 nodes, ≤600 provider calls per investigation); analytics on
≤5k transfers return in < 1 s locally; no secrets in the browser bundle.

## 6. Definition of done
Every ID mapped to code and verification in BUILD_STATUS; backend + frontend tests, lint, type-check and build
pass; live integrations exercised where keyless; key-dependent integrations marked BLOCKED (live) but tested
with fixtures; historical case authentic and reproducible.
