"""Curated known-entity registry (bridges) with official citations, plus mixer labels derived from
imported OFAC designation notices. Labels are source assertions about contract roles, never identities."""

from __future__ import annotations

from dataclasses import dataclass

from ..domain.models import SourceLabel

SUPERCHAIN = "https://github.com/ethereum-optimism/superchain-registry/blob/main/superchain/extra/addresses/addresses.json"
BASE_DOCS = "https://docs.base.org/base-chain/network-information/base-contracts"
ARB_DOCS = "https://docs.arbitrum.io/build-decentralized-apps/reference/contract-addresses"
OFAC_TORNADO = "https://ofac.treasury.gov/recent-actions/20220808"


@dataclass(frozen=True)
class KnownEntity:
    chain: str
    address: str
    label: str
    category: str  # bridge | mixer | ...
    bridge_family: str | None
    destination_chain: str | None
    role: str | None
    source_url: str


BRIDGES: tuple[KnownEntity, ...] = (
    KnownEntity("ethereum", "0xbeb5fc579115071764c7423a4f12edde41f106ed", "OP Mainnet: OptimismPortal", "bridge",
                "op-stack", "optimism", "portal", SUPERCHAIN),
    KnownEntity("ethereum", "0x99c9fc46f92e8a1c0dec1b1747d010903e884be1", "OP Mainnet: L1StandardBridge", "bridge",
                "op-stack", "optimism", "standard_bridge", SUPERCHAIN),
    KnownEntity("ethereum", "0x25ace71c97b33cc4729cf772ae268934f7ab5fa1", "OP Mainnet: L1CrossDomainMessenger", "bridge",
                "op-stack", "optimism", "messenger", SUPERCHAIN),
    KnownEntity("ethereum", "0x49048044d57e1c92a77f79988d21fa8faf74e97e", "Base: OptimismPortal", "bridge",
                "op-stack", "base", "portal", BASE_DOCS),
    KnownEntity("ethereum", "0x3154cf16ccdb4c6d922629664174b904d80f2c35", "Base: L1StandardBridge", "bridge",
                "op-stack", "base", "standard_bridge", BASE_DOCS),
    KnownEntity("ethereum", "0x866e82a600a1414e583f7f13623f1ac5d58b0afa", "Base: L1CrossDomainMessenger", "bridge",
                "op-stack", "base", "messenger", BASE_DOCS),
    KnownEntity("ethereum", "0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f", "Arbitrum One: Delayed Inbox", "bridge",
                "arbitrum", "arbitrum", "inbox", ARB_DOCS),
    KnownEntity("ethereum", "0x72ce9c846789fdb6fc1f34ac4ad25dd9ef7031ef", "Arbitrum One: L1 Gateway Router", "bridge",
                "arbitrum", "arbitrum", "gateway_router", ARB_DOCS),
    KnownEntity("ethereum", "0xa3a7b6f88361f48403514059f1f16c8e78d60eec", "Arbitrum One: L1 ERC20 Gateway", "bridge",
                "arbitrum", "arbitrum", "erc20_gateway", ARB_DOCS),
    KnownEntity("ethereum", "0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a", "Arbitrum One: Bridge", "bridge",
                "arbitrum", "arbitrum", "bridge", ARB_DOCS),
)

_BY_KEY = {(e.chain, e.address): e for e in BRIDGES}


def lookup(chain: str, address: str | None) -> KnownEntity | None:
    if not address:
        return None
    return _BY_KEY.get((chain, address.lower()))


def registry_label(e: KnownEntity) -> SourceLabel:
    return SourceLabel(label=e.label, category=e.category, source="tracefuse-registry", source_url=e.source_url,
                       note=f"Contract address published in official documentation ({e.source_url}).")


def mixer_label(entity: str, action_date: str, url: str) -> SourceLabel:
    return SourceLabel(
        label=f"{entity.title()} contract (listed in OFAC notice {action_date})", category="mixer",
        source="ofac-recent-actions", source_url=url,
        note="Address appeared in an OFAC designation notice for a mixer; Tornado Cash was delisted on 2025-03-21. "
             "Role label only — interaction with a mixer is not proof of wrongdoing.",
    )


SERVICE_CATEGORIES = {"bridge", "mixer", "exchange", "dex"}
