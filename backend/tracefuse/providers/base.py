"""Provider interface + shared helpers for normalising transfers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from ..chains import ChainConfig
from ..config import Settings
from ..domain.amounts import parse_int
from ..domain.models import (
    AddressInfo,
    AssetRef,
    DataOrigin,
    Provenance,
    Transfer,
    TransferKind,
    build_amount,
    make_transfer_id,
)
from .http import CallBudget, HttpResult, ResilientHttp


@dataclass
class FetchContext:
    budget: CallBudget | None = None
    data_origin: DataOrigin = DataOrigin.LIVE

    def origin_for(self, result: HttpResult) -> DataOrigin:
        if self.data_origin == DataOrigin.HISTORICAL_CASE or result.replayed:
            return DataOrigin.HISTORICAL_CASE
        return DataOrigin.CACHED if result.from_cache else DataOrigin.LIVE

    def provenance(self, provider: str, result: HttpResult) -> Provenance:
        return Provenance(
            provider=provider,
            endpoint=result.url,
            retrieved_at=result.retrieved_at,
            data_origin=self.origin_for(result),
            from_cache=result.from_cache,
        )


@dataclass(frozen=True)
class BlockRange:
    start_block: int = 0
    end_block: int | None = None  # None = chain head


@dataclass
class AddressFetchResult:
    chain: str
    address: str
    transfers: list[Transfer]
    truncated: bool = False
    truncated_streams: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    endpoints: list[str] = field(default_factory=list)
    counterparty_info: dict[str, AddressInfo] = field(default_factory=dict)


@dataclass
class TxFetchResult:
    chain: str
    tx_hash: str
    from_address: str
    to_address: str | None
    block_number: int
    timestamp: datetime | None
    success: bool
    method: str | None
    transfers: list[Transfer]
    warnings: list[str] = field(default_factory=list)
    to_is_contract: bool | None = None


@dataclass
class LogRecord:
    address: str
    topics: list[str]
    data: str
    log_index: int
    block_hash: str | None
    block_number: int | None
    tx_hash: str
    decoded_name: str | None = None


class ChainProvider(ABC):
    name: str = "provider"
    requires_credential: str | None = None

    def __init__(self, http: ResilientHttp, settings: Settings):
        self.http = http
        self.settings = settings

    @abstractmethod
    def is_configured(self) -> bool: ...

    @abstractmethod
    def supports_chain(self, chain: ChainConfig) -> bool: ...

    @abstractmethod
    async def block_at_time(
        self, chain: ChainConfig, when: datetime, closest: Literal["before", "after"], ctx: FetchContext
    ) -> int: ...

    @abstractmethod
    async def address_transfers(
        self,
        chain: ChainConfig,
        address: str,
        block_range: BlockRange,
        *,
        include_internal: bool,
        include_tokens: bool,
        limit: int,
        ctx: FetchContext,
    ) -> AddressFetchResult: ...

    @abstractmethod
    async def transaction(self, chain: ChainConfig, tx_hash: str, ctx: FetchContext) -> TxFetchResult: ...

    @abstractmethod
    async def address_info(self, chain: ChainConfig, address: str, ctx: FetchContext) -> AddressInfo: ...

    @abstractmethod
    async def tx_logs(self, chain: ChainConfig, tx_hash: str, ctx: FetchContext) -> list[LogRecord]: ...

    def describe(self, chain: ChainConfig) -> dict[str, Any]:
        return {"provider": self.name, "configured": self.is_configured(), "supports": self.supports_chain(chain)}


# ---------------------------------------------------------------------------------------------------
# Normalisation helpers
# ---------------------------------------------------------------------------------------------------


def native_asset(chain: ChainConfig) -> AssetRef:
    return AssetRef(
        symbol=chain.native_symbol,
        name=chain.native_symbol,
        contract=None,
        decimals=chain.native_decimals,
        token_type="native",
        recognised=True,
        economic_asset=chain.native_symbol,
    )


def token_asset(
    chain: ChainConfig,
    contract: str,
    symbol: str | None,
    name: str | None,
    decimals: int | None,
    token_type: str = "erc20",
) -> AssetRef:
    known = chain.token(contract)
    if known is not None:
        # Trust the curated registry (by contract address) over provider-reported symbols, which
        # spam tokens routinely spoof.
        return AssetRef(
            symbol=known.symbol,
            name=name or known.symbol,
            contract=contract.lower(),
            decimals=known.decimals,
            token_type="erc20",
            recognised=True,
            economic_asset=known.economic_asset,
        )
    tt = token_type if token_type in ("erc20", "erc721", "erc1155") else "unknown"
    return AssetRef(
        symbol=(symbol or "?")[:24],
        name=(name or None) and name[:64],
        contract=contract.lower(),
        decimals=decimals,
        token_type=tt,  # type: ignore[arg-type]
        recognised=False,
        economic_asset=None,
    )


def ts_from_unix(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    try:
        return datetime.fromtimestamp(parse_int(value), UTC)
    except (ValueError, OverflowError, OSError):
        return None


def ts_from_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def make_transfer(
    *,
    chain: ChainConfig,
    tx_hash: str,
    block_number: int,
    timestamp: datetime | None,
    from_address: str,
    to_address: str | None,
    kind: TransferKind,
    asset: AssetRef,
    raw_amount: int,
    discriminator: str,
    provenance: Provenance,
    success: bool = True,
    method: str | None = None,
    log_index: int | None = None,
    trace_index: str | None = None,
) -> Transfer:
    return Transfer(
        id=make_transfer_id(chain.chain_id, tx_hash, kind, discriminator),
        chain=chain.key,
        chain_id=chain.chain_id,
        tx_hash=tx_hash,
        block_number=block_number,
        timestamp=timestamp,
        timestamp_quality="block_timestamp" if timestamp else "missing",
        from_address=from_address,
        to_address=to_address,
        kind=kind,
        asset=asset,
        raw_amount=str(raw_amount),
        amount=build_amount(raw_amount, asset.decimals),
        success=success,
        method=method,
        log_index=log_index,
        trace_index=trace_index,
        explorer_url=chain.explorer_tx_url(tx_hash),
        provenance=provenance,
    )


class OccurrenceCounter:
    """Assigns stable per-transaction ordinals to otherwise identical records lacking a log index."""

    def __init__(self) -> None:
        self._seen: dict[tuple[Any, ...], int] = defaultdict(int)

    def next(self, *key: Any) -> int:
        n = self._seen[key]
        self._seen[key] += 1
        return n


def dedupe_transfers(transfers: list[Transfer]) -> list[Transfer]:
    """Deduplicate by transfer id, keeping the first occurrence; stable chronological order."""
    seen: dict[str, Transfer] = {}
    for t in transfers:
        if t.id not in seen:
            seen[t.id] = t
    return sorted(
        seen.values(),
        key=lambda t: (t.block_number, t.log_index if t.log_index is not None else -1, t.id),
    )
