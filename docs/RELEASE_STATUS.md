# Judge release checkpoints

Deadline supplied by the team: 7 November 2026, 07:00 IST. Submission target: 05:00 IST.

## Checkpoint 1: buildable, inspectable frontend

- Production URL: https://kusari-demo.vercel.app
- Node 24.22.2 production build, TypeScript and ESLint pass.
- Production HTTP checks: `/`, `/demo`, `/freeze`, `/setup` return 200 without authentication.
- Public trade-control POST returns 403. No browser-visible gateway secret is used.
- Homepage inspection requires no wallet. Recorded transaction evidence is labelled; owner management is separate.
- Existing onchain deployment was read successfully: agent authorized, policy active, 5 kUSD per-swap cap, 100 kUSD daily cap, 2% impact limit. These are observations at verification time, not fixed application values.

## Checkpoint 2: backend boundaries and contract regression

- 10 gateway/cache/startup/presenter tests pass, including concurrent stream admission and transport configuration.
- Independent source review found two blockers; both were fixed and reviewed again.
- All 60 existing contract tests pass: 44 local and 16 on a live Sepolia fork. Contracts were not modified or redeployed.
- Fly package targets one shared CPU and 1 GB RAM in iad; no database, volume or dedicated IPv4.
- Build context excludes local environment files and credentials. Owner and deployer keys stay outside Fly.

## Remaining release gates

- Fly account authorization is complete; app `kusari-demo-backend` was created in the authorized account.
- Remote Docker build passed. A temporary one-shared-CPU, 1GB iad Machine booted Chromium/Nox and completed two out of two anonymous Sepolia block reads before exiting successfully. No wallet key was used for this infrastructure check.
- Existing demo agent/Gemini configuration is still required. Full-stack steady-state memory remains to be verified; increase RAM only if runtime evidence requires it.
- Connect Fly gateway to Vercel through server-only environment variables.
- Verify a fresh matching-agent snapshot with actual anonymous bridge mode through the public URL.
- Rehearse normal trade, injected over-cap rejection, owner role revocation, blocked next trade, and reauthorization; restore initial state and retain gas/daily-cap headroom.
- Verify desktop/mobile browser behavior and record the completed demonstration. Browser automation was unavailable during the initial frontend checkpoint; HTTP checks do not replace that verification.
- Complete sponsor submission requirements, including the Uniswap feedback form.

Until the remaining gates pass, the frontend is an inspectable public deployment, not a verified hosted end-to-end trading demo. Namera, Alt Mempools, multichain changes and optional policy editing remain outside this baseline release.
