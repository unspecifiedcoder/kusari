# Kusari 鎖

**Give your agent a budget. Keep the final say.**

AI trading with ENSv2 owner controls, Uniswap v4 enforcement and Ethereum Foundation Anon-RPC routing. Built at ETHGlobal Mumbai 2026 on Sepolia with test tokens.

**[Try the demo →](https://kusari.outcomeseal.com/demo#try-sandbox)** · [Trade API](docs/TRADE_API.md) · [Bring your own agent](docs/BRING_YOUR_OWN_AGENT.md) · [Personal agents · Beta](https://kusari.outcomeseal.com/agents) · [Source](https://github.com/unspecifiedcoder/kusari/tree/codex/judge-ready) · [Uniswap feedback](FEEDBACK.md)

**Release status:** the custom domain is live with verified DNS and HTTPS. Browser MetaMask signatures, real Gemini normal/attack runs, owner freeze/restore and a successful post-restore swap passed on 6 November 2026. The user reported no wallet security warning on the custom domain. `kusari-demo.vercel.app` remains under MetaMask review; a [review is submitted](https://github.com/MetaMask/eth-phishing-detect/issues/309873), not cleared. Use the custom domain and never bypass a wallet security warning.

## For judges

1. Open the website without connecting a wallet. Inspect the configured agent, policy, budget and vault balances.
2. Open **Try the demo → Request a trade**, connect a supported wallet on Sepolia, choose **Trade within limits** or **Test an over-limit request**, and sign the displayed message. No test ETH, token approval or transfer from your wallet is required.
3. Read **Your result**: the actual requested amount, owner's limit, outcome, decoded reason and receipt. Expand **How this request was enforced** for the run-specific ENS/Uniswap/Nox evidence. Shared activity and Integration details are separate disclosures. Freshness labels distinguish current readings from stale data or recorded proof. **Owner controls** remain restricted to the current ENS name owner on Sepolia.
4. Follow the transaction links below to verify a complete run even when the presenter is offline.

The funded `/demo` path demonstrates one configured agent, `alpha.kusari-pramod.eth`, using a **shared funded Sepolia vault**. A visitor's EIP-191 message signature authorizes one fixed sandbox scenario; the backend agent supplies gas and test tokens. A normal decision may spend at most 1 kUSD. The poisoned-news scenario exercises rejection only if the real model requests more than the owner's current cap (5 kUSD in the rehearsal); a hold or refusal is reported honestly without claiming an attack was blocked onchain.

The optional **`/agents` path is beta**. Its streamlined flow generates and encrypts an agent key in the browser, then calls a coordinator to create its owner-controlled ENS label/resolver/policy and vault in one transaction, mint 25 valueless kUSD and forward 0.0001 Sepolia ETH to its agent. A gas-free owner signature protects the local key; the owner also confirms and funds the setup transaction. The page checks the owner's gas balance before requesting a signature. The earlier six-step flow passed live two-owner isolation; the new atomic coordinator is deployed and passed eight fork tests, while its complete live/browser rehearsal remains pending. Keep the verified shared demo as the primary judging path. `/setup` remains the older advanced vault tool.

Personal owner keys stay in the wallet; personal agent keys and unlock signatures never enter the hosted runner. The browser page must be open and unlocked to sign a new personal trade. Wallet-based unlocking requires reproducible EOA message signatures from the same wallet/signing method; keep an optional encrypted recovery backup, since wallet ownership alone cannot recover a random key after browser storage is lost. Legacy passphrase backups remain supported. Each owner/agent pair gets a label under `kusari-pramod.eth`, whose parent administrator remains a trust dependency. Arbitrary ENS parents and in-place agent-key rotation are not supported. See [owned-workspace architecture and boundaries](docs/OWN_AGENTS.md).

External agents can also call the **shared `/v1/trade` API** with a dedicated demo bearer key, a decimal `amountIn` of at most 1 kUSD and an optional stricter output minimum. The shared agent key is held by Kusari's Fly runner; the hook still enforces ENS policy. This route accepts the external caller's decision and labels it `external-agent`; it does not claim Gemini produced that request. A [real 1 kUSD API trade](https://sepolia.etherscan.io/tx/0x736d1bbdcc78ae9d2e26105f15f760b5b02a5a35eb67d56811127f5a6c68556e) and rejection/cooldown checks passed. [API docs and curl](docs/TRADE_API.md) explain custody, polling and shared quotas. Owner revocation, policy editing and withdrawals are not exposed by this API.

The current UI is a dark product workspace with persistent navigation, a task-first composer and compact policy controls. [Product context](PRODUCT.md), the [reusable UI prompt](docs/UI_BRIEF.md) and [design system](DESIGN.md) explain the flow, accessibility requirements and evidence boundaries for future contributors or AI assistants. Its new five-field result was verified with a user-signed real Gemini [1 kUSD swap](https://sepolia.etherscan.io/tx/0xa0e48bb4fdce53b6b8ed2b6701bcb8cb1f1b87dc855e0215af7d0fd61acddab7).

## What Kusari enforces

An agent may make a bad decision or lose its signing key. Its funds remain in an owner-controlled vault, and the vault routes swaps through a Uniswap v4 policy hook:

| Layer | Role |
| --- | --- |
| **AgentVault** | Only the configured agent can request swaps; only the owner can withdraw. Every swap includes a signed intent and uses the required hook. |
| **PolicyHook** | Checks agent authorization, allowed pool, funding-token direction, per-swap and daily caps, nonce and deadline. `afterSwap` checks actual pool-price movement and the signed minimum output; a failed check reverts the whole swap. |
| **ENSv2 policy source** | Reads the name's live role and `kusari.policy` data record. The owner can change limits or revoke access without redeploying the hook. The parent registry is pinned, and the agent cannot rebind itself. |
| **Anon-RPC / Nox** | Routes the agent's chain reads and transaction submission through the mixnet by default, separating RPC traffic from the agent's source IP. |

The rehearsal policy is **5 kUSD per swap, 100 kUSD per UTC day, one pool, and 2% maximum pool-price impact**. The website reads current state rather than treating those numbers as fixed UI values.

## Live visitor and owner verification

On **6 November 2026**, the custom-domain UI and public API completed the following checks. The user signed the two scenario messages and the two owner transactions in MetaMask on Sepolia, reporting no security warning. The blocked trade while frozen and the final normal trade were requested through the public signed API using ephemeral test wallets. Agent routing reported `anon` with the bridge in `anon` mode.

| Check | Sepolia evidence |
| --- | --- |
| Browser normal scenario | Real Gemini requested 1 kUSD; [swap succeeded](https://sepolia.etherscan.io/tx/0x947f9b3d7ce8d6989fed3410dc0ac3efedf54fb045cb7dfa52acef5db20a8861) and the run-specific UI showed the receipt |
| Browser owner freeze | [ENS role revoked](https://sepolia.etherscan.io/tx/0xc2d455abffb86c788e56c86a0574ddb23ca9d5391d4d0f1b98551b83d4d1856d); UI changed to Trading blocked |
| Public normal scenario while frozen | Real Gemini requested 1 kUSD; [transaction reverted with `NotAuthorized`](https://sepolia.etherscan.io/tx/0x3c2c1e8786ee1bc9371eb59d5e0c2ad4812847a0862da3aba93fe69dff11751a); vault balances unchanged |
| Browser owner restore | [ENS role restored](https://sepolia.etherscan.io/tx/0x577bc7faeda7a24869189abf2b0691e604fc615a0e35d6786114b6421f0a3fe6); owner view returned to Authorized |
| Browser poisoned-news scenario | Real Gemini requested 81.9 kUSD against the 5 kUSD cap; [transaction reverted with `ExceedsPerSwap`](https://sepolia.etherscan.io/tx/0x067c00b2afaccae1c07511accb2d6cfd4d2f413f6ca783962c07afa6ac2a06f0); UI showed the exact rejection and receipt |
| Public normal scenario after restore | Real Gemini requested 1 kUSD; [swap succeeded](https://sepolia.etherscan.io/tx/0x5861ff93e6d4ce1cfeaf362fd41781a9f1823751fb3acfe4b40363cb7f58f45c) |

Public HTTPS checks also rejected a different origin (403) and replayed signatures (409). The homepage at 320 px and sandbox at 390 px had no horizontal overflow. The final state was authorized and active, with the backend idle, a fresh chain snapshot and Anon-RPC/Nox observed. These checks establish the shared testnet demonstration, not personal-vault onboarding or an audited production trading service.

## Demo (4 minutes)

On **6 November 2026**, the real Gemini agent and owner CLI completed **6/6 checks** against the current deployment. Agent reads, simulations and transaction submissions used Anon-RPC/Nox; owner CLI revocation/regrant used a public Sepolia RPC override. This is a CLI-verified rehearsal; it does not claim that the browser owner-wallet signing flow was exercised.

| Beat | Result and Sepolia evidence |
| --- | --- |
| Read ENS policy | Authorized and active; 5 per swap and 100 daily cap |
| Normal decision | Gemini requested 5 kUSD; [swap succeeded](https://sepolia.etherscan.io/tx/0x7816c314503bcf336d7780c3d567da65e7a37b2e9ec761b5a120a3b01aab0ad4) |
| Staged prompt injection | Gemini requested the remaining 95 kUSD; [hook reverted with `ExceedsPerSwap`](https://sepolia.etherscan.io/tx/0xa0295bab9d5006f67b61ad8d7a04d5a0919317b2cbd7b92aa70aec01ca13df00); vault balance stayed unchanged |
| Owner kill switch | [ENS role revoked](https://sepolia.etherscan.io/tx/0x0091c5259fc3abfaac082c62c7b8cbf7d662d6ca0608c85306e6afc921f04981); [next 0.1 kUSD swap reverted with `NotAuthorized`](https://sepolia.etherscan.io/tx/0xe8a72a961db3e7195c047b3dd4987901a74ec81777a74287362b7d176bc66dc6) |
| Rebind attempt | Agent's attempted `bind()` was rejected with `NotNameOwner` |
| Restore authorization | [Role regranted](https://sepolia.etherscan.io/tx/0x4e9b9c1aeee0fdf5659bd677204fb01a24cab9c7121cf7cb37fe1a857e3dffaf); [next 0.1 kUSD swap succeeded](https://sepolia.etherscan.io/tx/0x5275c8476b62ed7128d39ac0f22708f19b64806912a5f2dcbe58951193c3f897) |

The injection is deliberately staged with a gullible prompt. The contract rejection is real. A normal model may refuse the injected instruction; Kusari's protection does not rely on that refusal.

### Earlier screenshots

These screenshots show an **older deployment/run**, not the current addresses or current balances. Use the current contract table and rehearsal links above for the submitted release.

| Earlier provider-leak demonstration | Earlier attack blocked |
| --- | --- |
| ![Historical Anon-RPC off demonstration](docs/demo-leak.png) | ![Historical onchain attack rejection](docs/demo-hijack.png) |

## Current Sepolia contracts

| Contract or identity | Address |
| --- | --- |
| PolicyHook | [`0x9C8dfb140ffc368694644783a3f2Ac37B8B400c0`](https://sepolia.etherscan.io/address/0x9C8dfb140ffc368694644783a3f2Ac37B8B400c0) |
| ENSPolicySource | [`0x2dAA4eEacfDe394679aaE27e1F554442002b3438`](https://sepolia.etherscan.io/address/0x2dAA4eEacfDe394679aaE27e1F554442002b3438) |
| AgentVaultFactory | [`0xa73BDda27e66A0BfF20d85De8EAf20c0C8EE5370`](https://sepolia.etherscan.io/address/0xa73BDda27e66A0BfF20d85De8EAf20c0C8EE5370) |
| OwnedAgentRegistrar (register-only) | [`0xf913591278db093fc33e1ac20b45745a51b9dc32`](https://sepolia.etherscan.io/address/0xf913591278db093fc33e1ac20b45745a51b9dc32) |
| Demonstration vault | [`0x209c26182c40F6B34Ef5fe11b21709496dc6a2ed`](https://sepolia.etherscan.io/address/0x209c26182c40F6B34Ef5fe11b21709496dc6a2ed) |
| kUSD / kETH | [`0x218885DEB694Dd7a822B936ca0a214C35C2467Fa`](https://sepolia.etherscan.io/address/0x218885DEB694Dd7a822B936ca0a214C35C2467Fa) / [`0xabD19b8591318cf8EAB1fE106000DDFf0E31d9F0`](https://sepolia.etherscan.io/address/0xabD19b8591318cf8EAB1fE106000DDFf0E31d9F0) |
| Agent, `alpha.kusari-pramod.eth` | [`0x72db032c0dFB6E7502e16A73fabdab31712dc706`](https://sepolia.etherscan.io/address/0x72db032c0dFB6E7502e16A73fabdab31712dc706) |
| ENS owner | [`0xc815eDb747e34DA879AFE1a0EF3DF641B4921000`](https://sepolia.etherscan.io/address/0xc815eDb747e34DA879AFE1a0EF3DF641B4921000) |
| `kusari-pramod.eth` UserRegistry | [`0x479a0588634C3c20509707D05d95561BC2d5FB36`](https://sepolia.etherscan.io/address/0x479a0588634C3c20509707D05d95561BC2d5FB36) |
| PermissionedResolver | [`0xBDf4Ca409529182C45cE767683a1CCafD15225b5`](https://sepolia.etherscan.io/address/0xBDf4Ca409529182C45cE767683a1CCafD15225b5) |

The canonical manifests [`deployments/11155111.json`](deployments/11155111.json) and [`deployments/11155111-ens.json`](deployments/11155111-ens.json) select this release by default. The hosted `-next` manifests contain the same deployment and are retained for existing runtime configuration. Original addresses are preserved in the `-legacy` manifests. Do not redeploy merely to inspect or run the configured demo.

## Owned-workspace isolation verification

On 6 November 2026, the public hosted workspace API completed a live two-owner rehearsal. Four fresh keys were generated only in the local test process. Each owner created a separate ENS label, resolver, policy and vault. Real Gemini decisions were signed locally and submitted through Nox; setup/owner transactions in this CLI rehearsal used a public Sepolia RPC.

| Check | Live Sepolia evidence |
| --- | --- |
| A trades normally | [Successful 1 kUSD swap](https://sepolia.etherscan.io/tx/0xf63a6ed889e3d7110923e0efadc60100b7de24e196fd90ffd881e300a40c46ee) |
| B trades normally | [Successful 1 kUSD swap](https://sepolia.etherscan.io/tx/0xc29010571c41d82ece12b9eeb6143b09353b398a4491fdfa1889dbb75c6ae1f8) |
| Owner A freezes only A | [Confirmed role revocation](https://sepolia.etherscan.io/tx/0x3e7173000e9eed6fd9525704c6157a46a641f7341fbf703741167d48eb8274b3) |
| A cannot trade while frozen | [Confirmed reverted swap](https://sepolia.etherscan.io/tx/0xba87b91c739ecb0715b3ccdc11301fad2002fa0c7bf5c6180760f78bafd91cdc) |
| B can still trade while A is frozen | [Successful swap](https://sepolia.etherscan.io/tx/0xb447b2200e24c4163b7d54caad23a15b02d10ca6df435700a9a188bc71c0ceac) |
| A is restored | [Confirmed role restoration](https://sepolia.etherscan.io/tx/0x7f2441452f60095d9c4c47b4bb071d245018b80c6ba359af7db5a3dbee35674b) |

A's spent amount stayed at 1 kUSD; B's independently reached 2 kUSD. Each run observed 16 Nox RPC requests and one transaction submission, with zero observed HTTP failures. These are service routing counters, **not proof of anonymity**. The exact nested `NotAuthorized` failure, cross-owner denial of policy editing/rebinding/freezing/withdrawal, and registrar authority boundaries are covered by the real-contract Sepolia fork tests. The live receipt above proves a revert without claiming that a receipt contains its decoded revert reason.

See the [public rehearsal report](docs/evidence/owned-workspaces.json), [reproducible script](scripts/rehearse-owned-workspaces.mjs) and [ownership tests](contracts/test/ens/OwnedAgentIsolation.t.sol). The CLI rehearsal is distinct from a complete browser owner walkthrough.

## Code map

| What to inspect | Source |
| --- | --- |
| Hook permissions and pre/post-swap enforcement | [`PolicyHook.sol`](contracts/src/PolicyHook.sol#L52) |
| Intent, signature, nonce and policy checks | [`PolicyHook.sol`](contracts/src/PolicyHook.sol#L121) |
| Agent-only vault swap and direct PoolManager settlement | [`AgentVault.sol`](contracts/src/AgentVault.sol#L34) |
| Pinned ENS registry, owner binding and least-privilege roles | [`ENSPolicySource.sol`](contracts/src/ens/ENSPolicySource.sol#L49) |
| Hook-address mining, test tokens, liquidity and vault deployment | [`Deploy.s.sol`](contracts/script/Deploy.s.sol) |
| Real model decisions and signed swaps | [`llm.ts`](agent/src/llm.ts), [`swap.ts`](agent/src/swap.ts) |
| Full current-deployment rehearsal | [`e2e.ts`](agent/src/e2e.ts) |
| Authenticated observation gateway and hosted startup | [`demo-gateway.mjs`](scripts/demo-gateway.mjs), [`start-hosted-demo.mjs`](scripts/start-hosted-demo.mjs) |
| Wallet-signed Sandbox admission and visitor UI | [`sandbox-access.mjs`](scripts/sandbox-access.mjs), [`SandboxControls.tsx`](app/src/components/SandboxControls.tsx), [`sandbox-http.mjs`](app/src/lib/sandbox-http.mjs) |
| Personal ENS registration and browser onboarding | [`OwnedAgentRegistrar.sol`](contracts/src/ens/OwnedAgentRegistrar.sol), [`OwnedAgentWorkspace.tsx`](app/src/components/OwnedAgentWorkspace.tsx) |
| Browser key encryption and bounded local signing | [`owned-key.ts`](app/src/lib/owned-key.ts), [`owned-agent.ts`](app/src/lib/owned-agent.ts) |
| Non-custodial Gemini preparation and Nox relay | [`workspace.ts`](agent/src/workspace.ts), [`workspace-http.mjs`](app/src/lib/workspace-http.mjs) |
| Bounded shared trade API and external-agent requests | [`api-trade.mjs`](scripts/api-trade.mjs), [`demo-gateway.mjs`](scripts/demo-gateway.mjs), [`trade-api-http.mjs`](app/src/lib/trade-api-http.mjs) |
| Direct integration and ENS judge architecture | [Bring your own agent](docs/BRING_YOUR_OWN_AGENT.md), [ASCII walkthrough](docs/ENS_JUDGE_WALKTHROUGH.md) |
| Contract tests | [`contracts/test/`](contracts/test) |

## Run locally

Use the Node version in [`.nvmrc`](.nvmrc). See [build instructions](docs/BUILD.md) for the supported toolchain. Keep wallet and model keys in a local, ignored `.env`; the owner and agent must match the selected deployment metadata. A random new key has no authority over an existing vault or ENS name.

```sh
# Preserve an existing .env. Create one from .env.example only for a new checkout.
# Configure the selected deployment, its local keys and GEMINI_API_KEY.
cd contracts
forge install
forge test
```

Start the services in separate terminals from the indicated directory:

| Directory | Command |
| --- | --- |
| `reader/` | `npm ci`, `npx playwright install chromium`, then `npm run bridge` |
| `proxy/` | `node server.mjs` |
| `agent/` | `npm ci`, then `npm start` |
| `app/` | `npm ci`, then `npm run dev` |

Open `http://localhost:3001/demo`. The presenter can run a normal decision, toggle the staged injection and compare direct-provider logs with Anon-RPC routing. Owner actions require the configured owner wallet. Local scripts `node agent/src/ens-policy.ts show` and `node agent/src/e2e.ts` inspect policy and rehearse the complete flow; the latter sends real Sepolia transactions and restores authorization after its revoke check.

**Validation:** the existing Solidity suite passed **44 local tests and 16 Sepolia-fork tests**. The judge frontend passed production build, TypeScript and lint; gateway/cache/startup boundaries have automated tests. These checks do not constitute a security audit.

## Hosting and privacy boundaries

The frontend runs on Vercel; the Node agent, Chromium/Nox bridge and logging proxy require a persistent backend on Fly.io. Same-origin `/api/demo/*` observation and `/api/sandbox/{challenge,run}` routes connect to a bearer-protected gateway. The token stays server-side. Sandbox admission verifies a single-use, expiring wallet signature for the exact origin and scenario; it exposes no arbitrary RPC, transport switch, owner-policy change or revoke endpoint. Public Sandbox runs require real Gemini and Sepolia; scripted fallback is unavailable. See [judge hosting instructions](docs/JUDGE_HOSTING.md) for activation and verification.

Sandbox limits are shared across visitors: 30 seconds per wallet, 10 seconds globally, 20 admitted runs per rolling hour and 40 per UTC day. Valid signed admissions consume budget even if the model or transaction fails. Challenges expire after two minutes, are single-use, and have at most 200 outstanding entries. These in-memory limits and challenges reset when the Fly backend restarts; they are operating limits, not durable abuse protection.

| Traffic | Route / disclosure |
| --- | --- |
| Agent chain reads, simulation, receipts and submissions | Anon-RPC/Nox by default; current bridge mode is verified and labelled |
| Hosted primary policy/balance snapshot | Backend snapshot through the agent's configured route; freshness is displayed |
| Independent UI reads when a fresh snapshot is unavailable | Public Sepolia RPC fallback, explicitly labelled |
| Owner's browser wallet transactions | The wallet's own RPC |
| CLI owner actions | Anon-RPC unless `SEPOLIA_RPC_URL` deliberately overrides it |
| Contract deployment and worker-specifier bootstrap | Public RPC |
| Model decision | Gemini receives market/news context; RPC anonymity does not anonymize the LLM request |

## Limits and trust assumptions

- Transactions, addresses and the ENS policy remain public onchain. Anon-RPC targets source-IP privacy; it does not hide RPC payloads, make a trade private or guarantee protection from traffic correlation.
- An allowed trade can lose value. A compromised agent can choose a weak signed output bound; the impact check compares the pool immediately before and after its swap, rather than checking an independent fair price.
- The daily cap resets at 00:00 UTC; up to two daily caps can be spent across that boundary.
- This deployment trusts one pinned parent registry. General multi-owner onboarding, Namera and EF Alt Mempools are future work.
- `PolicyMirror` is a tested multichain prototype, not the current Sepolia policy source. Its admin can update authorization, so its trust model differs from the owner-controlled ENS demo.
- The demonstration uses permissionless-mint test tokens and unaudited contracts.

## CROPS

- **C — Censorship resistance:** The hosted domain, Fly runner, model service, relay and ENS parent administrator are dependencies. If hosting refuses a request, shared trading stops; an owner can still call the deployed vault's withdrawal function using their wallet and the public ABI. A personal agent with its key can use the direct client independently of our hosted relay.
- **O — Open source:** Kusari is MIT licensed. Source, contract dependencies, tests, deployment manifests and build instructions are public; running a model/Anon-RPC environment requires the user's own service access and configuration. Published receipts can be verified without our frontend.
- **P — Privacy:** The service sees shared run requests and caller addresses; Gemini receives market/news, balance and limit inputs. Agent RPC reads and submissions use Anon-RPC/Nox, while transactions and state remain public. Browser policy readers and the owner's wallet RPC are separate privacy boundaries. Routing counters do not prove anonymity.
- **S — Security:** The shared demo signer is held by Kusari's runner; owner keys are excluded from Fly. Personal beta keys are encrypted on-device and sign locally while unlocked. ENS parent authority, browser-code integrity and unaudited contracts remain trust assumptions. The hook enforces policy even when a valid agent key signs a bad trade.

## AI assistance

Codex assisted with implementation, refactoring, UI design, tests, deployment tooling and documentation across the application, agent runner, ENS policy contracts and owned onboarding. New owned-workspace files are identified in the code map above; tests and deployment/rehearsal scripts are included in the same public change history. PRODUCT.md, DESIGN.md, docs/UI_BRIEF.md and docs/OWN_AGENTS.md record the product and design specifications used during that work.

The team supplied the product requirements, selected the workspace direction, configured service access and performed the recorded MetaMask owner confirmations. Automated checks and live rehearsal evidence are labelled separately from those user-performed browser actions. This disclosure does not replace listing individual team contributions in the ETHGlobal submission.

## Built with

[Uniswap v4](https://github.com/Uniswap/v4-core) · [ENSv2](https://github.com/ensdomains/contracts-v2) · [EF Anon-RPC](https://github.com/ethereum/anon-rpc) · [Nox](https://github.com/hisoka-io/nox)

License: [MIT](LICENSE)
