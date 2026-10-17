"""Chain registry.

Only EVM chains are modelled. ``blockscout_base`` instances were verified keyless on 2026-10-17 for
Ethereum (eth.blockscout.com) and OP Mainnet (explorer.optimism.io). Base and Arbitrum Blockscout
instances returned a Cloudflare browser challenge to scripted clients during that check, so they are
listed but expected to need ALCHEMY_API_KEY or ETHERSCAN_API_KEY; runtime health reports the truth.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class KnownToken:
    symbol: str
    address: str  # lowercase
    decimals: int
    economic_asset: str  # cross-chain token-mapping key, e.g. "ETH", "USDC"


@dataclass(frozen=True)
class ChainConfig:
    key: str
    chain_id: int
    name: str
    native_symbol: str
    native_decimals: int
    explorer_base: str
    blockscout_base: str | None = None
    blockscout_scripted_access: bool = True  # False: public instance serves a browser challenge to scripts
    etherscan_supported: bool = False
    etherscan_free_tier: bool = False
    alchemy_network: str | None = None
    alchemy_internal_transfers: bool = False
    goplus_chain_id: str | None = None
    is_op_stack_l2: bool = False
    known_tokens: tuple[KnownToken, ...] = field(default_factory=tuple)

    def explorer_tx_url(self, tx_hash: str) -> str:
        return f"{self.explorer_base}/tx/{tx_hash}"

    def explorer_address_url(self, address: str) -> str:
        return f"{self.explorer_base}/address/{address}"

    def token(self, address: str | None) -> KnownToken | None:
        if not address:
            return None
        a = address.lower()
        for t in self.known_tokens:
            if t.address == a:
                return t
        return None


# Token addresses are the canonical deployments published by the issuers / chain docs.
_ETH_TOKENS = (
    KnownToken("WETH", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", 18, "ETH"),
    KnownToken("USDC", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6, "USDC"),
    KnownToken("USDT", "0xdac17f958d2ee523a2206206994597c13d831ec7", 6, "USDT"),
    KnownToken("DAI", "0x6b175474e89094c44da98b954eedeac495271d0f", 18, "DAI"),
    KnownToken("WBTC", "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", 8, "BTC"),
)
_OP_TOKENS = (
    KnownToken("WETH", "0x4200000000000000000000000000000000000006", 18, "ETH"),
    KnownToken("USDC", "0x0b2c639c533813f4aa9d7837caf62653d097ff85", 6, "USDC"),
    KnownToken("USDC.e", "0x7f5c764cbc14f9669b88837ca1490cca17c31607", 6, "USDC"),
    KnownToken("USDT", "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", 6, "USDT"),
    KnownToken("DAI", "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", 18, "DAI"),
)
_BASE_TOKENS = (
    KnownToken("WETH", "0x4200000000000000000000000000000000000006", 18, "ETH"),
    KnownToken("USDC", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", 6, "USDC"),
)
_ARB_TOKENS = (
    KnownToken("WETH", "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", 18, "ETH"),
    KnownToken("USDC", "0xaf88d065e77c8cc2239327c5edb3a432268e5831", 6, "USDC"),
    KnownToken("USDT", "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", 6, "USDT"),
)

CHAINS: dict[str, ChainConfig] = {
    "ethereum": ChainConfig(
        key="ethereum",
        chain_id=1,
        name="Ethereum Mainnet",
        native_symbol="ETH",
        native_decimals=18,
        explorer_base="https://eth.blockscout.com",
        blockscout_base="https://eth.blockscout.com",
        etherscan_supported=True,
        etherscan_free_tier=True,
        alchemy_network="eth-mainnet",
        alchemy_internal_transfers=True,
        goplus_chain_id="1",
        known_tokens=_ETH_TOKENS,
    ),
    "optimism": ChainConfig(
        key="optimism",
        chain_id=10,
        name="OP Mainnet",
        native_symbol="ETH",
        native_decimals=18,
        explorer_base="https://explorer.optimism.io",
        blockscout_base="https://explorer.optimism.io",
        etherscan_supported=True,
        etherscan_free_tier=False,
        alchemy_network="opt-mainnet",
        goplus_chain_id="10",
        is_op_stack_l2=True,
        known_tokens=_OP_TOKENS,
    ),
    "base": ChainConfig(
        key="base",
        chain_id=8453,
        name="Base Mainnet",
        native_symbol="ETH",
        native_decimals=18,
        explorer_base="https://base.blockscout.com",
        blockscout_base="https://base.blockscout.com",
        blockscout_scripted_access=False,
        etherscan_supported=True,
        etherscan_free_tier=False,
        alchemy_network="base-mainnet",
        alchemy_internal_transfers=True,
        goplus_chain_id="8453",
        is_op_stack_l2=True,
        known_tokens=_BASE_TOKENS,
    ),
    "arbitrum": ChainConfig(
        key="arbitrum",
        chain_id=42161,
        name="Arbitrum One",
        native_symbol="ETH",
        native_decimals=18,
        explorer_base="https://arbitrum.blockscout.com",
        blockscout_base="https://arbitrum.blockscout.com",
        blockscout_scripted_access=False,
        etherscan_supported=True,
        etherscan_free_tier=True,
        alchemy_network="arb-mainnet",
        goplus_chain_id="42161",
        known_tokens=_ARB_TOKENS,
    ),
}

CHAIN_BY_ID: dict[int, ChainConfig] = {c.chain_id: c for c in CHAINS.values()}


def get_chain(key: str) -> ChainConfig:
    try:
        return CHAINS[key]
    except KeyError as exc:
        raise KeyError(f"unsupported chain '{key}'") from exc
