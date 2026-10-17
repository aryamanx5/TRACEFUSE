"""Bounded breadth-first acquisition of the transfer neighbourhood around the seed(s)."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from ..chains import ChainConfig
from ..domain.models import AddressInfo, ExpansionStatus, InvestigationConfig, Transfer
from ..intel import registry
from ..providers.base import BlockRange, ChainProvider, FetchContext, dedupe_transfers
from ..providers.errors import BudgetExhausted, ProviderError

Emit = Callable[[str, str, str, dict[str, Any]], Awaitable[None]]


@dataclass
class NodeState:
    address: str
    hop: int
    direction: str
    status: ExpansionStatus = ExpansionStatus.NOT_EXPANDED
    is_contract: bool | None = None
    name: str | None = None
    labels: list[dict[str, Any]] = field(default_factory=list)
    fetched: int = 0
    note: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"address": self.address, "discovered_hop": self.hop, "direction": self.direction,
                "expansion_status": self.status.value, "is_contract": self.is_contract, "name": self.name,
                "labels": self.labels, "fetched_records": self.fetched, "note": self.note}


def rank_counterparties(transfers: list[Transfer], address: str, direction: str, *, include_unrecognised: bool,
                        min_share: float) -> list[tuple[str, float, int]]:
    """(counterparty, max value share across assets, transfer count), best first."""
    totals: dict[str, int] = defaultdict(int)
    per: dict[tuple[str, str], int] = defaultdict(int)
    counts: dict[str, int] = defaultdict(int)
    for t in transfers:
        if not t.success or t.raw_int == 0 or not t.to_address or t.is_self_transfer:
            continue
        if not include_unrecognised and not t.asset.recognised:
            continue
        if direction == "forward" and t.from_address == address:
            cp = t.to_address
        elif direction == "backward" and t.to_address == address:
            cp = t.from_address
        else:
            continue
        totals[t.asset.key] += t.raw_int
        per[(cp, t.asset.key)] += t.raw_int
        counts[cp] += 1
    shares: dict[str, float] = defaultdict(float)
    for (cp, asset), raw in per.items():
        if totals[asset]:
            shares[cp] = max(shares[cp], float(Decimal(raw) / Decimal(totals[asset])))
    ranked = [(cp, s, counts[cp]) for cp, s in shares.items() if s >= min_share]
    ranked.sort(key=lambda x: (-x[1], -x[2], x[0]))
    return ranked


class Traverser:
    def __init__(self, *, provider: ChainProvider, chain: ChainConfig, config: InvestigationConfig, ctx: FetchContext,
                 block_range: BlockRange, emit: Emit, info_budget: int, mixer_labels: dict[str, dict[str, Any]]):
        self.provider, self.chain, self.config, self.ctx = provider, chain, config, ctx
        self.block_range, self.emit = block_range, emit
        self.info_budget = info_budget
        self.mixer_labels = mixer_labels
        self.nodes: dict[str, NodeState] = {}
        self.transfers: list[Transfer] = []
        self.warnings: list[str] = []
        self.partial = False
        self._sem = asyncio.Semaphore(3)
        self.info_cache: dict[str, AddressInfo] = {}

    def static_labels(self, address: str) -> list[dict[str, Any]]:
        out = []
        known = registry.lookup(self.chain.key, address)
        if known:
            out.append(registry.registry_label(known).model_dump(mode="json"))
        if address in self.mixer_labels:
            out.append(self.mixer_labels[address])
        return out

    async def address_info(self, address: str) -> AddressInfo | None:
        if address in self.info_cache:
            return self.info_cache[address]
        if self.info_budget <= 0:
            return None
        self.info_budget -= 1
        try:
            info = await self.provider.address_info(self.chain, address, self.ctx)
        except BudgetExhausted:
            raise
        except ProviderError as exc:
            self.warnings.append(f"address info for {address} unavailable: {exc.message}")
            return None
        self.info_cache[address] = info
        return info

    def _is_service(self, st: NodeState) -> str | None:
        for lb in st.labels:
            if lb.get("category") in registry.SERVICE_CATEGORIES:
                return f"{lb.get('category')}: {lb.get('label')}"
        return None

    async def _enrich(self, st: NodeState) -> None:
        st.labels = self.static_labels(st.address)
        info = await self.address_info(st.address)
        if info is not None:
            st.is_contract = info.is_contract
            st.name = info.name
            st.labels.extend(lb.model_dump(mode="json") for lb in info.labels)

    async def _fetch(self, st: NodeState) -> list[Transfer]:
        async with self._sem:
            res = await self.provider.address_transfers(
                self.chain, st.address, self.block_range, include_internal=self.config.include_internal,
                include_tokens=self.config.include_tokens, limit=self.config.max_transfers_per_address, ctx=self.ctx)
        st.fetched = len(res.transfers)
        for a, info in res.counterparty_info.items():
            self.info_cache.setdefault(a, info)
        self.warnings.extend(f"{st.address}: {w}" for w in res.warnings)
        if res.truncated and st.status == ExpansionStatus.SEED:
            st.note = "seed activity exceeds per-address cap; oldest records in the window were not fetched"
            self.partial = True
        elif res.truncated:
            st.status = ExpansionStatus.TRUNCATED
            st.note = "activity exceeds per-address cap; counterparties not expanded further (likely a service)"
            self.partial = True
        return res.transfers

    async def run(self, seeds: list[str]) -> None:
        directions = ["forward", "backward"] if self.config.direction == "both" else [self.config.direction]
        for s in seeds:
            st = NodeState(s, 0, self.config.direction, ExpansionStatus.SEED)
            self.nodes[s] = st
        await asyncio.gather(*(self._enrich(self.nodes[s]) for s in seeds))
        frontier: dict[str, list[str]] = {d: list(seeds) for d in directions}
        for hop in range(self.config.max_hops):
            fetch_now = sorted({a for d in directions for a in frontier[d]})
            if not fetch_now:
                break
            await self.emit("acquire", "progress", f"hop {hop}: fetching {len(fetch_now)} address(es)",
                            {"hop": hop, "addresses": len(fetch_now), "transfers_so_far": len(self.transfers)})
            results = await asyncio.gather(*(self._safe_fetch(self.nodes[a]) for a in fetch_now))
            fetched: dict[str, list[Transfer]] = dict(zip(fetch_now, results, strict=True))
            for a, ts in fetched.items():
                self.transfers.extend(ts)
                st = self.nodes[a]
                if st.status not in (ExpansionStatus.SEED, ExpansionStatus.TRUNCATED, ExpansionStatus.PROVIDER_ERROR):
                    st.status = ExpansionStatus.EXPANDED
            self.transfers = dedupe_transfers(self.transfers)
            # register all observed counterparties as nodes
            for t in self.transfers:
                for a in (t.from_address, t.to_address):
                    if a and a not in self.nodes:
                        self.nodes[a] = NodeState(a, hop + 1, "observed", ExpansionStatus.NOT_EXPANDED)
            nxt: dict[str, list[str]] = {d: [] for d in directions}
            for d in directions:
                for a in frontier[d]:
                    st = self.nodes[a]
                    if st.status in (ExpansionStatus.TRUNCATED, ExpansionStatus.PROVIDER_ERROR):
                        continue
                    ranked = rank_counterparties(fetched.get(a, []), a, d,
                                                 include_unrecognised=self.config.include_unrecognised_tokens_in_traversal,
                                                 min_share=self.config.min_traversal_share)
                    for i, (cp, share, _n) in enumerate(ranked):
                        cst = self.nodes[cp]
                        if cst.status not in (ExpansionStatus.NOT_EXPANDED, ExpansionStatus.BRANCH_PRUNED):
                            continue
                        cst.hop = min(cst.hop, hop + 1)
                        cst.direction = d
                        if i >= self.config.max_branching:
                            cst.status = ExpansionStatus.BRANCH_PRUNED
                            cst.note = f"rank {i + 1} by value share ({share:.2%}) exceeds branching limit"
                            continue
                        if hop + 1 >= self.config.max_hops:
                            cst.status = ExpansionStatus.DEPTH_LIMIT
                            continue
                        expanded = sum(1 for n in self.nodes.values() if n.status in (
                            ExpansionStatus.EXPANDED, ExpansionStatus.SEED, ExpansionStatus.TRUNCATED))
                        if expanded + sum(len(v) for v in nxt.values()) >= self.config.max_nodes:
                            cst.status = ExpansionStatus.BUDGET_EXHAUSTED
                            self.partial = True
                            continue
                        nxt[d].append(cp)
            # classify candidates before fetching: services are terminal
            cand = sorted({a for d in directions for a in nxt[d]})
            await asyncio.gather(*(self._enrich(self.nodes[a]) for a in cand))
            for d in directions:
                keep = []
                for a in nxt[d]:
                    svc = self._is_service(self.nodes[a])
                    if svc:
                        self.nodes[a].status = ExpansionStatus.TERMINAL_SERVICE
                        self.nodes[a].note = f"not expanded: labelled {svc}"
                    else:
                        keep.append(a)
                nxt[d] = keep
            frontier = nxt
        # Label remaining unenriched nodes that touch value flows (bounded by info budget).
        unlabelled = [n for n in self.nodes.values() if not n.labels and n.is_contract is None]
        unlabelled.sort(key=lambda n: (n.hop, n.address))
        for n in unlabelled:
            n.labels = self.static_labels(n.address)
        for n in unlabelled[: max(0, self.info_budget)]:
            await self._enrich(n)

    async def _safe_fetch(self, st: NodeState) -> list[Transfer]:
        try:
            return await self._fetch(st)
        except BudgetExhausted as exc:
            st.status = ExpansionStatus.BUDGET_EXHAUSTED
            st.note = exc.message
            self.partial = True
            self.warnings.append(f"{st.address}: {exc.message}")
            return []
        except ProviderError as exc:
            st.status = ExpansionStatus.PROVIDER_ERROR
            st.note = f"{exc.kind}: {exc.message}"
            self.partial = True
            self.warnings.append(f"{st.address}: provider error {exc.kind}: {exc.message}")
            return []
