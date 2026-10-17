"""Decimal-safe amount handling.

Raw on-chain integers are kept as Python ``int`` (arbitrary precision) and serialised as strings.
Display amounts use :class:`decimal.Decimal` with enough precision for 78-digit uint256 values. Binary
floats are only produced at the very edge (chart intensities / similarity ratios), never for totals.
"""

from __future__ import annotations

from decimal import Decimal, localcontext

PRECISION = 100


def to_display(raw: int, decimals: int | None) -> Decimal | None:
    if decimals is None:
        return None
    with localcontext() as ctx:
        ctx.prec = PRECISION
        return Decimal(raw).scaleb(-decimals)


def display_str(raw: int, decimals: int | None) -> str | None:
    d = to_display(raw, decimals)
    if d is None:
        return None
    return format_decimal(d)


def format_decimal(d: Decimal) -> str:
    """Plain (non-scientific) representation without trailing zeros."""
    if d == 0:
        return "0"
    s = format(d, "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


def parse_int(value: object, default: int = 0) -> int:
    if value is None or value == "":
        return default
    if isinstance(value, int):
        return value
    s = str(value).strip()
    if s.startswith(("0x", "0X")):
        return int(s, 16)
    return int(s)


def relative_difference(a: int, b: int) -> float:
    """|a-b| / max(a,b) computed on exact integers, returned as float in [0,1]."""
    if a == b:
        return 0.0
    m = max(abs(a), abs(b))
    if m == 0:
        return 0.0
    return float(Decimal(abs(a - b)) / Decimal(m))


def is_round_amount(raw: int, decimals: int | None, min_magnitude: int = 0) -> bool:
    """True if the display amount is a whole multiple of 10**min_magnitude (e.g. 500 ETH)."""
    if decimals is None or raw == 0:
        return False
    unit = 10 ** (decimals + min_magnitude)
    return raw % unit == 0
