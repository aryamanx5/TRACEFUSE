# Acceptance tests

Automated = `backend/tests/*` (pytest) or `frontend/src/test/app.test.tsx` (vitest). Manual = performed in the
browser during the build session (see TEST_RESULTS.md for dates/results).

| ID(s) | Acceptance criterion | Verification |
|---|---|---|
| LANDING-1..5 | Five stages render; CTAs link to `/app`, `/app/new`, `/app/historical`; reduced motion removes the animated progress bar; illustration labelled illustrative | vitest `landing page` (2 tests); manual scroll through all stages at 1024 px |
| INTAKE-1 | Invalid inputs give specific errors (length, BTC, Tron, ENS, checksum, zero address) | pytest `test_classify_invalid`; vitest `intake` |
| INTAKE-2 | Unconfigured chains disabled in UI; API returns readiness | vitest `intake` (Base disabled); pytest `test_chain_readiness_is_honest_without_keys` |
| INTAKE-3 | Bounds enforced server-side (hops ≤ 4 etc.) | pytest `test_config_bounds_and_window`, `test_validation_errors` |
| INTAKE-4 | Tx hash resolves to seed addresses | manual live run `inv_524effe1085e089d` (USDC exploit tx → seed 0x098b…) |
| INTAKE-5, STREAM-1/3/4 | Lifecycle + SSE + cancel + retry; warnings emitted as events | pytest `test_historical_case_full_journey` (SSE), `test_provider_failure_is_reported_not_faked`; manual cancel + retry in UI |
| CHAIN-1 | Blockscout v2 windowed paging stops before start block; counterparty labels harvested | pytest `test_blockscout_v2_window_paging`; live recording of Ronin case |
| CHAIN-2/3 | Etherscan key sent server-side only; unconfigured error without key | pytest `test_etherscan_configured_sends_key_server_side`, `test_etherscan_unconfigured` |
| CHAIN-5 | 429 retry, retry exhaustion, timeout, challenge page, auth, budget | pytest `test_retry_then_success` … `test_budget` |
| CHAIN-6 | Cache hit marked `from_cache`; secrets absent from cache rows; filters keep keys distinct | pytest `test_cache_marks_from_cache_and_strips_secrets`, `test_sanitize_keeps_filter_params_distinct` |
| CHAIN-7/8/9/11 | Normalisation, uint256 precision, dedup before totals, spoofed symbol not canonical | pytest `test_etherscan_format_parsers_normalise_and_dedupe`, `test_decimal_precision_uint256`, `test_dedupe_before_totals` |
| GRAPH-1/7/8 | Edge direction and aggregation; self-transfers flagged; caveat present | pytest `test_edge_direction_and_aggregation`; API journey (graph caveat) |
| GRAPH-2/3/4 | Bounded traversal; expansion statuses; services terminal | historical journey (statuses in node meta); manual inspector check |
| GRAPH-5/6 | Select node → inspector with labels, metrics, score, evidence, transfers | manual (wallet `0x5967…3c0a`) |
| QUANT-1..9 | Hops, degrees, dwell, pass-through, splits, bursts, relays, components, filter recompute | pytest `test_hop_distances_and_components`, `test_node_metrics`, `test_patterns`, `test_filters_time_and_value` |
| REPLAY-1..5 | Events sorted; buckets sum; gaps; snapshot visibility; UI step/play/window | pytest `test_timeline_and_snapshot`; vitest `ChronoReplay`; API journey (window changes graph = timeline counts) |
| MATRIX-1..4 | Cell values exact; cell → transfer ids; value requires asset; truncation flag; UI drill-down; empty state | pytest `test_matrix_values_and_cell_mapping`; vitest `Matrix Mode` (2); API journey drill-down |
| OSINT-1/2 | Exact-match only, snippets plain text, copied text counted once | pytest `test_github_evidence_requires_exact_match_and_dedupes`, `test_extraction_and_snippets_are_plain_text` |
| OSINT-3 | GoPlus flags + rate-limit mapping | pytest `test_goplus_check_and_evidence` |
| OSINT-4/5 | SDN XML parse, entity rejection, real notices: designation / removal / same-day re-designation | pytest `test_sdn_xml_parse`, `test_sdn_rejects_xml_entities`, `test_recent_action_designation_and_removal_from_real_notices`, `test_ofac_evidence_semantics` |
| FUSION-1..6 | Relationship types map to assertion statuses; conflicts detected; analyst hypotheses included | pytest `test_fusion_types_and_conflicts`; API journey fusion types |
| RISK-1..6 | Deterministic, toggles change score, OFAC/GoPlus correlation guard, behaviour cap, infrastructure unranked, wording | pytest `test_scoring_reproducible_explainable_and_guarded`, `test_behaviour_only_cap_and_infrastructure`, `test_flow_shares_time_consistent`; API rescore + 422 on unknown signal |
| CROSSCHAIN-3 | OP deposit hash equals Blockscout's published L2 hash | pytest `test_op_stack_deposit_hash_matches_blockscout_index`, `test_crosschain_op_stack_deterministic` |
| CROSSCHAIN-4/5/6 | Candidate/unresolved classification; larger-than-source rejected; privacy gaps | pytest `test_crosschain_heuristic_candidates_and_privacy_gaps` |
| CASEBOOK-1..5 | CRUD, notes, bookmarks (idempotent), reviews (validated), decisions, hypotheses, ui_state, cascade delete | pytest `test_casebook_crud`; vitest `casebook` (2) |
| CHALLENGE-1..4 | Historical case opens and replays identically to the recording; answers checked server-side; no answer leakage | pytest `test_historical_case_full_journey`, `test_challenge_flow`; replay-vs-recording diff (284/284 nodes, identical 1,642 transfer ids) |
| REPORT-1..4 | HTML has no scripts, historical banner, no-identity statement; JSON parseable; CSVs rectangular | pytest `test_historical_case_full_journey` |
| SECURITY-1..5 | Secrets never in URLs/cache/exports; redaction; XML entities rejected; unsafe link schemes blocked | pytest `test_secret_redaction`, `test_cache_marks…`, `test_sdn_rejects_xml_entities`; vitest `formats exact amounts and blocks unsafe links` |
| UX-2 | Offline / rate-limited / unconfigured errors named honestly | vitest `names offline, rate-limited and unconfigured errors honestly` |
| OPS-3 | `/api/health`, `/api/ready` | pytest `test_health_meta` |
| UX-1, UX-3 | axe 0 violations dark+light on all routes/tabs; keyboard tabs/dialog/skip-link/wallet list | Playwright `e2e/a11y.spec.ts`, `e2e/keyboard.spec.ts` |
| CROSSCHAIN-3 (Across) | deposit decoded from FundsDeposited; FilledRelay matched by (originChainId, depositId) only | pytest `test_across_decode_real_deposit_and_fill`, `test_across_unconfigured_destination_is_unresolved_not_guessed`; live `test_live_across_…` |
| CHAIN-1 (OP), CROSSCHAIN-3 (live) | live OP investigation; live confirmed L1→L2 deposit | `TRACEFUSE_LIVE_TESTS=1 pytest tests/test_live.py` |
