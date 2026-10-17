from decimal import Decimal

import pytest

from tracefuse.domain.amounts import display_str, is_round_amount, relative_difference, to_display
from tracefuse.domain.models import InvestigationConfig
from tracefuse.domain.validation import InvalidSeedError, classify_seed, is_valid_checksum, to_checksum_address
from tracefuse.logging_setup import redact
from tracefuse.providers.http import sanitize_url

RONIN = "0x098B716B8Aaf21512996dC57EB0615e2383E2f96"


def test_checksum_roundtrip():
    assert to_checksum_address(RONIN.lower()) == RONIN
    assert is_valid_checksum(RONIN)
    assert not is_valid_checksum(RONIN[:-1] + "6".upper() if RONIN[-1] != "6" else RONIN[:-1] + "7")


@pytest.mark.parametrize("raw,kind", [
    (RONIN, "address"), (RONIN.lower(), "address"), (RONIN[2:], "address"),
    ("0x" + "ab" * 32, "tx_hash"),
])
def test_classify_valid(raw, kind):
    c = classify_seed(raw)
    assert c.kind == kind and c.value == c.value.lower()


@pytest.mark.parametrize("raw,msg", [
    ("", "empty"), ("0x1234", "4 digits"), ("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", "Bitcoin"),
    ("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", "Tron"), ("vitalik.eth", "ENS"),
    ("0x098B716B8Aaf21512996dC57EB0615e2383E2f97", "checksum"), ("0x" + "0" * 40, "zero address"), ("hello", "Unrecognised"),
])
def test_classify_invalid(raw, msg):
    with pytest.raises(InvalidSeedError, match=msg):
        classify_seed(raw)


def test_decimal_precision_uint256():
    raw = 2**256 - 1
    assert display_str(raw, 18) == "115792089237316195423570985008687907853269984665640564039457.584007913129639935"
    assert to_display(173600 * 10**18, 18) == Decimal("173600")
    assert display_str(25_500_000 * 10**6, 6) == "25500000"
    assert display_str(5, None) is None


def test_amount_helpers():
    assert relative_difference(100, 99) == pytest.approx(0.01)
    assert is_round_amount(500 * 10**18, 18, 2)
    assert not is_round_amount(500 * 10**18 + 1, 18)


def test_config_bounds_and_window():
    with pytest.raises(ValueError):
        InvestigationConfig(seed=RONIN, max_hops=9)
    with pytest.raises(ValueError):
        InvestigationConfig(seed=RONIN, time_start="2022-05-01T00:00:00Z", time_end="2022-04-01T00:00:00Z")


def test_secret_redaction():
    url = sanitize_url("https://api.etherscan.io/v2/api?chainid=1&apikey=SECRET123&module=account")
    assert "SECRET123" not in url and "apikey" not in url
    assert sanitize_url("https://eth-mainnet.g.alchemy.com/v2/abcDEF123") == "https://eth-mainnet.g.alchemy.com/v2/[key]"
    assert "tok_abc" not in redact("Authorization: Bearer tok_abc123 ?apikey=zzz9", ["tok_abc123"])
