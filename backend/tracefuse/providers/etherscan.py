"""Etherscan API V2 adapter (requires ``ETHERSCAN_API_KEY``).

Single endpoint ``https://api.etherscan.io/v2/api`` with a ``chainid`` parameter. Per Etherscan's
supported-chains page (checked 2026-10-17) Ethereum (1) and Arbitrum One (42161) are on the free tier
while OP Mainnet (10) and Base (8453) are paid-tier only; plan errors surface as ``auth_error``.
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
    ts_from_unix,
)
from .errors import ProviderBadResponse, ProviderNotFound, ProviderUnconfigured
from .etherscan_compat import (
    etherscan_json_check,
    paginate_account_action,
    parse_tokentx,
    parse_txlist,
    parse_txlistinternal,
)

BASE_URL = "https://api.etherscan.io/v2/api"
PAGE_SIZE = 1000
ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


class EtherscanV2Provider(ChainProvider):
    name = "etherscan"
    requires_credential = "ETHERSCAN_API_KEY"

    def is_configured(self) -> bool:
        k = self.settings.etherscan_api_key
        return k is not None and bool(k.get_secret_value())

    def supports_chain(self, chain: ChainConfig) -> bool:
        return chain.etherscan_supported

    def _key(self) -> str:
        if not self.is_configured():
            raise ProviderUnconfigured(self.name, "ETHERSCAN_API_KEY is not set")
        assert self.settings.etherscan_api_key is not None
        return self.settings.etherscan_api_key.get_secret_value()

    async def _call(self, chain: ChainConfig, params: dict[str, Any], ctx: FetchContext, ttl: int | None = None):
        full = {"chainid": chain.chain_id, **params, "apikey": self._key()}
        return await self.http.request(
            f"etherscan:{chain.key}",
            "GET",
            BASE_URL,
            params=full,
            cache_ttl=ttl if ttl is not None else self.settings.cache_ttl_chain_seconds,
            json_check=etherscan_json_check(self.name),
            budget=ctx.budget,
        )

    async def _proxy(self, chain: ChainConfig, action: str, ctx: FetchContext, **params: Any) -> Any:
        res = await self._call(chain, {"module": "proxy", "action": action, **params}, ctx)
        data = res.data
        if isinstance(data, dict) and "error" in data:
            raise ProviderBadResponse(self.name, str(data["error"])[:200])
        return res, (data.get("result") if isinstance(data, dict) else None)

    async def block_at_time(
        self, chain: ChainConfig, when: datetime, closest: Literal["before", "after"], ctx: FetchContext
    ) -> int:
        res = await self._call(
            chain,
            {"module": "block", "action": "getblocknobytime", "timestamp": int(when.timestamp()), "closest": closest},
            ctx,
            ttl=30 * 24 * 3600,
        )
        r = res.data.get("result")
        return parse_int(r.get("blockNumber") if isinstance(r, dict) else r)

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
        actions: list[tuple[str, Any]] = [("txlist", parse_txlist)]
        if include_internal:
            actions.append(("txlistinternal", parse_txlistinternal))
        if include_tokens:
            actions.append(("tokentx", parse_tokentx))
        for action, parser in actions:

            async def fetch(page: int, size: int, action: str = action):
                params: dict[str, Any] = {
                    "module": "account",
                    "action": action,
                    "address": address,
                    "startblock": block_range.start_block,
                    "endblock": block_range.end_block if block_range.end_block is not None else 999_999_999,
                    "sort": "asc",
                    "page": page,
                    "offset": size,
                }
                return await self._call(chain, params, ctx)

            pages, truncated = await paginate_account_action(fetch, PAGE_SIZE, limit)
            items = [it for _, page_items in pages for it in page_items]
            first = min((p[0] for p in pages), key=lambda r: r.retrieved_at)
            result.transfers.extend(parser(chain, items, ctx.provenance(self.name, first)))
            result.endpoints.extend(p[0].url for p in pages)
            if truncated:
                result.truncated = True
                result.truncated_streams.append(action)
                result.warnings.append(f"{action}: activity exceeds the per-address cap of {limit} records")
        result.transfers = dedupe_transfers(result.transfers)
        return result

    async def transaction(self, chain: ChainConfig, tx_hash: str, ctx: FetchContext) -> TxFetchResult:
        res, tx = await self._proxy(chain, "eth_getTransactionByHash", ctx, txhash=tx_hash)
        if not tx:
            raise ProviderNotFound(self.name, f"transaction {tx_hash} not found on {chain.name}")
        _, receipt = await self._proxy(chain, "eth_getTransactionReceipt", ctx, txhash=tx_hash)
        block = parse_int(tx.get("blockNumber"))
        _, blk = await self._proxy(chain, "eth_getBlockByNumber", ctx, tag=hex(block), boolean="false")
        ts = ts_from_unix(parse_int(blk.get("timestamp"))) if isinstance(blk, dict) else None
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
                method=(str(tx.get("input", ""))[:10] or None) if tx.get("input") not in (None, "0x") else None,
            )
        ]
        for lg in (receipt or {}).get("logs") or []:
            topics = [str(t).lower() for t in lg.get("topics") or []]
            if len(topics) == 3 and topics[0] == ERC20_TRANSFER_TOPIC:
                contract = str(lg.get("address", "")).lower()
                li = parse_int(lg.get("logIndex"))
                asset = token_asset(chain, contract, None, None, None)
                transfers.append(
                    make_transfer(
                        chain=chain,
                        tx_hash=tx_hash,
                        block_number=block,
                        timestamp=ts,
                        from_address="0x" + topics[1][-40:],
                        to_address="0x" + topics[2][-40:],
                        kind=TransferKind.ERC20,
                        asset=asset,
                        raw_amount=parse_int(lg.get("data") or "0x0"),
                        discriminator=f"l{li}",
                        provenance=prov,
                        log_index=li,
                    )
                )
        ires = await self._call(chain, {"module": "account", "action": "txlistinternal", "txhash": tx_hash}, ctx)
        items = ires.data.get("result") if isinstance(ires.data.get("result"), list) else []
        for it in items:
            it.setdefault("hash", tx_hash)
        transfers.extend(parse_txlistinternal(chain, items, ctx.provenance(self.name, ires)))
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
            warnings=["token symbols/decimals for non-registry tokens are not resolved by the Etherscan proxy path"],
        )

    async def address_info(self, chain: ChainConfig, address: str, ctx: FetchContext) -> AddressInfo:
        res, code = await self._proxy(chain, "eth_getCode", ctx, address=address, tag="latest")
        is_contract = isinstance(code, str) and code not in ("0x", "0x0", "")
        return AddressInfo(
            chain=chain.key, address=address, is_contract=is_contract, provenance=ctx.provenance(self.name, res)
        )

    async def tx_logs(self, chain: ChainConfig, tx_hash: str, ctx: FetchContext) -> list[LogRecord]:
        _, receipt = await self._proxy(chain, "eth_getTransactionReceipt", ctx, txhash=tx_hash)
        out: list[LogRecord] = []
        for lg in (receipt or {}).get("logs") or []:
            out.append(
                LogRecord(
                    address=str(lg.get("address", "")).lower(),
                    topics=[str(t).lower() for t in lg.get("topics") or []],
                    data=str(lg.get("data") or "0x"),
                    log_index=parse_int(lg.get("logIndex")),
                    block_hash=str(lg.get("blockHash") or "").lower() or None,
                    block_number=parse_int(lg.get("blockNumber")) if lg.get("blockNumber") else None,
                    tx_hash=tx_hash,
                )
            )
        return out
