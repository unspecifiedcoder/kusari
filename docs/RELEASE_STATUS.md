# Judge release checkpoints

Updated 7 November 2026 after the shared trade-API rehearsal and the session-contract test pass. The latest team plan targets final submission by 08:30 IST, ahead of the dashboard's 09:00 IST cutoff. API work has a 03:00 cutoff and optional personal-agent work a 04:00 cutoff; media and the verified shared demo take priority.

## Verified release

- Canonical live application: https://kusari.outcomeseal.com/demo#try-sandbox. DNS and HTTPS verified.
- The promoted Vercel release is identified by `b5r0adn51`; it includes the shared trade API and the separately labelled personal Beta UI. Use the canonical domain for signing.
- One Fly shared-CPU, 1 GB Machine serves the authenticated gateway, Gemini agent and Anon-RPC/Nox bridge. Vercel holds only the server-side gateway credential; owner/deployer keys are excluded from Fly.
- Public visitors connect a Sepolia wallet and sign a fixed, single-use message for the funded shared sandbox. They need no tokens, approvals or gas. Public model runs require real Gemini.
- The combined Node regression suite passed 66 tests after adding the separate session-control helpers. Full ESLint, TypeScript and the production build passed for the previous promoted release; the new session view additionally passed TypeScript and scoped ESLint, with its next production build tracked separately.
- Current contract validation passed 59 local tests and 28 Sepolia fork tests: 87 total, including the 15 new session-vault tests. Passing local/fork tests does not establish a live deployment or browser transaction.
- User-signed MetaMask normal and poisoned-news scenarios passed in the live UI. User-signed browser owner revocation and restoration passed on Sepolia. Public signed API requests confirmed NotAuthorized while frozen and successful execution after restoration. Exact receipts and the distinction between browser and API actions are in the README.
- At the completed shared trade-API checkpoint, the original shared agent was authorized and active, the runner was idle, and the chain snapshot was fresh with readTransport=anon and bridgeMode=anon. This is a recorded observation, not a promise about its present state.
- Homepage at 320 px and sandbox at 390 px showed no horizontal overflow. Temporary viewport overrides were reset.
- The custom-domain scanner returned NONE and the user reported no security warning during scenario signatures and owner transactions. The old kusari-demo.vercel.app classification review remains open; signing is disabled on deployment aliases. Never bypass a wallet warning.
- The public release branch is codex/judge-ready. Confirm that the final source commit containing these extensions is pushed before submitting its URL.

The subsequent product-workspace redesign was published and verified at 1440 px desktop, 390 px mobile and 320 px narrow width without horizontal overflow. A user-signed real Gemini 1 kUSD swap displayed all five actual result fields and its receipt in the new UI. Keyboard dismissal of the wallet chooser was verified. Signing/execution prefixes remain identical to commit 54b1432. The final source includes corrected busy-region semantics and the explicit 1 kUSD public-scenario ceiling. Impeccable's source detector reported one font-style warning, accepted for the self-hosted Instrument Sans product type system; no automated screen-reader or headless-browser certification is claimed. See PRODUCT.md, DESIGN.md and docs/UI_BRIEF.md for durable context.

## Shared trade API

