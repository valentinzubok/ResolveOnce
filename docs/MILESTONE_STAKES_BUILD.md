# Milestone build record — ResolveOnce v2 (stakes)

Everything here is addressed by full commit SHA, so the links keep pointing at the same bytes
whatever happens to `main` afterwards.

## Comparison: accepted Project → milestone

| | Commit | What it is |
|---|---|---|
| **Base** | `159895411e871cac042831dc55a70c4744db510f` | `main` from 2026-10-05 until this milestone: the ResolveOnce accepted into Project Explorer |
| **Milestone head** | `323adb1867387d9e572d90b4a74f4c89b8109319` | v2: staked predictions, claims, credits, the console for them, the deploy record |

**Diff:** https://github.com/valentinzubok/ResolveOnce/compare/159895411e871cac042831dc55a70c4744db510f...323adb1867387d9e572d90b4a74f4c89b8109319

One commit, 11 files, 1 225 insertions and 92 deletions.

| File | Change | What |
|---|---:|---|
| `contracts/ResolveOnce.py` | +331 −45 | payable `predict`, `claim`, `withdraw_credit`, four views, the stake parameter, the gap-free digest |
| `tests/test_stakes.py` | +469 | new — 21 tests for the money |
| `tests/conftest.py` | +73 | the test double learns value, balance and external transfers |
| `web/src/components/ResolveOnceApp.tsx` | +139 | stake field, staked predict, pot, claim button, credit banner |
| `web/src/lib/contracts.ts` | +54 | bindings for the new methods and views |
| `web/src/lib/genlayer.ts` | +4 | a write can carry `value` |
| `STUDIO_DEV_DEPLOY.md` | rewritten | the v2 on-chain lifecycle |
| `docs/MILESTONE_STAKES.md` | +66 | new — what changed and why |
| `README.md` | +56 | the money side of the contract |
| `scripts/verify_deployment.py`, `web/src/lib/config.ts` | 1 line each | the v2 address |

Tags mirror the two commits for convenience (`project-explorer-v1`, `milestone-stakes-v2`); the
SHAs above are the reference.

## Files at the milestone head

- Contract:
  https://github.com/valentinzubok/ResolveOnce/blob/323adb1867387d9e572d90b4a74f4c89b8109319/contracts/ResolveOnce.py
- Stake tests:
  https://github.com/valentinzubok/ResolveOnce/blob/323adb1867387d9e572d90b4a74f4c89b8109319/tests/test_stakes.py
- Deploy record with every transaction:
  https://github.com/valentinzubok/ResolveOnce/blob/323adb1867387d9e572d90b4a74f4c89b8109319/STUDIO_DEV_DEPLOY.md
- What changed:
  https://github.com/valentinzubok/ResolveOnce/blob/323adb1867387d9e572d90b4a74f4c89b8109319/docs/MILESTONE_STAKES.md

## Deployed source, pinned

| | |
|---|---|
| **Network** | GenLayer Studio Dev / Studio Next, chain `61997`, GenVM `v0.3.0` |
| **Address** | `0xE4cBaaF13Aaf6aF3c8c5414bB5BaC1e5E60ABcBc` |
| **Deploy transaction** | `0xbd99a89b424ad0d9045a3de34b4b1c068084c342e671b48b5d5a1e8d705b5e01` |
| **Source file** | `contracts/ResolveOnce.py` at commit `323adb1867387d9e572d90b4a74f4c89b8109319` |
| **Git blob** | `b2aa942d5cc1dc279f243190bbd08ecc009ee6c9` |
| **sha256 of the file** | `352092f4416a18c79b85684af40da544753462e5eeafc88d5c5c0124d8452084` |
| **sha256 on chain** | `352092f4416a18c79b85684af40da544753462e5eeafc88d5c5c0124d8452084` (`gen_getContractCode`) |
| **Runner** | `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |
| **Constructor arguments** | none |

Reproduce both hashes from the pinned commit, without trusting this file:

```bash
curl -sL https://raw.githubusercontent.com/valentinzubok/ResolveOnce/323adb1867387d9e572d90b4a74f4c89b8109319/contracts/ResolveOnce.py \
  | shasum -a 256

curl -s -X POST https://studio-dev.genlayer.com/api -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"gen_getContractCode","params":["0xE4cBaaF13Aaf6aF3c8c5414bB5BaC1e5E60ABcBc"]}' \
  | python3 -c "import sys,json,base64,hashlib; print(hashlib.sha256(base64.b64decode(json.load(sys.stdin)['result'])).hexdigest())"
```

CI repeats that comparison on every push and runs the 72 tests.

## Functional proof on chain

Twenty transactions after the deploy are listed in `STUDIO_DEV_DEPLOY.md`. The ones that move
money, with the contract's `eth_getBalance` after each was finalized:

| Step | Call | Contract balance |
|---|---|---:|
| 3–7 | five payable `predict` calls: 4 GEN escrowed, 3 GEN credited | 7 GEN |
| 10–11 | `withdraw_credit` by both accounts | 4 GEN |
| 16 | winner's `claim` on the resolved market — `0x37649defee2f2df1e02d95a5cfbcbef34db41c90d5026c933a97b908e5114b55` | 2 GEN |
| 19–20 | both `claim` their stake on the expired market | **0** |
