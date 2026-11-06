# Kusari 鎖

**Give your agent a budget. Keep the final say.**

AI trading with ENSv2 owner controls, Uniswap v4 enforcement and Ethereum Foundation Anon-RPC routing. Built at ETHGlobal Mumbai 2026 on Sepolia with test tokens.

**[Open the judge demo →](https://kusari-demo.vercel.app)** · [Deployed source](https://github.com/unspecifiedcoder/kusari/tree/codex/judge-ready) · [Uniswap feedback](FEEDBACK.md)

## For judges

1. Open the website without connecting a wallet. Inspect the configured agent, policy, budget and vault balances.
2. Open **Demonstration** to follow presenter-run activity. Connection and freshness labels distinguish current readings from stale data or recorded proof.
3. Inspect **Owner controls** to read authorization. Only the current ENS name owner on Sepolia can revoke or regrant the agent's role.
4. Follow the transaction links below to verify a complete run even when the presenter is offline.

This release demonstrates one configured agent, `alpha.kusari-pramod.eth`. Public visitors observe the shared agent; trade and injection controls are presenter-only. The advanced `/setup` route is a vault tool, not a complete self-service agent onboarding flow.

## What Kusari enforces

An agent may make a bad decision or lose its signing key. Its funds remain in an owner-controlled vault, and the vault routes swaps through a Uniswap v4 policy hook:

| Layer | Role |
| --- | --- |
| **AgentVault** | Only the configured agent can request swaps; only the owner can withdraw. Every swap includes a signed intent and uses the required hook. |
| **PolicyHook** | Checks agent authorization, allowed pool, funding-token direction, per-swap and daily caps, nonce and deadline. `afterSwap` checks actual pool-price movement and the signed minimum output; a failed check reverts the whole swap. |
| **ENSv2 policy source** | Reads the name's live role and `kusari.policy` data record. The owner can change limits or revoke access without redeploying the hook. The parent registry is pinned, and the agent cannot rebind itself. |
| **Anon-RPC / Nox** | Routes the agent's chain reads and transaction submission through the mixnet by default, separating RPC traffic from the agent's source IP. |

The rehearsal policy is **5 kUSD per swap, 100 kUSD per UTC day, one pool, and 2% maximum pool-price impact**. The website reads current state rather than treating those numbers as fixed UI values.

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
| Demonstration vault | [`0x209c26182c40F6B34Ef5fe11b21709496dc6a2ed`](https://sepolia.etherscan.io/address/0x209c26182c40F6B34Ef5fe11b21709496dc6a2ed) |
| kUSD / kETH | [`0x218885DEB694Dd7a822B936ca0a214C35C2467Fa`](https://sepolia.etherscan.io/address/0x218885DEB694Dd7a822B936ca0a214C35C2467Fa) / [`0xabD19b8591318cf8EAB1fE106000DDFf0E31d9F0`](https://sepolia.etherscan.io/address/0xabD19b8591318cf8EAB1fE106000DDFf0E31d9F0) |
| Agent, `alpha.kusari-pramod.eth` | [`0x72db032c0dFB6E7502e16A73fabdab31712dc706`](https://sepolia.etherscan.io/address/0x72db032c0dFB6E7502e16A73fabdab31712dc706) |
| ENS owner | [`0xc815eDb747e34DA879AFE1a0EF3DF641B4921000`](https://sepolia.etherscan.io/address/0xc815eDb747e34DA879AFE1a0EF3DF641B4921000) |
| `kusari-pramod.eth` UserRegistry | [`0x479a0588634C3c20509707D05d95561BC2d5FB36`](https://sepolia.etherscan.io/address/0x479a0588634C3c20509707D05d95561BC2d5FB36) |
| PermissionedResolver | [`0xBDf4Ca409529182C45cE767683a1CCafD15225b5`](https://sepolia.etherscan.io/address/0xBDf4Ca409529182C45cE767683a1CCafD15225b5) |

The canonical manifests [`deployments/11155111.json`](deployments/11155111.json) and [`deployments/11155111-ens.json`](deployments/11155111-ens.json) select this release by default. The hosted `-next` manifests contain the same deployment and are retained for existing runtime configuration. Original addresses are preserved in the `-legacy` manifests. Do not redeploy merely to inspect or run the configured demo.

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
| Contract tests | [`contracts/test/`](contracts/test) |

## Run locally

Use the Node version in [`.nvmrc`](.nvmrc). See [build instructions](docs/BUILD.md) for the supported toolchain. Keep wallet and model keys in a local, ignored `.env`; the owner and agent must match the selected deployment metadata. A random new key has no authority over an existing vault or ENS name.

```sh
cp .env.example .env
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

The frontend can run on Vercel; the Node agent, Chromium/Nox bridge and logging proxy require a persistent backend. The same-origin `/api/demo/*` routes connect to a bearer-protected, fixed-route observation gateway. The gateway token stays server-side; public visitors cannot submit trades or change the agent's transport. See [judge hosting instructions](docs/JUDGE_HOSTING.md).

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

## Built with

[Uniswap v4](https://github.com/Uniswap/v4-core) · [ENSv2](https://github.com/ensdomains/contracts-v2) · [EF Anon-RPC](https://github.com/ethereum/anon-rpc) · [Nox](https://github.com/hisoka-io/nox)

License: [MIT](LICENSE)
