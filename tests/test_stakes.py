"""Staked predictions: the escrow has exactly three ways out, and no way to get stuck.

Every prediction on a staked market escrows the market's stake in the contract. The pot
goes to the winners, or back to everyone when nobody was right or the market expired.
Value attached to a reverting call is not returned by the network, so predict() must
never raise once value is attached; and a wallet is paid with an external transfer.
"""

import json
import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import advance, load_contract, pay, reset  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
mod = load_contract(ROOT)
gl = sys.modules["genlayer"]

DEPLOYER = "0x9999999999999999999999999999999999999999"
CREATOR = "0x1111111111111111111111111111111111111111"
ALICE = "0x2222222222222222222222222222222222222222"
BOB = "0x3333333333333333333333333333333333333333"
CAROL = "0x4444444444444444444444444444444444444444"
STRANGER = "0x5555555555555555555555555555555555555555"

URL = "https://dao.example/proposals/42"
QUESTION = "Did proposal 42 pass?"
OUTCOMES = json.dumps(["Passed", "Rejected"])
RULE = "Resolve from the final tally the page publishes once voting has closed."
HOUR = 3600
DAY = 86400
GEN = 10**18
M = "dao/42"


def _market(stake=GEN, required="1", market_id=M, expire_in=str(30 * DAY)):
    """Deploy from one account, create a staked market from another."""
    gl.message.sender_address = DEPLOYER
    c = mod.ResolveOnce()
    return _add_market(c, stake, required, market_id, expire_in)


def _add_market(c, stake=GEN, required="1", market_id=M, expire_in=str(30 * DAY)):
    gl.message.sender_address = CREATOR
    c.create_market(
        market_id,
        QUESTION,
        OUTCOMES,
        URL,
        RULE,
        str(HOUR),
        str(DAY),
        required,
        str(HOUR),
        expire_in,
        str(stake),
    )
    return c


def _predict(c, who, outcome, value=GEN, market_id=M):
    gl.message.sender_address = who
    return json.loads(pay(gl, c.predict, value, market_id, str(outcome)))


def _resolve(c, outcome=0, market_id=M):
    gl.llm_reply = json.dumps({"determined": True, "outcome": outcome})
    gl.message.sender_address = STRANGER
    c.resolve(market_id)


def _claim(c, who, market_id=M):
    gl.message.sender_address = who
    return json.loads(c.claim(market_id))


def _pot(c, market_id=M):
    return json.loads(c.get_pot(market_id))


def _owed(c):
    """Everything the contract still owes: unclaimed escrow plus credits."""
    owed = 0
    for mid in json.loads(c.list_ids()):
        pot = _pot(c, mid)
        owed += int(pot["pot"]) - int(pot["paid_out"])
    for who in (DEPLOYER, CREATOR, ALICE, BOB, CAROL, STRANGER):
        owed += int(c.get_credit(who))
    return owed


@pytest.fixture(autouse=True)
def _fresh():
    reset(gl)
    yield


# ── 1. money in ───────────────────────────────────────────────────────────────


def test_a_prediction_escrows_exactly_the_market_stake():
    c = _market()
    out = _predict(c, ALICE, 0)
    assert out == {"recorded": True, "escrowed": str(GEN), "credited": "0"}
    assert gl.balance == GEN and c.get_balance() == str(GEN)
    pot = _pot(c)
    assert pot["stake"] == str(GEN) and pot["pot"] == str(GEN) and pot["mode"] == "escrowed"
    row = json.loads(c.get_predictions(M))[0]
    assert row["address"] == ALICE and row["stake"] == str(GEN) and row["claimed"] is False
    assert gl.transfers == []


def test_an_overpayment_is_credited_back_not_kept():
    c = _market()
    out = _predict(c, ALICE, 0, value=3 * GEN)
    assert out == {"recorded": True, "escrowed": str(GEN), "credited": str(2 * GEN)}
    assert _pot(c)["pot"] == str(GEN) and c.get_credit(ALICE) == str(2 * GEN)
    gl.message.sender_address = ALICE
    assert c.withdraw_credit() == str(2 * GEN)
    assert gl.transfers == [(ALICE, 2 * GEN)] and gl.balance == GEN
    with pytest.raises(Exception, match="no credit"):
        c.withdraw_credit()


def test_the_stake_is_fixed_at_creation_and_validated():
    c = _market(stake=5 * GEN)
    assert json.loads(c.get_market(M))["stake"] == str(5 * GEN)
    for name in ("set_stake", "set_fee", "withdraw", "sweep", "rescue", "collect_fees"):
        assert not hasattr(c, name), name
    for bad in ("-1", str(10**24 + 1), "lots", "1.5"):
        with pytest.raises(Exception, match="stake must be"):
            _add_market(c, stake=bad, market_id="bad")
    _add_market(c, stake=0, market_id="free")
    assert json.loads(c.get_market("free"))["stake"] == "0"


