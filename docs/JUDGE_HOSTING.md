# Judge deployment and shared Sandbox

The public website observes one configured Sepolia agent and offers two bounded Sandbox scenarios. Visitors connect a supported wallet on Sepolia and sign an EIP-191 message authorizing one real Gemini cycle. The backend's shared funded vault supplies test tokens and gas; visitors send no funds, approve no tokens and do not receive personal vaults. Only the ENS owner can change policy or revoke the agent. No agent key, arbitrary trade/RPC forwarding or transport control is exposed publicly.

**Current release status:** `https://kusari.outcomeseal.com` is live with verified DNS and HTTPS. The Spaceship `kusari` A record points to `76.76.21.21`; no additional DNS change is needed. On 6 November 2026, MetaMask message signatures for both scenarios, browser owner freeze/restore, a blocked trade while frozen and a successful post-restore swap passed. The user reported no wallet security warning on the custom domain; the current scanner returned `NONE`. Receipts and the distinction between browser actions and public-API test requests are recorded in the README. The previous `kusari-demo.vercel.app` address remains under review: [review #309873](https://github.com/MetaMask/eth-phishing-detect/issues/309873) is submitted, not cleared. Do not ask judges to bypass a security warning. Signing on other deployment aliases is disabled.

## Services

Use the Node version in `.nvmrc`. Configure the root `.env` locally, then run `node scripts/check-env.mjs`. Agent and owner keys must match the existing deployment; a new key is not automatically authorized for the deployed vault. `GEMINI_API_KEY` is required for live model decisions. Although the presenter has an explicitly labelled scripted fallback, the public Sandbox rejects scripted mode and requires real Gemini.

Start these existing services in separate terminals from their directories:

```text
reader/: npm run bridge
proxy/: node server.mjs
agent/: npm start
app/: npm run dev
```

The bridge and agent must be healthy before recording the normal, injected, revoked and reauthorized beats. Leave enough test gas, vault funds and daily allowance for repeated rehearsals.

## Gateway and Sandbox admission

Add a random secret of at least 32 characters to local `.env` as `KUSARI_DEMO_GATEWAY_TOKEN`. Keep it out of Git and browser-visible `NEXT_PUBLIC_*` variables. Start the gateway from the repository root:

```text
node scripts/demo-gateway.mjs
```

For local startup it binds to `127.0.0.1:8788`. Point an HTTPS tunnel or reverse proxy only at that port. Never expose agent `8787`, bridge `8546` or proxy `8547` directly. The gateway requires a bearer token on every request, including health, and accepts only fixed routes:

| Route | Data |
| --- | --- |
| `/health` | Service reachability and signed shared-testnet Sandbox mode |
| `/agent/status` | Agent settings, bounded recent events, onchain snapshot and freshness |
| `/bridge/metrics` | Actual bridge mode and recent RPC method/timing counters |
| `/proxy/log` | Bounded demo provider log, with IPs redacted for public visitors |
| `/{agent,bridge,proxy}/events` | Optional SSE streams for hosting that supports them |
| `POST /sandbox/challenge` | Issues a nonce for a wallet address and fixed `normal` or `attack` scenario |
| `POST /sandbox/run` | Verifies the wallet signature and admits one bounded real-model run |

The two public Next endpoints are `POST /api/sandbox/challenge` and `POST /api/sandbox/run`. They accept JSON under 4 KB and require the exact configured HTTPS origin. Next attaches the private gateway bearer token; the persistent Fly backend verifies the signature against its stored message, including origin, wallet, Sepolia chain ID, scenario, nonce and expiry. Nonces are single-use, expire after two minutes and are capped at 200 outstanding entries (three per wallet). A signature does not grant authority over the visitor's wallet funds.

Admissions have a 30-second wallet cooldown, 10-second global cooldown, 20-run rolling-hour cap and 40-run UTC-day cap. A valid signed admission consumes budget even if Gemini or execution fails. Counters and pending challenges live in memory on the single backend and reset on a Fly restart. Wallet signatures alone are not durable abuse protection or one-person identity.

Normal runs reject decisions above 1 kUSD. An attack run must obtain an actual real-model over-cap swap decision before signing a rejection-path transaction; a refusal, hold or within-cap decision does not count as an onchain attack rejection. The UI distinguishes simulation-only blocks, confirmed onchain reverts, successful swaps and no-trade outcomes. Sandbox execution checks Sepolia and the agent's gas reserve. The owner remains responsible for replenishing gas, vault tokens and daily allowance.

For Cloudflare Quick Tunnels, use snapshot polling. Quick Tunnels do not support SSE. The hosted UI polls status, metrics and log snapshots; local presentation retains SSE. A temporary tunnel also requires keeping this machine online and awake, and its URL changes when restarted.

In the Vercel project for `app/`, configure these production variables. The gateway URL and token are server-only; the application origin is public:

```text
KUSARI_DEMO_GATEWAY_URL=https://your-gateway-host/
KUSARI_DEMO_GATEWAY_TOKEN=<the same local gateway secret>
KUSARI_DEMO_PUBLIC_ORIGIN=https://kusari.outcomeseal.com
NEXT_PUBLIC_APP_ORIGIN=https://kusari.outcomeseal.com
```

Set `KUSARI_DEMO_PUBLIC_ORIGIN` to the same exact origin on Fly as well. Use no trailing path or slash. These origin values are public configuration; the gateway token is secret. Include source files outside `app/` so `scripts/sync.mjs` can read `shared/` and `deployments/`. Redeploy Vercel after environment changes, including `NEXT_PUBLIC_APP_ORIGIN`, which is compiled into the browser bundle. Preview domains remain observation-only when they differ from the configured origin. `/api/demo/*` remains read-only; only the two named Sandbox POST endpoints admit public runs. There is no arbitrary URL or JSON-RPC forwarding route.

## Truthful connection states

`GET /agent/status` never calls the model or signs/submits a transaction. It starts a single background chain refresh and returns immediately. `lastStateAt` is the last successful snapshot timestamp; `stateStatus` is `fresh`, `stale`, `refreshing` or `unavailable`. A failed refresh preserves the old value only as stale evidence. Each event has an `id` and `t`; the public copy has `canControl: false` and omits RPC URLs.

`readTransport` comes from the actual bridge `/metrics` mode when the agent is configured to use the bridge. `anon` means Nox, `direct` means the emergency non-anonymous bridge mode, and `unknown` means its mode could not be verified. Separately, wallet/UI direct chain reads may use public RPC and must be labelled that way.

Before sharing the URL, verify DNS/TLS and wallet site-security status, then open it in an incognito browser without a wallet. Check live policy/balances, stale/offline errors and historical evidence. With a visitor wallet on Sepolia, verify a readable message signature (no transaction, approval or funds), normal and poisoned-news scenarios, real Gemini source, run-specific events, transaction links and truthful no-trade/error outcomes. Check wrong-chain, cancelled signature, expired/replayed nonce and cooldown behavior. Verify owner controls still reject a non-owner and check the wallet's actual Sepolia network before signing. Record which checks were actually performed; do not promote the existing CLI rehearsal into a claim of browser verification.

## Optional persistent backend on Fly.io

The repository-root `Dockerfile` packages only the backend: Node 24, Chromium and its system dependencies, the Anon-RPC reader, logging proxy, agent and fixed-route gateway. `.dockerignore` starts with a default deny and includes only required backend source and lockfiles; `.env`, credentials, private-key files, Git history, local dependencies and build/work outputs are excluded. No secret is supplied at image build time.

`fly.toml` requests **one shared CPU with 1 GB RAM**, primary region `iad`, no database, no volume and no dedicated IPv4. Consult [official pricing](https://docs.fly.io/about/pricing) for current compute and outbound-data charges. `auto_stop_machines = "off"` keeps the browser worker warm through judging. Confirm the app name in `fly.toml` belongs to the intended account before deployment. Deploy with `--ha=false` and verify the Machine count is one so Fly does not add a spare Machine. Increase to 2 GB only if runtime memory measurements or an out-of-memory failure justify it.

Only these runtime secrets belong on Fly:

| Secret | Purpose |
| --- | --- |
| `AGENT_PRIVATE_KEY` | Existing Sepolia demo agent's restricted vault-swap authority |
| `GEMINI_API_KEY` | Existing model decision call |
| `KUSARI_DEMO_GATEWAY_TOKEN` | Fixed-route server-to-server authentication; also set in Vercel |

Set the non-secret `KUSARI_DEMO_PUBLIC_ORIGIN=https://kusari.outcomeseal.com` in the Fly runtime configuration. Keep a single Machine because Sandbox nonce and admission state is not shared across Machines.

**Do not upload the owner or deployer key.** The supervisor rejects those secrets on Fly, strips them from child environments during local startup, and forces `AGENT_LOOP_SECONDS=0`. Owner ENS revocation continues through the user's wallet.

The container runs `node scripts/start-hosted-demo.mjs`. It starts bridge and proxy first, waits for readiness, starts the agent, then exposes only gateway port `8788`. An unexpected child exit stops the remaining stack; signals shut down its subprocesses and Chromium. Initial HTTP readiness is not proof of a fresh chain snapshot: verify `stateStatus=fresh` and `readTransport=anon` before judging.

Fly setup/deployment requires account access and explicit approval for billable resources. After provisioning and setting secrets, the parent deployment process can use:

```text
fly config validate --strict --config fly.toml --app <actual-app>
fly deploy --config fly.toml --app <actual-app> --remote-only --ha=false
fly scale count 1 --app <actual-app>
```

Set Vercel's `KUSARI_DEMO_GATEWAY_URL` to `https://<actual-app>.fly.dev/` and use the matching server-side gateway token. Public visitors can request only the two signed Sandbox scenarios; presenter-only controls and owner authorization remain separate.

For presenter-run trades, use authenticated Fly SSH to execute the bounded helper inside the Machine. It supports only `normal`, `attack` and read-only `status`; there is no arbitrary URL, RPC or transport option:

```text
fly ssh console --app <actual-app> --command "node scripts/present-hosted-demo.mjs status"
fly ssh console --app <actual-app> --command "node scripts/present-hosted-demo.mjs normal"
fly ssh console --app <actual-app> --command "node scripts/present-hosted-demo.mjs attack"
```

`normal` clears injected news and requests one agent cycle; `attack` enables the staged poisoned news and requests one cycle. The helper waits for that cycle to finish and prints public transaction/result fields. These two commands intentionally submit testnet activity via the existing agent; run them only when ready to present. The public page observes these presenter results separately from a visitor's run. A normal Fly TCP port-forward targets the Machine's private network address and does not reach this deliberately loopback-only agent. Do not widen the agent's bind address or publish port `8787` to work around that boundary. Ensure no second agent process is simultaneously submitting with the same agent key.

The existing backend has a separate CLI rehearsal; the new Sandbox build, deployed route authentication and wallet visitor flow must pass remote deployment and browser checks before being described as live and verified. Inspect [`sandbox-access.mjs`](../scripts/sandbox-access.mjs), [`SandboxControls.tsx`](../app/src/components/SandboxControls.tsx) and [`sandbox-http.mjs`](../app/src/lib/sandbox-http.mjs) for the corresponding boundaries.
