# Bounded trading sessions · Beta

`SessionAgentVault` is a separate, optional vault version. It adds a finite owner-approved budget, an expiry and an independent minimum exchange rate to the existing ENS authorization and Uniswap v4 hook. It does not upgrade the original shared demo or personal onboarding vaults.

The owner calls `openSession(totalBudget, expiresAt, minRateWad)` once. Only that owner can replace or close the session, or withdraw funds. The restricted agent cannot replenish its allowance, extend its expiry or lower the owner's output floor.

## What is enforced

- A swap must arrive before the exclusive expiry and fit inside the remaining session allowance.
- Every successful swap charges its **full requested input** against the allowance, including a partially filled trade. This is conservative; unused requested input does not become a second spending opportunity.
- After settlement, actual output must be at least `ceil(actualInput * minRateWad / 1e18)`. A zero or tiny agent-signed `minAmountOut` cannot weaken this independent owner floor.
- Failure reverts the entire transaction, including token settlement, pool state, hook accounting, nonce use and the session allowance reservation.
- The allowed token pair, pool, hook and agent are fixed. There is no inherited legacy swap entry point that bypasses session checks.

The displayed rate is kETH per kUSD for this fixed 18-decimal test-token pair. It is an owner-approved execution bound, **not an oracle tracking fair market value**. The UI can suggest a floor from the observed pool price and fee, but the owner must choose and approve it. Short sessions reduce exposure to a stale chosen rate; they do not turn it into a market oracle.

## Independence and limits

Session allowances belong to individual vaults. ENS authorization and the existing daily hook budget belong to the agent. Reusing an agent across vaults therefore shares its ENS role and daily cap. Use separate agent identities and ENS bindings for independent owner workspaces; the earlier [two-owner isolation proof](evidence/owned-workspaces.json) covers that distinction.

The optional `/sessions` view reads real session bounds, balances and `SessionSwap` events, and lets the connected owner approve, replace or close a session. It does not expose a connected web LLM runner. The shared `/v1/trade` API continues using the original shared vault. Keep `/demo` as the primary visitor experience.

## Verification

Fifteen new tests exercise real Uniswap v4 settlement: repeated small trades exhausting the allowance, exact expiry, zero/tiny agent minimums, ceiling rounding, actual partial fills, overflow rejection, complete rollback, unauthorized renewal/withdrawal, contract-agent reentrancy and separate vault budgets. The combined contract suite passes 87 tests, including 28 Sepolia fork tests. This is testing, not a security audit.

Deployment and live rehearsal use separate scripts and `deployments/11155111-session.json`. A live receipt or deployment is not implied by the local/fork test results. The session page shows an unconfigured state until that separate manifest exists.
