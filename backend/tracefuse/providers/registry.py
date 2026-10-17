"""Chooses a chain-data provider per chain and reports configuration/health honestly."""

from __future__ import annotations

from typing import Any

from ..chains import CHAINS, ChainConfig
from ..config import Settings
from .alchemy import AlchemyProvider
from .base import ChainProvider
from .blockscout import BlockscoutProvider
from .errors import ProviderUnconfigured, ProviderUnsupported
from .etherscan import EtherscanV2Provider
from .http import ResilientHttp

PREFERENCE = ("blockscout", "alchemy", "etherscan")


class ProviderRegistry:
    def __init__(self, http: ResilientHttp, settings: Settings):
        self.http = http
        self.settings = settings
        self.providers: dict[str, ChainProvider] = {
            "blockscout": BlockscoutProvider(http, settings),
            "etherscan": EtherscanV2Provider(http, settings),
            "alchemy": AlchemyProvider(http, settings),
        }

    def candidates(self, chain: ChainConfig) -> list[ChainProvider]:
        out = []
        for name in PREFERENCE:
            p = self.providers[name]
            if p.supports_chain(chain) and p.is_configured():
                out.append(p)
        return out

    def select(self, chain: ChainConfig, forced: str | None = None) -> ChainProvider:
        if forced:
            p = self.providers.get(forced)
            if p is None:
                raise ProviderUnsupported(forced, f"unknown provider '{forced}'")
            if not p.supports_chain(chain):
                raise ProviderUnsupported(forced, f"{forced} does not support {chain.name}")
            if not p.is_configured():
                raise ProviderUnconfigured(forced, f"{p.requires_credential} is not set")
            return p
        # Prefer a provider that has not been observed to be blocked for this chain.
        health = self.http.health.all()
        cands = self.candidates(chain)
        if not cands:
            raise ProviderUnconfigured(
                "chain-data",
                f"no configured provider for {chain.name}; set ALCHEMY_API_KEY or ETHERSCAN_API_KEY",
            )
        for p in cands:
            h = health.get(p.name)
            if p.name == "blockscout" and h is not None and h.last_error_kind == "blocked" and len(cands) > 1:
                continue
            return p
        return cands[0]

    def chain_matrix(self) -> list[dict[str, Any]]:
        rows = []
        for chain in CHAINS.values():
            provs = []
            for name in PREFERENCE:
                p = self.providers[name]
                note = None
                if name == "blockscout" and chain.key in ("base", "arbitrum"):
                    note = "public instance served a browser challenge to scripted clients when verified (2026-10-17)"
                if name == "etherscan" and chain.etherscan_supported and not chain.etherscan_free_tier:
                    note = "Etherscan lists this chain as paid-tier only"
                provs.append(
                    {
                        "provider": name,
                        "supports_chain": p.supports_chain(chain),
                        "configured": p.is_configured(),
                        "credential": p.requires_credential,
                        "note": note,
                    }
                )
            usable = [x for x in provs if x["supports_chain"] and x["configured"]]
            rows.append(
                {
                    "key": chain.key,
                    "chain_id": chain.chain_id,
                    "name": chain.name,
                    "native_symbol": chain.native_symbol,
                    "explorer": chain.explorer_base,
                    "providers": provs,
                    "ready": bool(usable),
                    "keyless_live_verified": chain.key in ("ethereum", "optimism"),
                }
            )
        return rows
