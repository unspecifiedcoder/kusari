# Reusable Kusari UI prompt

Use this context when asking a designer or another AI to improve the interface. PRODUCT.md is the factual product context; DESIGN.md records the selected visual system.

## Prompt

Redesign Kusari as a dark product workspace for managing and testing an AI trading agent. Preserve the working application and its actual capabilities. A first-time user, including someone using a screen reader, should understand the purpose and next action without studying a diagram.

Kusari lets an AI agent propose trades while an owner sets enforceable permissions and spending limits. Trading funds stay in a restricted vault. A Uniswap v4 policy hook checks each requested trade against ENSv2 authorization and policy. The model cannot override those contract checks merely by requesting a different amount.

There are two roles. Visitors can inspect public data and request bounded sandbox runs. Only the current verified ENS owner can revoke or restore the agent's role. Connecting a wallet must not imply that the visitor owns the shared vault.

The visitor's flow is: connect an EOA on Sepolia; choose Normal trade or Poisoned-news challenge; read and sign one gas-free message; follow the chain read, Gemini decision and guarded execution; inspect the actual result and transaction receipt. The shared backend supplies test tokens and gas. Do not imply a deposit, token approval or personal trading account is required.

The normal scenario uses clean news and permits a request up to 1 kUSD. The attack scenario stages malicious news for a deliberately gullible prompt. Show what the real Gemini model actually decides. If it refuses or holds, say no trade was submitted. If it requests more than the current cap, show the real contract rejection only after it is observed.

The owner flow is: revoke the ENS role, confirm on Sepolia, see revoked status, observe the next trade blocked with NotAuthorized, restore the role, and confirm that trading can resume. Revocation does not reverse past trades. These controls must be disabled for non-owners, wrong networks and non-canonical origins.

The workspace must answer four questions in plain text: What does the agent want to do? What is it allowed to do? What actually happened? What can I do next? Keep one primary run action, compact live policy context, distinct own-run results and shared activity, and deeper technical details behind clear disclosures.

For each run, show a compact summary with Agent requested, Owner's limit, Result, Reason and Tx. Populate it from that run's model, policy and execution events. Use kUSD amounts and exact decoded errors such as ExceedsPerSwap, not invented ETH examples or renamed errors. Waiting, model hold, simulation-only rejection and an unconfirmed outcome need explicit wording. A missing hash after an error is not proof that nothing was submitted.

Show ENS identity, per-swap cap, daily remaining allowance, allowed pool, impact limit, authorization, vault balances and observation time from real data. Label unavailable, stale and last-received values. Never replace missing data with invented numbers.

Show Anon-RPC/Nox as the agent's observed RPC route. It does not hide public transactions, the RPC payload itself, the model request or the visitor wallet's independent RPC. An empty comparison log is not proof of anonymity.

Handle disconnected wallet, wrong chain, signature cancellation, expired challenge, cooldown, another visitor's active run, model hold/refusal, simulation-only block, known policy revert, unknown revert, success, timeout, stale data and offline services. Never call an arbitrary failed transaction confirmed policy protection.

Use semantic headings, labels, keyboard controls, visible focus and readable text. Announce important changes without rereading a timer every two seconds. Provide a concise textual description of any diagram and do not use color, motion, icons or spatial placement as the only source of meaning.

Preserve all signing, account/network guards, canonical-origin restrictions, nonce verification, admission limits, backend secrets and run-ID filtering. Do not invent chat, portfolio returns, settings, accounts, price charts or integrations that do not work. This release is one shared funded Sepolia demonstration with test tokens and real model/chain activity.
