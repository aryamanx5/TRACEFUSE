"""OP-Stack L1→L2 deposit derivation (deterministic).

Per the OP Stack deposits specification, the OptimismPortal emits
``TransactionDeposited(address indexed from, address indexed to, uint256 indexed version, bytes opaqueData)``
with ``opaqueData = abi.encodePacked(mint, value, gasLimit(uint64), isCreation(bool), data)``. The L2 deposit
transaction is ``0x7E || rlp([sourceHash, from, to, mint, value, gas, isSystemTx, data])`` where
``sourceHash = keccak256(bytes32(0) || keccak256(l1BlockHash || bytes32(l1LogIndex)))`` (user-deposited).
Verified against Blockscout's OP Mainnet deposit index on 2026-10-17 (L1 0x48e0d6… → L2 0xc453ed…).
"""

from __future__ import annotations

from dataclasses import dataclass

from ..domain.validation import keccak256

TRANSACTION_DEPOSITED_TOPIC = "0x" + keccak256(b"TransactionDeposited(address,address,uint256,bytes)").hex()
ETH_DEPOSIT_INITIATED_TOPIC = "0x" + keccak256(b"ETHDepositInitiated(address,address,uint256,bytes)").hex()
ERC20_DEPOSIT_INITIATED_TOPIC = (
    "0x" + keccak256(b"ERC20DepositInitiated(address,address,address,address,uint256,bytes)").hex()
)


def _rlp_len(n: int, offset: int) -> bytes:
    if n < 56:
        return bytes([offset + n])
    nb = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([offset + 55 + len(nb)]) + nb


def rlp_bytes(b: bytes) -> bytes:
    if len(b) == 1 and b[0] < 0x80:
        return b
    return _rlp_len(len(b), 0x80) + b


def rlp_int(i: int) -> bytes:
    return rlp_bytes(b"" if i == 0 else i.to_bytes((i.bit_length() + 7) // 8, "big"))


def rlp_list(items: list[bytes]) -> bytes:
    payload = b"".join(items)
    return _rlp_len(len(payload), 0xC0) + payload


@dataclass(frozen=True)
class DerivedDeposit:
    l2_tx_hash: str
    l1_tx_hash: str
    l1_log_index: int
    from_address: str  # L2 "from" (aliased if the L1 sender was a contract)
    to_address: str | None
    mint: int
    value: int
    gas_limit: int
    is_creation: bool
    source_hash: str


def _hex(b: str) -> bytes:
    return bytes.fromhex(b[2:] if b.startswith("0x") else b)


def derive_deposit(*, l1_tx_hash: str, l1_block_hash: str, log_index: int, topics: list[str], data: str) -> DerivedDeposit:
    if not topics or topics[0].lower() != TRANSACTION_DEPOSITED_TOPIC:
        raise ValueError("not a TransactionDeposited log")
    frm = _hex(topics[1])[-20:]
    to = _hex(topics[2])[-20:]
    raw = _hex(data)
    off = int.from_bytes(raw[0:32], "big")
    ln = int.from_bytes(raw[off : off + 32], "big")
    opaque = raw[off + 32 : off + 32 + ln]
    if len(opaque) < 73:
        raise ValueError("opaqueData too short")
    mint = int.from_bytes(opaque[0:32], "big")
    value = int.from_bytes(opaque[32:64], "big")
    gas = int.from_bytes(opaque[64:72], "big")
    is_creation = opaque[72] == 1
    calldata = opaque[73:]
    source_hash = keccak256(bytes(32) + keccak256(_hex(l1_block_hash) + log_index.to_bytes(32, "big")))
    tx = b"\x7e" + rlp_list([
        rlp_bytes(source_hash), rlp_bytes(frm), rlp_bytes(b"" if is_creation else to), rlp_int(mint),
        rlp_int(value), rlp_int(gas), rlp_int(0), rlp_bytes(calldata),
    ])
    return DerivedDeposit(
        l2_tx_hash="0x" + keccak256(tx).hex(), l1_tx_hash=l1_tx_hash.lower(), l1_log_index=log_index,
        from_address="0x" + frm.hex(), to_address=None if is_creation else "0x" + to.hex(), mint=mint, value=value,
        gas_limit=gas, is_creation=is_creation, source_hash="0x" + source_hash.hex(),
    )


def decode_deposit_initiated(topics: list[str], data: str) -> dict[str, object] | None:
    """Extract (from, to, amount, l1Token) from L1StandardBridge deposit-initiated events."""
    if not topics:
        return None
    raw = _hex(data)
    t0 = topics[0].lower()
    if t0 == ETH_DEPOSIT_INITIATED_TOPIC and len(topics) >= 3 and len(raw) >= 32:
        return {"asset": "ETH", "l1_token": None, "from": "0x" + topics[1][-40:], "to": "0x" + topics[2][-40:],
                "amount": int.from_bytes(raw[0:32], "big")}
    if t0 == ERC20_DEPOSIT_INITIATED_TOPIC and len(topics) >= 4 and len(raw) >= 64:
        return {"asset": "ERC20", "l1_token": "0x" + topics[1][-40:], "l2_token": "0x" + topics[2][-40:],
                "from": "0x" + topics[3][-40:], "to": "0x" + raw[12:32].hex(), "amount": int.from_bytes(raw[32:64], "big")}
    return None
