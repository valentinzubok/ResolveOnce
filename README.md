# ResolveOnce

<p align="center">
  <img src="assets/logo.png" alt="ResolveOnce" width="120" />
</p>

<p align="center">
  <strong>A market resolution nobody is trusted to announce.</strong>
</p>

<p align="center">
  <a href="https://valentinzubok.github.io/ResolveOnce/"><img src="https://img.shields.io/badge/Live-Console-a78bfa?style=flat-square" alt="Live console" /></a>
  <a href="https://github.com/valentinzubok/ResolveOnce/actions/workflows/ci.yml"><img src="https://github.com/valentinzubok/ResolveOnce/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/GenLayer-Studio%20Dev%2061997-a78bfa?style=flat-square" alt="Studio Dev" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="MIT" /></a>
</p>

---

## The trust problem

A prediction market is only as honest as whoever says how it ended. A single resolver can be
wrong, bribed or simply early; a multisig moves the same problem to five people; a price-feed
oracle cannot read a governance page, a court docket or a results table at all.

**ResolveOnce makes "what does the source say happened?" a consensus question, and makes one
answer not enough.**

```
create_market(market_id, question, outcomes_json, source_url, resolution_rule,
              predictions_close_in, resolve_in,
              confirmations_required, confirm_interval, expire_in)
      the question, the closed list of outcomes, the ONE page that will carry the result,
      the rule for reading it and every time limit are fixed here. Nothing has a setter.

predict(market_id, outcome_index)    one prediction per address, immutable, refused once
                                     predictions_close_at has passed

resolve(market_id)                   anyone may call it; it takes a market id and nothing else
      refused before the committed resolve time, and before a full confirm_interval has
      elapsed since the last accepted round - an early call reverts before the page is fetched
      validators fetch THE COMMITTED PAGE, freeze it under eq_principle.strict_eq and agree on
      one answer: which listed outcome the page states as a final result, or none yet
        not determinable  -> nothing is proposed; an earlier proposal is withdrawn
        outcome k         -> a proposal with 1 confirmation, or +1 if k was already proposed
        a different k     -> the count starts again from 1
        unreachable       -> confirms nothing and overturns nothing
      after confirmations_required agreeing rounds, each a full interval apart: FINAL

expire(market_id)                    anyone, once expires_at has passed without a final result
get_outcome(market_id)               what a consumer reads: {final, outcome_index, outcome_label}
```

### Why it fails the way it does

A final result cannot be undone, so the fail-safe direction is to record nothing: a malformed
model answer, a model error or a consensus failure **reverts the transaction**.

| Risk | What stops it |
|---|---|
| The resolver announces the wrong result | There is no resolver. `resolve()` takes no outcome, no URL and no rule; all three were fixed at `create_market()`. |
| Resolving before the event | `resolve()` reverts until the committed `resolve_at`. Time is the transaction datetime, which GenVM pins so every validator reads the same value. |
| A source page edited to say something for five minutes | One agreeing round is only a proposal. Finality needs `confirmations_required` rounds naming the same outcome, each at least `confirm_interval` seconds after the previous accepted round. A round that reads a different outcome restarts the count; a round that no longer finds a result withdraws the proposal. |
| Hammering `resolve()` to collect confirmations quickly | `next_round_at` is stored on chain and moves to *this transaction's time + confirm_interval* after every accepted round. It is elapsed time, not a calendar window, so two calls either side of a clock boundary are one round. |
| A live tally, odds or a confident forecast read as a result | The prompt treats forecasts, polls, partial scores and "expected" as not final, and "not determinable yet" is a normal answer rather than an error. |
| The model returns `"1"`, `true`, `1.0`, a label, or an index that is not listed | `literal_index()` accepts only a JSON integer inside the outcome list and `literal_bool()` only JSON `true`/`false`. Anything else reverts and no round is recorded. |
| An outage being read as a result, or as a contradiction | An unreachable or empty source confirms nothing and overturns nothing, and still uses up its interval so it cannot be hammered. |
| An administrator voiding or forcing a market | There is none: no owner, no admin, no ownership transfer, no `cancel`, no `force_resolve`. The creator has no power once the market exists; the deployer is an ordinary account. |
| A market that can never resolve staying open forever | `expire()` is callable by anyone once the committed `expires_at` has passed, and `create_market()` refuses an expiry that leaves no room for every confirmation round. |
| The page or the creator's own text steering the model | Question, outcome labels, rule and page excerpts are fenced as untrusted data, inner fences are neutralized, and injection phrasing is flagged to the model and stored on the market. |
| Only the top of a long page being read | The whole document is hashed; the model reads ≤4000 chars from the head plus non-overlapping windows around the market's own words. |
| Consensus quietly degrading | No fallback: if `prompt_comparative` cannot run, the transaction reverts. `principle` is passed positionally (it is positional-only in GenVM v0.3). |

