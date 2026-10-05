"""Creating a market, predicting, resolving in separated rounds, expiry."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import advance, load_contract, reset  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
mod = load_contract(ROOT)
gl = sys.modules["genlayer"]

DEPLOYER = "0x9999999999999999999999999999999999999999"
CREATOR = "0x1111111111111111111111111111111111111111"
ALICE = "0x2222222222222222222222222222222222222222"
BOB = "0x3333333333333333333333333333333333333333"

URL = "https://dao.example/proposals/42"
QUESTION = "Did proposal 42 pass?"
OUTCOMES = json.dumps(["Passed", "Rejected"])
RULE = "Resolve from the final tally the page publishes once voting has closed."
HOUR = 3600
DAY = 86400
M = "dao/42"


def _market(required="2", interval=str(HOUR), close_in=str(HOUR), resolve_in=str(DAY)):
    """Deploy from one account, create from another."""
    reset(gl)
    gl.message.sender_address = DEPLOYER
    c = mod.ResolveOnce()
    gl.message.sender_address = CREATOR
    c.create_market(
        M, QUESTION, OUTCOMES, URL, RULE, close_in, resolve_in, required, interval, str(30 * DAY)
    )
    return c


def _get(c):
    return json.loads(c.get_market(M))


def test_create_commits_everything_a_resolution_depends_on():
    c = _market()
    m = _get(c)
    assert m["status"] == "open" and m["creator"] == CREATOR
    assert m["question"] == QUESTION and m["source_url"] == URL
    assert m["outcomes"] == ["Passed", "Rejected"] and m["resolution_rule"] == RULE
    assert m["resolve_at"] == m["created_at"] + DAY
    assert m["predictions_close_at"] == m["created_at"] + HOUR
    assert m["expires_at"] == m["created_at"] + 30 * DAY
    assert m["confirmations_required"] == 2 and m["confirm_interval"] == HOUR
    assert m["next_round_at"] == m["resolve_at"]
    assert json.loads(c.get_stats())["open"] == 1


def test_two_agreeing_rounds_an_interval_apart_make_it_final():
    c = _market()
    advance(gl, DAY)
    c.resolve(M)
    m = _get(c)
    assert m["status"] == "proposed" and m["proposed_index"] == 0 and m["confirmations"] == 1
    assert m["last_round"] == "proposed" and m["final_index"] == -1
    assert json.loads(c.get_outcome(M))["final"] is False

    advance(gl, HOUR)
    c.resolve(M)
    m = _get(c)
    assert m["status"] == "resolved" and m["final_index"] == 0 and m["final_label"] == "Passed"
    out = json.loads(c.get_outcome(M))
    assert out == {
        "market_id": M,
        "status": "resolved",
        "final": True,
        "outcome_index": 0,
        "outcome_label": "Passed",
        "resolved_at": m["resolved_at"],
    }
    events = json.loads(c.get_events())
    assert [e["kind"] for e in events] == ["Created", "Round", "Resolved"]
    assert events[2]["at"] - events[1]["at"] == HOUR

    with pytest.raises(Exception, match="already closed"):
        c.resolve(M)


def test_one_confirmation_is_enough_when_the_creator_committed_to_one():
    c = _market(required="1")
    advance(gl, DAY)
    c.resolve(M)
    assert _get(c)["status"] == "resolved"


def test_not_determinable_yet_is_a_normal_answer():
    c = _market()
    advance(gl, DAY)
    gl.page = "Voting is still open. Current tally: 71% in favour."
    gl.llm_reply = '{"determined": false}'
    c.resolve(M)
    m = _get(c)
    assert m["status"] == "open" and m["proposed_index"] == -1 and m["confirmations"] == 0
    assert m["last_round"] == "undetermined" and m["rounds"] == 1


def test_predictions_are_recorded_once_and_scored_after_resolution():
    c = _market(required="1")
    gl.message.sender_address = ALICE
    c.predict(M, "0")
    gl.message.sender_address = BOB
    c.predict(M, "1")
    with pytest.raises(Exception, match="already predicted"):
        c.predict(M, "0")
    assert _get(c)["tally"] == [1, 1]
    rows = json.loads(c.get_predictions(M))
    assert [r["address"] for r in rows] == [ALICE, BOB] and "correct" not in rows[0]

    advance(gl, DAY)
    c.resolve(M)
    rows = {r["address"]: r for r in json.loads(c.get_predictions(M))}
    assert rows[ALICE]["correct"] is True and rows[BOB]["correct"] is False
    assert json.loads(c.get_stats())["predictions"] == 2


def test_predictions_close_at_the_committed_time():
    c = _market()
    advance(gl, HOUR - 1)
    gl.message.sender_address = ALICE
    with pytest.raises(Exception, match="between 0 and 1"):
        c.predict(M, "2")
    c.predict(M, "0")
    advance(gl, 1)
    gl.message.sender_address = BOB
    with pytest.raises(Exception, match="predictions are closed"):
        c.predict(M, "1")


def test_an_unresolved_market_is_voided_by_anyone_after_expiry():
    c = _market()
    gl.message.sender_address = BOB
    with pytest.raises(Exception, match="has not reached its expiry"):
        c.expire(M)
    advance(gl, 30 * DAY)
    with pytest.raises(Exception, match="has expired"):
        c.resolve(M)
    c.expire(M)
    m = _get(c)
    assert m["status"] == "void" and m["final_index"] == -1
    assert json.loads(c.get_outcome(M))["final"] is False
    with pytest.raises(Exception, match="already closed"):
        c.expire(M)


def test_the_schedule_view_tells_an_app_what_is_accepted_now():
    c = _market()
    s = json.loads(c.get_schedule(M))
    assert s["predictions_open"] is True and s["round_open"] is False
    assert s["seconds_until_round"] == DAY and s["can_expire"] is False
    advance(gl, DAY)
    s = json.loads(c.get_schedule(M))
    assert s["predictions_open"] is False and s["round_open"] is True
    c.resolve(M)
    s = json.loads(c.get_schedule(M))
    assert s["round_open"] is False and s["seconds_until_round"] == HOUR
    assert s["confirmations"] == 1 and s["confirmations_required"] == 2


def test_validation_rules():
    c = _market()
    args = (QUESTION, OUTCOMES, URL, RULE, str(HOUR), str(DAY))
    with pytest.raises(Exception, match="already exists"):
        c.create_market(M, *args)
    with pytest.raises(Exception, match="https://"):
        c.create_market("a", QUESTION, OUTCOMES, "http://dao.example/42", RULE, "60", "60")
    with pytest.raises(Exception, match="path segments"):
        c.create_market("b", QUESTION, OUTCOMES, "https://dao.example/a/../b", RULE, "60", "60")
    with pytest.raises(Exception, match="between 2 and 6"):
        c.create_market("c", QUESTION, json.dumps(["Only"]), URL, RULE, "60", "60")
    with pytest.raises(Exception, match="between 2 and 6"):
        c.create_market("d", QUESTION, json.dumps(list("abcdefg")), URL, RULE, "60", "60")
    with pytest.raises(Exception, match="distinct"):
        c.create_market("e", QUESTION, json.dumps(["Yes", "yes"]), URL, RULE, "60", "60")
    with pytest.raises(Exception, match="JSON array"):
        c.create_market("f", QUESTION, "Yes,No", URL, RULE, "60", "60")
    with pytest.raises(Exception, match="every outcome must be a string"):
        c.create_market("g", QUESTION, json.dumps(["Yes", 2]), URL, RULE, "60", "60")
    with pytest.raises(Exception, match="no later than resolution opens"):
        c.create_market("h", QUESTION, OUTCOMES, URL, RULE, "7200", "3600")
    with pytest.raises(Exception, match="resolve_in must be between"):
        c.create_market("i", QUESTION, OUTCOMES, URL, RULE, "60", "5")
    with pytest.raises(Exception, match="confirmations_required must be between 1 and 5"):
        c.create_market("j", QUESTION, OUTCOMES, URL, RULE, "60", "60", "9")
    with pytest.raises(Exception, match="confirm_interval must be between"):
        c.create_market("k", QUESTION, OUTCOMES, URL, RULE, "60", "60", "2", "5")
    with pytest.raises(Exception, match="expire_in must be at least"):
        c.create_market("l", QUESTION, OUTCOMES, URL, RULE, "60", "600", "3", "3600", "7200")
    with pytest.raises(Exception, match="question is required"):
        c.create_market("m", "  ", OUTCOMES, URL, RULE, "60", "60")
    assert json.loads(c.get_market("nope"))["error"] == "unknown market_id"
    assert json.loads(c.list_ids()) == [M]
    assert c.get_admin() == ""
