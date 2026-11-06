# Bring your own agent

Kusari's hook does not require Gemini or the hosted runner. Your LLM, script or trading agent can sign a `SwapIntent` with its **own restricted agent key** and call its **own vault**. The same deployed Uniswap v4 hook reads that agent's live ENS policy and authorization. Your owner wallet retains withdrawals and freeze/restore authority.

The working shared sandbox is at [kusari.outcomeseal.com/demo](https://kusari.outcomeseal.com/demo). The [shared trade API](TRADE_API.md) uses Kusari's funded shared agent. This document describes the separate, locally signed integration; it never uploads your agent key to that API. Personal workspace onboarding remains beta.

## Provision an identity first

Use a separate owner wallet and a fresh restricted **Sepolia EOA agent**. Never use an owner key, a mainnet-funded key or Kusari's shared agent as the restricted signer. The owner provisions:

1. A dedicated ENSv2 PermissionedResolver initialized with admin roles granted to the owner.
2. Its own label beneath `kusari-pramod.eth`, using `OwnedAgentRegistrar.claim(agent,resolver)`. `labelFor(owner,agent)` returns the deterministic label.
3. An ABI-encoded `Policy(uint128 maxPerSwap,uint128 dailyCap,uint16 maxImpactBps,bytes32 allowedPool,bool active)` in the resolver's `kusari.policy` data record. Amounts are raw 18-decimal token0 units; `allowedPool` must be the deployed Kusari pool.
4. `ENSPolicySource.bind(agent,label,dnsName,namehash(fullName))`, then registry `grantRoles(keccak256(bytes(label)), 65536, agent)`. The harmless renewal marker is the agent's authorization; the agent receives no resolver or policy administration.
5. `AgentVaultFactory.create(agent)` called **by the owner**. Fund the resulting vault with test kUSD and give the restricted agent a small amount of Sepolia ETH for gas. Test kUSD is a permissionless test token; no mainnet funds are needed.

Current addresses are recorded in [the deployment manifest](../deployments/11155111.json), [ENS checkpoint](../deployments/11155111-ens.json) and [onboarding manifest](../deployments/11155111-owned.json). Proxy initialization and DNS/record encoding examples are in [the two-owner rehearsal script](../scripts/rehearse-owned-workspaces.mjs). Its default onboarding follows these owner-signed calls. The new one-transaction coordinator is a beta convenience path and is not required by this client.

The namespace's parent administrator remains a trust root. Separate owners control separate labels, dedicated resolvers, agent keys and vaults, while a reused agent key shares that agent's policy and daily budget. Use a fresh agent per independent workspace. A vault's agent is immutable: rotation requires a new vault and an owner-directed move of funds.

## Run the local client

Use Node 24 and install the existing agent dependencies with `npm ci` inside `agent/`. Keep these values in your local ignored `.env` or process environment:

```dotenv
ANON_RPC_URL=http://127.0.0.1:8546
KUSARI_VAULT_ADDRESS=<your provisioned Sepolia vault address>
AGENT_PRIVATE_KEY=<your own restricted agent key; required only for --send>
```

Start your own [Anon-RPC bridge](../README.md#run-locally), configured to use Nox, before running the example. It deliberately has no public-RPC fallback. Setting a URL does not prove privacy: the bridge's actual mode and configuration determine its route. Wallet setup transactions and public transaction data are separate from that private transport.

From `agent/`:

```powershell
# Reads chain state and prints an UNSIGNED intent. It does not sign or submit.
node src/bring-your-own.ts --amount 1

# Explicitly signs locally, simulates, then submits through your configured bridge.
node src/bring-your-own.ts --amount 1 --send
```

The client checks Sepolia (`11155111`), the vault's immutable agent, required hook and PoolManager before a write. It uses the EIP-712 domain **`{name:"Kusari", version:"1", chainId:11155111, verifyingContract:policyHook}`**. The verifying contract is the hook, not the vault or ENS resolver.

`SwapIntent` includes agent, vault, pool ID, direction, input amount, minimum output, nonce and deadline. The client reads the current pool price, signs a minimum output at 96.7% of the spot quote (0.3% pool fee plus 3% slippage allowance), uses a cryptographically random 256-bit nonce and expires the intent after five minutes. The hook checks output against the actual swap result. This floor is a simple testnet example, not a production route quote or trading strategy.

A failed simulation stops submission; there is no force-send flag. A successful simulation does not guarantee execution: the owner can freeze the agent, liquidity can move or policy can change before inclusion. A transaction hash means submitted; the receipt determines success or revert. If a submission fails ambiguously, inspect the agent's pending transactions before retrying.

Have your LLM produce a validated input amount, then invoke this client or reuse its typed-data and swap call. Keep the private key out of prompts and model context. The owner sets policy; model output never changes the owner policy. This client only buys token1 with token0 through the configured pool.

## Freeze, restore and smart accounts

The ENS label owner freezes this agent with registry `revokeRoles(labelHash,65536,agent)` and restores it with `grantRoles`. The hook reads authorization on the next swap, including for an intent signed before revocation. Freezing one agent does not revoke a different agent's independent label. The [two-owner receipt report](evidence/owned-workspaces.json) and real-contract fork tests demonstrate that isolation.

The hook uses OpenZeppelin `SignatureChecker`, so its signature validation supports ERC-1271 contract signers. **That is not a claim that every smart-account wallet is integrated or tested.** If the vault's agent is a contract account, that account must validate the intent and itself call `vault.swap`; an EOA directly calling on its behalf fails `OnlyAgent`. A smart-account client needs its own transaction execution adapter. This local private-key example and the hosted personal-workspace API currently implement EOA-agent signing only.
