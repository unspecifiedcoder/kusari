# Uniswap v4 developer feedback: Kusari

Kusari is a v4 hook (`beforeSwap` + `afterSwap`) that enforces an AI trading agent's policy on-chain: per-swap cap, daily cap, allowed pool, max price impact, a signed minimum output, and an EIP-712 signed intent. The policy itself is read from ENSv2. The agent's funds sit in a vault that calls `PoolManager.unlock` directly. Built at ETHGlobal Mumbai 2026 on Sepolia.

Code: [`contracts/src/PolicyHook.sol`](contracts/src/PolicyHook.sol), [`contracts/src/AgentVault.sol`](contracts/src/AgentVault.sol), [`contracts/script/Deploy.s.sol`](contracts/script/Deploy.s.sol).

## What worked well

- **`hookData` is the right primitive.** Passing an ABI-encoded signed intent from the vault's `unlockCallback` through `poolManager.swap(key, params, hookData)` into the hook was clean, and the hook's `sender` argument (the vault) made binding "who signed" to "who is swapping" straightforward.
- **Atomic `afterSwap` reverts.** Reverting in `afterSwap` rolls back the entire swap inside `unlock`. That let us enforce price impact *after* the swap executes, with no cleanup logic. We have a test proving balances, price and our own accounting are all untouched after the revert.
- **`StateLibrary.getSlot0`** for reading the pool price inside the hook was easy to find and use.
- **The v4-template** got us from zero to a passing hook test in minutes. `deployCodeTo` to a flags-encoded address is a great testing trick.
- **Transient storage** (`uint160 transient`) is a natural fit for carrying the pre-swap price from `beforeSwap` to `afterSwap`.

## Friction we hit

1. **Hook reverts are hard to decode off-chain.** A custom error from the hook reaches the caller wrapped as `WrappedError(address target, bytes4 selector, bytes reason, bytes details)` (ERC-7751). viem shows it as `WrappedError`, so to show users *"Blocked: exceeds the per-swap cap"* we had to decode `args[2]` against the hook ABI ourselves. A short docs section ("decoding hook reverts in viem/ethers") with a snippet would save every hook team this step. It also bit our Foundry tests: `vm.expectRevert(IPolicyHook.ExceedsPerSwap.selector)` doesn't match; you need the full wrapped encoding.

2. **Slippage bounds live in the router, not the swap.** `SwapParams` carries only a price limit, and the trader's `minAmountOut` usually stays in the router. A policy hook that should enforce the trader's tolerance has to receive it some other way. We put a signed `minAmountOut` in `hookData` and check it in `afterSwap` against the `BalanceDelta` the hook receives, which works well because our vault *is* the router. A documented pattern for "policy hooks" (what a hook can and can't enforce about a trade, and how to pass the trader's bounds in) would help people reason about guarantees.

3. **Template vs docs drift.** The docs and older examples use `Deployers` from v4-core test utils, while the current template tests use `BaseTest` + `EasyPosm`. Also, `EasyPosm.mint` uses `address(this)`, which `forge script` rejects ("Usage of address(this) detected in script contract"), so we couldn't reuse it in our deploy script and had to call `PositionManager.modifyLiquidities` directly. A script-safe liquidity helper in the template would help.

4. **Deploying hooks on Sepolia today: gas estimates are far too low.** Sepolia's current code-deposit pricing is roughly 7× what Foundry's local EVM assumes (we measured ~1,500 gas per deployed byte: a 4.2 KB contract used 6.8M gas on-chain vs 0.99M simulated). `forge script` therefore underestimates every deployment and transactions run out of gas. Worse, an unoptimized hook (~14 KB) would need ~21M gas, over the ~16.7M per-transaction cap, so it can't be deployed at all. What fixed it: turning the optimizer on (the template's `foundry.toml` doesn't enable it) and `forge script --skip-simulation` so the node estimates gas. Suggest: enable the optimizer in the template, and mention this in the deployment guide.

5. **Deployments page.** It now says v4 addresses differ per chain, which is correct and helpful; a machine-readable JSON (chainId → addresses) linked from that page would make multi-chain deploy scripts much less error-prone.

## Latest deployment check — 6 November 2026

With Foundry 1.5.1, the new hook's simulated broadcast limit (including the default 130% multiplier) was about 2.49M gas, while the node estimated 12.77M. Its successful receipt used 12,571,402 gas. For this release we kept simulation enabled, checked the node estimate for every contract creation, and used an 800% multiplier on the unscaled simulation. All 14 deployment transactions succeeded. This gives another reproducible example of the deployment-estimation friction above; blindly trusting the default simulated limit would have failed.

## Ideas

- An official example "**policy / guardrail hook**" (caps + allowlists + signed intents) would be a useful reference: there's growing demand for agent-safe swapping, and the pattern of *vault → direct unlock → hook-enforced policy* closes the "just use another router" bypass.
- A helper in v4-periphery for **reading `slot0` before/after a swap** (or exposing the pre-swap price to `afterSwap`) would make price-impact checks a one-liner.

Thanks for v4. Hooks made it possible to put the safety rule where it can't be skipped: in the pool itself.
