"""OFAC, GoPlus, GitHub extraction and OP-Stack derivation on real recorded data."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest

from tests.conftest import FIXTURES
from tracefuse.bridges.op_stack import TRANSACTION_DEPOSITED_TOPIC, derive_deposit
from tracefuse.chains import CHAINS
from tracefuse.domain.models import EvidenceKind
from tracefuse.intel.extract import extract_indicators, fingerprint, snippet_around
from tracefuse.intel.github import GitHubClient, independent_sources
from tracefuse.intel.goplus import GoPlusClient, goplus_check
from tracefuse.intel.ofac import parse_recent_action, parse_sdn_xml
from tracefuse.providers.base import FetchContext
from tracefuse.providers.errors import ProviderBadResponse, ProviderRateLimited
from tracefuse.providers.http import HttpResult

RONIN = "0x098b716b8aaf21512996dc57eb0615e2383e2f96"
TORNADO_100 = "0xa160cdab225685da1d56aa342ad8841c3b53f291"


def test_op_stack_deposit_hash_matches_blockscout_index():
    logs = json.loads((FIXTURES / "op_deposit_l1_logs.json").read_text())["items"]
    lg = next(x for x in logs if x["topics"][0].lower() == TRANSACTION_DEPOSITED_TOPIC)
    d = derive_deposit(l1_tx_hash="0x48e0d6cb52e9f59bc55412228a9b79ce0f079a60c43f5c95a308664e67b6b5fb",
                       l1_block_hash=lg["block_hash"], log_index=lg["index"], topics=[t.lower() for t in lg["topics"] if t],
                       data=lg["data"])
    # Value published by Blockscout's OP Mainnet deposit index (independent source)
    assert d.l2_tx_hash == "0xc453ed6b3a324c1af24db2565adee833f0c1e0c2fc5165528f3b5c86b5e9fb1e"
    assert d.gas_limit == 516982


def test_op_stack_rejects_other_logs():
    with pytest.raises(ValueError):
        derive_deposit(l1_tx_hash="0x0", l1_block_hash="0x" + "00" * 32, log_index=0, topics=["0x" + "11" * 32], data="0x")


SDN_SAMPLE = b"""<?xml version="1.0" standalone="yes"?>
<sdnList xmlns="https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/XML">
<publshInformation><Publish_Date>10/15/2026</Publish_Date><Record_Count>2</Record_Count></publshInformation>
<sdnEntry><uid>27307</uid><lastName>LAZARUS GROUP</lastName><sdnType>Entity</sdnType>
<programList><program>DPRK3</program></programList>
<idList><id><uid>150215</uid><idType>Digital Currency Address - ETH</idType><idNumber>0x098B716B8Aaf21512996dC57EB0615e2383E2f96</idNumber></id>
<id><uid>1</uid><idType>Registration Number</idType><idNumber>123</idNumber></id></idList></sdnEntry>
<sdnEntry><uid>9</uid><lastName>X</lastName><sdnType>Individual</sdnType><programList><program>CYBER2</program></programList>
<idList><id><uid>2</uid><idType>Digital Currency Address - XBT</idType><idNumber>1BoatSLRHtKNngkdXEeobR76b53LETtpyT</idNumber></id></idList></sdnEntry>
</sdnList>"""


def test_sdn_xml_parse():
    meta, recs = parse_sdn_xml(SDN_SAMPLE)
    assert meta == {"publish_date": "10/15/2026", "record_count": 2}
    assert len(recs) == 2
    eth = recs[0]
    assert eth["address_norm"] == RONIN and eth["currency"] == "ETH" and eth["sdn_name"] == "LAZARUS GROUP"
    assert recs[1]["address_norm"] == "1BoatSLRHtKNngkdXEeobR76b53LETtpyT"  # non-EVM ids keep case


def test_sdn_rejects_xml_entities():
    evil = b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><sdnList>&a;</sdnList>'
    with pytest.raises(Exception):
        parse_sdn_xml(evil)


def test_recent_action_designation_and_removal_from_real_notices():
    _, r1 = parse_recent_action((FIXTURES / "20220414.html").read_text(), "u1", "20220414")
    assert [(r["action"], r["address_norm"], r["entity"]) for r in r1] == [("designation", RONIN, "LAZARUS GROUP")]
    _, r2 = parse_recent_action((FIXTURES / "20250321.html").read_text(), "u2", "20250321")
    t = [r for r in r2 if r["address_norm"] == TORNADO_100]
    assert t and t[0]["action"] == "removal" and t[0]["entity"] == "TORNADO CASH"
    _, r3 = parse_recent_action((FIXTURES / "20221108.html").read_text(), "u3", "20221108")
    acts = {r["action"] for r in r3 if r["address_norm"] == TORNADO_100}
    assert acts == {"designation", "removal"}  # delisted and re-designated the same day


async def test_ofac_evidence_semantics(services):
    meta, recs = parse_sdn_xml(SDN_SAMPLE)
    services.ofac_repo.import_dataset({**meta, "source_url": "x", "retrieved_at": "2026-10-17T00:00:00+00:00", "sha256": "ab" * 32}, recs)
    services.ofac.import_action_html((FIXTURES / "20220414.html").read_text(), "20220414", datetime.now(UTC))
    evs = services.ofac.evidence_for("ethereum", [RONIN, "0x" + "1" * 40])
    kinds = sorted(e.kind for e in evs)
    assert kinds == [EvidenceKind.SANCTIONS_HISTORY, EvidenceKind.SANCTIONS_LISTING]
    listing = next(e for e in evs if e.kind == EvidenceKind.SANCTIONS_LISTING)
    assert listing.confidence.value == "confirmed" and "LAZARUS GROUP" in listing.title
    assert any("not by itself prove" in c for c in listing.caveats)


def test_goplus_check_and_evidence(settings):
    assert goplus_check({"code": 1, "result": {}}) is None
    assert isinstance(goplus_check({"code": 4029, "message": "request limit reached"}), ProviderRateLimited)
    assert isinstance(goplus_check({"code": 2, "message": "bad"}), ProviderBadResponse)
    gp = GoPlusClient(None, settings)  # type: ignore[arg-type]
    res = HttpResult(data={}, status=200, url="u", retrieved_at=datetime.now(UTC))
    result = {"sanctioned": "1", "stealing_attack": "1", "mixer": "0", "data_source": "SlowMist,BlockSec",
              "number_of_malicious_contracts_created": "0"}
    evs = gp.to_evidence(CHAINS["ethereum"], RONIN, result, res, FetchContext())
    assert len(evs) == 1 and evs[0].kind == EvidenceKind.THREAT_INTEL_FLAG
    assert evs[0].attributes["flags"] == ["sanctioned", "stealing_attack"]
    assert gp.to_evidence(CHAINS["ethereum"], RONIN, {"sanctioned": "0"}, res, FetchContext()) == []


def test_extraction_and_snippets_are_plain_text():
    text = f"Attacker 0x{RONIN[2:].upper()} moved funds; tx 0x{'ab' * 32}\x00<script>x</script>"
    inds = extract_indicators(text)
    assert {i.kind for i in inds} == {"evm_address", "tx_hash"}
    snip, _ = snippet_around(text, RONIN)
    assert "\x00" not in snip
    assert fingerprint("A  b\nC") == fingerprint("a b c")


def test_github_evidence_requires_exact_match_and_dedupes(settings):
    gh = GitHubClient(None, settings)  # type: ignore[arg-type]
    data = {"items": [
        {"title": "Stolen funds", "body": f"exploit attacker {RONIN} laundered", "html_url": "https://github.com/a/r/issues/1",
         "id": 1, "repository_url": "https://api.github.com/repos/a/r", "created_at": "2022-04-01T00:00:00Z"},
        {"title": "copy", "body": f"exploit attacker {RONIN} laundered", "html_url": "https://github.com/a/r2/issues/2",
         "id": 2, "repository_url": "https://api.github.com/repos/a/r2", "created_at": "2022-04-02T00:00:00Z"},
        {"title": "token match only", "body": "0x098b716b mentioned partially", "html_url": "https://github.com/b/r/issues/3",
         "id": 3, "repository_url": "https://api.github.com/repos/b/r", "created_at": "2022-04-02T00:00:00Z"},
    ]}
    res = HttpResult(data=data, status=200, url="u", retrieved_at=datetime.now(UTC))
    evs = gh.to_evidence("issues", RONIN, "ethereum", res, FetchContext())
    assert len(evs) == 2  # partial/token match excluded
    assert all(e.kind == EvidenceKind.ADDRESS_MENTION and e.confidence.value == "weak" for e in evs)
    assert "exploit" in evs[0].attributes["context_terms"]
    assert independent_sources(evs) == 1  # identical text from the same owner counts once
