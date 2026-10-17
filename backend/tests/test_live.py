"""Genuine live-provider checks (network). Opt-in: TRACEFUSE_LIVE_TESTS=1 .venv/bin/pytest tests/test_live.py -v

These never run in the default suite and never use mocked responses.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

import pytest

from tracefuse.domain.models import DataOrigin, InvestigationConfig
from tracefuse.pipeline.investigation import InvestigationRunner, JobManager
from tracefuse.services import Services
from tracefuse.storage.db import Database

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(os.environ.get("TRACEFUSE_LIVE_TESTS") != "1", reason="live tests are opt-in (TRACEFUSE_LIVE_TESTS=1)"),
]

# Real OP-Stack deposit: L1 tx on Ethereum and the L2 tx Blockscout's OP deposit index lists for it.
L1_DEPOSIT_TX = "0x48e0d6cb52e9f59bc55412228a9b79ce0f079a60c43f5c95a308664e67b6b5fb"
L2_DEPOSIT_TX = "0xc453ed6b3a324c1af24db2565adee833f0c1e0c2fc5165528f3b5c86b5e9fb1e"


@pytest.fixture
def live_services(tmp_path):
    from tracefuse.config import Settings

    settings = Settings(tracefuse_db_path=tmp_path / "live.sqlite3")
    s = Services.create(settings, db=Database(settings.tracefuse_db_path))
    from tracefuse.api.app import ensure_ofac

    ensure_ofac(s)
    return s


async def _run(s: Services, cfg: InvestigationConfig) -> str:
    jm = JobManager(s)
    from tracefuse.domain.validation import classify_seed

    seed = classify_seed(cfg.seed)
    inv = s.investigations.create(cfg, DataOrigin.LIVE.value, None, seed.kind, seed.value)
    await InvestigationRunner(s, jm.bus, inv["id"], cfg, s.live).run()
    return inv["id"]


async def test_live_op_mainnet_investigation(live_services):
    """CHAIN-1 on OP Mainnet: tx-hash seed resolved and traced via keyless Blockscout."""
    cfg = InvestigationConfig(
        seed=L2_DEPOSIT_TX, chain="optimism", max_hops=1, max_branching=3,
        time_start=datetime(2026, 10, 17, 4, 0, tzinfo=UTC), time_end=datetime(2026, 10, 17, 6, 0, tzinfo=UTC),
        osint={"github": False, "goplus": True, "ofac": True, "blockscout_labels": True}, crosschain={"enabled": False},
    )
    iid = await _run(live_services, cfg)
    inv = live_services.investigations.get(iid)
    assert inv["status"] in ("completed", "partial"), inv["error"]
    ts = live_services.investigations.load_transfers(iid)
    assert ts and all(t.chain == "optimism" and t.chain_id == 10 for t in ts)
    assert {t.provenance.data_origin for t in ts} <= {DataOrigin.LIVE, DataOrigin.CACHED}


async def test_live_op_stack_deposit_confirmed(live_services):
    """CROSSCHAIN-3 live: L1 deposit detected, L2 hash derived and the L2 tx fetched on OP Mainnet."""
    cfg = InvestigationConfig(
        seed=L1_DEPOSIT_TX, chain="ethereum", max_hops=1, max_branching=2,
        time_start=datetime(2026, 10, 17, 4, 40, tzinfo=UTC), time_end=datetime(2026, 10, 17, 4, 55, tzinfo=UTC),
        osint={"github": False, "goplus": False, "ofac": True, "blockscout_labels": True},
        crosschain={"enabled": True, "target_chains": ["optimism"]},
    )
    iid = await _run(live_services, cfg)
    inv = live_services.investigations.get(iid)
    assert inv["status"] in ("completed", "partial"), inv["error"]
    cc = live_services.investigations.load_artifact(iid, "crosschain", [])
    links = [lk for c in cc for lk in c["links"]]
    assert any(lk["destination_tx"] == L2_DEPOSIT_TX for lk in links), cc
    confirmed = [c for c in cc if c["status"] == "confirmed"]
    assert confirmed, [(c["status"], c["evidence_against"]) for c in cc]


async def test_live_across_deposit_decoded_destination_reported(live_services):
    """CROSSCHAIN-3/4 live (Across): the real deposit's destination/depositId/recipient are read from the on-chain event.
    Its destination is Base, which has no keyless provider, so the link must stay unresolved and name the credential."""
    cfg = InvestigationConfig(
        seed="0xe838e6c3f670f6bf819c3b6baf67163f8c83f91fead7d91ad0db6d6c090c7335", chain="ethereum", max_hops=1,
        max_branching=2, time_start=datetime(2026, 10, 17, 20, 0, tzinfo=UTC), time_end=datetime(2026, 10, 17, 20, 15, tzinfo=UTC),
        osint={"github": False, "goplus": False, "ofac": True, "blockscout_labels": True},
        crosschain={"enabled": True, "target_chains": ["optimism"]},
    )
    iid = await _run(live_services, cfg)
    cc = live_services.investigations.load_artifact(iid, "crosschain", [])
    seed_tx = "0xe838e6c3f670f6bf819c3b6baf67163f8c83f91fead7d91ad0db6d6c090c7335"
    acr = [c for c in cc if c["bridge_family"] == "across" and c["source_tx"] == seed_tx]
    assert acr, [(c["source_tx"], c["destination_chain"]) for c in cc]
    c = acr[0]
    # other deposits by the same wallet are decoded too, each with its own documented destination
    others = {x["destination_chain"] for x in cc if x["bridge_family"] == "across" and x["source_tx"] != seed_tx}
    assert all(d is None or d.startswith("chain-id:") or d in ("ethereum", "optimism", "base", "arbitrum") for d in others)
    # interactions without a FundsDeposited event are never given an invented destination
    for x in cc:
        if x["bridge_family"] == "across" and x["destination_chain"] is None:
            assert x["status"] in ("unresolved", "candidate")
    assert c["destination_chain"] == "base" and c["links"][0]["deposit_id"] == 4790238
    has_key = bool(os.environ.get("ALCHEMY_API_KEY"))
    if not has_key:
        assert c["status"] == "unresolved" and any("ALCHEMY_API_KEY" in e for e in c["evidence_against"])
