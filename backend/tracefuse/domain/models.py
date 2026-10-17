"""Core domain models shared by providers, analysis, storage, API and reports."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .amounts import display_str


def utcnow() -> datetime:
    return datetime.now(UTC)


class DataOrigin(StrEnum):
    LIVE = "live"
    CACHED = "cached"
    HISTORICAL_CASE = "historical_case"


class TransferKind(StrEnum):
    NATIVE = "native"  # top-level transaction value
    INTERNAL = "internal"  # value moved by a contract call trace
    ERC20 = "erc20"
    ERC721 = "erc721"
    ERC1155 = "erc1155"


class AssetRef(BaseModel):
    symbol: str
    name: str | None = None
    contract: str | None = None  # None for native asset
    decimals: int | None = None
    token_type: Literal["native", "erc20", "erc721", "erc1155", "unknown"] = "native"
    recognised: bool = False  # in the curated canonical-token registry (or native)
    economic_asset: str | None = None  # cross-chain mapping key, e.g. ETH/USDC

    @property
    def key(self) -> str:
        return "native" if self.contract is None else self.contract.lower()


class Provenance(BaseModel):
    provider: str
    endpoint: str  # sanitised (no credentials)
    retrieved_at: datetime
    data_origin: DataOrigin
    from_cache: bool = False


class Transfer(BaseModel):
    """One normalised value movement. ``id`` is the deduplication key."""

    id: str
    chain: str
    chain_id: int
    tx_hash: str
    block_number: int
    timestamp: datetime | None
    timestamp_quality: Literal["block_timestamp", "missing"] = "block_timestamp"
    from_address: str
    to_address: str | None
    kind: TransferKind
    asset: AssetRef
    raw_amount: str
    amount: str | None  # decimal string in display units; None when decimals unknown
    success: bool = True
    method: str | None = None
    log_index: int | None = None
    trace_index: str | None = None
    explorer_url: str
    provenance: Provenance

    @field_validator("tx_hash", "from_address")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.lower()

    @field_validator("to_address")
    @classmethod
    def _lower_opt(cls, v: str | None) -> str | None:
        return v.lower() if v else v

    @property
    def raw_int(self) -> int:
        return int(self.raw_amount)

    @property
    def ts(self) -> float | None:
        return self.timestamp.timestamp() if self.timestamp else None

    @property
    def is_self_transfer(self) -> bool:
        return self.to_address is not None and self.to_address == self.from_address

    @property
    def carries_value(self) -> bool:
        return self.success and self.kind in (TransferKind.NATIVE, TransferKind.INTERNAL, TransferKind.ERC20) and (
            self.raw_int > 0
        )


def make_transfer_id(chain_id: int, tx_hash: str, kind: TransferKind, discriminator: str) -> str:
    return f"{chain_id}:{tx_hash.lower()}:{kind.value}:{discriminator}"


def build_amount(raw: int, decimals: int | None) -> str | None:
    return display_str(raw, decimals)


# ---------------------------------------------------------------------------------------------------
# Addresses / nodes
# ---------------------------------------------------------------------------------------------------


class ExpansionStatus(StrEnum):
    SEED = "seed"
    EXPANDED = "expanded"
    DEPTH_LIMIT = "depth_limit"
    BRANCH_PRUNED = "branch_pruned"
    TERMINAL_SERVICE = "terminal_service"  # labelled exchange / bridge / mixer / DEX contract
    TRUNCATED = "truncated"  # activity exceeded per-address cap; expanded partially
    BUDGET_EXHAUSTED = "budget_exhausted"
    PROVIDER_ERROR = "provider_error"
    NOT_EXPANDED = "not_expanded"  # observed only as counterparty


class SourceLabel(BaseModel):
    """A label asserted by an external source about an address (not a TRACEFUSE conclusion)."""

    label: str
    category: str | None = None  # bridge / mixer / exchange / exploit / sanctioned / protocol / ...
    source: str  # e.g. "blockscout-metadata", "tracefuse-registry", "goplus"
    source_url: str | None = None
    retrieved_at: datetime | None = None
    note: str | None = None


class AddressInfo(BaseModel):
    chain: str
    address: str
    is_contract: bool | None = None
    name: str | None = None
    labels: list[SourceLabel] = Field(default_factory=list)
    provenance: Provenance | None = None


# ---------------------------------------------------------------------------------------------------
# Evidence & intelligence
# ---------------------------------------------------------------------------------------------------


class EvidenceKind(StrEnum):
    """Deliberately distinct categories — they are not interchangeable."""

    ADDRESS_MENTION = "address_mention"  # a public document contains the address string
    SOURCE_REPORTED_LABEL = "source_reported_label"  # a source labels the address (e.g. "Exploiter")
    SANCTIONS_LISTING = "sanctions_listing"  # official sanctions list entry
    SANCTIONS_HISTORY = "sanctions_history"  # official designation/removal action notice
    THREAT_INTEL_FLAG = "threat_intel_flag"  # security-vendor risk flag (GoPlus)
    KNOWN_MALICIOUS_CODE = "known_malicious_code"  # vendor states the address created malicious contracts
    PUBLIC_REPORT = "public_report"  # curated incident report / official statement (historical cases)
    IDENTITY_ATTRIBUTION = "identity_attribution"  # never generated automatically


class ConfidenceCategory(StrEnum):
    CONFIRMED = "confirmed"  # deterministic on-chain fact or official list exact match
    STRONG = "strong"
    MODERATE = "moderate"
    WEAK = "weak"
    UNVERIFIED = "unverified"


class AssertionStatus(StrEnum):
    VERIFIED_ONCHAIN = "verified_onchain"
    EXTERNAL_ASSERTION = "external_assertion"
    ALGORITHMIC_INFERENCE = "algorithmic_inference"
    ANALYST_HYPOTHESIS = "analyst_hypothesis"


class Evidence(BaseModel):
    id: str = ""
    kind: EvidenceKind
    subject_chain: str | None = None
    subject_address: str | None = None
    subject_tx: str | None = None
    title: str
    source: str  # provider / dataset name
    source_url: str | None = None
    source_item_id: str | None = None  # repo/file/issue id, SDN uid, ...
    snippet: str | None = None  # plain text, length-limited, never rendered as HTML
    match_location: str | None = None
    match_criteria: str | None = None
    query: str | None = None
    published_at: datetime | None = None
    collected_at: datetime = Field(default_factory=utcnow)
    confidence: ConfidenceCategory = ConfidenceCategory.UNVERIFIED
    assertion_status: AssertionStatus = AssertionStatus.EXTERNAL_ASSERTION
    caveats: list[str] = Field(default_factory=list)
    attributes: dict[str, Any] = Field(default_factory=dict)
    fingerprint: str | None = None  # for de-duplicating copied/repeated content
    data_origin: DataOrigin = DataOrigin.LIVE

    @model_validator(mode="after")
    def _ensure_id(self) -> Evidence:
        if not self.id:
            basis = "|".join(
                str(x)
                for x in (
                    self.kind.value,
                    self.subject_chain,
                    self.subject_address,
                    self.subject_tx,
                    self.source,
                    self.source_url,
                    self.source_item_id,
                    self.match_location,
                )
            )
            self.id = "ev_" + hashlib.sha256(basis.encode()).hexdigest()[:16]
        return self


class SourceStatus(BaseModel):
    source: str
    state: Literal["ok", "unconfigured", "disabled", "rate_limited", "error", "skipped", "partial"]
    message: str | None = None
    queried: int = 0
    results: int = 0
    from_cache: int = 0
    last_retrieved_at: datetime | None = None


# ---------------------------------------------------------------------------------------------------
# Investigation configuration
# ---------------------------------------------------------------------------------------------------


class OsintOptions(BaseModel):
    ofac: bool = True
    goplus: bool = True
    github: bool = True
    blockscout_labels: bool = True


class CrossChainOptions(BaseModel):
    enabled: bool = True
    target_chains: list[str] = Field(default_factory=lambda: ["optimism"])
    window_hours: float = Field(default=48.0, gt=0, le=24 * 14)
    amount_tolerance: float = Field(default=0.05, ge=0, le=0.5)
    max_candidates_per_event: int = Field(default=5, ge=1, le=20)


class InvestigationConfig(BaseModel):
    seed: str
    chain: str = "ethereum"
    direction: Literal["forward", "backward", "both"] = "forward"
    max_hops: int = Field(default=2, ge=1, le=4)
    max_branching: int = Field(default=6, ge=1, le=20)
    max_transfers_per_address: int = Field(default=1000, ge=50, le=5000)
    max_nodes: int = Field(default=250, ge=10, le=400)
    time_start: datetime | None = None
    time_end: datetime | None = None
    include_internal: bool = True
    include_tokens: bool = True
    include_unrecognised_tokens_in_traversal: bool = False
    min_traversal_share: float = Field(default=0.01, ge=0, le=1)
    osint: OsintOptions = Field(default_factory=OsintOptions)
    crosschain: CrossChainOptions = Field(default_factory=CrossChainOptions)
    provider: str | None = None  # force a provider; default = best available for chain

    @model_validator(mode="after")
    def _check_window(self) -> InvestigationConfig:
        for attr in ("time_start", "time_end"):
            v = getattr(self, attr)
            if v is not None and v.tzinfo is None:
                setattr(self, attr, v.replace(tzinfo=UTC))
        if self.time_start and self.time_end and self.time_start >= self.time_end:
            raise ValueError("time_start must be earlier than time_end")
        return self


class InvestigationStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    PARTIAL = "partial"  # completed with warnings / missing data
    FAILED = "failed"
    CANCELLED = "cancelled"


class ProgressEvent(BaseModel):
    seq: int = 0
    investigation_id: str
    stage: str
    status: Literal["started", "progress", "completed", "failed", "skipped", "warning", "info"]
    message: str
    detail: dict[str, Any] = Field(default_factory=dict)
    ts: datetime = Field(default_factory=utcnow)
