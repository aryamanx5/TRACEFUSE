"""Graph, metrics, matrix, timeline, scoring, fusion and cross-chain logic on synthetic transfers."""

from __future__ import annotations

from datetime import UTC, datetime

from tests.conftest import E18, USDC, addr, mk
from tracefuse.analysis import matrix, metrics, scoring, timeline
from tracefuse.analysis.crosschain import CrossChainTracer, find_bridge_interactions, find_privacy_gaps
from tracefuse.analysis.filters import AnalysisFilter
from tracefuse.analysis.fusion import build_fusion, detect_conflicts
from tracefuse.analysis.graph import aggregate_edges, components, hop_distances
from tracefuse.chains import CHAINS
from tracefuse.domain.models import ConfidenceCategory, Evidence, EvidenceKind, TransferKind
from tracefuse.providers.base import AddressFetchResult, dedupe_transfers

T0 = 1_648_000_000
SEED = addr(1)


def sample():
    # seed 1 splits 3×500 ETH to 2,3,4 within an hour; 2 relays to 5 quickly; 6→1 inflow; 7 isolated pair
    return [
        mk(6, 1, 2000 * E18, T0),
        mk(1, 2, 500 * E18, T0 + 100),
        mk(1, 3, 500 * E18, T0 + 200),
        mk(1, 4, 500 * E18, T0 + 300),
        mk(2, 5, 499 * E18, T0 + 600),
        mk(3, 3, 1 * E18, T0 + 700),  # self-transfer
        mk(7, 8, 1 * E18, T0 + 86400 * 5),
        mk(1, 2, 0, T0 + 50),  # zero-value call
        mk(4, 9, 10 * 10**6, T0 + 900, asset=USDC, kind=TransferKind.ERC20),
    ]


def test_dedupe_before_totals():
    ts = sample()
    doubled = dedupe_transfers(ts + ts)
    assert len(doubled) == len(ts)
    st = metrics.graph_stats(AnalysisFilter().apply(doubled))
    eth = next(a for a in st["assets"] if a["asset_key"] == "native")
    assert eth["amount"] == str(2000 + 1500 + 499 + 1 + 1)


def test_edge_direction_and_aggregation():
    edges = {e["id"]: e for e in aggregate_edges(sample())}
    assert f"{SEED}->{addr(2)}" in edges and f"{addr(2)}->{SEED}" not in edges
    e = edges[f"{SEED}->{addr(2)}"]
    assert e["count"] == 2 and e["totals"][0]["amount"] == "500"
    assert edges[f"{addr(3)}->{addr(3)}"]["self_transfer"]


def test_hop_distances_and_components():
    h = hop_distances(sample(), [SEED])
    assert h[addr(5)]["forward"] == 2 and h[addr(5)]["backward"] is None
    assert h[addr(6)]["backward"] == 1 and h[addr(6)]["forward"] is None
    assert h[addr(7)]["undirected"] is None
    comps = components(sample())
    assert len(comps) == 2 and comps[1] == sorted([addr(7), addr(8)])


def test_filters_time_and_value():
    f = AnalysisFilter(start=datetime.fromtimestamp(T0 + 150, UTC), end=datetime.fromtimestamp(T0 + 650, UTC))
    ids = {t.id for t in f.apply(sample())}
    assert len(ids) == 3  # 1→3, 1→4, 2→5 (zero-value call and out-of-window excluded)
    assert len(AnalysisFilter(include_zero_value=True).apply(sample())) == len(sample())
    assert len(AnalysisFilter(assets=[USDC.contract]).apply(sample())) == 1


def test_node_metrics():
    nm = metrics.node_metrics(AnalysisFilter().apply(sample()), [SEED])
    s = nm[SEED]
    assert s["out_count"] == 3 and s["fan_out"] == 3 and s["in_count"] == 1 and s["fan_in"] == 1
    assert nm[addr(2)]["median_dwell_seconds"] == 500
    assert nm[addr(3)]["out_count"] == 0  # self transfer excluded from flow metrics
    assert nm[SEED]["pass_through_ratio"] == 0.75


def test_patterns():
    ts = AnalysisFilter().apply(sample())
    splits = metrics.split_sets(ts)
    assert len(splits) == 1 and splits[0]["sender"] == SEED and splits[0]["size"] == 3
    assert metrics.fan_out_bursts(ts)[0]["recipients"] == sorted([addr(2), addr(3), addr(4)])
    relays = metrics.pass_through_links(ts)
    assert any(r["node"] == addr(2) and r["delay_seconds"] == 500 for r in relays)