def test_a_free_market_still_works_and_returns_value_sent_by_mistake():
    c = _market(stake=0)
    out = _predict(c, ALICE, 0, value=0)
    assert out == {"recorded": True, "escrowed": "0", "credited": "0"}
    out = _predict(c, BOB, 1, value=GEN)
    assert out == {"recorded": True, "escrowed": "0", "credited": str(GEN)}
    assert c.get_credit(BOB) == str(GEN) and _pot(c)["pot"] == "0"
    advance(gl, DAY)
    _resolve(c, 0)
    with pytest.raises(Exception, match="no stakes"):
        _claim(c, ALICE)


# ── 2. value can never be stranded ────────────────────────────────────────────


def _refusals(c):
    """Every way predict() can refuse, each as (caller, market, outcome, value, reason)."""
    return [
        (ALICE, "no/such", 0, GEN, "unknown market_id"),
        (ALICE, "bad id!", 0, GEN, "market_id: only"),
        (ALICE, M, 2, GEN, "outcome_index must be between 0 and 1"),
        (ALICE, M, "x", GEN, "outcome_index must be an integer"),
        (ALICE, M, 0, GEN - 1, "needs a stake"),
        (BOB, M, 0, GEN, "already predicted"),
    ]


def test_with_value_attached_predict_never_raises_and_credits_everything_back():
    c = _market()
    _predict(c, BOB, 1)
    before = (c.get_market(M), c.get_predictions(M))
    for who, market, outcome, value, reason in _refusals(c):
        credit_before = int(c.get_credit(who))
        out = _predict(c, who, outcome, value=value, market_id=market)
        assert out["recorded"] is False and out["escrowed"] == "0"
        assert out["credited"] == str(value) and reason in out["reason"]
        assert int(c.get_credit(who)) == credit_before + value
    assert (c.get_market(M), c.get_predictions(M)) == before  # nothing recorded
    assert gl.balance == _owed(c)  # every wei is either escrow or somebody's credit


def test_predictions_after_the_close_and_on_a_settled_market_are_credited_back():
    c = _market()
    _predict(c, ALICE, 0)
    advance(gl, HOUR)
    out = _predict(c, BOB, 1)
    assert out["recorded"] is False and "predictions are closed" in out["reason"]
    advance(gl, DAY)
    _resolve(c, 0)
    out = _predict(c, CAROL, 0)
    assert out["recorded"] is False and "market is closed" in out["reason"]
    assert c.get_credit(BOB) == str(GEN) and c.get_credit(CAROL) == str(GEN)
    assert _pot(c)["pot"] == str(GEN)  # late money never entered the pot
    assert gl.balance == _owed(c)


def test_without_value_the_same_refusals_raise_as_before():
    c = _market(stake=0)
    _predict(c, BOB, 1, value=0)
    for who, market, outcome, _value, reason in _refusals(c):
        if "needs a stake" in reason:
            continue
        gl.message.sender_address = who
        with pytest.raises(Exception, match=reason.replace("(", r"\(")):
            c.predict(market, str(outcome))
    c = _market()
    gl.message.sender_address = ALICE
    with pytest.raises(Exception, match="needs a stake"):
        c.predict(M, "0")


def test_money_can_only_arrive_through_predict():
    c = _market()
    for method, args in (
        (c.resolve, (M,)),
        (c.claim, (M,)),
        (c.expire, (M,)),
        (c.withdraw_credit, ()),
        (c.create_market, (M,)),
    ):
        with pytest.raises(Exception, match="not payable"):
            pay(gl, method, GEN, *args)


# ── 3. money out: winners split the pot ───────────────────────────────────────


def test_the_winner_takes_the_whole_pot_and_the_loser_nothing():
    c = _market()
    _predict(c, ALICE, 0)
    _predict(c, BOB, 1)
    advance(gl, DAY)
    with pytest.raises(Exception, match="not final yet"):
        _claim(c, ALICE)
    _resolve(c, 0)

    pot = _pot(c)
    assert pot["mode"] == "winners_split_pot" and pot["winners"] == 1
    assert pot["share"] == str(2 * GEN)
    assert json.loads(c.get_claimable(M, ALICE))["amount"] == str(2 * GEN)
    assert json.loads(c.get_claimable(M, BOB))["amount"] == "0"

    assert _claim(c, ALICE) == {"kind": "winnings", "amount": str(2 * GEN)}
    assert gl.transfers == [(ALICE, 2 * GEN)] and gl.balance == 0
    event = json.loads(c.get_events())[-1]
    assert event["kind"] == "Claimed" and event["what"] == "winnings"
    assert event["by"] == ALICE and event["amount"] == str(2 * GEN)
    with pytest.raises(Exception, match="not the final outcome"):
        _claim(c, BOB)
    with pytest.raises(Exception, match="already claimed"):
        _claim(c, ALICE)
    assert gl.transfers == [(ALICE, 2 * GEN)]
    stats = json.loads(c.get_stats())
    assert stats["staked"] == str(2 * GEN) and stats["paid_out"] == str(2 * GEN)