- The live `/v1/trade` rehearsal passed. A wrong bearer key was rejected with HTTP 401; an amount above 1 kUSD and an unknown field were rejected with HTTP 400; a valid 1 kUSD request was accepted with HTTP 202; an immediate repeated request hit HTTP 429 with a 30-second retry interval.
- The accepted request completed through the hosted shared agent, with source `external-agent` and observed route `Anon-RPC / Nox`. An independent Sepolia receipt check confirmed the successful 1 kUSD swap at block `12078500`: [transaction `0x736d1b…8556e`](https://sepolia.etherscan.io/tx/0x736d1bbdcc78ae9d2e26105f15f760b5b02a5a35eb67d56811127f5a6c68556e).
- The caller supplies the decision; this API result is not attributed to Gemini. The shared signing key remains hosted by Kusari. Owner revocation, policy editing and withdrawals are not exposed by the trade API.
- Public evidence is in [trade-api.json](evidence/trade-api.json), completed at `2026-11-06T19:02:06.728Z`. Route counters are service observations, not anonymity proof. The independent receipt lookup used a public RPC only in the rehearsal.
- The original funded `/demo` path and its owner-controlled ENS freeze/restore remain preserved. The API checkpoint separately checked its fresh, idle and authorized state.

## Submission work still to confirm

- Complete the ETHGlobal dashboard fields, team/track selection and final submission confirmation.
- Record and upload the demo video; keep recorded evidence visibly distinct from a live run.
- Submit or confirm the Uniswap feedback form, including the public FEEDBACK.md link. The repository file already exists.
- Document actual team contributions, AI-assisted files and any applicable specification/planning artifacts. Clearly distinguish reused libraries or project work.
- Verify public source access and every submitted URL, then retain owner-wallet, agent-gas and model-quota headroom for judging.

## Owned-agent extension

- `/agents` is deployed alongside the preserved `/demo` path and is visibly marked Beta. Try the demo is the primary landing-page and navigation action; personal onboarding is secondary.
- New personal onboarding uses a browser-generated key protected by a local wallet signature, then one atomic coordinator transaction to provision the ENS policy and vault, mint 25 test kUSD and forward 0.0001 Sepolia ETH for agent gas. Actual balance and setup-fee checks run before the first signature. The owner pays Sepolia gas; no sponsorship or zero-confirmation flow is claimed.
- The atomic coordinator's fork tests passed. The streamlined wallet-signature/atomic-creation path has not completed browser end-to-end acceptance and must not be described as a verified live onboarding flow. Earlier passphrase-encrypted workspaces retain their six-step compatibility/recovery path.
- Registrar `0xf913591278db093fc33e1ac20b45745a51b9dc32` has exactly root role `1` (register only). It retains no name administration. The existing demo hook, policy source and vault factory were not replaced.
- The earlier live public-API rehearsal created two different owners, agents, resolvers, names and vaults. A's normal trade succeeded; after A's revocation its next trade reverted while B still traded. Spending remained separate and A was restored. Public evidence: `docs/evidence/owned-workspaces.json`. This separate-vault isolation test does not establish completion of the newer atomic browser onboarding flow.
- Owner setup transactions in that rehearsal used a public RPC; each hosted execution observed 16 Nox RPC requests and one submission. These are routing counters, not anonymity proof. A full browser owner walkthrough is tracked separately.
- The earlier personal page was checked at desktop, 390 px and 320 px without horizontal overflow. The wallet chooser opened and dismissed with Escape. These observations do not certify the subsequent streamlined atomic form.
- Personal keys stay encrypted in browser storage and sign only in an open, unlocked page; the server receives neither the personal private key nor the wallet unlock signature. The shared demo's agent key remains hosted/custodial. Fly.io performs model decisions and relay for both paths; personal agents are not unattended background processes.
- Owner/chain/account/provider checks, context-change cancellation, deterministic ENS metadata verification, nonce replay protection, bounded relay calldata and fee checks passed review and regression checks.
- The parent ENS namespace remains a trust root. Arbitrary parent names, unattended personal execution and in-place agent rotation are not supported. Namera, Alt Mempools and multichain changes remain deferred.

## Separate bounded-session experiment

- The new session vault passed 15 local/fork contract tests, included in the 87-test contract total above. It adds an owner-approved finite total budget, expiry and minimum actual-output rate. The full requested input consumes session budget even on a partial fill; the rate floor checks actual input and output.
- A separate factory and owner-held vault are now deployed on Sepolia and the vault is funded with 2 test kUSD; see `deployments/11155111-session.json`. Its session remains unopened. No live session swap, owner browser approval or running session-backed web agent is claimed.
- The separate `/sessions` Beta view reads that manifest, discovers actual owner vaults, exposes owner-only session open/close controls and displays real SessionSwap events when available. Its scoped stylesheet was converted to ordinary prefixed CSS to match the production Tailwind pipeline. Session runtime acceptance remains separate.
- The existing shared demo, trade API and personal Beta still use their original vaults. They do not receive session-budget, expiry or owner-rate protection from this new contract or page. Session execution is not connected to the public web API.

## Owner ENS policy demonstration

- The canonical `/demo` has a separate, owner-only ENS policy disclosure. It can write the existing resolver's ABI-encoded `kusari.policy` cap from 5 to 1 kUSD and restore 5, preserving the other verified policy fields. It requires the actual connected Sepolia ENS owner and pins the registry, label, DNS name, node, policy source and pool.
- The owner can authorize a fixed 2 kUSD request using an exact, expiring, single-use message. That deterministic path uses the existing shared vault, signer and hook through Nox; it does not call Gemini. It submits a bounded test even when simulation predicts rejection so the receipt can prove the actual revert. Public normal/API requests remain capped at 1 kUSD.
- The combined Node regression suite passed 82 tests. Full TypeScript, scoped lint and the production Next.js build passed. Browser verification confirmed live ENS values, owner gating, corrected styling and no horizontal overflow at the checked wide/narrow layouts. Real acceptance receipts are tracked separately; source checks and rendering are not transaction acceptance.
- Current frontend: `dpl_DyFftnZvhQjfHAFM54gi3RZvh294`. Current Fly image: `deployment-01M6SEPY5SF1XM2ZG4AKJFJ1S8`. Owner keys remain local and are not uploaded to Fly. The previous working frontend and backend images remain available for rollback.