def test_matrix_values_and_cell_mapping():
    ts = AnalysisFilter().apply(sample())
    m = matrix.build_matrix(ts, measure="count", limit=50)
    labels = m["labels"]
    cell = next(c for c in m["cells"] if labels[c["row"]] == SEED and labels[c["col"]] == addr(2))
    assert cell["count"] == 1 and len(cell["transfer_ids"]) == 1
    mv = matrix.build_matrix(ts, measure="value", asset_key="native", limit=50)
    cell = next(c for c in mv["cells"] if mv["labels"][c["row"]] == SEED and mv["labels"][c["col"]] == addr(3))
    assert cell["amount"] == "500" and cell["raw"] == str(500 * E18)
    try:
        matrix.build_matrix(ts, measure="value")
        raise AssertionError("value without asset must fail")
    except ValueError:
        pass
    small = matrix.build_matrix(ts, limit=2)
    assert small["truncated"]["is_truncated"]


def test_timeline_and_snapshot():
    ts = AnalysisFilter().apply(sample())
    tl = timeline.timeline(ts, buckets=10)
    assert [e["ts"] for e in tl["events"]] == sorted(e["ts"] for e in tl["events"])
    assert sum(b["count"] for b in tl["buckets"]) == len(ts)
    assert tl["gaps"] and tl["gaps"][0]["seconds"] > 86400
    snap = timeline.snapshot(ts, at=T0 + 250)
    assert set(snap["visible_nodes"]) == {addr(6), SEED, addr(2), addr(3)}
    assert snap["stats"]["transfers"] == 3


def _ev(kind, a, **attrs):
    return Evidence(kind=kind, subject_chain="ethereum", subject_address=a, title="t", source=attrs.pop("source", "s"),
                    source_item_id=attrs.pop("item", a), confidence=ConfidenceCategory.CONFIRMED, attributes=attrs)


def score(ts, ev, node_meta=None, cfg=None):
    nm = metrics.node_metrics(ts, [SEED])
    return {r["address"]: r for r in scoring.score_addresses(
        addresses=sorted(nm), seeds=[SEED], node_meta=node_meta or {}, metrics=nm, evidence=ev,
        flow=scoring.flow_shares(ts, [SEED], "forward"), relay_links=metrics.pass_through_links(ts),
        split_sets=metrics.split_sets(ts), bursts=metrics.fan_out_bursts(ts), transfers=ts,
        available_sources={"ofac": True, "goplus": True, "github": True, "labels": True}, config=cfg)}


def test_flow_shares_time_consistent():
    ts = AnalysisFilter().apply(sample())
    f = scoring.flow_shares(ts, [SEED], "forward")
    assert abs(f[addr(2)] - 1 / 3) < 1e-9 and abs(f[addr(5)] - 1 / 3) < 1e-9
    assert addr(6) not in f  # inflow source is not downstream
    late = mk(2, 7, 1 * E18, T0 - 10)  # before 2 received seed funds → must not propagate
    assert addr(7) not in scoring.flow_shares([*ts, late], [SEED], "forward")


def test_scoring_reproducible_explainable_and_guarded():
    ts = AnalysisFilter().apply(sample())
    ev = [_ev(EvidenceKind.SANCTIONS_LISTING, addr(5)),
          _ev(EvidenceKind.THREAT_INTEL_FLAG, addr(5), flags=["sanctioned"], data_source="SlowMist")]
    a, b = score(ts, ev), score(ts, ev)
    assert a == b  # deterministic
    s5 = a[addr(5)]
    sig = {x["key"]: x for x in s5["signals"]}
    assert sig["sanctions"]["value"] == 1.0
    assert sig["threat_intel"]["value"] == 0.0  # GoPlus 'sanctioned' not double counted with OFAC
    assert a[SEED]["category"] == "seed" and a[SEED]["rank"] is None
    assert all(r["score"] <= 100 for r in a.values())
    # toggling a signal changes the result
    off = score(ts, ev, cfg=scoring.ScoringConfig(disabled=["sanctions"]))
    assert off[addr(5)]["score"] < s5["score"]
    assert next(x for x in off[addr(5)]["signals"] if x["key"] == "sanctions")["enabled"] is False


