"""Blockscout adapter (keyless public instances).

Uses two documented Blockscout surfaces:
- Etherscan-compatible RPC API ``/api?module=account&action=txlist|txlistinternal|tokentx`` — supports
  ``startblock``/``endblock`` windows and page/offset pagination.
- REST API v2 ``/api/v2/...`` — transaction detail, token transfers of a tx, address metadata (public
  labels, contract flag) and event logs (with ``block_hash``/``index`` needed for OP-Stack deposit
  derivation). v2 pagination uses ``next_page_params``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from ..chains import ChainConfig
from ..domain.amounts import parse_int
from ..domain.models import AddressInfo, SourceLabel, TransferKind
from .base import (
    AddressFetchResult,
    BlockRange,
    ChainProvider,
    FetchContext,
    LogRecord,
    OccurrenceCounter,
    TxFetchResult,
    dedupe_transfers,
    make_transfer,
    native_asset,
    token_asset,
    ts_from_iso,
)
from .errors import ProviderNotFound, ProviderUnsupported
from .etherscan_compat import (
    etherscan_json_check,
    paginate_account_action,
    parse_tokentx,
    parse_txlist,
    parse_txlistinternal,
)

PAGE_SIZE = 500
V2_MAX_PAGES = 10

# Blockscout metadata tag slugs that indicate a service / infrastructure role.
SERVICE_SLUGS = {
    "bridge": "bridge",
    "mixer": "mixer",
    "exchange": "exchange",
    "cex": "exchange",
    "dex": "dex",
    "dex-aggregator": "dex",
    "aggregator": "dex",
}
RISK_SLUGS = {"exploit", "sanctioned", "blocked", "phish-hack", "phishing", "scam", "hack", "heist", "exploiter"}


def _label_category(tag: dict[str, Any]) -> str | None:
    slug = str(tag.get("slug") or "").lower()
    ttype = str(tag.get("tagType") or "").lower()
    if slug in SERVICE_SLUGS:
        return SERVICE_SLUGS[slug]
    if slug in RISK_SLUGS:
        return slug
    if ttype == "protocol":
        return "protocol"
    if ttype == "note":
        return "note"
    if ttype == "name":
        return "name"
    return ttype or None


def parse_blockscout_tags(address_obj: dict[str, Any], explorer_url: str, retrieved_at: datetime) -> list[SourceLabel]:
    labels: list[SourceLabel] = []
    meta = address_obj.get("metadata") or {}
    for tag in meta.get("tags") or []:
        if not isinstance(tag, dict):
            continue
        tmeta = tag.get("meta") or {}
        name = str(tag.get("name") or "").strip()
        if not name:
            continue
        note_parts: list[str] = []
        if isinstance(tmeta, dict):
            if tmeta.get("data"):
                note_parts.append(str(tmeta["data"])[:300])
            info = tmeta.get("info")
            if isinstance(info, list):
                note_parts.append("; ".join(str(i)[:80] for i in info[:6]))
            if tmeta.get("tooltipDescription"):
                note_parts.append(str(tmeta["tooltipDescription"])[:200])
            if tmeta.get("tooltipAttribution"):
                note_parts.append(f"attribution: {str(tmeta['tooltipAttribution'])[:200]}")
        cat = _label_category(tag)
        if cat == "note" and note_parts:
            name = note_parts[0][:120]
        labels.append(
            SourceLabel(
                label=name[:120],
                category=cat,
                source="blockscout-metadata",
                source_url=explorer_url,
                retrieved_at=retrieved_at,
                note=" | ".join(p for p in note_parts if p)[:500] or None,
            )
        )
    for pt in address_obj.get("public_tags") or []:
        if isinstance(pt, dict) and pt.get("display_name"):
            labels.append(
                SourceLabel(
                    label=str(pt["display_name"])[:120],
                    category=str(pt.get("label") or "public_tag")[:40],
                    source="blockscout-public-tags",
                    source_url=explorer_url,
                    retrieved_at=retrieved_at,
                )
            )
    if address_obj.get("is_scam"):
        labels.append(
            SourceLabel(
                label="Flagged as scam by explorer",
                category="scam",
                source="blockscout-metadata",
                source_url=explorer_url,
                retrieved_at=retrieved_at,
            )
        )
    return labels


class BlockscoutProvider(ChainProvider):
    name = "blockscout"

    def is_configured(self) -> bool:
        return True  # keyless

    def supports_chain(self, chain: ChainConfig) -> bool:
        return chain.blockscout_base is not None

    def _base(self, chain: ChainConfig) -> str:
        if not chain.blockscout_base:
            raise ProviderUnsupported(self.name, f"no Blockscout instance configured for {chain.name}")
        return chain.blockscout_base

    def _pid(self, chain: ChainConfig) -> str:
        return f"blockscout:{chain.key}"

    async def _rpc(self, chain: ChainConfig, params: dict[str, Any], ctx: FetchContext, ttl: int | None = None):
        return await self.http.request(
            self._pid(chain),
            "GET",
            f"{self._base(chain)}/api",
            params=params,
            cache_ttl=ttl if ttl is not None else self.settings.cache_ttl_chain_seconds,
            json_check=etherscan_json_check(self.name),
            budget=ctx.budget,
        )

    async def _v2(self, chain: ChainConfig, path: str, ctx: FetchContext, params: dict[str, Any] | None = None):
        return await self.http.request(
            self._pid(chain),
            "GET",
            f"{self._base(chain)}/api/v2{path}",
            params=params,
            cache_ttl=self.settings.cache_ttl_chain_seconds,
            budget=ctx.budget,
        )

    # -----------------------------------------------------------------------------------------
    async def block_at_time(
        self, chain: ChainConfig, when: datetime, closest: Literal["before", "after"], ctx: FetchContext
    ) -> int:
        res = await self._rpc(
            chain,
            {"module": "block", "action": "getblocknobytime", "timestamp": int(when.timestamp()), "closest": closest},
            ctx,
            ttl=30 * 24 * 3600,
        )
        r = res.data.get("result")
        if isinstance(r, dict):
            return parse_int(r.get("blockNumber"))
        return parse_int(r)

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
        """Page REST v2 address streams newest→oldest inside the block window.

        The v2 keyset cursor (``block_number``/``index``) is seeded with ``end_block + 1`` so paging starts at the
        window end (verified against eth.blockscout.com 2026-10-17); paging stops once items fall before
        ``start_block``. The RPC ``/api?module=account`` path is avoided for traversal because its public rate
        limit (10 requests per ~2 minutes observed) is too low for multi-address tracing.
        """
        result = AddressFetchResult(chain=chain.key, address=address, transfers=[])

        async def page_stream(stream: str, extra: dict[str, Any], cap: int):
            items: list[dict[str, Any]] = []
            params: dict[str, Any] = dict(extra)
            if block_range.end_block is not None:
                params.update({"block_number": block_range.end_block + 1, "index": 0, "items_count": 50})
                if stream == "internal-transactions":
                    params["transaction_index"] = 0
            first = None
            while True:
                res = await self._v2(chain, f"/addresses/{address}/{stream}", ctx, params or None)
                first = first or res
                result.endpoints.append(res.url)
                stop = False
                for it in res.data.get("items") or []:
                    bn = parse_int(it.get("block_number"))
                    if bn < block_range.start_block:
                        stop = True
                        break
                    if block_range.end_block is not None and bn > block_range.end_block:
                        continue
                    items.append(it)
                nxt = res.data.get("next_page_params")
                if stop or not nxt:
                    return items, False, first
                if len(items) >= cap:
                    return items, True, first
                params = {**extra, **nxt}

        streams = ["transactions"]
        if include_internal:
            streams.append("internal-transactions")
        if include_tokens:
            streams.append("token-transfers")
        for stream in streams:
            if stream == "token-transfers":
                items, truncated, first = await page_stream(stream, {}, min(limit, 1000))
                if truncated and chain.known_tokens:
                    # Spam airdrops can flood the token stream; fetch canonical tokens separately and completely.
                    spam = [it for it in items if not chain.token(str((it.get("token") or {}).get("address_hash") or ""))]
                    canonical: list[dict[str, Any]] = []
                    truncated = False
                    for tok in chain.known_tokens:
                        its, tr, _ = await page_stream(stream, {"token": tok.address}, limit)
                        canonical.extend(its)
                        truncated |= tr
                    items = spam + canonical
                    result.warnings.append(
                        f"token-transfers: >{min(limit, 1000)} records, mostly non-canonical tokens (possible spam); "
                        "canonical tokens were fetched separately"
                        + ("" if not truncated else " but still exceed the cap")
                        + "; non-canonical token records are incomplete")
            else:
                items, truncated, first = await page_stream(stream, {}, limit)
            if first is None:
                continue
            prov = ctx.provenance(self.name, first)
            if stream == "transactions":
                result.transfers.extend(self._parse_v2_txs(chain, items, prov))
            elif stream == "internal-transactions":
                result.transfers.extend(self._parse_v2_internal(chain, items, prov))
            else:
                result.transfers.extend(self._parse_v2_token_transfers(chain, items, prov))
            for it in items:
                for side in ("from", "to"):
                    obj = it.get(side)
                    if isinstance(obj, dict) and obj.get("hash"):
                        a = str(obj["hash"]).lower()
                        if a not in result.counterparty_info:
                            result.counterparty_info[a] = AddressInfo(
                                chain=chain.key, address=a, is_contract=obj.get("is_contract"), name=obj.get("name"),
                                labels=parse_blockscout_tags(obj, chain.explorer_address_url(a), first.retrieved_at),
                                provenance=prov)
            if truncated:
                result.truncated = True
                result.truncated_streams.append(stream)
                result.warnings.append(
                    f"{stream}: activity exceeds the per-address cap of {limit} records in the window; older records not fetched")
        result.transfers = dedupe_transfers(result.transfers)
        return result

    def _parse_v2_txs(self, chain: ChainConfig, items: list[dict[str, Any]], prov):
        out = []
        asset = native_asset(chain)
        for it in items:
            frm = str((it.get("from") or {}).get("hash", "")).lower()
            to = str((it.get("to") or {}).get("hash") or (it.get("created_contract") or {}).get("hash") or "").lower() or None
            tx_hash = str(it.get("hash", "")).lower()
            if not frm or not tx_hash:
                continue
            out.append(make_transfer(
                chain=chain, tx_hash=tx_hash, block_number=parse_int(it.get("block_number")),
                timestamp=ts_from_iso(it.get("timestamp")), from_address=frm, to_address=to,
                kind=TransferKind.NATIVE, asset=asset, raw_amount=parse_int(it.get("value")), discriminator="0",
                provenance=prov, success=str(it.get("status", "ok")) == "ok", method=it.get("method")))
        return out

    def _parse_v2_internal(self, chain: ChainConfig, items: list[dict[str, Any]], prov):
        out = []
        asset = native_asset(chain)
        for it in items:
            value = parse_int(it.get("value"))
            if value == 0:
                continue
            frm = str((it.get("from") or {}).get("hash", "")).lower()
            to = str((it.get("to") or {}).get("hash") or (it.get("created_contract") or {}).get("hash") or "").lower() or None
            tx_hash = str(it.get("transaction_hash", "")).lower()
            idx = it.get("index")
            out.append(make_transfer(
                chain=chain, tx_hash=tx_hash, block_number=parse_int(it.get("block_number")),
                timestamp=ts_from_iso(it.get("timestamp")), from_address=frm, to_address=to,
                kind=TransferKind.INTERNAL, asset=asset, raw_amount=value, discriminator=str(idx),
                provenance=prov, success=bool(it.get("success", True)), trace_index=str(idx)))
        return out

    async def transaction(self, chain: ChainConfig, tx_hash: str, ctx: FetchContext) -> TxFetchResult:
        res = await self._v2(chain, f"/transactions/{tx_hash}", ctx)
        d = res.data
        if not isinstance(d, dict) or "hash" not in d:
            raise ProviderNotFound(self.name, f"transaction {tx_hash} not found on {chain.name}")
        prov = ctx.provenance(self.name, res)
        frm = str((d.get("from") or {}).get("hash", "")).lower()
        to_obj = d.get("to") or {}
        to = str(to_obj.get("hash") or "").lower() or None
        created = (d.get("created_contract") or {}).get("hash")
        if to is None and created:
            to = str(created).lower()
        block = parse_int(d.get("block_number") or d.get("block"))
        ts = ts_from_iso(d.get("timestamp"))
        success = str(d.get("status", "ok")) == "ok"
        method = d.get("method")
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
                raw_amount=parse_int(d.get("value")),
                discriminator="0",
                provenance=prov,
                success=success,
                method=method,
            )
        ]
        warnings: list[str] = []
        # token transfers of this tx (paginated v2 endpoint)
        token_items: list[dict[str, Any]] = []
        params: dict[str, Any] | None = None
        for _ in range(V2_MAX_PAGES):
            tres = await self._v2(chain, f"/transactions/{tx_hash}/token-transfers", ctx, params)
            token_items.extend(tres.data.get("items") or [])
            nxt = tres.data.get("next_page_params")
            if not nxt:
                break
            params = nxt
        else:
            warnings.append("token transfers of this transaction exceed the page cap; list truncated")
        transfers.extend(self._parse_v2_token_transfers(chain, token_items, prov))
        # internal value transfers of this tx via the RPC API
        ires = await self._rpc(chain, {"module": "account", "action": "txlistinternal", "txhash": tx_hash}, ctx)
        items = ires.data.get("result") if isinstance(ires.data.get("result"), list) else []
        for it in items:
            it.setdefault("hash", tx_hash)
            it.setdefault("blockNumber", block)
        transfers.extend(parse_txlistinternal(chain, items, ctx.provenance(self.name, ires)))
        return TxFetchResult(
            chain=chain.key,
            tx_hash=tx_hash,
            from_address=frm,
            to_address=to,
            block_number=block,
            timestamp=ts,
            success=success,
            method=method,
            transfers=dedupe_transfers(transfers),
            warnings=warnings,
            to_is_contract=to_obj.get("is_contract") if isinstance(to_obj, dict) else None,
        )

    def _parse_v2_token_transfers(self, chain: ChainConfig, items: list[dict[str, Any]], prov):
        out = []
        occ = OccurrenceCounter()
        for it in items:
            tok = it.get("token") or {}
            contract = str(tok.get("address_hash") or tok.get("address") or "").lower()
            if not contract:
                continue
            ttype = str(tok.get("type") or it.get("token_type") or "ERC-20").lower().replace("-", "")
            total = it.get("total") or {}
            is_nft = ttype in ("erc721", "erc1155") or ("token_id" in total and "value" not in total)
            dec = total.get("decimals") or tok.get("decimals")
            decimals = parse_int(dec) if dec not in (None, "") else None
            raw = parse_int(total.get("value")) if not is_nft or total.get("value") else 1
            kind = TransferKind.ERC20
            if ttype == "erc721":
                kind = TransferKind.ERC721
            elif ttype == "erc1155":
                kind = TransferKind.ERC1155
            asset = token_asset(
                chain, contract, tok.get("symbol"), tok.get("name"), 0 if is_nft else decimals, ttype
            )
            li = it.get("log_index")
            log_index = parse_int(li) if li not in (None, "") else None
            tx_hash = str(it.get("transaction_hash") or it.get("tx_hash") or "").lower()
            frm = str((it.get("from") or {}).get("hash", "")).lower()
            to = str((it.get("to") or {}).get("hash", "")).lower() or None
            disc = f"l{log_index}" if log_index is not None else f"o{occ.next(tx_hash, contract, frm, to, raw)}"
            out.append(
                make_transfer(
                    chain=chain,
                    tx_hash=tx_hash,
                    block_number=parse_int(it.get("block_number")),
                    timestamp=ts_from_iso(it.get("timestamp")),
                    from_address=frm,
                    to_address=to,
                    kind=kind,
                    asset=asset,
                    raw_amount=raw,
                    discriminator=disc,
                    provenance=prov,
                    method=it.get("method"),
                    log_index=log_index,
                )
            )
        return out

    async def address_info(self, chain: ChainConfig, address: str, ctx: FetchContext) -> AddressInfo:
        try:
            res = await self._v2(chain, f"/addresses/{address}", ctx)
        except ProviderNotFound:
            return AddressInfo(chain=chain.key, address=address, is_contract=None)
        d = res.data if isinstance(res.data, dict) else {}
        url = chain.explorer_address_url(address)
        return AddressInfo(
            chain=chain.key,
            address=address,
            is_contract=bool(d.get("is_contract")) if "is_contract" in d else None,
            name=(d.get("name") or None),
            labels=parse_blockscout_tags(d, url, res.retrieved_at),
            provenance=ctx.provenance(self.name, res),
        )

    async def tx_logs(self, chain: ChainConfig, tx_hash: str, ctx: FetchContext) -> list[LogRecord]:
        logs: list[LogRecord] = []
        params: dict[str, Any] | None = None
        for _ in range(V2_MAX_PAGES):
            res = await self._v2(chain, f"/transactions/{tx_hash}/logs", ctx, params)
            for it in res.data.get("items") or []:
                addr = it.get("address") or {}
                decoded = it.get("decoded") or {}
                logs.append(
                    LogRecord(
                        address=str(addr.get("hash") if isinstance(addr, dict) else addr).lower(),
                        topics=[str(t).lower() for t in (it.get("topics") or []) if t],
                        data=str(it.get("data") or "0x"),
                        log_index=parse_int(it.get("index")),
                        block_hash=(str(it["block_hash"]).lower() if it.get("block_hash") else None),
                        block_number=parse_int(it.get("block_number")) if it.get("block_number") else None,
                        tx_hash=tx_hash,
                        decoded_name=(decoded.get("method_call") if isinstance(decoded, dict) else None),
                    )
                )
            nxt = res.data.get("next_page_params")
            if not nxt:
                break
            params = nxt
        return logs
