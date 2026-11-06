# ENS judge walkthrough

Kusari gives an untrusted AI agent a restricted trading identity. Funds stay in an owner-controlled vault. Every agent swap carries a signed intent through a Uniswap v4 hook, which reads the agent's current ENSv2 authorization and policy. Revoking the ENS role stops future swaps after the revocation transaction confirms.

Primary demonstration: [kusari.outcomeseal.com/demo](https://kusari.outcomeseal.com/demo). Owner controls: [kusari.outcomeseal.com/freeze](https://kusari.outcomeseal.com/freeze). The demonstrated identity is `alpha.kusari-pramod.eth` on **Sepolia, chain ID 11155111**. This path uses the funded shared agent and vault; it does not create a personal trading account for a visitor.

## Where each part runs

```text
OFFCHAIN: request, decision and transaction transport

Visitor browser                    Vercel / Next.js
  choose fixed scenario ----------> same-origin /api/sandbox/* proxy
  sign one expiring EIP-191 message           |
  (no funds or token approval)               | server-held gateway credential
                                            v
                                   Persistent Fly service
                                     gateway + agent runtime
                                            |
                         market/news ------> Gemini ----> proposal
                                            |
                                   restricted shared agent key
                                   signs EIP-712 SwapIntent
                                   signs Sepolia transaction
                                            |
                               reads / simulation / submission
                                            v
                                   Anon-RPC bridge -> Nox -> RPC provider
                                            |
                                            v
ONCHAIN: identity, authority and atomic enforcement

Agent transaction -> AgentVault.swap(key, intent, signature)
                      | only immutable agent may call
                      | required hook; matching agent/vault intent
                      v
                   PoolManager.unlock -> vault callback -> PoolManager.swap
                                                              |
                                                              v
                                                   PolicyHook.beforeSwap
                                                     | check intent / signature
                                                     | expiry / nonce / direction
                                                     v
                                                   pinned ENSPolicySource
                                                     |
                                  +------------------+------------------+
                                  v                                     v
                           ENSv2 registry                         label resolver
                           agent's current role                   ENSIP-10 resolve()
                                  |                               kusari.policy data
                                  +------------------+------------------+
                                                     |
                                      authorization + active policy
                                      allowed pool + per-swap/daily caps
                                                     |
                                                     v
                                            actual Uniswap v4 swap
                                                     |
                                                     v
                                            PolicyHook.afterSwap
                                              actual output >= signed minimum
                                              actual pool-price impact <= policy
                                                     |
                                  +------------------+------------------+
                                  v                                     v
                         checks pass -> settle                 check fails -> REVERT
                         bought tokens into vault              entire transaction rolls back
                         confirmed success receipt             balances / spending / nonce unchanged

OWNER CONTROL: independent of Gemini and the hosted agent

Owner wallet -> its wallet RPC -> ENSv2 registry.revokeRoles / grantRoles
                                | confirms on Sepolia
                                v
                         next hook authorization read sees frozen / active

Owner wallet -> its wallet RPC -> AgentVault.withdraw -> owner-selected recipient
```

The visitor's message admits one sandbox run. It is separate from the agent's trade signature. The trade's EIP-712 domain is `{name:"Kusari", version:"1", chainId:11155111, verifyingContract:PolicyHook}`: the verifying contract is the **hook**, not the vault or ENS resolver. A valid signature proves the agent signed those fields; ENS policy constrains what that signed request may do.

The policy source trusts the pinned `kusari-pramod.eth` registry. Each agent is bound to a label, DNS-encoded name and namehash. Authorization requires exactly the narrow **`ROLE_RENEW = 1 << 16`** marker on the label. That role can extend expiry; it cannot edit the policy. Agents with extra roles or resolver administration, including inherited operator authority, fail authorization. The owner writes the resolver's ABI-encoded `kusari.policy` record. The hook reads ENS on every swap; UI snapshots are explanatory state, not the authority that permits a trade.

The parent registry's administrator remains a trust root. Kusari does not claim these subnames are emancipated from parent authority or that arbitrary ENS parents are supported. AgentVault requires its configured hook and always attaches the intent. Ordinary public pool swaps without agent hook data are outside this vault-policy boundary; the project does not claim to control every trader in the pool.

## Exact judge flow

Before presenting, confirm the shared agent is active, the chain snapshot is fresh, the funded vault has enough test kUSD, and the agent has gas and remaining daily allowance. Keep the owner wallet available on Sepolia. Use the canonical domain; stop if any wallet security warning appears.

1. **Normal request.** Open **Agent workspace -> Request a trade**, connect a supported wallet on Sepolia, select **Trade within limits**, then **Sign request & run agent**. Explain the gas-free admission message. Gemini makes the real decision; the normal sandbox bounds a proposal to at most 1 kUSD. Read **Your result**: Agent requested / Owner's limit / Result / Reason / Tx. Open the confirmed Sepolia receipt.
2. **Poisoned news.** Select **Test an over-limit request** and sign the new message. This uses a deliberately gullible challenge prompt. Show the model's actual requested amount and the owner's cap. If Gemini requests an oversized swap, show the hook's confirmed `ExceedsPerSwap` receipt. If Gemini holds or refuses, say so; do not call that an onchain rejection. Use the clearly labelled recorded attack receipt below to explain the already-verified enforcement case.
3. **Freeze from the owner wallet.** Open **Owner controls** (`/freeze`) with the actual ENS owner. Revoke the agent's role and confirm the transaction on Sepolia. Wait for the receipt and the fresh **Revoked** status. This changes ENS authority, not the model's prompt or an application pause flag.
4. **Small trade while frozen.** Return to the normal scenario and request another small trade. If Gemini proposes a swap, its transaction must fail with `NotAuthorized` even though the amount is within the cap. Show the receipt and unchanged vault balances. If the model holds instead, distinguish that result and show the recorded frozen-trade receipt; do not manufacture a decision.
5. **Restore.** Restore the role from the same owner wallet, confirm on Sepolia and refresh the status. Run the normal scenario again if time and capacity allow. Leave the shared agent restored for other judges.

A freeze takes effect after its transaction confirms. It cannot undo a previously confirmed trade. A signature issued before a confirmed revoke still fails when the hook later checks authorization. Visitors cannot freeze the shared agent; only its current ENS owner can perform that step.

Recorded proof from the completed shared rehearsal:

| Beat | Sepolia evidence |
| --- | --- |
| Real Gemini normal trade | [1 kUSD success](https://sepolia.etherscan.io/tx/0xa0e48bb4fdce53b6b8ed2b6701bcb8cb1f1b87dc855e0215af7d0fd61acddab7) |
| Real poisoned-news proposal over the 5 kUSD cap | [81.9 kUSD attempt reverted](https://sepolia.etherscan.io/tx/0x067c00b2afaccae1c07511accb2d6cfd4d2f413f6ca783962c07afa6ac2a06f0) |
| Owner revocation | [ENS role revoked](https://sepolia.etherscan.io/tx/0xc2d455abffb86c788e56c86a0574ddb23ca9d5391d4d0f1b98551b83d4d1856d) |
| Small trade after revocation | [`NotAuthorized` revert](https://sepolia.etherscan.io/tx/0x3c2c1e8786ee1bc9371eb59d5e0c2ad4812847a0862da3aba93fe69dff11751a) |
| Owner restoration | [ENS role restored](https://sepolia.etherscan.io/tx/0x577bc7faeda7a24869189abf2b0691e604fc615a0e35d6786114b6421f0a3fe6) |
| Small trade after restoration | [1 kUSD success](https://sepolia.etherscan.io/tx/0x5861ff93e6d4ce1cfeaf362fd41781a9f1823751fb3acfe4b40363cb7f58f45c) |

## Repeatable live ENS limit edit

The existing shared workspace also exposes **ENS policy demonstration** below the main trading area. Open it with the configured ENS owner connected on Sepolia. Other visitors cannot edit the policy or authorize its fixed test.

1. Check **Current per-trade cap: 5 kUSD**. If necessary, use **Restore cap to 5 kUSD** and wait for confirmation.
2. Click **Sign & run fixed 2 kUSD test**. Sign the explicitly labelled, expiring gas-free request. This test skips Gemini's variable decision and asks the existing agent to submit exactly 2 test kUSD through the same vault and hook. Wait for the actual success receipt; other live policy checks can still reject a request.
3. Click **Set cap to 1 kUSD** and confirm one Sepolia transaction to the current ENS resolver. Wait for the confirmed cap read to become **1 kUSD**. The owner edits the ABI-encoded `kusari.policy` data record; it is not an ordinary text record. No contract deployment or app configuration change is involved.
4. Repeat **Sign & run fixed 2 kUSD test**. Show **Requested: 2**, **Limit: 1**, the actual reverted receipt, and the separately labelled simulation reason if available. The fixed-test runner deliberately submits this bounded transaction even when simulation predicts rejection.
5. Click **Restore cap to 5 kUSD**, confirm, and leave the shared agent authorized for other visitors. All other policy fields are copied from a verified snapshot; avoid simultaneous owner policy edits from another session.

Say: **“The request stayed at 2 kUSD. I changed only the ENS record from 5 to 1. The hook read the new policy and rejected the next swap.”** This is a deterministic policy demonstration, not an LLM decision. Use the normal scenario separately to show Gemini. The public normal scenario and shared trade API retain their 1 kUSD ceiling throughout.

The [completed canonical-HTTPS/CLI rehearsal](evidence/owner-policy-check.json) contains the four real receipts and independent calldata checks. It left cap 5 restored and the agent authorized. The owner signed locally for that rehearsal; it is separate from recording the new browser controls with MetaMask.

The subsequent [recorded browser rehearsal](evidence/live-browser-demo.json) also completed with human MetaMask approvals: cap 5 success, cap 1 edit and rejection, cap 5 restoration, freeze, within-cap rejection, restore, and a real Gemini 1 kUSD success. Its eight new receipts and calldata were independently verified. Wallet popups are outside the page capture; the video shortens waits and labels reading holds.

The standard ENS app can show the name, owner and agent address; the ENS explorer can show indexed text/address records. The encoded `kusari.policy` data and its owner editor are implemented here. Do not promise an ordinary text-record editor changes these enforced limits. Two-owner isolation is separately evidenced by the CLI receipts; the shared workspace does not provide a reusable literal `beta.kusari-demo.eth` browser account.

## Ninety-second ENS explanation

“Kusari separates an AI agent's decision from its authority. Gemini can propose a trade, but it does not own the funds or write its limits. Funds sit in a vault, and the owner controls an ENSv2 name with a policy record and a narrowly delegated agent role.

“Here is a normal request. The agent signs an exact trade intent. Our Uniswap v4 hook checks that intent, then reads the agent's current ENS role and policy. After the swap, it checks the output and actual pool-price impact. A failed check rolls back the whole transaction.

“Now the poisoned news asks the agent to exceed its authority. If the model follows it, a valid signature still cannot bypass the owner's onchain policy. The receipt shows what actually happened. If the model refuses, we show that honestly and distinguish the recorded enforcement proof.

“Finally, I revoke the role in ENS. A small trade that was previously allowed now fails. Restoring the role restores authorization. ENS is the live, public authority boundary used by the hook on every swap.”

## Nox: show the evidence precisely

Expand **Integration details** and show the **Anon-RPC bridge: Nox mixnet** feed: observed RPC methods, timings and live connection state. After a browser run, **How this request was enforced** shows its observed route alongside ENS and transaction evidence. The read-only [bridge metrics](https://kusari.outcomeseal.com/api/demo/bridge/metrics) endpoint provides numeric request/failure counters if an EF judge wants to inspect them. Global counter increases include background reads and must not all be attributed to one trade. These observations demonstrate transport use, not cryptographic anonymity or “zero requests seen by the provider.”

The final RPC provider still receives RPC payloads, and transactions, calldata, addresses and ENS state remain public. The visitor's wallet RPC, owner-wallet transactions, web requests and Gemini requests are separate. UI snapshots and counters must be labelled fresh, stale or recorded; an unavailable observation is not proof of privacy.

## Current status and boundaries

- **Verified shared demo:** real Gemini runs, the five-field result and receipts, browser MetaMask owner freeze/restore, a rejected trade while frozen and successful trading after restoration. The user reported no wallet security warning on the canonical domain during those checks. The old Vercel hostname's review remains open; never bypass a warning.
- **Verified two-owner isolation:** the [live hosted-API rehearsal](evidence/owned-workspaces.json) provisioned separate owners, agents, ENS labels, dedicated resolvers and vaults. A froze and its next trade reverted; B still traded; daily accounting stayed separate; A was restored. Setup used a local CLI and public owner RPC. Personal execution used real Gemini and observed Nox reads/submissions. This is not a completed browser onboarding rehearsal.
- **Atomic personal onboarding remains beta:** the coordinator and separate personal vault factory are deployed. Eight real-contract Sepolia fork tests passed, including zero retained coordinator label/resolver administration and two-owner freeze isolation. The new atomic path has **not** completed its live end-to-end rehearsal. Do not present deployment or fork tests as that missing live acceptance check.
- **External-agent integration:** the [local EOA client](BRING_YOUR_OWN_AGENT.md) defaults to unsigned preview and supports explicit locally signed submission after simulation. The shared [trade API](TRADE_API.md) is live and passed a real 1 kUSD trade plus authentication/input/cooldown checks. It uses the shared hosted signer and explicitly labels requests `external-agent`; no personal agent key is uploaded. The direct EOA client has syntax/guard checks, not a separate live execution rehearsal.

Code pointers: [vault](../contracts/src/AgentVault.sol), [hook](../contracts/src/PolicyHook.sol), [ENS policy source](../contracts/src/ens/ENSPolicySource.sol), [intent types/domain](../shared/types.ts), [agent execution](../agent/src/swap.ts), [two-owner fork tests](../contracts/test/ens/OwnedAgentIsolation.t.sol), [atomic fork tests](../contracts/test/ens/AtomicOwnedAgent.t.sol).
