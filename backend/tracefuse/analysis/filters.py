"""Common analysis filter applied identically by graph, metrics, matrix, timeline and reports."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from ..domain.models import Transfer, TransferKind


class AnalysisFilter(BaseModel):
    start: datetime | None = None
    end: datetime | None = None
    assets: list[str] | None = None  # asset keys ("native" or token contract)
    kinds: list[TransferKind] | None = None
    min_amount: Decimal | None = None  # display units; only applied when decimals are known
    include_failed: bool = False
    include_zero_value: bool = False  # zero-value contract calls ("interactions")
    include_unrecognised_tokens: bool = True
    hidden_addresses: list[str] = Field(default_factory=list)

    def apply(self, transfers: list[Transfer]) -> list[Transfer]:
        out: list[Transfer] = []
        hidden = {a.lower() for a in self.hidden_addresses}
        assets = {a.lower() for a in self.assets} if self.assets else None
        kinds = set(self.kinds) if self.kinds else None
        s = self.start.timestamp() if self.start else None
        e = self.end.timestamp() if self.end else None
        for t in transfers:
            if not self.include_failed and not t.success:
                continue
            if not self.include_zero_value and t.raw_int == 0:
                continue
            if kinds and t.kind not in kinds:
                continue
            if assets and t.asset.key not in assets:
                continue
            if not self.include_unrecognised_tokens and not t.asset.recognised:
                continue
            if s is not None or e is not None:
                ts = t.ts
                if ts is None:
                    continue  # cannot place in a time window; reported separately as missing timestamps
                if s is not None and ts < s:
                    continue
                if e is not None and ts > e:
                    continue
            if self.min_amount is not None and t.amount is not None and Decimal(t.amount) < self.min_amount:
                continue
            if t.from_address in hidden or (t.to_address or "") in hidden:
                continue
            out.append(t)
        return out