## Live

| | |
|---|---|
| Console | **https://valentinzubok.github.io/ResolveOnce/** (reads work with no wallet) |
| Network | GenLayer Studio Dev / Studio Next — chain `61997` |
| Contract | [`0x6FB445e8edC50A7B01C88faBf8B0E925a2001355`](https://explorer-studio-dev.genlayer.com/address/0x6FB445e8edC50A7B01C88faBf8B0E925a2001355) |
| Contract-only repo | [ResolveOnceCore](https://github.com/valentinzubok/ResolveOnceCore) |
| Deploy record | [`STUDIO_DEV_DEPLOY.md`](STUDIO_DEV_DEPLOY.md) — every transaction of the demo, including the refused ones |

`scripts/verify_deployment.py` runs in CI and fails the build if the deployed bytes stop matching
[`contracts/ResolveOnce.py`](contracts/ResolveOnce.py).

## The source pages are files in this repository

- [`web/public/fixtures/vote-final.html`](web/public/fixtures/vote-final.html) — a certified
  result stated as a fact that has already happened.
- [`web/public/fixtures/vote-open.html`](web/public/fixtures/vote-open.html) — voting still open,
  with a leading side, a percentage and a confident forecast. It looks like an answer and is not
  one; on chain the validators agreed it is "not determinable yet".

## The console

[`web/`](web/) — Next.js 16 + `genlayer-js` 2.0.0-rc.1 + MetaMask, exported statically to Pages.
It reads markets, schedules, predictions and events from chain without a wallet, writes
`create_market` / `predict` / `resolve` / `expire` through MetaMask with Studio Dev fees, disables
a button whose call would revert (`get_schedule` is a free view), and distinguishes `ACCEPTED`
from `FINALIZED` rather than presenting acceptance as completion.

```bash
cd web
npm install
npm run dev      # http://localhost:3016
```

## Tests

```bash
pip install -r requirements-dev.txt
python3 -m pytest -q      # 51 tests
```

`tests/test_adversarial.py` is the half that matters:

- **Nothing malformed becomes a result.** Nineteen malformed answers — quoted booleans and
  indexes, `true` as an index, floats, an out-of-range index, a label, a missing key, non-JSON —
  each revert and leave the market untouched; so do a model error and a consensus failure one
  round from final.
- **It cannot be hurried.** Refused before the resolve time; a second round inside the interval
  reverts for four different accounts without fetching anything; two calls straddling a clock
  boundary are one round; a caller hammering every ten minutes cannot finalize a 4-confirmation
  market before the committed number of intervals.
- **A brief edit resolves nothing.** A different outcome restarts the count, a disappearing
  result withdraws the proposal, an unreachable source neither confirms nor overturns, and an
  unreachable source alone never resolves a market.
- **It cannot be steered or overridden.** `resolve` takes no URL, rule or outcome; there is no
  setter, owner, cancel or force; the creator and the deployer cannot void a live market.
- Injection on the page and in the creator's own question, rule and outcome labels; a result
  buried deep in a long page; digest bounds and determinism; expiry in both directions.

## License

[MIT](LICENSE) © 2026 Valentyn Zubok