def test_several_winners_get_equal_shares():
    c = _market()
    _predict(c, ALICE, 0)
    _predict(c, BOB, 0)
    _predict(c, CAROL, 1)
    advance(gl, DAY)
    _resolve(c, 0)
    share = 3 * GEN // 2
    assert _claim(c, BOB)["amount"] == str(share)
    assert _claim(c, ALICE)["amount"] == str(share)
    assert sorted(gl.transfers) == sorted([(ALICE, share), (BOB, share)])
    assert gl.balance == 0


def test_indivisible_dust_stays_put_and_no_claim_exceeds_the_pot():
    c = _market(stake=1)
    _predict(c, ALICE, 0, value=1)
    _predict(c, BOB, 0, value=1)
    _predict(c, CAROL, 1, value=1)
    advance(gl, DAY)
    _resolve(c, 0)
    assert _pot(c)["share"] == "1"  # 3 wei between 2 winners
    _claim(c, ALICE)
    _claim(c, BOB)
    pot = _pot(c)
    assert int(pot["paid_out"]) == 2 <= int(pot["pot"]) and gl.balance == 1


def test_a_claim_pays_the_predictor_and_nobody_else():
    c = _market()
    _predict(c, ALICE, 0)
    _predict(c, BOB, 1)
    advance(gl, DAY)
    _resolve(c, 0)
    for other in (STRANGER, CREATOR, DEPLOYER):
        with pytest.raises(Exception, match="has no prediction"):
            _claim(c, other)
    with pytest.raises(TypeError):
        gl.message.sender_address = STRANGER
        c.claim(M, ALICE)  # type: ignore[call-arg]
    assert gl.transfers == [] and gl.balance == 2 * GEN
    _claim(c, ALICE)
    assert gl.transfers == [(ALICE, 2 * GEN)]


# ── 4. money out: stakes go back ──────────────────────────────────────────────


def test_when_nobody_was_right_everyone_takes_their_stake_back():
    reset(gl)
    gl.message.sender_address = DEPLOYER
    c = mod.ResolveOnce()
    gl.message.sender_address = CREATOR
    c.create_market(
        M,
        "Who won?",
        json.dumps(["Red", "Blue", "Green"]),
        URL,
        RULE,
        str(HOUR),
        str(DAY),
        "1",
        str(HOUR),
        str(30 * DAY),
        str(GEN),
    )
    _predict(c, ALICE, 0)
    _predict(c, BOB, 1)
    advance(gl, DAY)
    _resolve(c, 2)
    pot = _pot(c)
    assert pot["winners"] == 0 and pot["mode"] == "everyone_refunded"
    assert _claim(c, ALICE) == {"kind": "refund", "amount": str(GEN)}
    assert _claim(c, BOB) == {"kind": "refund", "amount": str(GEN)}
    assert gl.balance == 0


def test_an_expired_market_refunds_every_stake():
    c = _market(required="2", expire_in=str(2 * DAY))
    _predict(c, ALICE, 0)
    _predict(c, BOB, 1)
    advance(gl, DAY)
    _resolve(c, 0)  # a proposal only
    with pytest.raises(Exception, match="not final yet"):
        _claim(c, ALICE)
    advance(gl, DAY)
    gl.message.sender_address = STRANGER
    c.expire(M)
    assert _pot(c)["mode"] == "everyone_refunded"
    assert _claim(c, BOB)["kind"] == "refund" and _claim(c, ALICE)["kind"] == "refund"
    assert sorted(gl.transfers) == sorted([(ALICE, GEN), (BOB, GEN)]) and gl.balance == 0
    with pytest.raises(Exception, match="already claimed"):
        _claim(c, ALICE)


# ── 5. the books always balance ───────────────────────────────────────────────


def test_markets_do_not_share_money():
    c = _market(stake=GEN, market_id="a")
    _add_market(c, stake=5 * GEN, market_id="b")
    _predict(c, ALICE, 0, value=GEN, market_id="a")
    _predict(c, BOB, 1, value=GEN, market_id="a")
    _predict(c, ALICE, 1, value=5 * GEN, market_id="b")
    _predict(c, CAROL, 0, value=5 * GEN, market_id="b")
    advance(gl, DAY)
    _resolve(c, 0, market_id="a")
    assert _claim(c, ALICE, market_id="a")["amount"] == str(2 * GEN)
    assert gl.balance == 10 * GEN  # market b is untouched
    with pytest.raises(Exception, match="not final yet"):
        _claim(c, CAROL, market_id="b")
    advance(gl, HOUR)
    _resolve(c, 0, market_id="b")
    assert _claim(c, CAROL, market_id="b")["amount"] == str(10 * GEN)
    assert gl.balance == 0


