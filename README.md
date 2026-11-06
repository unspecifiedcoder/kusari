# Kusari 鎖

**Let an agent trade. Keep ownership and limits outside its control.**

An LLM can follow poisoned news. A valid agent key can sign a bad trade. Kusari separates those decisions from authority: an owner-controlled vault holds funds, ENSv2 publishes policy and a revocable agent role, and a Uniswap v4 hook enforces that policy against the swap. Agent RPC reads and transaction submissions use Anon-RPC/Nox.

Built for **ETHGlobal Mumbai 2026** on **Sepolia**, using permissionless-mint test tokens. Contracts are unaudited. The verified shared demo, personal onboarding beta and bounded-session extension have distinct custody and verification boundaries.

**[Try the live demo](https://kusari.outcomeseal.com/demo#try-sandbox)** · [Submission source: `codex/judge-ready`](https://github.com/unspecifiedcoder/kusari/tree/codex/judge-ready) · [Trade API](docs/TRADE_API.md) · [Bring your own agent](docs/BRING_YOUR_OWN_AGENT.md) · [ENS judge walkthrough](docs/ENS_JUDGE_WALKTHROUGH.md) · [Uniswap feedback](FEEDBACK.md)

**[Watch the new live browser demonstration — 3:14, silent with captions](docs/submission/kusari-live-demo-captioned.mp4)** · [Matching voiceover script](docs/submission/kusari-live-demo-narration.txt) · [SRT](docs/submission/kusari-live-demo-captioned.srt). It records the 5→1 ENS cap edit, repeated fixed request, freeze/restore and a successful real Gemini trade. These are new browser-session transactions, with [all eight receipts independently verified](docs/evidence/live-browser-demo.json). The edit uses real browser frame captures at about 1–2 captures per second; waiting cuts and reading holds are labelled. MetaMask popups are outside the captured page. This replaces the earlier screenshot-walkthrough draft as the recording to narrate; audio has not yet been added.

## Try it as a judge

1. Open the demo and inspect the agent, ENS policy and vault without connecting a wallet.
2. Under **Request a trade**, connect a supported wallet on **Sepolia**, choose **Trade within limits**, and sign the expiring admission message. Your wallet supplies **no tokens, gas payment or token approval** for this shared run. The hosted agent supplies test funds and gas.
3. Read **Your result**: **Agent requested / Owner's limit / Result / Reason / Tx**. Open the receipt. Expand **How this request was enforced** for ENS, hook and routing observations.
4. Choose **Test an over-limit request**. The challenge exposes a deliberately gullible model to poisoned news. If the real model requests too much, show the confirmed revert. If it holds or refuses, show that honestly and use the labelled recorded receipt below to explain the already-verified rejection.
5. With the presenter, open **[Owner controls](https://kusari.outcomeseal.com/freeze)**. The ENS owner revokes the role and confirms on Sepolia. Another small trade must fail after that confirmation, even within the spending cap. Restore the role afterward.

The primary demo uses **one shared funded agent**, `alpha.kusari-pramod.eth`. Normal proposals are bounded to **1 kUSD**. The recorded owner policy was **5 kUSD per swap, 100 kUSD per UTC day, one pool and 2% maximum pool-price impact**; the UI reads actual current values. Shared quotas and model/chain latency can require waiting. A job ID or simulation is not a confirmed transaction.

### Owner-controlled ENS policy demonstration

The deployed **ENS policy demonstration** controls let the connected ENS owner change the per-trade cap in the existing resolver and compare the **same fixed 2 kUSD request**:

1. With the cap at **5 kUSD**, choose **Sign & run fixed 2 kUSD test** and inspect its receipt.
2. Choose **Set cap to 1 kUSD** and confirm the owner transaction on Sepolia. Wait for the confirmed policy update, then repeat the fixed test.
3. Inspect the actual outcome and separate simulation observation. The lower cap should reject the same amount; other policy checks can also reject either run.
4. Choose **Restore cap to 5 kUSD**, confirm, and leave the shared policy restored.

This is a **deterministic policy check, not a Gemini decision**. Its exact-message, single-use owner signature permits only the fixed shared-vault test. The backend checks current ENS ownership and Nox routing; the shared agent pays test gas, including when submitting a transaction predicted to revert. Policy editing itself is an owner-paid transaction. The form preserves the other policy fields from its verified snapshot and checks for changes before requesting a wallet transaction; concurrent owner transactions during wallet confirmation remain possible. The public normal scenario and external trade API retain their **1 kUSD** ceiling.

The controls are deployed and visible on the canonical site. **The live canonical-HTTPS/CLI rehearsal passed:** [2 kUSD succeeded at cap 5](https://sepolia.etherscan.io/tx/0xc5da019bafdb85e3d889dbf54386c807b85e12b181b1ab8d251505c343c81770), the owner [changed the ENS cap to 1](https://sepolia.etherscan.io/tx/0xf290c965e038403aaad87394739fdd2d02d0638f0f947f75ac26ebcae93ea864), the [same 2 kUSD request reverted](https://sepolia.etherscan.io/tx/0x76125d7da1d86d7f0b15ddfcad30d78eeae442dc234a761488b898fda1b476f7), and the owner [restored cap 5](https://sepolia.etherscan.io/tx/0xc51298b4522492469183d9104548be6255d4634d7c09bc4fdf17dd6cdeafedd3). [The evidence report](docs/evidence/owner-policy-check.json) independently checks receipt status and exact calldata, unchanged other policy fields and final authorization. Owner signing was local; agent execution used the hosted Nox route. This verifies the deployed service/contract sequence, separately from a complete MetaMask walkthrough of these new controls.

## How authority is enforced

```text
Visitor -> Next.js proxy -> authenticated Fly gateway -> Gemini proposal
                                                        |
                                             restricted agent signer
                                                        |
                                  reads / simulation / signed transaction
                                                        v
                                           Anon-RPC -> Nox -> RPC
                                                        |
ONCHAIN                                                 v
Agent -> AgentVault -> PoolManager -> PolicyHook.beforeSwap
          |                            | signature / nonce / deadline
          |                            | direction / pool / spending caps
          |                            v
          |                       ENSPolicySource (pinned registry)
          |                            | live role + resolver policy
          |                            v
          |                       actual Uniswap v4 swap
          |                            |
          |                       PolicyHook.afterSwap
          |                            | actual output / price impact
          +---- funds settle <---------+ or entire transaction reverts

Owner wallet -> its own RPC -> ENS role revoke / restore or policy edit
Owner wallet -> AgentVault.withdraw   (agent cannot withdraw)
```

**ENSv2 is a live authority dependency.** [`ENSPolicySource`](contracts/src/ens/ENSPolicySource.sol) pins the `kusari-pramod.eth` UserRegistry. Only a label's owner can bind an agent; replacing a binding also requires ownership of its old label. Authorization requires exactly `ROLE_RENEW = 1 << 16` as the narrow marker, and denies registry authority that could repoint the resolver, including inherited operator authority. The current resolver grants policy editing to the owner, not the agent. The marker permits renewal, not policy administration.

Limits are an **ABI-encoded `Policy` in the `kusari.policy` data record**, read via **ENSIP-10 `resolve(dnsName, data(node,key))`**. They are not an ordinary text record or application-only cached rule. The hook reads authority on every trade, so a confirmed revoke also blocks an intent signed before revocation. The parent administrator remains a trust root; these subnames are not emancipated.

**Uniswap v4 checks the actual execution.** [`AgentVault`](contracts/src/AgentVault.sol) accepts swaps only from its immutable agent, requires the configured hook and attaches the signed intent. [`PolicyHook.beforeSwap`](contracts/src/PolicyHook.sol) verifies identity, pool, direction, nonce, expiry, authorization and input caps. `afterSwap` checks the **actual BalanceDelta output** against the signed minimum and the pool's **actual before/after price movement**. Failure rolls back settlement, nonce use and spending accounting. The EIP-712 domain is `Kusari / 1 / 11155111 / PolicyHook`; its verifying contract is the hook, not the vault.

Direct integration pointers at the verified source revision: [vault swap entry, line 34](https://github.com/unspecifiedcoder/kusari/blob/67fd59f5fab87aebccd837f0925508b4eedaf27b/contracts/src/AgentVault.sol#L34), [PoolManager unlock callback, line 47](https://github.com/unspecifiedcoder/kusari/blob/67fd59f5fab87aebccd837f0925508b4eedaf27b/contracts/src/AgentVault.sol#L47), [before-swap checks, line 71](https://github.com/unspecifiedcoder/kusari/blob/67fd59f5fab87aebccd837f0925508b4eedaf27b/contracts/src/PolicyHook.sol#L71), [after-swap output/impact checks, line 93](https://github.com/unspecifiedcoder/kusari/blob/67fd59f5fab87aebccd837f0925508b4eedaf27b/contracts/src/PolicyHook.sol#L93), and [live ENS authorization/policy reads, line 147](https://github.com/unspecifiedcoder/kusari/blob/67fd59f5fab87aebccd837f0925508b4eedaf27b/contracts/src/PolicyHook.sol#L147).

**Anon-RPC/Nox carries agent traffic.** The persistent [`reader` bridge](reader/src/bridge.mjs) routes agent reads, simulations, submissions and receipt queries through Nox by default. The shared trade API requires the anonymous route; personal workspaces use a dedicated Nox client. Counters show observed requests/submissions, including retries, **not cryptographic anonymity proof**. RPC payloads, transactions, addresses and ENS state remain public. Wallet-provider RPC, web/Gemini requests and deployment/bootstrap traffic are separate boundaries.

## Claims you can check

| Claim | Implementation | Tests | Live evidence / limit |
| --- | --- | --- | --- |
| Agent cannot withdraw or bypass the required vault hook | [AgentVault](contracts/src/AgentVault.sol) | [Vault tests](contracts/test/AgentVault.t.sol) | Deployed immutable identities and shared swaps below |
| ENS owner can freeze a valid agent key without changing its model | [ENSPolicySource](contracts/src/ens/ENSPolicySource.sol) | [Real ENS fork](contracts/test/ens/ENSPolicySource.t.sol), [kill switch](contracts/test/KillSwitch.t.sol) | Revoke -> small reverted trade -> restore receipts |
| ENS owner can edit the cap and authorize one fixed 2 kUSD comparison | [Owner controls](app/src/components/OwnerPolicyControls.tsx), [record encoding](app/src/lib/owner-policy.ts), [authorization/jobs](scripts/owner-policy-check.mjs), [fresh context](agent/src/owner-policy-context.ts) | [UI policy helpers](app/src/lib/owner-policy.test.mjs), [authorization/replay/results](scripts/owner-policy-check.test.mjs), [owner/context routing](agent/src/owner-policy-context.test.ts) | [HTTPS/CLI proof](docs/evidence/owner-policy-check.json) and [recorded MetaMask browser walkthrough](docs/evidence/live-browser-demo.json): success at 5, revert at 1, restore 5 |
| Oversized input fails despite a valid agent signature | [PolicyHook](contracts/src/PolicyHook.sol), [intent types](shared/types.ts) | [Caps](contracts/test/PolicyHookCaps.t.sol), [signatures](contracts/test/PolicyHookSignature.t.sol) | Real poisoned-news run reported `ExceedsPerSwap`; receipt confirms revert |
| Post-swap checks use actual output and price movement | [PolicyHook.afterSwap](contracts/src/PolicyHook.sol) | [Output guards](contracts/test/PolicyHookGuards.t.sol), [impact/rollback](contracts/test/PolicyHookImpact.t.sol) | Successful swaps exercise this path; adverse-output/impact cases are regression tests |
| Separate agents have independent control and daily accounting | [Bindings](contracts/src/ens/ENSPolicySource.sol), [factory](contracts/src/AgentVaultFactory.sol) | [Two-owner fork tests](contracts/test/ens/OwnedAgentIsolation.t.sol) | [Live CLI + hosted-API report](docs/evidence/owned-workspaces.json), not browser onboarding |
| Shared API requests are authenticated and bounded | [Admission](scripts/api-trade.mjs), [gateway](scripts/demo-gateway.mjs), [proxy](app/src/lib/trade-api-http.mjs) | [API](scripts/api-trade.test.mjs), [gateway](scripts/demo-gateway.test.mjs), [proxy](app/src/lib/trade-api-http.test.mjs) | [401/400/202/429 checks and real 1 kUSD receipt](docs/evidence/trade-api.json) |
| Agent reads and submissions use the configured Nox route | [Bridge](reader/src/bridge.mjs), [runner](agent/src/runtime.ts), [personal relay](agent/src/workspace.ts) | [Workspace transport/admission tests](agent/src/workspace.test.ts) | Mode observations and routing counts; no anonymity proof |
| Optional session vault adds a finite allowance and owner output floor | [SessionAgentVault](contracts/src/SessionAgentVault.sol) | [15 real-v4 session tests](contracts/test/SessionAgentVault.t.sol) | Separate deployed beta vault; session unopened and live execution not yet rehearsed |

Latest completed regression baselines: **87 Solidity tests** — **59 local and 28 Sepolia fork tests** — and **82 Node tests**, with no failures in those completed runs. Testing is not a security audit. A receipt confirms success/revert; reason names come from decoded simulation/execution data and tests, not its status field alone.

## Recorded shared-demo receipts

On **6 November 2026**, the user signed the normal/poisoned-news admission messages and owner revoke/restore transactions in MetaMask on Sepolia, reporting no wallet security warning on the canonical domain. Frozen and post-restore public requests below used signed API admission from ephemeral test wallets. The redesigned five-field result was additionally verified with [this user-signed 1 kUSD run](https://sepolia.etherscan.io/tx/0xa0e48bb4fdce53b6b8ed2b6701bcb8cb1f1b87dc855e0215af7d0fd61acddab7).

| Step | Sepolia receipt |
| --- | --- |
| Browser normal scenario: Gemini requested 1 kUSD | [Successful swap](https://sepolia.etherscan.io/tx/0x947f9b3d7ce8d6989fed3410dc0ac3efedf54fb045cb7dfa52acef5db20a8861) |
| Owner freezes the agent | [ENS role revoked](https://sepolia.etherscan.io/tx/0xc2d455abffb86c788e56c86a0574ddb23ca9d5391d4d0f1b98551b83d4d1856d) |
| Normal 1 kUSD request while frozen; run reported `NotAuthorized` | [Reverted transaction](https://sepolia.etherscan.io/tx/0x3c2c1e8786ee1bc9371eb59d5e0c2ad4812847a0862da3aba93fe69dff11751a) |
| Owner restores the agent | [ENS role regranted](https://sepolia.etherscan.io/tx/0x577bc7faeda7a24869189abf2b0691e604fc615a0e35d6786114b6421f0a3fe6) |
| Browser poisoned-news scenario: Gemini requested 81.9 kUSD against a 5 kUSD cap | [Reverted; run reported `ExceedsPerSwap`](https://sepolia.etherscan.io/tx/0x067c00b2afaccae1c07511accb2d6cfd4d2f413f6ca783962c07afa6ac2a06f0) |
| Normal 1 kUSD request after restore | [Successful swap](https://sepolia.etherscan.io/tx/0x5861ff93e6d4ce1cfeaf362fd41781a9f1823751fb3acfe4b40363cb7f58f45c) |
| External-agent shared API, verified 7 November IST | [Successful 1 kUSD swap](https://sepolia.etherscan.io/tx/0x736d1bbdcc78ae9d2e26105f15f760b5b02a5a35eb67d56811127f5a6c68556e) · [report](docs/evidence/trade-api.json) |

Public HTTPS checks rejected a different signing origin and replayed admission signatures. Wallet writes verify the provider's actual Sepolia chain/account immediately before signing: [guard](app/src/lib/wallet-safety.ts), [tests](app/src/lib/wallet-safety.test.mjs). Use the canonical domain; never bypass a wallet warning. The historical Vercel hostname's [MetaMask review](https://github.com/MetaMask/eth-phishing-detect/issues/309873) remains open; it is not a cleared signing origin.

<details>
<summary>Earlier six-check CLI rehearsal on the same deployment</summary>

Agent execution used Nox; owner CLI revoke/restore deliberately used a public RPC override. This was distinct from the later browser confirmations.

- [Normal 5 kUSD swap](https://sepolia.etherscan.io/tx/0x7816c314503bcf336d7780c3d567da65e7a37b2e9ec761b5a120a3b01aab0ad4).
- [Poisoned 95 kUSD attempt reverted](https://sepolia.etherscan.io/tx/0xa0295bab9d5006f67b61ad8d7a04d5a0919317b2cbd7b92aa70aec01ca13df00).
- [Owner revocation](https://sepolia.etherscan.io/tx/0x0091c5259fc3abfaac082c62c7b8cbf7d662d6ca0608c85306e6afc921f04981) and [reverted 0.1 kUSD attempt](https://sepolia.etherscan.io/tx/0xe8a72a961db3e7195c047b3dd4987901a74ec81777a74287362b7d176bc66dc6).
- The agent's attempted rebind was rejected with `NotNameOwner`.
- [Owner restoration](https://sepolia.etherscan.io/tx/0x4e9b9c1aeee0fdf5659bd677204fb01a24cab9c7121cf7cb37fe1a857e3dffaf) and [successful 0.1 kUSD swap](https://sepolia.etherscan.io/tx/0x5275c8476b62ed7128d39ac0f22708f19b64806912a5f2dcbe58951193c3f897).

</details>

## Two-owner isolation proof

The [live report](docs/evidence/owned-workspaces.json) records two owners, agents, dedicated resolvers, ENS labels and vaults. Real Gemini decisions were signed locally and submitted through the hosted Nox relay. Owner/setup calls used public RPC in this CLI test.

| Check | Live receipt |
| --- | --- |
| A trades 1 kUSD | [Success](https://sepolia.etherscan.io/tx/0xf63a6ed889e3d7110923e0efadc60100b7de24e196fd90ffd881e300a40c46ee) |
| B trades 1 kUSD | [Success](https://sepolia.etherscan.io/tx/0xc29010571c41d82ece12b9eeb6143b09353b398a4491fdfa1889dbb75c6ae1f8) |
| Owner A freezes A | [Role revoked](https://sepolia.etherscan.io/tx/0x3e7173000e9eed6fd9525704c6157a46a641f7341fbf703741167d48eb8274b3) |
| A attempts another trade | [Reverted](https://sepolia.etherscan.io/tx/0xba87b91c739ecb0715b3ccdc11301fad2002fa0c7bf5c6180760f78bafd91cdc) |
| B trades while A is frozen | [Success](https://sepolia.etherscan.io/tx/0xb447b2200e24c4163b7d54caad23a15b02d10ca6df435700a9a188bc71c0ceac) |
| A is restored | [Role regranted](https://sepolia.etherscan.io/tx/0x7f2441452f60095d9c4c47b4bb071d245018b80c6ba359af7db5a3dbee35674b) |

A's spending stayed at **1 kUSD**; B's reached **2 kUSD**. Each execution observed **16 Nox RPC requests and one submission**, with no observed HTTP failures. Exact `NotAuthorized` behavior and denial of cross-owner policy edits, rebinds, freezes and withdrawals are additionally asserted in [real-contract fork tests](contracts/test/ens/OwnedAgentIsolation.t.sol).

These were generated CLI identities: `a-6aaa4d2de513ca697207a7150a0d2c407ac7db93.kusari-pramod.eth` and `a-97053e8114c182e580d0c10bf5ea6104935549cb.kusari-pramod.eth`. Four private keys existed only in the test process and were discarded afterward; these are not reusable browser-demo accounts. This proves the exercised contract/API isolation, **not completed browser onboarding or a fixed two-owner UI demonstration**. [Rehearsal source](scripts/rehearse-owned-workspaces.mjs).

## Deployed contracts

Network: **Sepolia (`11155111`)**. No redeployment is needed to inspect the demo.

| Shared release | Address |
| --- | --- |
| PolicyHook | [`0x9C8dfb140ffc368694644783a3f2Ac37B8B400c0`](https://sepolia.etherscan.io/address/0x9C8dfb140ffc368694644783a3f2Ac37B8B400c0) |
| ENSPolicySource | [`0x2dAA4eEacfDe394679aaE27e1F554442002b3438`](https://sepolia.etherscan.io/address/0x2dAA4eEacfDe394679aaE27e1F554442002b3438) |
| AgentVaultFactory | [`0xa73BDda27e66A0BfF20d85De8EAf20c0C8EE5370`](https://sepolia.etherscan.io/address/0xa73BDda27e66A0BfF20d85De8EAf20c0C8EE5370) |
| Shared vault | [`0x209c26182c40F6B34Ef5fe11b21709496dc6a2ed`](https://sepolia.etherscan.io/address/0x209c26182c40F6B34Ef5fe11b21709496dc6a2ed) |
| Agent: `alpha.kusari-pramod.eth` | [`0x72db032c0dFB6E7502e16A73fabdab31712dc706`](https://sepolia.etherscan.io/address/0x72db032c0dFB6E7502e16A73fabdab31712dc706) |
| ENS/vault owner | [`0xc815eDb747e34DA879AFE1a0EF3DF641B4921000`](https://sepolia.etherscan.io/address/0xc815eDb747e34DA879AFE1a0EF3DF641B4921000) |
| `kusari-pramod.eth` UserRegistry | [`0x479a0588634C3c20509707D05d95561BC2d5FB36`](https://sepolia.etherscan.io/address/0x479a0588634C3c20509707D05d95561BC2d5FB36) |
| PermissionedResolver | [`0xBDf4Ca409529182C45cE767683a1CCafD15225b5`](https://sepolia.etherscan.io/address/0xBDf4Ca409529182C45cE767683a1CCafD15225b5) |
| kUSD / kETH | [`0x218885DEB694Dd7a822B936ca0a214C35C2467Fa`](https://sepolia.etherscan.io/address/0x218885DEB694Dd7a822B936ca0a214C35C2467Fa) / [`0xabD19b8591318cf8EAB1fE106000DDFf0E31d9F0`](https://sepolia.etherscan.io/address/0xabD19b8591318cf8EAB1fE106000DDFf0E31d9F0) |

Shared manifests: [`11155111.json`](deployments/11155111.json), [`11155111-ens.json`](deployments/11155111-ens.json). Pool ID: `0xa5919e6e4fdea32ead5822ec741ac0dd9e6155c32ec37c9d417452849eb5fc93`. PoolManager and Nox specifier are in [`config/chains.json`](config/chains.json). Hosted `-next` checkpoints select the same shared deployment; `-legacy` files preserve history.

| Separate beta deployment | Address / manifest |
| --- | --- |
| Register-only label registrar | [`0xf913591278db093fc33e1ac20b45745a51b9dc32`](https://sepolia.etherscan.io/address/0xf913591278db093fc33e1ac20b45745a51b9dc32) |
| Atomic personal coordinator | [`0x370c18274165ef5c48f0d73f1ecd19505a6b8a35`](https://sepolia.etherscan.io/address/0x370c18274165ef5c48f0d73f1ecd19505a6b8a35) |
| Personal vault factory | [`0x92f8d36b9b8bcdd2dd1a08999b1de62465ac2b6c`](https://sepolia.etherscan.io/address/0x92f8d36b9b8bcdd2dd1a08999b1de62465ac2b6c) · [owned manifest](deployments/11155111-owned.json) |
| Session vault factory | [`0x3ae8a9e7775b280fd6d0b3fe65eb1894c6b6da2b`](https://sepolia.etherscan.io/address/0x3ae8a9e7775b280fd6d0b3fe65eb1894c6b6da2b) |
| Separate session vault, funded with 2 test kUSD | [`0x529489Af3b40a780fb499445116b364C083C3F90`](https://sepolia.etherscan.io/address/0x529489Af3b40a780fb499445116b364C083C3F90) · [session manifest](deployments/11155111-session.json) |

## Integration paths and status

**Shared trade API — live verified.** An external agent can call [`POST /v1/trade`](docs/TRADE_API.md) with a dedicated demo bearer credential and a decimal amount **greater than zero and at most 1 kUSD**. Its optional output minimum may only tighten the runner's quote protection. The caller supplies the decision, labelled `external-agent`; Gemini is not falsely credited. Kusari's Fly runner holds this **shared** agent key and signs for the configured vault only. The API cannot edit policy, revoke, withdraw or select arbitrary wallets/contracts/RPCs. Poll the returned job ID; acceptance is not execution.

**Bring your own EOA agent — local integration.** [`bring-your-own.ts`](agent/src/bring-your-own.ts) uses a user-held key, its own provisioned vault and the same ENS/hook boundary. Unsigned preview is the default; `--send` enables local signing after simulation through the user's bridge. No personal key is uploaded. The hook's `SignatureChecker` supports ERC-1271 validation, but a contract agent must itself call the vault through a suitable smart-account adapter. This client and the hosted personal runner implement EOA-agent signing; universal smart-wallet compatibility is not claimed.

**Personal onboarding — beta.** [`/agents`](https://kusari.outcomeseal.com/agents) uses encrypted browser-held keys and a one-transaction coordinator that creates a personal ENS label/resolver/policy and owner-held vault, mints **25 test kUSD** and forwards **0.0001 Sepolia ETH supplied by the owner**. The coordinator is deployed and **eight fork tests** verify its handoff/isolation. Its complete atomic live/browser rehearsal remains pending; the earlier six-step CLI proof does not substitute for it. Browser code and an unlocked page remain trusted. Wallet-derived encryption needs reproducible signatures and preserved encrypted key material; ownership alone cannot recreate a lost random key. Keep an encrypted recovery backup. [Custody/recovery details](docs/OWN_AGENTS.md).

**Bounded sessions — separate deployed beta.** [`SessionAgentVault`](contracts/src/SessionAgentVault.sol) adds an owner-approved finite allowance, exclusive expiry and independent output floor, `ceil(actualInput * minRateWad / 1e18)`. Successful partial fills charge the full requested amount. Only the owner can replace/close a session; the agent cannot replenish it or lower its floor. The separate vault is deployed/funded, but **its session has not been opened and live execution is not yet rehearsed**. These bounds do **not** retrofit the original shared/personal vaults. Its demo reuses `alpha`'s ENS role and daily cap; the session allowance is per vault. [Session behavior and boundaries](docs/BOUNDED_SESSIONS.md).

**Owner policy controls — deployed, CLI and browser rehearsals verified.** The fixed comparison above passed through canonical HTTPS with local owner signing, including wrong-owner rejection and the public API's unchanged 1 kUSD ceiling. A subsequent [real browser walkthrough](docs/evidence/live-browser-demo.json), with the user approving every MetaMask request, recorded the cap edit, over-cap rejection, cap restoration, ENS role revocation, a within-cap rejection while frozen, role restoration and a successful real Gemini 1 kUSD swap. All eight receipts and their calldata were independently verified; the shared agent was left authorized with cap 5. A reusable fixed two-owner browser judging walkthrough remains pending. Possible future applications include bounded treasury rebalancing and other permissioned agent actions. Those workflows, arbitrary ENS parents, in-place key rotation, Namera, Alt Mempools and production/multichain execution are not implemented here.

`PolicyMirror` is a tested cross-chain prototype with a separate admin-managed trust model; it is not this release's live ENS policy source.

## Build, run and verify

Use **Node 24.22.2** ([`.nvmrc`](.nvmrc)) and Foundry. Check out the submission branch with pinned submodules:

```sh
git clone --recurse-submodules --branch codex/judge-ready https://github.com/unspecifiedcoder/kusari.git
cd kusari
```

The frontend compiles without private wallet/model keys. From the repository root:

```sh
cd app
npm ci
npm run lint
npm run build
npm run dev
```

Development serves `http://localhost:3001`; production `npm run start` defaults to port 3000. Build from the whole checkout: `app/scripts/sync.mjs` reads `shared/`, `config/` and `deployments/`. Hosted signing routes are pinned to the canonical HTTPS origin and require a configured persistent backend. Starting a local UI alone does not activate hosted signing or grant shared owner/agent keys. [Build notes](docs/BUILD.md) · [Gateway/Fly setup](docs/JUDGE_HOSTING.md).

For a separately provisioned runner, preserve an existing `.env`; create a local ignored file from [`.env.example`](.env.example) only on a new checkout. Use your own authorized Sepolia identities and Gemini access. Never commit keys or place them in `NEXT_PUBLIC_*`. A new key is not authorized for an existing vault. The example ENS parent label is a provisioning setting, not permission to control published names.

| Component directory | Install / run |
| --- | --- |
| `reader/` | `npm ci`, `npx playwright install chromium`, `npm run bridge` |
| `proxy/` | `node server.mjs` — local provider-leak comparison |
| `agent/` | `npm ci`, `npm start` — manual cycles by default; real runs need Gemini and an authorized agent key |

After installing agent dependencies, `node scripts/check-env.mjs` from the repository root checks configuration without printing secret values. Follow [Bring your own agent](docs/BRING_YOUR_OWN_AGENT.md) for the own-vault CLI. Deployment/rehearsal scripts can send actual Sepolia transactions; they are not needed to inspect receipts or run these tests:

```sh
cd contracts
# Local v4/session tests: no wallet keys
forge test --no-match-path 'test/ens/*'
# Live Sepolia forks: no signed transactions or wallet keys
forge test --match-path 'test/ens/*'
# Both
forge test --summary
```

Forks use public Sepolia RPC by default; `SEPOLIA_RPC_URL` can select another endpoint. After installing the `agent/` and `app/` dependencies and generating frontend metadata (`npm run build` in `app/`), run Node regressions from the repository root:

```sh
node --test scripts/*.test.mjs app/src/lib/*.test.mjs agent/src/*.test.mjs agent/src/*.test.ts
```

These cover admission/authentication, replay, fixed owner checks, proxy/transport boundaries, key handling and signing helpers. Product/design context: [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md), [UI brief](docs/UI_BRIEF.md).

## CROPS

- **C — Censorship resistance:** domain, Fly, relay, Gemini and the ENS parent are dependencies; losing hosting stops shared execution. The owner can still call deployed withdrawal/revocation functions independently, and a personal agent with its key can use the direct client.
- **O — Open source:** [MIT](LICENSE); the repo contains source, dependency pins, manifests, tests and build/run instructions. UI/contracts can be built from the checkout; live hosted runs additionally need model credentials, an authorized agent and a working Nox bridge.
- **P — Privacy:** hosting/gateway services can observe IP, wallet and run metadata; Gemini receives news/chain context, and the final RPC provider receives RPC payloads. Public transactions and wallet RPC are not hidden; the client source includes no third-party analytics integration, and routing counters are not anonymity proof.
- **S — Security:** owner/deployer keys stay local; the shared agent key is held by the Fly runner, explicitly custodial for that restricted key. Personal beta keys are encrypted on-device; browser compromise, parent ENS authority and unaudited contracts remain trust assumptions.

Protocol components include [Uniswap v4](https://github.com/Uniswap/v4-core), [ENSv2](https://github.com/ensdomains/contracts-v2), [Anon-RPC](https://github.com/ethereum/anon-rpc) and [Nox](https://github.com/hisoka-io/nox). [Uniswap feedback](FEEDBACK.md) documents the builder experience. Deployment/bootstrap and independent CLI verification can use public RPC; the UI labels its independent public-reader fallback.

## Security and availability limits

An allowed trade can lose value. In the **original shared vault**, a compromised agent can choose a weak signed output minimum and repeatedly trade within its remaining ENS daily allowance. Price impact compares this pool immediately before/after the swap, not an independent fair-price oracle. UTC reset permits spending across adjacent daily windows. Only the **new session vault** adds the independent owner floor and finite session budget; that chosen floor is also not a market oracle.

Browser, shared-API and fixed owner-policy runs share operating capacity: **20 admitted requests/hour, 40/day**, a **10-second global** and **30-second caller** cooldown. Accepted failures consume capacity; API callers share one caller bucket. Jobs, challenges and counters are bounded/in-memory and reset on Fly restart. They are not durable abuse protection or personal token budgets. This is not a mainnet trading or real-asset custody service.

## AI assistance and team contributions

Codex assisted implementation, review, UI design, tests, deployment/rehearsal tooling and documentation in this branch, including changes under `app/src/`, `agent/src/`, ENS/onboarding/session contracts, `contracts/test/` and `scripts/`. The product/design documents record requirements used during that work. Third-party libraries and fixtures retain their attribution/licenses.

Representative assisted files include [the sandbox UI](app/src/components/SandboxControls.tsx), [ENS owner controls](app/src/components/OwnerPolicyControls.tsx), [runner](agent/src/runtime.ts), [ENS policy source](contracts/src/ens/ENSPolicySource.sol), [session vault](contracts/src/SessionAgentVault.sol) and [receipt verification](scripts/verify-live-browser-demo.mjs). Codex also assisted caption/narration text and editing the real browser captures; the published live video has no narration audio. Product requirements and planning artifacts are preserved in [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md), [UI_BRIEF.md](docs/UI_BRIEF.md) and the [workspace](.impeccable/surfaces/demo.md), [personal onboarding](.impeccable/surfaces/agents.md) and [session](.impeccable/surfaces/sessions.md) briefs.

The team supplied product requirements, chose the workspace UX, configured service access and performed the recorded MetaMask owner confirmations. Automated/CLI evidence is distinguished from human browser actions. Individual contributions and required AI/specification disclosures must also be listed accurately in the ETHGlobal submission.

License: [MIT](LICENSE).
