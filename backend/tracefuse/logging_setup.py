"""Logging with secret redaction.

Every log record passes through :class:`RedactingFilter`, which replaces configured secret values and
common credential query parameters (``apikey=…``, ``/v2/<alchemy-key>``) with ``[REDACTED]``.
"""

from __future__ import annotations

import logging
import re

from .config import Settings

_PARAM_RE = re.compile(r"(?i)((?:api)?key|token|access_token|apikey)=([^&\s\"']+)")
_ALCHEMY_RE = re.compile(r"(g\.alchemy\.com/v2/)([A-Za-z0-9_\-]+)")
_BEARER_RE = re.compile(r"(?i)(bearer\s+)([A-Za-z0-9_\-\.]+)")


def redact(text: str, secrets: list[str] | None = None) -> str:
    for s in secrets or []:
        if s and len(s) >= 4:
            text = text.replace(s, "[REDACTED]")
    text = _PARAM_RE.sub(r"\1=[REDACTED]", text)
    text = _ALCHEMY_RE.sub(r"\1[REDACTED]", text)
    text = _BEARER_RE.sub(r"\1[REDACTED]", text)
    return text


class RedactingFilter(logging.Filter):
    def __init__(self, secrets: list[str]):
        super().__init__()
        self._secrets = secrets

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:  # pragma: no cover - defensive
            return True
        record.msg = redact(msg, self._secrets)
        record.args = ()
        return True


def configure_logging(settings: Settings) -> None:
    root = logging.getLogger()
    if not any(isinstance(f, RedactingFilter) for h in root.handlers for f in h.filters):
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        handler.addFilter(RedactingFilter(settings.secret_values()))
        root.addHandler(handler)
    root.setLevel(settings.log_level.upper())
    # httpx logs full URLs at INFO; keep it quiet and rely on our redacted provider logs.
    logging.getLogger("httpx").setLevel(logging.WARNING)
