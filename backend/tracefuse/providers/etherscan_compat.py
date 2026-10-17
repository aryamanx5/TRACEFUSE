"""Parser for Etherscan-format account endpoints (``txlist``, ``txlistinternal``, ``tokentx``).

Both Etherscan API V2 and Blockscout's Etherscan-compatible RPC API (``/api?module=account``) return
this shape, so the normalisation logic is shared and tested once.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from ..chains import ChainConfig
from ..domain.amounts import parse_int
from ..domain.models import Provenance, Transfer, TransferKind
from .base import (
    OccurrenceCounter,
    make_transfer,
    native_asset,
    token_asset,
    ts_from_unix,
)
from .errors import ProviderAuthError, ProviderBadResponse, ProviderError, ProviderRateLimited
from .http import HttpResult


def etherscan_json_check(provider: str) -> Callable[[Any], ProviderError | None]:
    def check(data: Any) -> ProviderError | None:
        if not isinstance(data, dict):
            return ProviderBadResponse(provider, "unexpected payload shape")
        status = str(data.get("status", "1"))
        if status == "1":
            return None
        message = str(data.get("message", ""))
        result = data.get("result")
        text = f"{message} {result if isinstance(result, str) else ''}".lower()
        if "no transactions found" in text or "no records found" in text or (
            message.lower() == "ok" and isinstance(result, list)
        ):
            return None
        if "rate limit" in text or "too many" in text:
            return ProviderRateLimited(provider, f"rate limited: {message} {result}"[:200])
        if "invalid api key" in text or "missing/invalid api key" in text or "api key" in text and "invalid" in text:
            return ProviderAuthError(provider, "API key rejected")
        if "free api access is not supported" in text or "upgrade" in text:
            return ProviderAuthError(provider, f"plan does not cover this chain/endpoint: {result}"[:200])
        return ProviderBadResponse(provider, f"{message}: {result}"[:200])

    return check


def _result_list(data: Any) -> list[dict[str, Any]]:
    r = data.get("result") if isinstance(data, dict) else None
    return r if isinstance(r, list) else []


def parse_txlist(
    chain: ChainConfig, items: list[dict[str, Any]], provenance: Provenance
) -> list[Transfer]:
    out: list[Transfer] = []
    asset = native_asset(chain)
    for it in items:
        tx_hash = str(it.get("hash", "")).lower()
        frm = str(it.get("from", "")).lower()
        to = (str(it.get("to") or "").lower()) or (str(it.get("contractAddress") or "").lower()) or None
        if not tx_hash or not frm:
            continue
        success = str(it.get("isError", "0")) == "0" and str(it.get("txreceipt_status", "1")) in ("1", "")
        fn = it.get("functionName") or None
        method = (str(fn).split("(")[0] or None) if fn else (it.get("methodId") or None)
        if method in ("0x", ""):
            method = None
        out.append(
            make_transfer(
                chain=chain,
                tx_hash=tx_hash,
                block_number=parse_int(it.get("blockNumber")),
                timestamp=ts_from_unix(it.get("timeStamp")),
                from_address=frm,
                to_address=to,
                kind=TransferKind.NATIVE,
                asset=asset,
                raw_amount=parse_int(it.get("value")),
                discriminator="0",
                provenance=provenance,
                success=success,
                method=method,
            )
        )
    return out


def parse_txlistinternal(
    chain: ChainConfig, items: list[dict[str, Any]], provenance: Provenance
) -> list[Transfer]:
    out: list[Transfer] = []
    asset = native_asset(chain)
    occ = OccurrenceCounter()
    for it in items:
        value = parse_int(it.get("value"))
        if value == 0:
            continue  # zero-value internal calls carry no funds
        tx_hash = str(it.get("hash") or it.get("transactionHash") or "").lower()
        frm = str(it.get("from", "")).lower()
        to = (str(it.get("to") or "").lower()) or (str(it.get("contractAddress") or "").lower()) or None
        if not tx_hash or not frm:
            continue
        trace = it.get("traceId") or it.get("index")
        disc = str(trace) if trace not in (None, "") else f"o{occ.next(tx_hash, frm, to, value)}"
        success = str(it.get("isError", "0")) == "0"
        out.append(
            make_transfer(
                chain=chain,
                tx_hash=tx_hash,
                block_number=parse_int(it.get("blockNumber")),
                timestamp=ts_from_unix(it.get("timeStamp")),
                from_address=frm,
                to_address=to,
                kind=TransferKind.INTERNAL,
                asset=asset,
                raw_amount=value,
                discriminator=disc,
                provenance=provenance,
                success=success,
                trace_index=str(trace) if trace not in (None, "") else None,
            )
        )
    return out


def parse_tokentx(chain: ChainConfig, items: list[dict[str, Any]], provenance: Provenance) -> list[Transfer]:
    out: list[Transfer] = []
    occ = OccurrenceCounter()
    for it in items:
        tx_hash = str(it.get("hash", "")).lower()
        frm = str(it.get("from", "")).lower()
        to = str(it.get("to") or "").lower() or None
        contract = str(it.get("contractAddress", "")).lower()
        if not tx_hash or not frm or not contract:
            continue
        token_id = it.get("tokenID")
        is_nft = token_id not in (None, "")
        dec_raw = it.get("tokenDecimal")
        decimals = parse_int(dec_raw) if dec_raw not in (None, "") else None
        asset = token_asset(
            chain,
            contract,
            it.get("tokenSymbol"),
            it.get("tokenName"),
            0 if is_nft else decimals,
            "erc721" if is_nft else "erc20",
        )
        raw = 1 if is_nft else parse_int(it.get("value"))
        li = it.get("logIndex")
        log_index = parse_int(li) if li not in (None, "") else None
        disc = (
            f"l{log_index}"
            if log_index is not None
            else f"o{occ.next(tx_hash, contract, frm, to, raw, token_id)}"
        )
        fn = it.get("functionName") or None
        out.append(
            make_transfer(
                chain=chain,
                tx_hash=tx_hash,
                block_number=parse_int(it.get("blockNumber")),
                timestamp=ts_from_unix(it.get("timeStamp")),
                from_address=frm,
                to_address=to,
                kind=TransferKind.ERC721 if is_nft else TransferKind.ERC20,
                asset=asset,
                raw_amount=raw,
                discriminator=disc,
                provenance=provenance,
                method=(str(fn).split("(")[0] or None) if fn else None,
                log_index=log_index,
            )
        )
    return out


PageFetcher = Callable[[int, int], Awaitable[HttpResult]]


async def paginate_account_action(
    fetch_page: PageFetcher, page_size: int, limit: int
) -> tuple[list[tuple[HttpResult, list[dict[str, Any]]]], bool]:
    """Fetch pages (1-based) until exhausted or ``limit`` items. Returns (pages, truncated)."""
    pages: list[tuple[HttpResult, list[dict[str, Any]]]] = []
    total = 0
    page = 1
    while True:
        res = await fetch_page(page, page_size)
        items = _result_list(res.data)
        pages.append((res, items))
        total += len(items)
        if len(items) < page_size:
            return pages, False
        if total >= limit:
            return pages, True
        page += 1
