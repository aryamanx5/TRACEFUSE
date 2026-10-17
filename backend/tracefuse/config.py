"""Runtime configuration.

All secrets are read from the environment (or a local, git-ignored ``.env``) and stay server-side.
Nothing in this module is ever serialised to API responses except the *presence* of a credential.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="",
        env_file=(str(BACKEND_ROOT / ".env"), str(BACKEND_ROOT.parent / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- storage -------------------------------------------------------------------------------
    tracefuse_db_path: Path = Field(default=BACKEND_ROOT / "var" / "tracefuse.sqlite3")
    tracefuse_data_dir: Path = Field(default=BACKEND_ROOT / "data")

    # --- credentials (optional; absence = "unconfigured", never faked) -------------------------
    etherscan_api_key: SecretStr | None = None
    alchemy_api_key: SecretStr | None = None
    github_token: SecretStr | None = None
    goplus_access_token: SecretStr | None = None

    # --- HTTP behaviour -------------------------------------------------------------------------
    http_timeout_seconds: float = 20.0
    http_max_retries: int = 3
    http_backoff_base_seconds: float = 0.6
    http_backoff_max_seconds: float = 8.0
    http_user_agent: str = "TRACEFUSE/0.1 (+https://github.com/; blockchain-forensics research tool)"

    # Per-provider request rate (requests / second). Conservative defaults below documented limits.
    rate_blockscout_rps: float = 2.5
    rate_etherscan_rps: float = 4.0
    rate_alchemy_rps: float = 10.0
    rate_goplus_rps: float = 1.0
    rate_github_rps: float = 0.15  # 10 search requests / minute unauthenticated
    rate_github_auth_rps: float = 0.45  # 30 search requests / minute authenticated (code search 10/min)

    # Cache TTLs (seconds)
    cache_ttl_chain_seconds: int = 6 * 3600
    cache_ttl_intel_seconds: int = 24 * 3600

    # --- investigation bounds (server-enforced; requests are clamped/validated against these) ---
    max_hops_limit: int = 4
    max_branching_limit: int = 20
    max_transfers_per_address_limit: int = 5000
    max_nodes_limit: int = 400
    max_provider_calls_per_investigation: int = 600
    max_github_queries_per_investigation: int = 6
    max_goplus_lookups_per_investigation: int = 25
    max_address_info_lookups_per_investigation: int = 120

    # --- API ------------------------------------------------------------------------------------
    cors_allow_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )
    max_request_body_bytes: int = 256 * 1024
    log_level: str = "INFO"

    def credential_status(self) -> dict[str, bool]:
        """Presence-only view of credentials, safe to expose."""
        return {
            "ETHERSCAN_API_KEY": self.etherscan_api_key is not None
            and bool(self.etherscan_api_key.get_secret_value()),
            "ALCHEMY_API_KEY": self.alchemy_api_key is not None
            and bool(self.alchemy_api_key.get_secret_value()),
            "GITHUB_TOKEN": self.github_token is not None and bool(self.github_token.get_secret_value()),
            "GOPLUS_ACCESS_TOKEN": self.goplus_access_token is not None
            and bool(self.goplus_access_token.get_secret_value()),
        }

    def secret_values(self) -> list[str]:
        out: list[str] = []
        for s in (self.etherscan_api_key, self.alchemy_api_key, self.github_token, self.goplus_access_token):
            if s is not None and s.get_secret_value():
                out.append(s.get_secret_value())
        return out


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