def test_behaviour_only_cap_and_infrastructure():
    # node 9 receives USDC from 4: only proximity/behaviour, must be capped / low
    ts = [mk(1, 2, 10 * E18, T0 + i * 10, tx=f"0x{i:064x}") for i in range(1, 6)]
    only_proximity = [k for k in scoring.SIGNALS if k != "proximity"]
    r = score(ts, [], cfg=scoring.ScoringConfig(disabled=only_proximity))  # raw 50 from proximity alone
    assert r[addr(2)]["score"] <= scoring.BEHAVIOUR_CAP
    assert r[addr(2)]["caps_applied"]
    meta = {addr(2): {"labels": [{"label": "Bridge", "category": "bridge"}]}}
    r2 = score(ts, [], node_meta=meta)
    assert r2[addr(2)]["category"] == "infrastructure" and r2[addr(2)]["rank"] is None


def test_fusion_types_and_conflicts():
    ts = AnalysisFilter().apply(sample())
    ev = [_ev(EvidenceKind.ADDRESS_MENTION, addr(2), repository="o/r", context_terms=["hack"], co_mentioned_indicators=[addr(3)]),
          _ev(EvidenceKind.THREAT_INTEL_FLAG, addr(4), flags=["sanctioned"], item="gp4")]
    node_meta = {addr(i): {"labels": []} for i in range(1, 10)}
    fg = build_fusion(chain="ethereum", transfers=ts, node_meta=node_meta, evidence=ev, crosschain=[],
                      split_sets=metrics.split_sets(ts), scores={}, seeds=[SEED],
                      analyst_relationships=[{"id": "h1", "source_entity": "wallet:ethereum:" + addr(2),
                                              "target_entity": "wallet:ethereum:" + addr(5), "relation": "same operator?",
                                              "rationale": "timing", "created_at": "now"}])
    types = {r["type"]: r["assertion_status"] for r in fg["relationships"]}
    assert types["observed_transfer"] == "verified_onchain"
    assert types["exact_public_source_match"] == "external_assertion"
    assert types["coordinated_split"] == "algorithmic_inference"
    assert types["analyst_note"] == "analyst_hypothesis"
    conflicts = detect_conflicts(ev, node_meta)
    assert conflicts and conflicts[0]["type"] == "unconfirmed_sanctions_claim"


async def test_crosschain_heuristic_candidates_and_privacy_gaps():
    bridge = "0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f"  # Arbitrum Delayed Inbox (registry)
    src = mk(1, bridge, 10 * E18, T0)
    inter = find_bridge_interactions([src, mk(1, bridge, 0, T0 + 1)], {}, "ethereum")
    assert len(inter) == 1 and inter[0]["destination_chain"] == "arbitrum"
    arrivals = [mk("0x9999999999999999999999999999999999999999", SEED, int(9.97 * E18), T0 + 600),
                mk("0x9999999999999999999999999999999999999999", SEED, 12 * E18, T0 + 700)]  # larger than source → rejected

    async def addr_fn(c, a, br):
        return AddressFetchResult(chain=c.key, address=a, transfers=arrivals)

    async def block_fn(c, when, closest):
        return 1

    tracer = CrossChainTracer(logs=None, tx=None, address_transfers=addr_fn, block_at=block_fn, ready=lambda c: True,  # type: ignore[arg-type]
                              window_hours=48, tolerance=0.05, max_candidates=5, target_chains=["optimism"])
    out = await tracer.trace(CHAINS["ethereum"], inter)
    assert out[0]["status"] == "candidate" and len(out[0]["links"]) == 1
    assert out[0]["links"][0]["relative_amount_difference"] == 0.003
    assert "not a confirmed transfer" in out[0]["uncertainty"]
    tracer2 = CrossChainTracer(logs=None, tx=None, address_transfers=addr_fn, block_at=block_fn, ready=lambda c: False,  # type: ignore[arg-type]
                               window_hours=48, tolerance=0.05, max_candidates=5, target_chains=[])
    out2 = await tracer2.trace(CHAINS["ethereum"], inter)
    assert out2[0]["status"] == "unresolved"
    mixer = "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b"
    gaps = find_privacy_gaps([mk(2, mixer, 100 * E18, T0)], {mixer: {"labels": [{"label": "Tornado", "category": "mixer"}]}})
    assert gaps[0]["status"] == "unresolved" and gaps[0]["deposits"] == 1


