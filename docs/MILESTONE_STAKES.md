# Milestone — ResolveOnce v2: stakes, escrow and payout

The ResolveOnce accepted into Project Explorer resolves a market without a resolver, and lets
people record a prediction. The prediction costs nothing and wins nothing: the contract could say
who was right, and that was all.

This milestone puts money behind the answer and makes the contract responsible for it.

| | |
|---|---|
| **New contract functionality** | A market fixes a stake. `predict` is payable and escrows it. `claim` pays the winners the pot, or returns every stake when nobody was right or the market expired. `withdraw_credit` returns anything that could not be escrowed. |
| **New deployment** | [`0xE4cBaaF13Aaf6aF3c8c5414bB5BaC1e5E60ABcBc`](https://explorer-studio-dev.genlayer.com/address/0xE4cBaaF13Aaf6aF3c8c5414bB5BaC1e5E60ABcBc) on Studio Dev (61997), sha256 `352092f4…` = `contracts/ResolveOnce.py`, checked in CI |
| **On-chain proof** | 7 GEN in, 7 GEN out, contract balance back to 0: [`STUDIO_DEV_DEPLOY.md`](../STUDIO_DEV_DEPLOY.md) |
| **Tests** | 21 new in [`tests/test_stakes.py`](../tests/test_stakes.py); 72 in total |
| **Console** | Stake field, staked predict, pot and paid-out per market, a claim button showing what you are owed, a credit banner |
| **Also fixed** | The evidence digest could skip text between two windows on a short page. A page that fits the budget is now read whole. |

## What changed in the contract

| v1 (accepted Project) | v2 (this milestone) |
|---|---|
| `predict(market_id, outcome_index)` records a free prediction | `predict` is `@gl.public.write.payable`; on a staked market it escrows exactly `stake` wei |
| `create_market(...)` — 10 parameters | an 11th, `stake`, fixed at creation like the rest; `"0"` keeps a market free |
| No money in the contract | `pot`, `paid_out` and `claims` per market; `credits_json` for money owed outside a market |
| — | `claim(market_id)`: winners split the pot equally; everyone is refunded if nobody was right or the market is void |
| — | `withdraw_credit()` |
| — | views `get_pot`, `get_claimable`, `get_credit`, `get_balance`; `get_stats` reports `staked` and `paid_out` |
| Digest: head + keyword windows, overlapping windows dropped | whole page if it fits; every keyword occurrence; spare windows spent on uncovered text |

Everything v1 guaranteed about the resolution itself is unchanged: no caller-supplied inputs, no
resolution before the committed time, rounds a full interval apart, literal JSON types, no
fallback, no owner.

## Three things the network taught this code

Each of these was found by running it on Studio Dev, not by reading documentation.

1. **Value attached to a call that reverts is not returned.** A first test sent a wrong amount to a
   method that raised; the GEN stayed in the contract with no way out. So `predict` never raises
   once value is attached. A late, duplicate, underpaid or unknown-market prediction completes,
   records nothing, and credits the whole amount to the sender.
2. **An internal message does not pay a wallet.** `gl.chain.Account(addr).emit_transfer(x)` emits
   the message, the transaction succeeds, and the balance does not move, because a wallet is not an
   Intelligent Contract. Payouts go through an `@gl.evm.contract_interface` proxy, an external
   transfer. The deploy record shows the balance actually reaching zero.
3. **A payout lands on finalization, not on acceptance.** The console says so, and the deploy
   record reads balances only after finalization.

## Why the money cannot go missing

- Money enters through one payable method and leaves through two: `claim` (to the caller, for the
  caller's own prediction) and `withdraw_credit` (the caller's own credit). There is no fee, no
  owner and no sweep.
- Stakes are equal, so a winner's share is `pot // winners`. Claims can never add up to more than
  the pot; at most `winners - 1` wei of rounding dust stays behind.
- The claimed flag and `paid_out` are written before the transfer is emitted.
- A test drives thirty random markets and asserts after every step that the contract balance equals
  unclaimed escrow plus credits.

## What it does not do

- Stakes are equal per market. There are no odds and no variable position sizes.
- Payouts go to wallets. An Intelligent Contract that predicts cannot be paid by `claim` as written,
  because it is paid as a wallet.
- The deployer and the market creator are the same test account in the on-chain run. Neither role
  has any power over a market's money; the tests use separate accounts for both.