def test_balance_equals_what_is_owed_through_a_random_run():
    """Thirty random markets: after every single step, balance == escrow + credits."""
    rng = random.Random(42)
    people = [ALICE, BOB, CAROL, STRANGER]
    for round_no in range(30):
        reset(gl)
        stake = rng.choice([1, 7, GEN, 3 * GEN])
        c = _market(stake=stake, required="1", expire_in=str(3 * DAY))
        for who in rng.sample(people, rng.randint(0, 4)):
            value = stake + rng.choice([0, 0, 1, -1, stake])
            _predict(c, who, rng.randint(0, 2), value=max(value, 0) or 1)
            assert gl.balance == _owed(c)
        ending = rng.choice(["resolved", "void"])
        if ending == "resolved":
            advance(gl, DAY)
            _resolve(c, rng.randint(0, 1))
        else:
            advance(gl, 3 * DAY)
            gl.message.sender_address = STRANGER
            c.expire(M)
        for who in rng.sample(people, 4):
            for action in (lambda: c.claim(M), c.withdraw_credit):
                gl.message.sender_address = who
                try:
                    action()
                except Exception:
                    pass
                assert gl.balance == _owed(c)
        pot = _pot(c)
        assert int(pot["paid_out"]) <= int(pot["pot"])
        assert gl.balance == int(pot["pot"]) - int(pot["paid_out"])  # only dust is left
        assert gl.balance < 4


# ── 6. how the money leaves ───────────────────────────────────────────────────


def test_payouts_are_external_wallet_transfers_and_nothing_else_moves_money():
    source = (ROOT / "contracts" / "ResolveOnce.py").read_text(encoding="utf-8")
    code = "\n".join(line for line in source.splitlines() if not line.lstrip().startswith("#"))
    assert "@gl.evm.contract_interface" in code
    assert code.count("pay_wallet(") == 3  # the helper, claim and withdraw_credit
    assert code.count("emit_transfer(") == 1
    for forbidden in ("gl.chain.Account", "gl.contract.get_at", "gl.transfer(", "self.owner"):
        assert forbidden not in code, forbidden
    assert code.count("@gl.public.write.payable") == 1


def test_the_books_are_updated_before_the_transfer_is_emitted():
    c = _market()
    _predict(c, ALICE, 0)
    advance(gl, DAY)
    _resolve(c, 0)
    seen = {}
    real = mod.pay_wallet

    def spy(address, amount):
        row = [r for r in json.loads(c.get_predictions(M)) if r["address"] == address][0]
        seen["claimed_before_transfer"] = row["claimed"]
        seen["paid_out_before_transfer"] = _pot(c)["paid_out"]
        real(address, amount)

    mod.pay_wallet = spy
    try:
        _claim(c, ALICE)
    finally:
        mod.pay_wallet = real
    assert seen == {"claimed_before_transfer": True, "paid_out_before_transfer": str(GEN)}


# ── 7. the whole source page is read ──────────────────────────────────────────


def test_a_page_that_fits_the_budget_is_read_whole():
    doc = "Results archive. " + "x" * 900 + " Final result: PASSED " + "y" * 1500 + " end."
    assert len(doc) < mod.EVIDENCE_BUDGET_CHARS
    d = mod.build_digest(doc, QUESTION + " " + RULE)
    assert d["covers_whole_document"] is True and d["excerpt_chars"] == len(doc)
    assert len(d["excerpts"]) == 1 and d["excerpts"][0]["text"] == doc
    assert mod.build_digest("", RULE)["excerpts"] == []


def test_a_keyword_inside_a_kept_window_does_not_hide_a_later_occurrence():
    filler = "Ordinary notes about committees, budgets and meeting minutes. " * 90
    doc = "The tally is discussed here in passing. " + filler + "Final tally: PASSED 71%."
    d = mod.build_digest(doc, "tally")
    assert any("PASSED 71%" in e["text"] for e in d["excerpts"])


def test_spare_windows_are_spent_on_text_nobody_has_looked_at():
    doc = "".join(f"[{i:04d}]" + "q" * 494 for i in range(12))  # 6000 chars, no keyword
    d = mod.build_digest(doc, RULE)
    assert len(d["excerpts"]) == mod.MAX_WINDOWS
    assert [e["from_char"] for e in d["excerpts"]] == [i * 500 for i in range(6)]
    assert d["excerpt_chars"] <= mod.EVIDENCE_BUDGET_CHARS
