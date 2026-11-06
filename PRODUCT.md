# Kusari

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Visitors and ETHGlobal judges try an AI trading agent without obtaining tokens or depositing money. The presenter owns the configured ENS name and can revoke or restore the agent's trading authority. These are distinct roles; a visitor's wallet does not acquire owner permissions.

## Product Purpose

Let an AI agent propose trades while its owner retains enforceable control over funds, permissions and spending limits. A successful first visit explains what the agent proposes, what it may do, what actually happened and what the user can do next.

## Positioning

Trading funds stay in a restricted vault. A Uniswap v4 policy hook checks the agent's intent against ENSv2 authorization and policy. The protection does not depend on the model obeying its prompt.

## Operating Context

The current release is a shared funded Sepolia sandbox at https://kusari.outcomeseal.com. It uses test kUSD/kETH and real Gemini decisions and transactions. The next submission target supplied by the team is 7 November 2026 at 07:00 IST. Preserve the complete verified demo while redesigning its interface.

## Capabilities and Constraints

- A connected Sepolia EOA signs a gas-free, short-lived EIP-191 request for one fixed normal or poisoned-news scenario. The backend agent supplies test tokens and transaction gas.
- The normal scenario caps model requests at 1 kUSD. The poisoned-news challenge deliberately uses a gullible prompt; it exercises onchain rejection only if the actual model requests an over-limit swap. A hold/refusal is reported honestly.
- Events and the result panel belong to the accepted run ID. Shared history is a separate view and must never be passed off as a visitor's own result.
- The owner can revoke and restore the ENS role using real Sepolia transactions. Revocation blocks future execution after confirmation; it does not undo completed trades or withdraw funds.
- Agent chain reads and submissions are routed through Anon-RPC/Nox by default. Routing observations are not anonymity proofs. Public transactions and the visitor wallet's own RPC remain separate boundaries.
- The canonical domain is the only signing origin. Keep provider/account/network checks, explicit Sepolia writes, admission limits, single-use nonces and backend credentials unchanged.
- This is not personal-vault onboarding, arbitrary chat/trading, audited production finance or an Alt Mempool/Namera integration. Do not add controls implying those capabilities.

## Brand Commitments

Kusari and its chain mark remain recognizable. The user explicitly selected a dark product workspace with persistent navigation, a spacious agent workspace and compact policy controls. Use plain language and a consistent product vocabulary, not a marketing or terminal costume.

## Evidence on Hand

README.md records real normal/attack, browser owner freeze/restore, NotAuthorized rejection and successful resumed execution. Deployment manifests contain the actual ENS identity, contracts, vault and pool. FEEDBACK.md documents the Uniswap integration. Never fabricate returns, price charts, balances, model rationale or transaction evidence.

## Product Principles

1. Make the user's task and next action obvious.
2. Explain the boundary between an AI proposal and contract execution.
3. Show observed state, freshness and exact outcomes honestly.
4. Preserve owner control and the verified signing path.

## Accessibility & Inclusion

The user requested an explanation understandable without relying on the screen's appearance. Provide semantic headings and landmarks, explicit control names, keyboard focus, text equivalents for status and diagrams, readable contrast, reduced-motion support and bounded screen-reader announcements. No outcome may rely on color alone.
