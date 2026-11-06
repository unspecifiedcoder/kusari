# Kusari

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Visitors and ETHGlobal judges can try the funded shared agent without obtaining tokens or depositing money. Owners can instead create a separate agent workspace, ENS label, policy resolver and vault using their own Sepolia wallet. A shared-demo visitor does not acquire the presenter's permissions; an owned-workspace user controls only the names and vaults their wallet owns.

## Product Purpose

Let an AI agent propose trades while its owner retains enforceable control over funds, permissions and spending limits. A successful first visit explains what the agent proposes, what it may do, what actually happened and what the user can do next.

## Positioning

Trading funds stay in a restricted vault. A Uniswap v4 policy hook checks the agent's intent against ENSv2 authorization and policy. The protection does not depend on the model obeying its prompt.

## Operating Context

The application at https://kusari.outcomeseal.com has two separate paths: `/demo` is the funded shared Sepolia sandbox and the primary judging experience; `/agents` is owner-funded personal onboarding and execution, visibly marked Beta. The landing page and navigation lead with Try the demo. The streamlined atomic personal flow has not yet completed its live acceptance test; do not describe it as verified. Both paths use test kUSD/kETH and genuine Gemini proposals. Preserve the verified shared demonstration while extending the product.

## Capabilities and Constraints

- In the shared demo, a connected Sepolia EOA signs a gas-free, short-lived EIP-191 request for one fixed normal or poisoned-news scenario. The shared backend agent supplies test tokens and transaction gas. Its signing key is held by the hosted service: this shared demo is custodial with respect to the agent key, not a visitor-owned agent.
- New personal workspaces generate a separate restricted key in the browser. The owner signs a locally constructed, fixed EIP-191 key-protection message bound to the canonical origin, Sepolia, owner and agent. The verified, normalized signature derives an AES-GCM encryption key through HKDF. Neither the private key nor the unlock signature is uploaded or persisted in plaintext. The owner key remains in the wallet extension. This is a noncustodial personal key path with respect to the server, subject to browser-code compromise risks; use testnet funds only.
- Personal creation uses one gas-free local encryption signature followed by one owner-confirmed coordinator transaction. That transaction creates the resolver, owned ENS label, policy, agent binding and authorization, and immutable-owner/agent vault; it also mints 25 valueless test kUSD into the vault and forwards 0.0001 Sepolia ETH from the owner to the agent for gas. Defaults are 5 kUSD per trade, 100 kUSD daily and 2% maximum pool price impact. Custom limits are optional. This is not gas sponsorship or a zero-confirmation flow.
- Before any creation signature, the app checks the owner's actual Sepolia balance and estimates the coordinator transaction, adding a 20% gas margin bounded by 16 million gas. The displayed funding requirement includes the agent's 0.0001 ETH and the observed network-fee budget. An insufficient or unavailable balance/estimate disables creation; the UI offers the ETHGlobal Sepolia faucet and the funded shared demo. Funding is checked again before the transaction.
- Browser storage contains the encrypted personal workspace record. A later page or wallet session unlocks it with the same local message signature. Stable EOA signatures are required; use the same MetaMask account and signing method. A password and backup are not required for the normal first run. Optional encrypted export supports moving or recovering the record; without that export, clearing browser storage loses the random agent key, although the owner can still withdraw vault funds. There is no claim of recovery from a wallet address alone.
- Earlier personal workspaces retain their passphrase-encrypted keys and six individually confirmed setup steps as an advanced compatibility/recovery path. New workspaces use the coordinator. Both paths determine setup completion from actual chain state rather than saved completion flags.
- Each owned agent has its own ENS role and hook spending accounting; its vault has its own balances and withdrawal owner. Owners can mint additional test tokens, top up agent gas and withdraw vault tokens. Freezing a role does not move assets or undo transactions.
- Owned execution requires one owner-signed admission message. Gemini prepares a proposal; the browser checks the chain, agent, vault, pool, amount, slippage and gas boundaries before the restricted key signs locally. The server validates and relays the signed transaction through Anon-RPC/Nox. A wallet or workspace change cancels further signing for the pending browser operation.
- Gemini decisions and transaction relay run on Fly.io, while the personal signer runs in the open browser page. Keep the page open for a request; personal agents are not unattended background processes. Unlock signatures are separate from short-lived admission signatures and are never sent to the relay.
- The normal scenario caps model requests at 1 kUSD. The poisoned-news challenge deliberately uses a gullible prompt; it exercises onchain rejection only if the actual model requests an over-limit swap. A hold/refusal is reported honestly.
- Events and the result panel belong to the accepted run ID. Shared history is a separate view and must never be passed off as a visitor's own result.
- The owner can revoke and restore the ENS role using real Sepolia transactions. Revocation blocks future execution after confirmation; it does not undo completed trades or withdraw funds.
- Agent chain reads and submissions are routed through Anon-RPC/Nox by default. Routing observations are not anonymity proofs. Public transactions and the visitor wallet's own RPC remain separate boundaries.
- Browser onboarding/status reads use the application's configured Sepolia reader; owner setup and control transactions use the connected wallet's provider. Do not claim that those browser requests are routed through Nox. Per-run RPC/submission/failure counters describe observed agent-service traffic only.
- The canonical domain is the only signing origin. Keep provider/account/network checks, explicit Sepolia writes, admission limits, single-use nonces and backend credentials unchanged.
- Personal ENS labels remain under `kusari-pramod.eth`, which is a parent-registry trust dependency. This is not arbitrary ENS namespace support. Agent rotation requires a new vault because the vault's agent is immutable.
- This is not arbitrary chat/trading, audited production finance or an Alt Mempool/Namera integration. Do not add controls implying those capabilities.

## Brand Commitments

Kusari and its chain mark remain recognizable. The user explicitly selected a dark product workspace with persistent navigation, a spacious agent workspace and compact policy controls. Use plain language and a consistent product vocabulary, not a marketing or terminal costume.

## Evidence on Hand

README.md records real normal/attack, browser owner freeze/restore, NotAuthorized rejection and successful resumed execution. Deployment manifests contain the actual ENS identity, contracts, vault and pool. FEEDBACK.md documents the Uniswap integration. Never fabricate returns, price charts, balances, model rationale or transaction evidence.

The owned-agent registrar, atomic coordinator and personal vault factory are recorded in `deployments/11155111-owned.json`. The release process owns live acceptance, two-owner isolation and browser/deployment verification. Earlier separate-vault isolation evidence does not by itself verify the new atomic onboarding flow; it remains Beta until its own checks are recorded.

## Product Principles

1. Make the user's task and next action obvious.
2. Explain the boundary between an AI proposal and contract execution.
3. Show observed state, freshness and exact outcomes honestly.
4. Preserve owner control and the verified signing path.

## Accessibility & Inclusion

The user requested an explanation understandable without relying on the screen's appearance. Provide semantic headings and landmarks, explicit control names, keyboard focus, text equivalents for status and diagrams, readable contrast, reduced-motion support and bounded screen-reader announcements. No outcome may rely on color alone.
