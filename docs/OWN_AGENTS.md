# Owned-agent workspaces

The personal workspace is **beta** and adds ownership to the same policy boundary used by the verified shared demo. `/demo` remains the primary funded sandbox. `/agents` is a separate Sepolia flow: the connected wallet owns its ENS label and vault, and a distinct browser-held key signs that workspace's trades. The earlier six-step provisioning flow passed live isolation; the streamlined atomic flow is deployed and fork-tested but awaits its full live/browser rehearsal.

## Authority and key custody

- **Owner:** the connected MetaMask EOA. Its private key never enters Kusari. It confirms ENS setup, policy updates, vault funding, freeze/restore and withdrawals on Sepolia.
- **Agent:** a fresh browser-generated key, or an imported encrypted Kusari backup. There is no raw private-key input. New keys use AES-GCM encryption derived through HKDF from a verified, canonical EOA signature over a locally constructed origin/chain/owner/agent-specific unlock message. The signature is never persisted or sent to the server. Legacy backups use PBKDF2-SHA256/passphrase encryption. The page must remain open and unlocked to sign a new trade; the Fly runner supplies Gemini and relaying, not a personal signer.
- **ENS label:** deterministic for the owner/agent pair beneath `kusari-pramod.eth`. Registration contracts hold only the parent registration role. In atomic setup the coordinator briefly initializes the label and resolver, binds policy and grants the agent marker, then transfers label authority to the owner and erases all its resolver administration before returning.
- **Vault:** atomic setup uses a separate personal vault factory with immutable owner and agent. The original shared-demo factory and deployed contracts are unchanged. Only the coordinator can call the new factory, whose one-time initializer has been erased. The owner can withdraw; the agent can only execute through the required hook. Rotation requires a new workspace and owner-directed movement of funds.
- **Policy:** the existing ENS policy source reads authorization and limits on each swap. Spending and intent nonces are keyed by agent address, so separate agent keys have separate budgets. Reusing an agent across vaults deliberately shares that agent's policy and budget.

This is an unaudited testnet product. Local encryption protects stored material; compromised browser code can use an unlocked key. Wallet-based unlocking requires the same EOA wallet/signing method to reproduce its signature; this is not guaranteed for every wallet. Optional encrypted recovery backups remain important: losing browser storage without a backup loses the random agent key, although the owner can still withdraw vault funds. Ownership of the wallet alone does not regenerate the agent key.

## Atomic setup and gas

The primary beta action checks the owner's Sepolia balance and estimates the actual coordinator call before requesting signatures. A new workspace requires one gas-free encryption signature and one owner-confirmed transaction. Setup creates the resolver, ENS label, policy, binding, agent authorization and vault, mints 25 valueless kUSD, and forwards 0.0001 Sepolia ETH to the agent. Existing legacy workspaces can resume their six-step flow.

Gas is not sponsored. An empty-wallet user sees the [ETHGlobal Sepolia faucet](https://ethglobal.com/faucet) or can use the funded shared demo instead. Live estimation measured roughly 12.25 million gas for atomic creation on Sepolia; use the current estimate and fees, not a fixed ETH cost. The coordinator's registration permission was granted once by the parent owner; no server owner-key operation is required per user.

The coordinator uses ENS's documented `unsafeTransfer` for an intentional new-name handoff within a known parent-admin namespace while retaining the restricted agent role. ENS's ordinary safe-transfer path rejects these known authority dependencies. This does not remove the parent trust root. Fork tests assert the final owner, retained agent marker and zero coordinator label/resolver administration.

## Execution

The owner signs an expiring, single-use message describing one workspace and scenario. The persistent Fly runner checks the factory vault, owner, agent, required hook and current ENS label owner. Gemini produces the actual decision. No scripted response substitutes for a model failure.

The browser independently checks the prepared Sepolia transaction and intent, signs with the restricted agent key and sends only signatures and the raw transaction to the bounded relay. The relay verifies the sender, vault, calldata, chain, gas and intent before submitting through Anon-RPC/Nox. Receipt polling determines success or revert. Missing receipts remain pending.

The normal test limits a decision to 1 kUSD. The poisoned-news test deliberately uses a gullible prompt and may request more than policy allows. A refusal or hold is reported as such. A confirmed revert is separate from a simulation rejection.

## Remaining trust boundaries

The parent ENS namespace still has its administrator. This is individually owned subname onboarding under Kusari's namespace, not support for every arbitrary ENS parent or a removal of ENS parent authority. Users independently control their label, dedicated resolver, vault and restricted key within that boundary.

The hosted runner supplies Gemini and relay availability; it cannot sign a user's agent swap. Its model quotas are shared service capacity, while token balances, ENS roles and hook spending budgets are separate. Job/admission state is in memory on one Fly machine and is not durable across a restart.

Anon-RPC routing does not hide public transactions, calldata, contract state, wallet-provider RPC traffic, or requests made to Kusari's web server. Routing counters are observations of transport use, not a cryptographic anonymity measurement. Wallet setup and owner transactions use the connected wallet's provider.

## Required acceptance evidence

The isolation check uses two different owners and two different restricted agents. It creates separate ENS labels, resolvers, policies and vaults, executes trades, freezes A, confirms A's next swap reverts and confirms B can still trade. It also checks that A cannot revoke B or withdraw B's funds and that A's spending does not increment B's budget. Restore A before leaving the rehearsal.

The live hosted-API rehearsal passed on 6 November 2026: A's frozen trade reverted, B's trade still succeeded, daily spending stayed independent, and A was restored. The public receipts and routing observations are in [the rehearsal report](evidence/owned-workspaces.json); the README links the individual transactions. Setup was performed by a local CLI using four fresh in-memory keys, not by browser automation. All 64 contract tests passed, including four real-contract ownership fork tests. Cross-owner management denial and exact nested `NotAuthorized` decoding are asserted in those fork tests.

The onboarding registrar is `0xf913591278db093fc33e1ac20b45745a51b9dc32` on Sepolia, with its root registration role verified to equal `1` and no additional role bits. The deployment and role-grant receipts are recorded in `deployments/11155111-owned.json`. Public reports contain addresses and transactions, never private keys.

Atomic beta adds coordinator `0x370c18274165ef5c48f0d73f1ecd19505a6b8a35` and personal factory `0x92f8d36b9b8bcdd2dd1a08999b1de62465ac2b6c`. Eight atomic fork tests passed. Their deployment and wiring receipts are in the same manifest; deployment/fork verification is separate from a complete live atomic rehearsal.
