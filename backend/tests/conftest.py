from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from tracefuse.chains import CHAINS
from tracefuse.config import Settings
from tracefuse.domain.models import AssetRef, DataOrigin, Provenance, Transfer, TransferKind, make_transfer_id
from tracefuse.services import Services
from tracefuse.storage.db import Database

FIXTURES = Path(__file__).parent / "fixtures"
BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(tracefuse_db_path=tmp_path / "t.sqlite3", tracefuse_data_dir=BACKEND / "data",
                    http_backoff_base_seconds=0.0, http_backoff_max_seconds=0.0, http_max_retries=2,
                    etherscan_api_key=None, alchemy_api_key=None, github_token=None, goplus_access_token=None,
                    rate_blockscout_rps=1000, rate_goplus_rps=1000, rate_github_rps=1000)


@pytest.fixture
def services(settings: Settings) -> Services:
    return Services.create(settings, db=Database(settings.tracefuse_db_path))


ETH = AssetRef(symbol="ETH", contract=None, decimals=18, token_type="native", recognised=True, economic_asset="ETH")
USDC = AssetRef(symbol="USDC", contract="0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals=6, token_type="erc20",
                recognised=True, economic_asset="USDC")


def addr(n: int) -> str:
    return "0x" + f"{n:040x}"


def mk(frm: int | str, to: int | str, amount_wei: int, ts: int, *, asset: AssetRef = ETH, tx: str | None = None,
       kind: TransferKind = TransferKind.NATIVE, disc: str = "0", success: bool = True) -> Transfer:
    f = frm if isinstance(frm, str) else addr(frm)
    t = to if isinstance(to, str) else addr(to)
    txh = tx or "0x" + f"{abs(hash((f, t, amount_wei, ts, disc))):064x}"[-64:]
    chain = CHAINS["ethereum"]
    from tracefuse.domain.models import build_amount
    return Transfer(
        id=make_transfer_id(1, txh, kind, disc), chain="ethereum", chain_id=1, tx_hash=txh, block_number=ts // 12,
        timestamp=datetime.fromtimestamp(ts, UTC), from_address=f, to_address=t, kind=kind, asset=asset,
        raw_amount=str(amount_wei), amount=build_amount(amount_wei, asset.decimals), success=success,
        explorer_url=chain.explorer_tx_url(txh),
        provenance=Provenance(provider="test", endpoint="fixture", retrieved_at=datetime(2026, 1, 1, tzinfo=UTC),
                              data_origin=DataOrigin.LIVE),
    )


E18 = 10**18
