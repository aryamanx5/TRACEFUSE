"""GoPlus Security — Malicious Address API.

``GET https://api.gopluslabs.io/api/v1/address_security/{address}?chain_id=<id>``; ``Authorization: Bearer``
optional. ``code == 1`` = success; ``result`` flags are strings where "1" = true (GoPlus "Response Details").
Flags are vendor assertions aggregated from ``data_source`` (e.g. SlowMist, BlockSec) without citations.
"""

from __future__ import annotations

from typing import Any

from ..chains import ChainConfig
from ..config import Settings
from ..domain.models import AssertionStatus, ConfidenceCategory, Evidence, EvidenceKind
from ..providers.base import FetchContext
from ..providers.errors import ProviderBadResponse, ProviderError, ProviderRateLimited, ProviderUnsupported
from ..providers.http import HttpResult, ResilientHttp

URL = "https://api.gopluslabs.io/api/v1/address_security/{address}"

RISK_FLAGS: dict[str, str] = {
    "honeypot_related_address": "related to honeypot tokens or created scam tokens",
    "phishing_activities": "implemented phishing activities",
    "blackmail_activities": "implemented blackmail activities",
    "stealing_attack": "implemented stealing attacks",
    "fake_kyc": "involved in fake KYC",
    "malicious_mining_activities": "involved in malicious mining activities",
    "darkweb_transactions": "involved in dark web transactions",
    "cybercrime": "involved in cybercrime",
    "money_laundering": "involved in money laundering",
    "financial_crime": "involved in financial crime",
    "blacklist_doubt": "suspected of malicious behavior",
    "mixer": "coin mixer address",
    "sanctioned": "sanctioned address",
    "gas_abuse": "abuses other users' gas fees",
    "fake_token": "counterfeit of a mainstream asset",
    "fake_standard_interface": "contract with non-conforming standard interfaces",
    "reinit": "contract can be redeployed",
}


def goplus_check(data: Any) -> ProviderError | None:
    if not isinstance(data, dict):
        return ProviderBadResponse("goplus", "unexpected payload")
    code = data.get("code")
    if str(code) == "1":
        return None
    msg = str(data.get("message", ""))[:200]
    if "limit" in msg.lower() or str(code) in ("4029", "4012"):
        return ProviderRateLimited("goplus", f"code {code}: {msg}")
    return ProviderBadResponse("goplus", f"code {code}: {msg}")


class GoPlusClient:
    source = "goplus"

    def __init__(self, http: ResilientHttp, settings: Settings):
        self.http = http
        self.settings = settings

    def supports(self, chain: ChainConfig) -> bool:
        return chain.goplus_chain_id is not None

    async def address_security(self, chain: ChainConfig, address: str, ctx: FetchContext) -> tuple[dict[str, Any], HttpResult]:
        if not self.supports(chain):
            raise ProviderUnsupported(self.source, f"GoPlus does not list {chain.name}")
        headers = None
        if self.settings.goplus_access_token:
            headers = {"Authorization": f"Bearer {self.settings.goplus_access_token.get_secret_value()}"}
        res = await self.http.request(
            "goplus", "GET", URL.format(address=address), params={"chain_id": chain.goplus_chain_id},
            headers=headers, cache_ttl=self.settings.cache_ttl_intel_seconds, json_check=goplus_check, budget=ctx.budget,
        )
        return res.data.get("result") or {}, res

    def to_evidence(self, chain: ChainConfig, address: str, result: dict[str, Any], res: HttpResult,
                    ctx: FetchContext) -> list[Evidence]:
        flagged = {k: v for k, v in RISK_FLAGS.items() if str(result.get(k, "0")) == "1"}
        try:
            created_n = int(str(result.get("number_of_malicious_contracts_created") or "0"))
        except ValueError:
            created_n = 0
        data_source = str(result.get("data_source") or "").strip() or None
        url = f"https://api.gopluslabs.io/api/v1/address_security/{address}?chain_id={chain.goplus_chain_id}"
        caveats = [
            "GoPlus flags are vendor assertions aggregated from third-party sources"
            + (f" ({data_source})" if data_source else "") + "; no per-flag citation is provided.",
            "A flag does not identify a person and is not proof of intent.",
        ]
        evs: list[Evidence] = []
        if flagged:
            evs.append(Evidence(
                kind=EvidenceKind.THREAT_INTEL_FLAG, subject_chain=chain.key, subject_address=address,
                title="GoPlus flags: " + ", ".join(flagged), source="goplus", source_url=url,
                source_item_id=f"goplus:{chain.goplus_chain_id}:{address}",
                snippet="; ".join(f"{k}: {v}" for k, v in flagged.items()),
                match_location="address_security.result", match_criteria="exact address lookup",
                collected_at=res.retrieved_at, confidence=ConfidenceCategory.MODERATE,
                assertion_status=AssertionStatus.EXTERNAL_ASSERTION,
                caveats=caveats + (["'sanctioned' likely derives from official lists; not double-counted with OFAC."]
                                   if "sanctioned" in flagged else []),
                attributes={"flags": sorted(flagged), "data_source": data_source},
                fingerprint=f"goplus:{address}", data_origin=ctx.origin_for(res),
            ))
        if created_n > 0:
            evs.append(Evidence(
                kind=EvidenceKind.KNOWN_MALICIOUS_CODE, subject_chain=chain.key, subject_address=address,
                title=f"GoPlus: created {created_n} malicious contract(s)", source="goplus", source_url=url,
                source_item_id=f"goplus:{chain.goplus_chain_id}:{address}:contracts",
                snippet=f"number_of_malicious_contracts_created = {created_n}", match_criteria="exact address lookup",
                collected_at=res.retrieved_at, confidence=ConfidenceCategory.MODERATE, caveats=caveats,
                attributes={"count": created_n, "data_source": data_source}, data_origin=ctx.origin_for(res),
            ))
        return evs
