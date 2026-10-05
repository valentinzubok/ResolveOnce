# ResolveOnce v1 — Studio Dev (chain 61997) deploy record

| | |
|---|---|
| **Network** | GenLayer Studio Dev / Studio Next — chain `61997`, GenVM `v0.3.0` |
| **Contract** | [`0x6FB445e8edC50A7B01C88faBf8B0E925a2001355`](https://explorer-studio-dev.genlayer.com/address/0x6FB445e8edC50A7B01C88faBf8B0E925a2001355) |
| **Source** | [`contracts/ResolveOnce.py`](contracts/ResolveOnce.py) — runner `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |
| **Source sha256** | `4546dd20eca08335112fcf184d54c69b17260af776a3b3c458741435e2270e93` |
| **Console** | https://valentinzubok.github.io/ResolveOnce/ · [ResolveOnce](https://github.com/valentinzubok/ResolveOnce) |
| **Deployer** | `0x4130dC892bD57009Ba795d746354072465b84412` — a separate test account; it also places the losing prediction below |
| **Market creator in the demo** | `0xBA989D240AAB780d3d2eD2201f5F677098901408` (test account) |
| **Owner / admin** | none — the contract has no privileged address; `get_admin()` returns `""` |

## Verify that the deployed code equals this source

```bash
curl -s -X POST https://studio-dev.genlayer.com/api -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"gen_getContractCode","params":["0x6FB445e8edC50A7B01C88faBf8B0E925a2001355"]}' \
  | python3 -c "import sys,json,base64,hashlib; print(hashlib.sha256(base64.b64decode(json.load(sys.stdin)['result'])).hexdigest())"
shasum -a 256 contracts/ResolveOnce.py
# both print 4546dd20eca08335112fcf184d54c69b17260af776a3b3c458741435e2270e93
```

`scripts/verify_deployment.py` does the same check and runs in CI. The constructor takes no
arguments, so the deployed code is this file and nothing else.

## On-chain lifecycle

Both source pages are files in the console repository:
[`web/public/fixtures/`](https://github.com/valentinzubok/ResolveOnce/tree/main/web/public/fixtures).

Market `dao/42` reads `vote-final.html` (a certified result) with `confirmations_required = 2` and
`confirm_interval = 180`. Market `dao/43` reads `vote-open.html` (voting still open, 64.6% in
favour, "polls expect the proposal to pass").

| # | Caller | Step | Result | Tx |
|---|--------|------|--------|----|
| 0 | deployer | deploy | contract created | `0xb0bd5d09a148824ee98b063516b48aa813db1c27fb683e90b0683e0f54fc0d4f` |
| 1 | creator | `create_market("dao/42", …, vote-final.html, …, predictions_close_in=120, resolve_in=180, confirmations_required=2, confirm_interval=180, expire_in=86400)` | open; created at `1791227756`, `resolve_at = 1791227936` | `0x6d8f483a2b39b6294a5d179c838cd55e85a0c4667ebe1110694bebf43ff8bc77` |
| 2 | creator | `create_market("dao/43", …, vote-open.html, …, resolve_in=120, confirmations_required=1, confirm_interval=120)` | open | `0x4c04a42ab01d1d40040db9ee2557fe5f898749f3e904a04d8c911899c42799ee` |
| 3 | creator | `predict("dao/42", 0)` — Passed | recorded | `0x15d44b842889612a166a75e4ab65b282b1352f97f7dc4b3dac6acb64150463c8` |
| 4 | deployer | `predict("dao/42", 1)` — Rejected | recorded | `0xea717eb471d539c8f3ee8c993f1042710adef7da316f635e962b43b1e9a9ef29` |
| 5 | creator | `resolve("dao/42")` before the resolve time | **reverted** — `a resolution round is not accepted yet; the next one is accepted at 1791227936`. The page was not fetched. | `0xe730b609b5c8a60d9c948f9fe62c11d7d3f6dc9e56452a0b481d67efa562c6c6` (ERROR) |
| 6 | creator | `resolve("dao/42")` at `1791227939` | **proposed, 1 of 2** — validators agreed the page states "Passed". Not final. `next_round_at` moves to this transaction + 180 s. | `0x434f4b539f5d7c27441cc9d98671e6e3a17a13f5ee759116a0e08d9e2f62ee0b` |
| 7 | creator | `resolve("dao/42")` again, immediately | **reverted** — `…the next one is accepted at 1791228119`: 180 s after step 6, not at the next multiple of 180. | `0x5e6daeac2c579e98825b1378dd9c7b565b8911b76fb77c8829eb185876227759` (ERROR) |
| 8 | creator | `resolve("dao/43")` | **undetermined** — validators agreed the page does not state a final result. Nothing proposed, even though this market needs only one confirmation and the page shows a leading side and a forecast. | `0x98e86b22ffa6f033e877ea9cb36787ff91fc519d8014b4ee61b67147d0d2a57a` |
| 9 | creator | `resolve("dao/42")` at `1791228125` | **resolved: Passed** — second agreeing round, 186 s after the first, same page hash. Final. | `0x5472b39868d256ce12765260611beac47675db3dac9a42b92e8440fae40946ac` |

State after step 9:

- `get_outcome("dao/42")` → `{"final":true,"outcome_index":0,"outcome_label":"Passed","status":"resolved",…}`
- `get_predictions("dao/42")` → the creator's `Passed` is `correct: true`, the deployer's `Rejected`
  is `correct: false`. Deploying the contract bought no say in the result.
- `dao/43` is still `open` with `last_round: "undetermined"`; it will be voided by `expire()` if
  the page never carries a result.
- `get_stats` → `{"markets":2,"open":1,"proposed":0,"resolved":1,"void":0,"predictions":2,"rounds":3}`:
  five `resolve` transactions, three accepted rounds.

The intervals are minutes here so the flow can be reproduced quickly; a real market would use
hours or days (`confirm_interval` accepts 60 s – 30 days, the horizons up to 365 days).

### A note on the page renderer's cache

Studio Dev's page renderer can serve a cached copy of a URL for several minutes, so a round right
after a commit to a source page may legitimately read the previous text. That is one more reason a
single round is only a proposal. The demo above uses pages that did not change during the run.

## Design notes for reviewers

| Concern | Where it is handled |
|---|---|
| Rate limits must be elapsed time, not calendar windows | `next_round_at` is stored per market and set to `now + confirm_interval` by every accepted round; `tests/test_adversarial.py::test_two_calls_straddling_a_clock_boundary_are_still_one_round`. |
| No privileged override of user-held state | No owner storage, constructor argument or ownership transfer; no `cancel`/`void`/`force_resolve`; `test_the_committed_terms_have_no_setter`, `test_the_creator_and_the_deployer_have_no_special_power_after_creation`. |
| Model output validated as literal JSON types | `literal_bool` and `literal_index`; nineteen malformed replies in `test_a_malformed_answer_reverts_and_records_nothing`. |
| Fail closed | No `strict_eq` fallback for the verdict; `principle` passed positionally; `test_a_consensus_failure_reverts_even_one_round_from_final`. A reverted round leaves no trace: the round counters are written only after the verdict exists. |
| Inputs fixed at creation, not at resolution time | `resolve(market_id)` has one parameter; `test_resolve_takes_no_url_no_rule_and_no_outcome`. |
| Untrusted data | Question, outcome labels, rule and page excerpts are fenced, inner fences scrubbed, injection phrasing flagged and stored. |
| Bounded, deterministic evidence | SHA-256 over the whole normalized document; ≤4000 chars of non-overlapping windows for the model. |
