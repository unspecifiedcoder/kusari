# Judge release checkpoints

Updated 6 November 2026 after the live browser rehearsal. Team submission target remains before 7 November 2026, 07:00 IST. The official public event page currently lists 09:00 IST; use the earlier team target and confirm the dashboard.

## Verified release

- Canonical live application: https://kusari.outcomeseal.com/demo#try-sandbox. DNS and HTTPS verified.
- One Fly shared-CPU, 1 GB Machine serves the authenticated gateway, Gemini agent and Anon-RPC/Nox bridge. Vercel holds only the server-side gateway credential; owner/deployer keys are excluded from Fly.
- Public visitors connect a Sepolia wallet and sign a fixed, single-use message for the funded shared sandbox. They need no tokens, approvals or gas. Public model runs require real Gemini.
- 29 Node regression tests, ESLint, TypeScript and the production build passed. Prior contract validation passed 44 local and 16 Sepolia fork tests.
- User-signed MetaMask normal and poisoned-news scenarios passed in the live UI. User-signed browser owner revocation and restoration passed on Sepolia. Public signed API requests confirmed NotAuthorized while frozen and successful execution after restoration. Exact receipts and the distinction between browser and API actions are in the README.
- Final observed state: authorized and active, runner idle, fresh chain snapshot, readTransport=anon and bridgeMode=anon. Funds and daily allowance remained available.
- Homepage at 320 px and sandbox at 390 px showed no horizontal overflow. Temporary viewport overrides were reset.
- The custom-domain scanner returned NONE and the user reported no security warning during scenario signatures and owner transactions. The old kusari-demo.vercel.app classification review remains open; signing is disabled on deployment aliases. Never bypass a wallet warning.
- Source and deployment changes are pushed to codex/judge-ready; the README links to the correct branch.

## Submission work still to confirm

- Complete the ETHGlobal dashboard fields, team/track selection and final submission confirmation.
- Record and upload the demo video; keep recorded evidence visibly distinct from a live run.
- Submit or confirm the Uniswap feedback form, including the public FEEDBACK.md link. The repository file already exists.
- Document actual team contributions, AI-assisted files and any applicable specification/planning artifacts. Clearly distinguish reused libraries or project work.
- Verify public source access and every submitted URL, then retain owner-wallet, agent-gas and model-quota headroom for judging.

Namera, Alt Mempools, personal agent onboarding, multichain changes and optional policy editing remain outside this complete shared-testnet release.
