"""Cross-chain tracing: deterministic OP-Stack deposit links + clearly-labelled heuristic candidates.

Classifications
- confirmed: deterministic link derived from documented bridge events AND the destination tx was fetched.
- derived: deterministic link computed, destination not fetched (no provider for that chain / not found yet).
- candidate: heuristic match (timing window, token mapping, fee-adjusted amount, same EOA address).
- unresolved: bridge or privacy-protocol interaction with no defensible link.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import timedelta
from decimal import Decimal
from typing import Any

from ..bridges.op_stack import TRANSACTION_DEPOSITED_TOPIC, decode_deposit_initiated, derive_deposit
from ..chains import CHAINS, ChainConfig
from ..domain.models import Transfer
from ..intel import registry
from ..providers.base import AddressFetchResult, BlockRange, LogRecord, TxFetchResult
from ..providers.errors import ProviderError

LogsFn = Callable[[ChainConfig, str], Awaitable[list[LogRecord]]]
TxFn = Callable[[ChainConfig, str], Awaitable[TxFetchResult]]
AddrFn = Callable[[ChainConfig, str, BlockRange], Awaitable[AddressFetchResult]]
BlockFn = Callable[[ChainConfig, Any, str], Awaitable[int]]
ReadyFn = Callable[[ChainConfig], bool]

PORTALS = {e.address: e for e in registry.BRIDGES if e.role == "portal"}


def find_bridge_interactions(transfers: list[Transfer], node_meta: dict[str, dict[str, Any]], chain: str) -> list[dict[str, Any]]:
    """Transfers into a bridge contract (registry or source-reported 'bridge' label)."""
    out: dict[str, dict[str, Any]] = {}
    for t in transfers:
        if not t.to_address or not t.success or t.raw_int == 0:
            continue  # zero-value calls (e.g. withdraw requests) are interactions, not bridged value
        known = registry.lookup(chain, t.to_address)
        labels = node_meta.get(t.to_address, {}).get("labels") or []
        labelled_bridge = any((lb.get("category") == "bridge") for lb in labels)
        if not known and not labelled_bridge:
            continue
        key = t.tx_hash
        entry = out.setdefault(key, {"tx_hash": t.tx_hash, "chain": chain, "bridge_address": t.to_address,
                                     "bridge_label": known.label if known else next((lb.get("label") for lb in labels
                                                                                  if lb.get("category") == "bridge"), "Bridge"),
                                     "bridge_family": known.bridge_family if known else None,
                                     "destination_chain": known.destination_chain if known else None,
                                     "sender": t.from_address, "transfers": [], "timestamp": t.ts,
                                     "label_source": known.source_url if known else "blockscout-metadata"})
        entry["transfers"].append(t)
    return list(out.values())


def find_privacy_gaps(transfers: list[Transfer], node_meta: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    gaps: dict[str, dict[str, Any]] = {}
    for t in transfers:
        if not t.to_address or not t.success or t.raw_int == 0:
            continue
        labels = node_meta.get(t.to_address, {}).get("labels") or []
        if not any(lb.get("category") == "mixer" for lb in labels):
            continue
        g = gaps.setdefault(t.to_address, {"address": t.to_address, "label": next(lb.get("label") for lb in labels
                                                                                   if lb.get("category") == "mixer"),
                                           "deposits": 0, "transfer_ids": [], "senders": set()})
        g["deposits"] += 1
        g["transfer_ids"].append(t.id)
        g["senders"].add(t.from_address)
    out = []
    for g in gaps.values():
        g["senders"] = sorted(g["senders"])
        g["status"] = "unresolved"
        g["explanation"] = ("Funds entered a mixing/privacy contract. Pooled deposits break the deterministic on-chain "
                            "link between depositor and withdrawer; TRACEFUSE does not claim to trace through it.")
        out.append(g)
    return out


class CrossChainTracer:
    def __init__(self, *, logs: LogsFn, tx: TxFn, address_transfers: AddrFn, block_at: BlockFn, ready: ReadyFn,
                 window_hours: float, tolerance: float, max_candidates: int, target_chains: list[str]):
        self.logs, self.tx, self.address_transfers, self.block_at, self.ready = logs, tx, address_transfers, block_at, ready
        self.window_hours, self.tolerance, self.max_candidates = window_hours, tolerance, max_candidates
        self.target_chains = target_chains
        self.warnings: list[str] = []

    async def trace(self, chain: ChainConfig, interactions: list[dict[str, Any]]) -> list[dict[str, Any]]:
        results = []
        for it in interactions:
            res = await self._trace_one(chain, it)
            results.append(res)
        return results

    async def _trace_one(self, chain: ChainConfig, it: dict[str, Any]) -> dict[str, Any]:
        base = {
            "source_chain": chain.key, "source_tx": it["tx_hash"], "bridge_address": it["bridge_address"],
            "bridge_label": it["bridge_label"], "bridge_family": it["bridge_family"], "sender": it["sender"],
            "destination_chain": it["destination_chain"], "source_timestamp": it["timestamp"],
            "source_transfer_ids": [t.id for t in it["transfers"]], "label_source": it["label_source"],
            "links": [], "evidence_for": [], "evidence_against": [], "status": "unresolved", "method": None,
            "uncertainty": None,
        }
        if it["bridge_family"] == "op-stack":
            try:
                det = await self._op_stack(chain, it, base)
                if det:
                    return base
            except ProviderError as exc:
                base["evidence_against"].append(f"could not read source logs: {exc.message}")
        await self._heuristic(chain, it, base)
        return base

    async def _op_stack(self, chain: ChainConfig, it: dict[str, Any], base: dict[str, Any]) -> bool:
        logs = await self.logs(chain, it["tx_hash"])
        deposits = [lg for lg in logs if lg.topics and lg.topics[0] == TRANSACTION_DEPOSITED_TOPIC and lg.address in PORTALS]
        if not deposits:
            base["evidence_against"].append("no TransactionDeposited event from a documented OptimismPortal in this tx")
            return False
        intents = [d for d in (decode_deposit_initiated(lg.topics, lg.data) for lg in logs) if d]
        for lg in deposits:
            if not lg.block_hash:
                base["evidence_against"].append("log lacks block hash; cannot derive deposit hash")
                continue
            dep = derive_deposit(l1_tx_hash=it["tx_hash"], l1_block_hash=lg.block_hash, log_index=lg.log_index,
                                 topics=lg.topics, data=lg.data)
            dest_key = PORTALS[lg.address].destination_chain or "optimism"
            dest = CHAINS.get(dest_key)
            link: dict[str, Any] = {
                "destination_chain": dest_key, "destination_tx": dep.l2_tx_hash, "l1_log_index": dep.l1_log_index,
                "source_hash": dep.source_hash, "mint_wei": str(dep.mint), "deposit_value_wei": str(dep.value),
                "recipient": None, "amount": None, "asset": None,
                "destination_explorer_url": dest.explorer_tx_url(dep.l2_tx_hash) if dest else None,
            }
            if intents:
                link["recipient"] = intents[0]["to"]
                link["amount"] = str(intents[0]["amount"])
                link["asset"] = intents[0]["asset"]
            base["method"] = "op-stack deposit derivation (TransactionDeposited → sourceHash → L2 deposit tx hash)"
            base["evidence_for"].append(
                f"OptimismPortal {lg.address} emitted TransactionDeposited (log {lg.log_index}); L2 hash derived per OP spec")
            status = "derived"
            if dest is not None and self.ready(dest):
                try:
                    l2 = await self.tx(dest, dep.l2_tx_hash)
                    status = "confirmed"
                    link["destination_timestamp"] = l2.timestamp.timestamp() if l2.timestamp else None
                    link["destination_transfers"] = [t.model_dump(mode="json") for t in l2.transfers if t.raw_int > 0][:20]
                    link["destination_success"] = l2.success
                    base["evidence_for"].append(f"derived L2 transaction {dep.l2_tx_hash} exists on {dest.name}")
                except ProviderError as exc:
                    base["evidence_against"].append(f"derived L2 tx not fetched on {dest_key}: {exc.message}")
            else:
                base["evidence_against"].append(f"no configured provider for {dest_key}; L2 tx not fetched (hash still deterministic)")
            link["status"] = status
            base["links"].append(link)
        if base["links"]:
            base["status"] = "confirmed" if any(lk["status"] == "confirmed" for lk in base["links"]) else "derived"
            base["uncertainty"] = ("Deterministic derivation from documented events; the recipient shown is the L2 "
                                   "deposit target and may be a bridge/messenger predeploy that forwards to the user.")
            return True
        return False

    async def _heuristic(self, chain: ChainConfig, it: dict[str, Any], base: dict[str, Any]) -> None:
        src_ts = it["timestamp"]
        value_tx = [t for t in it["transfers"] if t.raw_int > 0]
        if src_ts is None or not value_tx:
            base["evidence_against"].append("no timestamped value transfer into the bridge; nothing to match")
            return
        src = max(value_tx, key=lambda t: t.raw_int)
        econ = src.asset.economic_asset
        dests = [it["destination_chain"]] if it["destination_chain"] else list(self.target_chains)
        base["method"] = (f"heuristic: same recipient address on destination, arrival within {self.window_hours}h, "
                          f"same economic asset ({econ}), amount ≤ source and within {self.tolerance:.0%} (fees)")
        candidates = []
        for dkey in dests:
            dest = CHAINS.get(dkey)
            if dest is None or dest.key == chain.key:
                continue
            if not self.ready(dest):
                base["evidence_against"].append(f"no configured provider for {dkey}; candidates not searched")
                continue
            if econ is None:
                base["evidence_against"].append("source asset is not in the canonical token registry; no token mapping")
                continue
            from datetime import UTC, datetime
            start_dt = datetime.fromtimestamp(src_ts, UTC)
            try:
                b0 = await self.block_at(dest, start_dt, "after")
                b1 = await self.block_at(dest, start_dt + timedelta(hours=self.window_hours), "before")
                fetched = await self.address_transfers(dest, it["sender"], BlockRange(b0, b1))
            except ProviderError as exc:
                base["evidence_against"].append(f"{dkey}: {exc.message}")
                continue
            for t in fetched.transfers:
                if t.to_address != it["sender"] or t.raw_int == 0 or t.asset.economic_asset != econ or t.ts is None:
                    continue
                if t.asset.decimals is None or src.asset.decimals is None:
                    continue
                a_src = Decimal(src.raw_int).scaleb(-src.asset.decimals)
                a_dst = Decimal(t.raw_int).scaleb(-t.asset.decimals)
                if a_dst > a_src or a_src == 0:
                    continue
                rel = float((a_src - a_dst) / a_src)
                if rel > self.tolerance:
                    continue
                delay = t.ts - src_ts
                candidates.append({"destination_chain": dkey, "destination_tx": t.tx_hash, "destination_transfer": t.id,
                                   "recipient": t.to_address, "amount": t.amount, "asset": t.asset.symbol,
                                   "relative_amount_difference": round(rel, 6), "delay_seconds": delay,
                                   "destination_sender": t.from_address, "destination_explorer_url": t.explorer_url,
                                   "status": "candidate"})
        candidates.sort(key=lambda c: (c["relative_amount_difference"], c["delay_seconds"]))
        candidates = candidates[: self.max_candidates]
        if candidates:
            base["status"] = "candidate"
            base["links"] = candidates
            base["evidence_for"].append("arrival(s) to the same address with fee-consistent amount inside the window")
            if len(candidates) > 1:
                base["evidence_against"].append(f"{len(candidates)} competing candidates — ambiguity lowers confidence")
            base["evidence_against"].append("same address on two chains only implies the same controller for EOAs; "
                                            "the recipient could also be a different user")
            base["uncertainty"] = "Heuristic candidate — not a confirmed transfer."
        else:
            base["evidence_against"].append("no matching arrival found within the window/tolerance")
            base["uncertainty"] = "Unresolved: bridge interaction observed but no defensible destination link."
