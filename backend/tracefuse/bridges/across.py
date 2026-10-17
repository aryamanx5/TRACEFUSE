"""Across Protocol (intent bridge) — documented deposit/fill correspondence.

SpokePool addresses: https://docs.across.to/reference/contract-addresses (checked 2026-10-18).
Event layouts were read from live, Blockscout-decoded logs on 2026-10-18:
- origin   ``FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount,
            uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline,
            uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)``
- destination ``FilledRelay(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount,
            uint256 repaymentChainId, uint256 indexed originChainId, uint256 indexed depositId, uint32 fillDeadline,
            uint32 exclusivityDeadline, bytes32 exclusiveRelayer, address indexed relayer, bytes32 depositor,
            bytes32 recipient, …)``
A fill whose (originChainId, depositId) equals the deposit's (origin chain id, depositId) is the documented
correspondence for that deposit.
"""

from __future__ import annotations

from dataclasses import dataclass

SPOKE_POOLS: dict[int, str] = {
    1: "0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5",
    10: "0x6f26bf09b1c792e3228e5467807a900a503c0281",
    8453: "0x09aea4b2242abc8bb4bb78d537a67a245a7bec64",
    42161: "0xe35e9842fceaca96570b734083f4a58e8f7c5f2a",
}
FUNDS_DEPOSITED_TOPIC = "0x32ed1a409ef04c7b0227189c3a103dc5ac10e775a15b785dcc510201f7c25ad3"
FILLED_RELAY_TOPIC = "0x44b559f101f8fbcc8a0ea43fa91a05a729a5ea6e14a7c75aa750374690137208"


def _words(data: str) -> list[int]:
    raw = bytes.fromhex(data[2:] if data.startswith("0x") else data)
    return [int.from_bytes(raw[i : i + 32], "big") for i in range(0, len(raw) - len(raw) % 32, 32)]


def _addr(word: int) -> str:
    return "0x" + word.to_bytes(32, "big")[-20:].hex()


@dataclass(frozen=True)
class AcrossDeposit:
    origin_chain_id: int
    destination_chain_id: int
    deposit_id: int
    depositor: str
    recipient: str
    input_token: str
    output_token: str
    input_amount: int
    output_amount: int
    fill_deadline: int


def decode_deposit(origin_chain_id: int, address: str, topics: list[str], data: str) -> AcrossDeposit | None:
    if address.lower() != SPOKE_POOLS.get(origin_chain_id) or not topics or topics[0].lower() != FUNDS_DEPOSITED_TOPIC:
        return None
    if len(topics) < 4:
        return None
    w = _words(data)
    if len(w) < 9:
        return None
    return AcrossDeposit(
        origin_chain_id=origin_chain_id, destination_chain_id=int(topics[1], 16), deposit_id=int(topics[2], 16),
        depositor=_addr(int(topics[3], 16)), recipient=_addr(w[7]), input_token=_addr(w[0]), output_token=_addr(w[1]),
        input_amount=w[2], output_amount=w[3], fill_deadline=w[5],
    )


def is_fill_for(dep: AcrossDeposit, dest_chain_id: int, address: str, topics: list[str], data: str) -> dict[str, object] | None:
    """Return fill details when this log is the destination SpokePool's FilledRelay for ``dep``."""
    if address.lower() != SPOKE_POOLS.get(dest_chain_id) or not topics or topics[0].lower() != FILLED_RELAY_TOPIC:
        return None
    if len(topics) < 3 or int(topics[1], 16) != dep.origin_chain_id or int(topics[2], 16) != dep.deposit_id:
        return None
    w = _words(data)
    return {"relayer": _addr(int(topics[3], 16)) if len(topics) > 3 else None,
            "output_amount": w[3] if len(w) > 3 else None, "recipient": _addr(w[9]) if len(w) > 9 else None}
