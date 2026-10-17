"""Indicator extraction from untrusted public text (plain text only, bounded, control chars stripped)."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

ADDRESS_IN_TEXT = re.compile(r"(?<![0-9a-fA-Fx])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])")
TXHASH_IN_TEXT = re.compile(r"(?<![0-9a-fA-Fx])0x[0-9a-fA-F]{64}(?![0-9a-fA-F])")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏‪-‮⁦-⁩]")

CONTEXT_TERMS = (
    "hack", "exploit", "attacker", "stolen", "theft", "drain", "phish", "scam", "launder", "mixer",
    "tornado", "sanction", "ofac", "lazarus", "ransom", "rug", "blacklist", "blocklist", "malicious",
)


def clean_text(text: str | None, limit: int = 20000) -> str:
    if not text:
        return ""
    return _CONTROL.sub("", str(text))[:limit]


@dataclass(frozen=True)
class ExtractedIndicator:
    kind: str  # evm_address | tx_hash
    value: str
    start: int
    end: int


def extract_indicators(text: str, max_items: int = 200) -> list[ExtractedIndicator]:
    t = clean_text(text)
    out: list[ExtractedIndicator] = []
    spans: list[tuple[int, int]] = []
    for m in TXHASH_IN_TEXT.finditer(t):
        out.append(ExtractedIndicator("tx_hash", m.group(0).lower(), m.start(), m.end()))
        spans.append((m.start(), m.end()))
        if len(out) >= max_items:
            return out
    for m in ADDRESS_IN_TEXT.finditer(t):
        if any(s <= m.start() < e for s, e in spans):
            continue
        out.append(ExtractedIndicator("evm_address", m.group(0).lower(), m.start(), m.end()))
        if len(out) >= max_items:
            break
    return out


def snippet_around(text: str, needle: str, radius: int = 160) -> tuple[str, int] | None:
    t = clean_text(text)
    idx = t.lower().find(needle.lower())
    if idx < 0:
        return None
    start, end = max(0, idx - radius), min(len(t), idx + len(needle) + radius)
    snip = ("…" if start > 0 else "") + t[start:end] + ("…" if end < len(t) else "")
    return re.sub(r"\s+", " ", snip).strip(), idx


def context_terms(text: str) -> list[str]:
    low = clean_text(text).lower()
    return sorted({term for term in CONTEXT_TERMS if term in low})


def fingerprint(text: str) -> str:
    """Whitespace/case-insensitive content fingerprint to detect copied evidence."""
    norm = re.sub(r"\s+", " ", clean_text(text).lower()).strip()
    return hashlib.sha256(norm.encode()).hexdigest()[:20]
