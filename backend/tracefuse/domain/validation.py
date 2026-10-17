"""Input validation for addresses and transaction hashes (EVM)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from Crypto.Hash import keccak

ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
TX_HASH_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")
ZERO_ADDRESS = "0x" + "0" * 40


def keccak256(data: bytes) -> bytes:
    h = keccak.new(digest_bits=256)
    h.update(data)
    return h.digest()


def to_checksum_address(address: str) -> str:
    """EIP-55 checksum encoding."""
    a = address.lower().removeprefix("0x")
    digest = keccak256(a.encode("ascii")).hex()
    return "0x" + "".join(c.upper() if c.isalpha() and int(digest[i], 16) >= 8 else c for i, c in enumerate(a))


def is_valid_checksum(address: str) -> bool:
    body = address[2:]
    if body == body.lower() or body == body.upper():
        return True  # all-lower / all-upper carry no checksum information
    return to_checksum_address(address) == address


@dataclass(frozen=True)
class SeedClassification:
    kind: Literal["address", "tx_hash"]
    value: str  # normalised lowercase
    warnings: tuple[str, ...] = ()


class InvalidSeedError(ValueError):
    pass


def classify_seed(raw: str) -> SeedClassification:
    s = (raw or "").strip()
    if not s:
        raise InvalidSeedError("Seed is empty. Enter an EVM address (0x + 40 hex) or transaction hash (0x + 64 hex).")
    if not s.startswith("0x") and re.fullmatch(r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}", s):
        s = "0x" + s
    if ADDRESS_RE.fullmatch(s):
        if not is_valid_checksum(s):
            raise InvalidSeedError(
                "Address has mixed case but fails the EIP-55 checksum — it is probably mistyped."
            )
        if s.lower() == ZERO_ADDRESS:
            raise InvalidSeedError("The zero address is a burn/mint sentinel and cannot be investigated as a wallet.")
        return SeedClassification("address", s.lower())
    if TX_HASH_RE.fullmatch(s):
        return SeedClassification("tx_hash", s.lower())
    if re.fullmatch(r"0x[0-9a-fA-F]*", s):
        n = len(s) - 2
        raise InvalidSeedError(
            f"Hex value has {n} digits; an address needs 40 and a transaction hash needs 64."
        )
    if re.fullmatch(r"[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[0-9a-z]{11,71}", s):
        raise InvalidSeedError("This looks like a Bitcoin address. TRACEFUSE currently supports EVM chains only.")
    if re.fullmatch(r"T[1-9A-HJ-NP-Za-km-z]{33}", s):
        raise InvalidSeedError("This looks like a Tron address. TRACEFUSE currently supports EVM chains only.")
    if s.endswith(".eth"):
        raise InvalidSeedError("ENS names are not resolved automatically; paste the resolved 0x address.")
    raise InvalidSeedError("Unrecognised input. Enter an EVM address (0x + 40 hex) or transaction hash (0x + 64 hex).")


def normalize_address(value: str | None) -> str | None:
    if value is None:
        return None
    v = value.strip()
    if not v:
        return None
    if ADDRESS_RE.fullmatch(v):
        return v.lower()
    return None
