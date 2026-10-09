# ResolveOnce v2 — Studio Dev (chain 61997) deploy record

| | |
|---|---|
| **Network** | GenLayer Studio Dev / Studio Next — chain `61997`, GenVM `v0.3.0` |
| **Contract (v2)** | [`0xE4cBaaF13Aaf6aF3c8c5414bB5BaC1e5E60ABcBc`](https://explorer-studio-dev.genlayer.com/address/0xE4cBaaF13Aaf6aF3c8c5414bB5BaC1e5E60ABcBc) |
| **Source** | [`contracts/ResolveOnce.py`](contracts/ResolveOnce.py) — runner `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |
| **Source sha256** | `352092f4416a18c79b85684af40da544753462e5eeafc88d5c5c0124d8452084` |
| **Console** | https://valentinzubok.github.io/ResolveOnce/ |
| **Account A** | `0x9b4D377af0D74d965a82aa2E8E429873299a67b1` — test account: deployer, market creator, predicts "Passed" |
| **Account B** | `0x68D0CaF57A525AD9146B7dF81c8c5E3871ba7Bf9` — test account: predicts "Rejected" |
| **Owner / admin** | none — the contract has no privileged address; `get_admin()` returns `""` |

The v1 deployment the Project was accepted with is
[`0x6FB445e8edC50A7B01C88faBf8B0E925a2001355`](https://explorer-studio-dev.genlayer.com/address/0x6FB445e8edC50A7B01C88faBf8B0E925a2001355);
its source and record are in
[ResolveOnceCore](https://github.com/valentinzubok/ResolveOnceCore). What v2 adds is described in
[`docs/MILESTONE_STAKES.md`](docs/MILESTONE_STAKES.md).

## Verify that the deployed code equals this source

```bash
curl -s -X POST https://studio-dev.genlayer.com/api -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"gen_getContractCode","params":["0xE4cBaaF13Aaf6aF3c8c5414bB5BaC1e5E60ABcBc"]}' \
  | python3 -c "import sys,json,base64,hashlib; print(hashlib.sha256(base64.b64decode(json.load(sys.stdin)['result'])).hexdigest())"
shasum -a 256 contracts/ResolveOnce.py
# both print 352092f4416a18c79b85684af40da544753462e5eeafc88d5c5c0124d8452084
```

`scripts/verify_deployment.py` does the same check and runs in CI. The constructor takes no
arguments, so the deployed code is this file and nothing else.

## On-chain lifecycle: 7 GEN in, 7 GEN out

Two markets, both with a stake of 1 GEN per prediction. `dao/42` reads
[`vote-final.html`](web/public/fixtures/vote-final.html) (a certified result) and needs two agreeing
rounds 120 s apart. `dao/43` reads [`vote-open.html`](web/public/fixtures/vote-open.html) (voting
still open) and expires after 240 s.

The **balance** column is the contract's native GEN balance from `eth_getBalance`, read after the
step had been finalized.

| # | Who | Call | Result | Balance | Tx |
|---|-----|------|--------|--------:|----|
| 0 | A | deploy | contract created | 0 | `0xbd99a89b424ad0d9045a3de34b4b1c068084c342e671b48b5d5a1e8d705b5e01` |
| 1 | A | `create_market("dao/42", …, vote-final.html, …, 150, 180, 2, 120, 86400, stake=1 GEN)` | open | 0 | `0x113cab606d6e3861ede60aba6f7663559c00218e6c9b4a39549f20c7830b0164` |
| 2 | A | `create_market("dao/43", …, vote-open.html, …, 90, 90, 1, 60, 240, stake=1 GEN)` | open | 0 | `0xc2453989162874c4b28f246b7747d2036a18c831733b0c680aa61377e0efbdb2` |
| 3 | A | `predict("dao/43", 0)` + 1 GEN | escrowed | 1 | `0x5218f595a59795d84d9dac46b03c846a9b55750dc9edde39900244bc1b321f98` |
| 4 | B | `predict("dao/43", 1)` + 1 GEN | escrowed | 2 | `0x3f0572c507b0c084b81d6ee1ccb33b3590e769e3487ca8d00f2035be39fa9a7c` |
| 5 | A | `predict("dao/42", 0)` + 1 GEN | escrowed | 3 | `0x9ca74d67aff6e3c74a01d16394c561da3f18d94f2371ba50dd666f1825ebb9d5` |
| 6 | B | `predict("dao/42", 1)` + **3 GEN** | 1 GEN escrowed, **2 GEN credited back** to B | 6 | `0xdf9a8416977262b985885b071e009011921577fcdc412b7363e36ba020cdcb02` |
| 7 | A | `predict("dao/42", 1)` + 1 GEN, a second prediction | **refused without reverting**: nothing recorded, 1 GEN credited back to A | **7** | `0x3a2f89196e950980def401b5038085d2bb266729e6f7ac6fc7959daca7c75998` |
| 8 | B | `predict("dao/43", 0)` with no value, a second prediction | reverted — `this address has already predicted on this market` | 7 | `0x958205874a226024997f1b0152217d647d4db8bc2f26896f7568f2326ffaef46` (ERROR) |
| 9 | A | `claim("dao/42")` before it is final | reverted — `nothing to claim: market is not final yet` | 7 | `0xf5db8b4f29836e70caf73db1168bc2a496e013b5817dfa8169f5ec6d10e9ad5b` (ERROR) |
| 10 | B | `withdraw_credit()` | 2 GEN back to B's wallet | 5 | `0x13e29d4c64bee2d434f6997df331079d7fe88a8ce657805d0cec22e4a2d62aa3` |
| 11 | A | `withdraw_credit()` | 1 GEN back to A's wallet | **4** | `0x339da6685ed8f4f6a53fb04c3d107c8623ede771aa8951075e400ac10bb78617` |
| 12 | A | `resolve("dao/43")` | **undetermined** — the page shows a live tally and a forecast, not a result | 4 | `0x0ef9392daa537d6361f2a638ac55bb021640dc2fe9464dd1a837f26d68e8a3a6` |
| 13 | A | `resolve("dao/42")` at `1791563337` | **proposed: Passed**, 1 of 2 | 4 | `0x26816d3d938d4a50f45dc657e28c10e70b3001522da38b94b7edef160936f89e` |
| 14 | A | `resolve("dao/42")` at `1791563469`, 132 s later | **resolved: Passed**, final | 4 | `0xe0d52e65fd541688ea48240d81f896b31994c5184076fbb61ec726224ea598e9` |
| 15 | B | `claim("dao/42")` — the loser | reverted — `nothing to claim: this prediction was not the final outcome` | 4 | `0x34ff35918633417d7e81bb35a8a4d4035650aa27c17ae51ae72a2734bbc3fae4` (ERROR) |
| 16 | A | `claim("dao/42")` — the winner | **2 GEN (the whole pot) to A's wallet** | **2** | `0x37649defee2f2df1e02d95a5cfbcbef34db41c90d5026c933a97b908e5114b55` |
| 17 | A | `claim("dao/42")` again | reverted — `nothing to claim: already claimed` | 2 | `0xa6544e380e6754c82f3cc77e160ebe06abb3622cbf8ac4cf07a41ed746713383` (ERROR) |
| 18 | B | `expire("dao/43")` after 240 s | **void** — expired without a final result | 2 | `0x5368fc6744dcab7b2442684d1d21e74d68ea886f99045280f2eeda518397214e` |
| 19 | A | `claim("dao/43")` | 1 GEN stake back | 1 | `0xb6e29baea2d8787fcf3c4301dff5182b91ffab7b11896c078e9acb3ecbf21226` |
| 20 | B | `claim("dao/43")` | 1 GEN stake back | **0** | `0x0b8dccca6410fdc4204ad6924b6abc8ebf52f72829c03d97641da34f806dcd24` |

`get_stats` afterwards:
`{"markets":2,"open":0,"proposed":0,"resolved":1,"void":1,"predictions":4,"staked":"4000000000000000000","paid_out":"4000000000000000000","rounds":3}`
and `get_balance` is `0`.

Where the 7 GEN went: 4 were staked (2 per market) and 3 were sent in excess or to a refused
prediction. All 3 came back through `withdraw_credit`; the 4 staked left through `claim` — 2 as
winnings on `dao/42`, 2 as refunds on `dao/43`. Nothing stayed in the contract.

A's wallet around step 16, in wei: `2687896516926749955905` → `2689896224904499953730`, that is
+2 GEN less the fees of the two calls in between.

Two things this run does not show, both covered by `tests/test_stakes.py`: several winners sharing
a pot (including the rounding dust), and a market that resolves to an outcome nobody predicted.

### Notes for anyone reproducing this

- A payout is applied when the transaction is **finalized**, a few seconds to a couple of minutes
  after it is accepted. A balance read straight after `claim` can still show the old value.
- Step 8 was meant to show an unpaid prediction on a staked market. B had already predicted on
  `dao/43`, so the duplicate check fired first. The underpaid case is in the tests
  (`needs a stake`).
- The intervals are minutes so the flow can be reproduced quickly; a real market would use hours or
  days.
- An earlier v2 deployment, `0x28b9550628007f57d03EEC36971099c73B766F1a`, was abandoned before this
  run: its `Claimed` event wrote the payout type under the key `kind`, overwriting the event's own
  kind. The key is now `what`. Test stakes from the interrupted run are still in that contract.

## Design notes for reviewers

| Concern | Where it is handled |
|---|---|
| A payable method that really receives value | `predict` is `@gl.public.write.payable` and reads `gl.message.value`; steps 3–7 move the contract balance. |
| A payout that really reaches a wallet | `pay_wallet` uses an `@gl.evm.contract_interface` proxy, i.e. an external transfer. An internal message to a wallet succeeds and pays nobody. Steps 10, 11, 16, 19, 20 move the balance down to 0. |
| Value stranded by a revert | Value attached to a reverting call is not returned, so `predict` never raises once value is attached. Step 7 is refused and credited; `test_with_value_attached_predict_never_raises_and_credits_everything_back`. |
| No privileged withdrawal | No owner, fee or sweep. `test_payouts_are_external_wallet_transfers_and_nothing_else_moves_money`, `test_a_claim_pays_the_predictor_and_nobody_else`. |
| Solvency | `test_balance_equals_what_is_owed_through_a_random_run`: balance == unclaimed escrow + credits after every step of thirty random markets. Shares are `pot // winners`. |
| Re-entrancy style ordering | Claimed flag and `paid_out` are written before the transfer is emitted; `test_the_books_are_updated_before_the_transfer_is_emitted`. |
| Rate limits are elapsed time; inputs fixed at creation; literal JSON types; fail closed; untrusted data | Unchanged from v1 — see `tests/test_adversarial.py`. The stake is one more input fixed at creation. |
| Bounded evidence with no gaps | A page that fits the 4000-char budget is read whole; `test_a_page_that_fits_the_budget_is_read_whole`. |
