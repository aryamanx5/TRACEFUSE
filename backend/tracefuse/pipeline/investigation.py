"""Investigation orchestrator. Every progress event reflects completed backend work."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Any

from ..analysis.crosschain import CrossChainTracer, find_bridge_interactions, find_privacy_gaps
from ..chains import CHAINS, get_chain
from ..domain.models import (
    DataOrigin,
    Evidence,
    InvestigationConfig,
    InvestigationStatus,
    ProgressEvent,
    SourceStatus,
)
from ..domain.validation import InvalidSeedError, classify_seed
from ..intel import registry
from ..intel.github import GitHubClient
from ..intel.goplus import GoPlusClient
from ..providers.base import BlockRange, FetchContext, dedupe_transfers
from ..providers.errors import BudgetExhausted, ProviderError
from ..providers.http import CallBudget
from ..services import ExternalClients, Services
from .traversal import Traverser

log = logging.getLogger(__name__)


class EventBus:
    """Persists events and wakes SSE listeners."""

    def __init__(self, services: Services):
        self.services = services
        self._conds: dict[str, asyncio.Event] = {}

    def waiter(self, investigation_id: str) -> asyncio.Event:
        return self._conds.setdefault(investigation_id, asyncio.Event())

    async def emit(self, investigation_id: str, stage: str, status: str, message: str,
                   detail: dict[str, Any] | None = None) -> ProgressEvent:
        ev = self.services.events.append(ProgressEvent(investigation_id=investigation_id, stage=stage, status=status,  # type: ignore[arg-type]
                                                       message=message, detail=detail or {}))
        w = self._conds.get(investigation_id)
        if w is not None:
            w.set()
            self._conds[investigation_id] = asyncio.Event()
        return ev


class InvestigationRunner:
    def __init__(self, services: Services, bus: EventBus, investigation_id: str, config: InvestigationConfig,
                 clients: ExternalClients, data_origin: DataOrigin = DataOrigin.LIVE,
                 extra_evidence: list[Evidence] | None = None):
        self.s, self.bus, self.id, self.config, self.clients = services, bus, investigation_id, config, clients
        self.data_origin = data_origin
        self.extra_evidence = extra_evidence or []
        self.warnings: list[str] = []
        self.partial = False
        self.budget = CallBudget(services.settings.max_provider_calls_per_investigation)
        self.ctx = FetchContext(budget=self.budget, data_origin=data_origin)

    async def emit(self, stage: str, status: str, message: str, detail: dict[str, Any] | None = None) -> None:
        await self.bus.emit(self.id, stage, status, message, detail)

    async def run(self) -> None:
        repo = self.s.investigations
        repo.set_status(self.id, InvestigationStatus.RUNNING)
        traverser: Traverser | None = None
        try:
            traverser = await self._run()
        except asyncio.CancelledError:
            if traverser is None and hasattr(self, "_traverser"):
                traverser = self._traverser
            if traverser is not None and traverser.transfers:
                repo.save_transfers(self.id, traverser.transfers)
                repo.save_artifact(self.id, "nodes", {a: n.to_dict() for a, n in traverser.nodes.items()})
            await self.emit("lifecycle", "warning", "investigation cancelled by analyst; partial data retained",
                            {"transfers": len(traverser.transfers) if traverser else 0})
            repo.update(self.id, warnings=[*self.warnings, "cancelled before completion"])
            repo.set_status(self.id, InvestigationStatus.CANCELLED)
            raise
        except InvalidSeedError as exc:
            await self.emit("validate", "failed", str(exc))
            repo.set_status(self.id, InvestigationStatus.FAILED, error=str(exc))
        except ProviderError as exc:
            await self.emit("lifecycle", "failed", f"provider failure: {exc.message}", exc.to_dict())
            repo.update(self.id, warnings=self.warnings)
            repo.set_status(self.id, InvestigationStatus.FAILED, error=f"{exc.kind}: {exc.message}")
        except Exception as exc:  # unexpected bug: record honestly, never pretend success
            log.exception("investigation %s crashed", self.id)
            await self.emit("lifecycle", "failed", f"internal error: {type(exc).__name__}: {exc}")
            repo.set_status(self.id, InvestigationStatus.FAILED, error=f"internal error: {type(exc).__name__}")

    async def _run(self) -> Traverser:
        cfg, repo = self.config, self.s.investigations
        await self.emit("validate", "started", "validating seed and configuration")
        seed = classify_seed(cfg.seed)
        chain = get_chain(cfg.chain)
        provider = self.clients.registry.select(chain, cfg.provider)
        repo.update(self.id, provider=provider.name)
        await self.emit("validate", "completed", f"{seed.kind} on {chain.name} via {provider.name}",
                        {"seed_kind": seed.kind, "chain": chain.key, "provider": provider.name,
                         "data_origin": self.data_origin.value})

        # block window
        block_range = BlockRange()
        if cfg.time_start or cfg.time_end:
            await self.emit("resolve_window", "started", "resolving time window to block range")
            start_b = await provider.block_at_time(chain, cfg.time_start, "after", self.ctx) if cfg.time_start else 0
            end_b = await provider.block_at_time(chain, cfg.time_end, "before", self.ctx) if cfg.time_end else None
            block_range = BlockRange(start_b, end_b)
            await self.emit("resolve_window", "completed", f"blocks {start_b}–{end_b or 'head'}",
                            {"start_block": start_b, "end_block": end_b})

        # seed resolution
        seed_transfers = []
        if seed.kind == "tx_hash":
            await self.emit("resolve_seed", "started", "fetching seed transaction")
            txr = await provider.transaction(chain, seed.value, self.ctx)
            seed_transfers = txr.transfers
            recipients = {t.to_address for t in txr.transfers if t.to_address and t.raw_int > 0 and t.success}
            seeds = sorted({txr.from_address} | ({a for a in recipients if a} if cfg.direction != "backward" else set()))
            repo.save_artifact(self.id, "seed", {"kind": "tx_hash", "tx_hash": seed.value, "from": txr.from_address,
                                                 "to": txr.to_address, "success": txr.success,
                                                 "timestamp": txr.timestamp.isoformat() if txr.timestamp else None,
                                                 "block_number": txr.block_number, "seed_addresses": seeds,
                                                 "transfer_ids": [t.id for t in txr.transfers]})
            self.warnings.extend(txr.warnings)
            await self.emit("resolve_seed", "completed",
                            f"seed tx {'succeeded' if txr.success else 'FAILED on-chain'}; {len(txr.transfers)} transfer(s); "
                            f"{len(seeds)} seed address(es)", {"seed_addresses": seeds})
        else:
            seeds = [seed.value]
            repo.save_artifact(self.id, "seed", {"kind": "address", "address": seed.value, "seed_addresses": seeds})

        # acquisition
        await self.emit("acquire", "started", f"bounded {cfg.direction} traversal: ≤{cfg.max_hops} hops, "
                        f"≤{cfg.max_branching} branches/node, ≤{cfg.max_transfers_per_address} records/address")
        mixer_labels = {}
        for a in self.s.ofac_repo.entity_addresses("TORNADO CASH"):
            mixer_labels[a["address_norm"]] = registry.mixer_label(a["entity"] or "Tornado Cash", a["action_date"], a["url"]).model_dump(mode="json")
        trav = Traverser(provider=provider, chain=chain, config=cfg, ctx=self.ctx, block_range=block_range,
                         emit=lambda st, status, msg, d: self.emit(st, status, msg, d),
                         info_budget=self.s.settings.max_address_info_lookups_per_investigation, mixer_labels=mixer_labels)
        self._traverser = trav
        await trav.run(seeds)
        seed_errors = [trav.fetch_errors[a] for a in seeds if a in trav.fetch_errors]
        if seed_errors and len(seed_errors) == len(seeds) and not trav.transfers and not seed_transfers:
            # Nothing could be retrieved for any seed: this is a failure, not a partial result.
            raise seed_errors[0]
        trav.transfers = dedupe_transfers(trav.transfers + seed_transfers)
        self.warnings.extend(trav.warnings)
        self.partial |= trav.partial
        for w in trav.warnings[:20]:
            await self.emit("acquire", "warning", w)
        if len(trav.warnings) > 20:
            await self.emit("acquire", "warning", f"{len(trav.warnings) - 20} further warning(s) in the investigation record")
        await self.emit("acquire", "completed", f"{len(trav.transfers)} unique transfer(s), {len(trav.nodes)} address(es)",
                        {"transfers": len(trav.transfers), "addresses": len(trav.nodes), "provider_calls": self.budget.used})

        await self.emit("normalize", "started", "persisting normalised, deduplicated records")
        n = repo.save_transfers(self.id, trav.transfers)
        node_meta = {a: st.to_dict() for a, st in trav.nodes.items()}
        repo.save_artifact(self.id, "nodes", node_meta)
        await self.emit("normalize", "completed", f"{n} records stored with provenance",
                        {"from_cache": sum(1 for t in trav.transfers if t.provenance.from_cache)})

        # OSINT
        evidence, statuses = await self._osint(chain, seeds, trav, node_meta)
        evidence.extend(self.extra_evidence)
        repo.save_artifact(self.id, "evidence", [e.model_dump(mode="json") for e in evidence])
        repo.save_artifact(self.id, "source_status", [s.model_dump(mode="json") for s in statuses])

        # cross-chain
        cc: list[dict[str, Any]] = []
        gaps = find_privacy_gaps(trav.transfers, node_meta)
        if cfg.crosschain.enabled:
            await self.emit("crosschain", "started", "checking bridge interactions")
            inter = find_bridge_interactions(trav.transfers, node_meta, chain.key)
            reg = self.clients.registry

            def ready(c):
                return bool(reg.candidates(c))

            async def logs_fn(c, h):
                return await reg.select(c).tx_logs(c, h, self.ctx)

            async def tx_fn(c, h):
                return await reg.select(c).transaction(c, h, self.ctx)

            async def addr_fn(c, a, br):
                return await reg.select(c).address_transfers(c, a, br, include_internal=True, include_tokens=True,
                                                              limit=500, ctx=self.ctx)

            async def block_fn(c, when, closest):
                return await reg.select(c).block_at_time(c, when, closest, self.ctx)

            tracer = CrossChainTracer(logs=logs_fn, tx=tx_fn, address_transfers=addr_fn, block_at=block_fn, ready=ready,
                                      window_hours=cfg.crosschain.window_hours, tolerance=cfg.crosschain.amount_tolerance,
                                      max_candidates=cfg.crosschain.max_candidates_per_event,
                                      target_chains=[c for c in cfg.crosschain.target_chains if c in CHAINS])
            for it in inter[:25]:
                try:
                    cc.extend(await tracer.trace(chain, [it]))
                except BudgetExhausted as exc:
                    self.partial = True
                    self.warnings.append(f"cross-chain: {exc.message}")
                    break
            if len(inter) > 25:
                self.warnings.append(f"cross-chain: only the first 25 of {len(inter)} bridge interactions were traced")
            counts: dict[str, int] = {}
            for c in cc:
                counts[c["status"]] = counts.get(c["status"], 0) + 1
            await self.emit("crosschain", "completed", f"{len(inter)} bridge interaction(s); {counts or 'none linked'}; "
                            f"{len(gaps)} privacy-protocol gap(s)", {"by_status": counts, "privacy_gaps": len(gaps)})
        else:
            await self.emit("crosschain", "skipped", "cross-chain tracing disabled")
        repo.save_artifact(self.id, "crosschain", cc)
        repo.save_artifact(self.id, "privacy_gaps", gaps)

        # scoring snapshot (reproducible default weights)
        await self.emit("score", "started", "computing metrics and heuristic scores")
        from ..analysis.service import AnalysisService

        summary = AnalysisService(self.s).summary(self.id, force=True)
        await self.emit("score", "completed", f"{summary['scored']} address(es) scored; top band: {summary['top_band']}",
                        {"top": summary["top"][:5]})

        status = InvestigationStatus.PARTIAL if (self.partial or self.warnings) else InvestigationStatus.COMPLETED
        repo.update(self.id, warnings=self.warnings, summary={**summary, "provider_calls": self.budget.used,
                                                               "provider_calls_by_family": self.budget.per_provider})
        repo.set_status(self.id, status)
        await self.emit("lifecycle", "completed", f"investigation {status.value}"
                        + (f" with {len(self.warnings)} warning(s)" if self.warnings else ""),
                        {"status": status.value, "warnings": self.warnings[:20]})
        return trav

    async def _osint(self, chain, seeds, trav: Traverser, node_meta) -> tuple[list[Evidence], list[SourceStatus]]:
        cfg = self.config
        evidence: list[Evidence] = []
        statuses: list[SourceStatus] = []
        addrs = sorted(node_meta)
        await self.emit("osint", "started", "enriching with OFAC, explorer labels, GoPlus and GitHub")

        # OFAC (local dataset)
        if cfg.osint.ofac:
            ds = self.s.ofac_repo.active_dataset()
            if ds is None:
                statuses.append(SourceStatus(source="ofac", state="unconfigured", message="no OFAC dataset imported"))
            else:
                evs = self.s.ofac.evidence_for(chain.key, addrs)
                evidence.extend(evs)
                statuses.append(SourceStatus(source="ofac", state="ok", queried=len(addrs), results=len(evs),
                                             message=f"SDN published {ds.get('publish_date')}"))
        else:
            statuses.append(SourceStatus(source="ofac", state="disabled"))

        # Explorer / registry labels as evidence objects
        if cfg.osint.blockscout_labels:
            from ..domain.models import AssertionStatus, ConfidenceCategory, EvidenceKind

            cnt = 0
            for a, m in node_meta.items():
                for lb in m.get("labels") or []:
                    if lb.get("source") in ("blockscout-metadata", "blockscout-public-tags"):
                        cnt += 1
                        evidence.append(Evidence(
                            kind=EvidenceKind.SOURCE_REPORTED_LABEL, subject_chain=chain.key, subject_address=a,
                            title=f"Explorer label: {lb.get('label')}", source=lb.get("source"), source_url=lb.get("source_url"),
                            source_item_id=f"{lb.get('source')}:{a}:{lb.get('label')}", snippet=lb.get("note"),
                            match_criteria="exact address metadata lookup", confidence=ConfidenceCategory.MODERATE,
                            assertion_status=AssertionStatus.EXTERNAL_ASSERTION,
                            caveats=["Label supplied by the explorer's metadata service / attribution partners; not "
                                     "independently verified by TRACEFUSE."],
                            attributes={"category": lb.get("category")}, data_origin=self.data_origin,
                        ))
            statuses.append(SourceStatus(source="explorer_labels", state="ok", results=cnt,
                                         queried=sum(1 for m in node_meta.values() if m.get("is_contract") is not None)))
        else:
            statuses.append(SourceStatus(source="explorer_labels", state="disabled"))

        # Priority addresses for rate-limited sources: seeds, then hop-1 non-service by flow
        def priority(a: str) -> tuple:
            m = node_meta[a]
            svc = any(lb.get("category") in registry.SERVICE_CATEGORIES for lb in m.get("labels") or [])
            return (a not in seeds, svc, m.get("discovered_hop", 9), -int(m.get("fetched_records") or 0), a)

        ranked = sorted(addrs, key=priority)

        # GoPlus
        gp: GoPlusClient = self.clients.goplus
        if cfg.osint.goplus and gp.supports(chain):
            st = SourceStatus(source="goplus", state="ok")
            for a in ranked[: self.s.settings.max_goplus_lookups_per_investigation]:
                try:
                    result, res = await gp.address_security(chain, a, self.ctx)
                    st.queried += 1
                    st.from_cache += int(res.from_cache)
                    st.last_retrieved_at = res.retrieved_at
                    evs = gp.to_evidence(chain, a, result, res, self.ctx)
                    st.results += len(evs)
                    evidence.extend(evs)
                except ProviderError as exc:
                    st.state = "rate_limited" if exc.kind == "rate_limited" else "partial"
                    st.message = f"{exc.kind}: {exc.message}"
                    self.warnings.append(f"GoPlus: {exc.message}")
                    if exc.kind in ("rate_limited", "budget_exhausted", "not_in_historical_dataset"):
                        break
            statuses.append(st)
            await self.emit("osint", "progress", f"GoPlus: {st.queried} lookup(s), {st.results} flag record(s)")
        else:
            statuses.append(SourceStatus(source="goplus", state="disabled" if not cfg.osint.goplus else "skipped",
                                         message=None if cfg.osint.goplus else "disabled by analyst"))

        # GitHub
        gh: GitHubClient = self.clients.github
        if cfg.osint.github:
            st = SourceStatus(source="github", state="ok",
                              message="authenticated (issues, commits, code)" if gh.authenticated
                              else "unauthenticated: issues + commits only (code search needs GITHUB_TOKEN)")
            seed_info = self.s.investigations.load_artifact(self.id, "seed", {})
            indicators = ([seed_info["tx_hash"]] if seed_info.get("tx_hash") else []) + [a for a in ranked
                         if not any(lb.get("category") in registry.SERVICE_CATEGORIES for lb in node_meta[a].get("labels") or [])]
            budget = self.s.settings.max_github_queries_per_investigation
            for ind in indicators:
                if budget <= 0:
                    break
                for ep in gh.endpoints():
                    if budget <= 0:
                        break
                    budget -= 1
                    try:
                        res = await gh.search(ep, ind, self.ctx)
                        st.queried += 1
                        st.from_cache += int(res.from_cache)
                        st.last_retrieved_at = res.retrieved_at
                        evs = gh.to_evidence(ep, ind, chain.key, res, self.ctx)
                        st.results += len(evs)
                        evidence.extend(evs)
                    except ProviderError as exc:
                        st.state = "rate_limited" if exc.kind == "rate_limited" else "partial"
                        st.message = f"{exc.kind}: {exc.message}"
                        self.warnings.append(f"GitHub {ep}: {exc.message}")
                        budget = 0
            statuses.append(st)
        else:
            statuses.append(SourceStatus(source="github", state="disabled"))

        # de-duplicate evidence by id
        uniq: dict[str, Evidence] = {}
        for e in evidence:
            uniq.setdefault(e.id, e)
        evidence = list(uniq.values())
        await self.emit("osint", "completed", f"{len(evidence)} evidence record(s)",
                        {"sources": [s.model_dump(mode="json") for s in statuses]})
        return evidence, statuses


class JobManager:
    def __init__(self, services: Services):
        self.services = services
        self.bus = EventBus(services)
        self.tasks: dict[str, asyncio.Task] = {}

    def start(self, runner: InvestigationRunner) -> None:
        async def _wrapped() -> None:
            try:
                await runner.run()
            finally:
                self.tasks.pop(runner.id, None)
                close = getattr(runner, "close_clients", None)
                if close:
                    await close()

        self.tasks[runner.id] = asyncio.create_task(_wrapped(), name=f"investigation-{runner.id}")

    def cancel(self, investigation_id: str) -> bool:
        t = self.tasks.get(investigation_id)
        if t is None or t.done():
            return False
        t.cancel()
        return True

    async def wait(self, investigation_id: str) -> None:
        t = self.tasks.get(investigation_id)
        if t is not None:
            with contextlib.suppress(asyncio.CancelledError):
                await t

    async def shutdown(self) -> None:
        for t in list(self.tasks.values()):
            t.cancel()
        await asyncio.gather(*self.tasks.values(), return_exceptions=True)