async def test_crosschain_op_stack_deterministic():
    import json

    from tests.conftest import FIXTURES
    from tracefuse.providers.base import LogRecord, TxFetchResult
    logs_raw = json.loads((FIXTURES / "op_deposit_l1_logs.json").read_text())["items"]
    logs = [LogRecord(address=lg["address"]["hash"].lower(), topics=[t.lower() for t in lg["topics"] if t], data=lg["data"],
                      log_index=lg["index"], block_hash=lg["block_hash"], block_number=lg["block_number"], tx_hash="0x48")
            for lg in logs_raw]
    portal_bridge = "0x99c9fc46f92e8a1c0dec1b1747d010903e884be1"
    t = mk(1, portal_bridge, 5 * 10**6, T0, asset=USDC, kind=TransferKind.ERC20,
           tx="0x48e0d6cb52e9f59bc55412228a9b79ce0f079a60c43f5c95a308664e67b6b5fb")
    inter = find_bridge_interactions([t], {}, "ethereum")

    async def logs_fn(c, h):
        return logs

    async def tx_fn(c, h):
        return TxFetchResult(chain=c.key, tx_hash=h, from_address="0x1", to_address="0x2", block_number=1,
                             timestamp=datetime.fromtimestamp(T0 + 120, UTC), success=True, method=None, transfers=[])

    tracer = CrossChainTracer(logs=logs_fn, tx=tx_fn, address_transfers=None, block_at=None, ready=lambda c: True,  # type: ignore[arg-type]
                              window_hours=48, tolerance=0.05, max_candidates=5, target_chains=["optimism"])
    out = (await tracer.trace(CHAINS["ethereum"], inter))[0]
    assert out["status"] == "confirmed"
    assert out["links"][0]["destination_tx"] == "0xc453ed6b3a324c1af24db2565adee833f0c1e0c2fc5165528f3b5c86b5e9fb1e"
    assert out["links"][0]["recipient"] is not None


def _fixture_logs(name):
    import json

    from tests.conftest import FIXTURES
    from tracefuse.providers.base import LogRecord
    return [LogRecord(address=lg["address"]["hash"].lower(), topics=[t.lower() for t in lg["topics"] if t], data=lg["data"],
                      log_index=lg["index"], block_hash=lg.get("block_hash"), block_number=lg.get("block_number"),
                      tx_hash=lg["transaction_hash"]) for lg in json.loads((FIXTURES / name).read_text())["items"]]


def test_across_decode_real_deposit_and_fill():
    from tracefuse.bridges import across
    dep = next(d for d in (across.decode_deposit(1, lg.address, lg.topics, lg.data)
                           for lg in _fixture_logs("across_deposit_eth_logs.json")) if d)
    assert (dep.destination_chain_id, dep.deposit_id) == (8453, 4790238)
    assert dep.recipient == dep.depositor == "0x507c8b1574c45b28012dfb718df6a8c7a47f21f5"
    assert (dep.input_amount, dep.output_amount) == (72800000000000000, 72791073415604511)
    fill_logs = _fixture_logs("across_fill_op_logs.json")
    # real OP fill belongs to origin chain 4663 / depositId 478004 — it must match only that deposit
    matching = across.AcrossDeposit(4663, 10, 478004, "0x577fa9e4c609f37682141d4812ee0d5bc846736d",
                                    "0x577fa9e4c609f37682141d4812ee0d5bc846736d", "", "", 0, 0, 0)
    assert any(across.is_fill_for(matching, 10, lg.address, lg.topics, lg.data) for lg in fill_logs)
    other = across.AcrossDeposit(1, 10, 478004, "", "", "", "", 0, 0, 0)  # same depositId, different origin
    assert not any(across.is_fill_for(other, 10, lg.address, lg.topics, lg.data) for lg in fill_logs)


async def test_across_unconfigured_destination_is_unresolved_not_guessed():
    from tracefuse.bridges import across
    pool = across.SPOKE_POOLS[1]
    t = mk(1, pool, 72800000000000000, T0, tx="0xe838e6c3f670f6bf819c3b6baf67163f8c83f91fead7d91ad0db6d6c090c7335")
    inter = find_bridge_interactions([t], {}, "ethereum")
    assert inter and inter[0]["bridge_family"] == "across"
    logs = _fixture_logs("across_deposit_eth_logs.json")

    async def logs_fn(c, h):
        return logs

    tracer = CrossChainTracer(logs=logs_fn, tx=None, address_transfers=None, block_at=None,  # type: ignore[arg-type]
                              ready=lambda c: c.key != "base", window_hours=48, tolerance=0.05, max_candidates=5,
                              target_chains=["optimism"])
    out = (await tracer.trace(CHAINS["ethereum"], inter))[0]
    assert out["destination_chain"] == "base" and out["status"] == "unresolved"
    assert any("ALCHEMY_API_KEY" in e for e in out["evidence_against"])
    assert out["links"][0]["recipient"] == "0x507c8b1574c45b28012dfb718df6a8c7a47f21f5"
