"""Application service container (wired once at startup; tests build their own)."""

from __future__ import annotations

from dataclasses import dataclass, field

import httpx

from .config import Settings
from .intel.github import GitHubClient
from .intel.goplus import GoPlusClient
from .intel.ofac import OfacService
from .providers.http import Cassette, HealthRegistry, ResilientHttp
from .providers.registry import ProviderRegistry
from .storage.db import Database
from .storage.ofac_repository import OfacRepository
from .storage.repositories import (
    CaseRepository,
    ChallengeRepository,
    EventRepository,
    HttpCacheRepository,
    InvestigationRepository,
)


@dataclass
class ExternalClients:
    """Everything that talks to the network. Live, recording, or replaying a historical cassette."""

    http: ResilientHttp
    registry: ProviderRegistry
    github: GitHubClient
    goplus: GoPlusClient

    async def aclose(self) -> None:
        await self.http.aclose()


def build_clients(settings: Settings, *, cache: HttpCacheRepository | None, health: HealthRegistry,
                  mode: str = "live", cassette: Cassette | None = None,
                  transport: httpx.AsyncBaseTransport | None = None) -> ExternalClients:
    http = ResilientHttp(settings, cache=cache, health=health, mode=mode, cassette=cassette,  # type: ignore[arg-type]
                         transport=transport)
    return ExternalClients(http=http, registry=ProviderRegistry(http, settings), github=GitHubClient(http, settings),
                           goplus=GoPlusClient(http, settings))


@dataclass
class Services:
    settings: Settings
    db: Database
    cases: CaseRepository
    investigations: InvestigationRepository
    events: EventRepository
    cache: HttpCacheRepository
    ofac_repo: OfacRepository
    challenges: ChallengeRepository
    health: HealthRegistry
    live: ExternalClients
    ofac: OfacService
    extra: dict = field(default_factory=dict)

    @classmethod
    def create(cls, settings: Settings, *, db: Database | None = None,
               transport: httpx.AsyncBaseTransport | None = None) -> Services:
        db = db or Database(settings.tracefuse_db_path)
        db.migrate()
        cache = HttpCacheRepository(db)
        health = HealthRegistry()
        live = build_clients(settings, cache=cache, health=health, transport=transport)
        ofac_repo = OfacRepository(db)
        return cls(settings=settings, db=db, cases=CaseRepository(db), investigations=InvestigationRepository(db),
                   events=EventRepository(db), cache=cache, ofac_repo=ofac_repo, challenges=ChallengeRepository(db),
                   health=health, live=live, ofac=OfacService(ofac_repo, live.http))

    async def aclose(self) -> None:
        await self.live.aclose()
