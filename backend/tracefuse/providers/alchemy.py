"""Alchemy Transfers API adapter (requires ``ALCHEMY_API_KEY``).

``alchemy_getAssetTransfers`` (documented params: fromBlock, toBlock, fromAddress, toAddress, category,
order, withMetadata, excludeZeroValue, maxCount, pageKey). The ``internal`` category is only offered on
some networks (Ethereum, Polygon, Base, …) — ``ChainConfig.alchemy_internal_transfers`` gates it.
Alchemy omits zero-value internal transfers and delegatecalls; this is reported as a coverage caveat.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from ..chains import ChainConfig
from ..domain.amounts import parse_int
from ..domain.models import AddressInfo, TransferKind
from .base import (
    AddressFetchResult,
    BlockRange,
    ChainProvider,
    FetchContext,
    LogRecord,
    TxFetchResult,
    dedupe_transfers,
    make_transfer,
    native_asset,
    token_asset,
    ts_from_iso,
    ts_from_unix,
)
from .errors import ProviderBadResponse, ProviderNotFound, ProviderUnconfigured, ProviderUnsupported

MAX_COUNT = 1000
ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


class AlchemyProvider(ChainProvider):
    name = "alchemy"
    requires_credential = "ALCHEMY_API_KEY"

    def is_configured(self) -> bool:
        k = self.settings.alchemy_api_key
        return k is not None and bool(k.get_secret_value())

    def supports_chain(self, chain: ChainConfig) -> bool:
        return chain.alchemy_network is not None

    def _url(self, chain: ChainConfig) -> str:
        if not self.is_configured():
            raise ProviderUnconfigured(self.name, "ALCHEMY_API_KEY is not set")
        if not chain.alchemy_network:
            raise ProviderUnsupported(self.name, f"{chain.name} is not mapped to an Alchemy network")
        assert self.settings.alchemy_api_key is not None
        return f"https://{chain.alchemy_network}.g.alchemy.com/v2/{self.settings.alchemy_api_key.get_secret_value()}"

    async def _rpc(self, chain: ChainConfig, method: str, params: list[Any], ctx: FetchContext, ttl: int | None = None):
        def check(data: Any):
            if isinstance(data, dict) and data.get("error"):
                err = data["error"]
                msg = str(err.get("message") if isinstance(err, dict) else err)[:200]
                from .errors import ProviderRateLimited

                if "rate" in msg.lower() or (isinstance(err, dict) and err.get("code") == 429):
                    return ProviderRateLimited(self.name, msg)
                return ProviderBadResponse(self.name, msg)
            return None

        res = await self.http.request(
            f"alchemy:{chain.key}",
            "POST",
            self._url(chain),
            json_body={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
            cache_ttl=ttl if ttl is not None else self.settings.cache_ttl_chain_seconds,
            json_check=check,
            budget=ctx.budget,
        )
        return res, res.data.get("result")

    async def _block_timestamp(self, chain: ChainConfig, block: int, ctx: FetchContext) -> int:
        _, blk = await self._rpc(chain, "eth_getBlockByNumber", [hex(block), False], ctx, ttl=30 * 24 * 3600)
        if not blk:
            raise ProviderNotFound(self.name, f"block {block} not found")
        return parse_int(blk.get("timestamp"))

    async def block_at_time(
        self, chain: ChainConfig, when: datetime, closest: Literal["before", "after"], ctx: FetchContext
    ) -> int:
        """Binary search over block timestamps (bounded to ~40 calls)."""
        _, head_hex = await self._rpc(chain, "eth_blockNumber", [], ctx, ttl=30)
        lo, hi = 0, parse_int(head_hex)
        target = int(when.timestamp())
        for _ in range(40):
            if lo >= hi:
                break
            mid = (lo + hi + (1 if closest == "before" else 0)) // 2
            ts = await self._block_timestamp(chain, mid, ctx)
            if closest == "before":
                if ts <= target:
                    lo = mid
                else:
                    hi = mid - 1
            else:
                if ts >= target:
                    hi = mid
                else:
                    lo = mid + 1
        return lo

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
    ) -> AddressFetchResult:
        result = AddressFetchResult(chain=chain.key, address=address, transfers=[])
        categories = ["external"]
        if include_internal and chain.alchemy_internal_transfers:
            categories.append("internal")
        elif include_internal:
            result.warnings.append(f"Alchemy does not offer internal transfers on {chain.name}; not included")
        if include_tokens:
            categories.append("erc20")
        for side in ("fromAddress", "toAddress"):
            page_key: str | None = None
            fetched = 0
            while True:
                p: dict[str, Any] = {
                    "fromBlock": hex(block_range.start_block),
                    "toBlock": hex(block_range.end_block) if block_range.end_block is not None else "latest",
                    side: address,
                    "category": categories,
                    "order": "asc",
                    "withMetadata": True,
                    "excludeZeroValue": False,
                    "maxCount": hex(MAX_COUNT),
                }
                if page_key:
                    p["pageKey"] = page_key
                res, r = await self._rpc(chain, "alchemy_getAssetTransfers", [p], ctx)
                r = r or {}
                prov = ctx.provenance(self.name, res)
                items = r.get("transfers") or []
                for it in items:
                    t = self._parse(chain, it, prov)
                    if t is not None:
                        result.transfers.append(t)
                result.endpoints.append(res.url)
                fetched += len(items)
                page_key = r.get("pageKey") or None
                if not page_key:
                    break
                if fetched >= limit:
                    result.truncated = True
                    result.truncated_streams.append(side)
                    result.warnings.append(f"{side}: activity exceeds the per-address cap of {limit} records")
                    break
        result.transfers = dedupe_transfers(result.transfers)
        return result

    def _parse(self, chain: ChainConfig, it: dict[str, Any], prov):
        cat = it.get("category")
        raw_contract = it.get("rawContract") or {}
        raw = parse_int(raw_contract.get("value") or "0x0")
        tx_hash = str(it.get("hash", "")).lower()
        uid = str(it.get("uniqueId") or "")
        disc = uid.split(":", 1)[1] if ":" in uid else uid or "0"
        if cat == "external":
            kind, asset = TransferKind.NATIVE, native_asset(chain)
            disc = "0"
        elif cat == "internal":
            kind, asset = TransferKind.INTERNAL, native_asset(chain)
        elif cat == "erc20":
            dec = raw_contract.get("decimal")
            kind = TransferKind.ERC20
            asset = token_asset(
                chain,
                str(raw_contract.get("address") or ""),
                it.get("asset"),
                None,
                parse_int(dec) if dec not in (None, "") else None,
            )
        else:
            return None
        ts = ts_from_iso((it.get("metadata") or {}).get("blockTimestamp"))
        log_index = None
        if disc.startswith("log:"):
            log_index = parse_int(disc.split(":", 1)[1])
            disc = f"l{log_index}"
        return make_transfer(
            chain=chain,
            tx_hash=tx_hash,
            block_number=parse_int(it.get("blockNum")),
            timestamp=ts,
            from_address=str(it.get("from", "")).lower(),
            to_address=str(it.get("to") or "").lower() or None,
            kind=kind,
            asset=asset,
            raw_amount=raw,
            discriminator=disc,
            provenance=prov,
            log_index=log_index,
        )

    async def transaction(self, chain: ChainConfig, tx_hash: str, ctx: FetchContext) -> TxFetchResult:
        res, tx = await self._rpc(chain, "eth_getTransactionByHash", [tx_hash], ctx)
        if not tx:
            raise ProviderNotFound(self.name, f"transaction {tx_hash} not found on {chain.name}")
        _, receipt = await self._rpc(chain, "eth_getTransactionReceipt", [tx_hash], ctx)
        block = parse_int(tx.get("blockNumber"))
        ts = ts_from_unix(await self._block_timestamp(chain, block, ctx))
        prov = ctx.provenance(self.name, res)
        success = bool(receipt) and parse_int(receipt.get("status", "0x1")) == 1
        frm = str(tx.get("from", "")).lower()
        to = str(tx.get("to") or "").lower() or (str((receipt or {}).get("contractAddress") or "").lower() or None)
        transfers = [
            make_transfer(
                chain=chain,
                tx_hash=tx_hash,
                block_number=block,
                timestamp=ts,
                from_address=frm,
                to_address=to,
                kind=TransferKind.NATIVE,
                asset=native_asset(chain),
                raw_amount=parse_int(tx.get("value")),
                discriminator="0",
                provenance=prov,
                success=success,
            )
        ]
        for lg in (receipt or {}).get("logs") or []:
            topics = [str(t).lower() for t in lg.get("topics") or []]
            if len(topics) == 3 and topics[0] == ERC20_TRANSFER_TOPIC:
                li = parse_int(lg.get("logIndex"))
                transfers.append(
                    make_transfer(
                        chain=chain,
                        tx_hash=tx_hash,
                        block_number=block,
                        timestamp=ts,
                        from_address="0x" + topics[1][-40:],
                        to_address="0x" + topics[2][-40:],
                        kind=TransferKind.ERC20,
                        asset=token_asset(chain, str(lg.get("address", "")), None, None, None),
                        raw_amount=parse_int(lg.get("data") or "0x0"),
                        discriminator=f"l{li}",
                        provenance=prov,
                        log_index=li,
                    )
                )
        return TxFetchResult(
            chain=chain.key,
            tx_hash=tx_hash,
            from_address=frm,
            to_address=to,
            block_number=block,
            timestamp=ts,
            success=success,
            method=None,
            transfers=dedupe_transfers(transfers),
            warnings=["internal (trace) transfers are not fetched by the Alchemy transaction path"],
        )

    async def address_info(self, chain: ChainConfig, address: str, ctx: FetchContext) -> AddressInfo:
        res, code = await self._rpc(chain, "eth_getCode", [address, "latest"], ctx)
        return AddressInfo(
            chain=chain.key,
            address=address,
            is_contract=isinstance(code, str) and code not in ("0x", "0x0", ""),
            provenance=ctx.provenance(self.name, res),
        )

    async def tx_logs(self, chain: ChainConfig, tx_hash: str, ctx: FetchContext) -> list[LogRecord]:
        _, receipt = await self._rpc(chain, "eth_getTransactionReceipt", [tx_hash], ctx)
        return [
            LogRecord(
                address=str(lg.get("address", "")).lower(),
                topics=[str(t).lower() for t in lg.get("topics") or []],
                data=str(lg.get("data") or "0x"),
                log_index=parse_int(lg.get("logIndex")),
                block_hash=str(lg.get("blockHash") or "").lower() or None,
                block_number=parse_int(lg.get("blockNumber")) if lg.get("blockNumber") else None,
                tx_hash=tx_hash,
            )
            for lg in (receipt or {}).get("logs") or []
        ]
