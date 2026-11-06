# Judge deployment: complete baseline

The public website observes the configured Sepolia demo agent. It does not grant visitors the agent key or let them run arbitrary trades. The owner uses their wallet for ENS role revocation; the presenter runs trade and injection controls on the local demo machine.

## Services

Use the Node version in `.nvmrc`. Configure the root `.env` locally, then run `node scripts/check-env.mjs`. Agent and owner keys must match the existing deployment; a new key is not automatically authorized for the deployed vault. `GEMINI_API_KEY` is required for live model decisions. `AGENT_SCRIPTED=1` is an explicitly labelled demo fallback.

Start these existing services in separate terminals from their directories:

```text
reader/: npm run bridge
proxy/: node server.mjs
agent/: npm start
app/: npm run dev
```

The bridge and agent must be healthy before recording the normal, injected, revoked and reauthorized beats. Leave enough test gas, vault funds and daily allowance for repeated rehearsals.

## Hosted observation

Add a random secret of at least 32 characters to local `.env` as `KUSARI_DEMO_GATEWAY_TOKEN`. Keep it out of Git and browser-visible `NEXT_PUBLIC_*` variables. Start the read-only gateway from the repository root:

```text
node scripts/demo-gateway.mjs
```

It binds to `127.0.0.1:8788`. Point an HTTPS tunnel or reverse proxy only at that port. Never expose agent `8787`, bridge `8546` or proxy `8547` directly. The gateway requires a bearer token on every request, including health, and accepts only these fixed observation routes:

| Route | Data |
| --- | --- |
| `/health` | Service reachability and observation-only mode |
| `/agent/status` | Agent settings, bounded recent events, onchain snapshot and freshness |
| `/bridge/metrics` | Actual bridge mode and recent RPC method/timing counters |
| `/proxy/log` | Bounded demo provider log, with IPs redacted for public visitors |
| `/{agent,bridge,proxy}/events` | Optional SSE streams for hosting that supports them |

For Cloudflare Quick Tunnels, use snapshot polling. Quick Tunnels do not support SSE. The hosted UI polls status, metrics and log snapshots; local presentation retains SSE. A temporary tunnel also requires keeping this machine online and awake, and its URL changes when restarted.

In the Vercel project for `app/`, configure **server-only** production variables:

```text
KUSARI_DEMO_GATEWAY_URL=https://your-gateway-host/
KUSARI_DEMO_GATEWAY_TOKEN=<the same local gateway secret>
```

Include source files outside `app/` so `scripts/sync.mjs` can read `shared/` and `deployments/`. Redeploy after environment changes. The browser sees only same-origin `/api/demo/*` URLs. The Next route handlers attach the gateway token server-side. Public POST requests are rejected, and there is no arbitrary URL or JSON-RPC forwarding route.

## Truthful connection states

`GET /agent/status` never calls the model or signs/submits a transaction. It starts a single background chain refresh and returns immediately. `lastStateAt` is the last successful snapshot timestamp; `stateStatus` is `fresh`, `stale`, `refreshing` or `unavailable`. A failed refresh preserves the old value only as stale evidence. Each event has an `id` and `t`; the public copy has `canControl: false` and omits RPC URLs.

`readTransport` comes from the actual bridge `/metrics` mode when the agent is configured to use the bridge. `anon` means Nox, `direct` means the emergency non-anonymous bridge mode, and `unknown` means its mode could not be verified. Separately, wallet/UI direct chain reads may use public RPC and must be labelled that way.

Before sharing the URL, open it in an incognito browser without a wallet. Check live policy/balances, stale/offline errors, event updates during the presenter's run, real transaction links, owner-only freeze controls, and clear historical evidence when services are unavailable.

## Optional persistent backend on Fly.io

The repository-root `Dockerfile` packages only the backend: Node 24, Chromium and its system dependencies, the Anon-RPC reader, logging proxy, agent and read-only gateway. `.dockerignore` starts with a default deny and includes only required backend source and lockfiles; `.env`, credentials, private-key files, Git history, local dependencies and build/work outputs are excluded. No secret is supplied at image build time.

`fly.toml` requests **one shared CPU with 1 GB RAM**, primary region `iad` (one of Fly's lowest-priced regions), no database, no volume and no dedicated IPv4. Fly's published compute rate for this size is **$6.70 per 30 days**, billed by the second while running, plus applicable outbound data/storage charges. That is approximately $0.11 for 12 hours of compute, not a total invoice guarantee. [Official pricing](https://docs.fly.io/about/pricing). `auto_stop_machines = "off"` keeps the browser worker warm through judging. The app name in that file is a placeholder: select the actual account/app before deployment. Deploy with `--ha=false` and verify the Machine count is one so Fly does not add a spare Machine. Increase to 2 GB only if runtime memory measurements or an out-of-memory failure justify it.

Only these runtime secrets belong on Fly:

| Secret | Purpose |
| --- | --- |
| `AGENT_PRIVATE_KEY` | Existing Sepolia demo agent's restricted vault-swap authority |
| `GEMINI_API_KEY` | Existing model decision call |
| `KUSARI_DEMO_GATEWAY_TOKEN` | Read-only server-to-server authentication; also set in Vercel |

**Do not upload the owner or deployer key.** The supervisor rejects those secrets on Fly, strips them from child environments during local startup, and forces `AGENT_LOOP_SECONDS=0`. Owner ENS revocation continues through the user's wallet.

The container runs `node scripts/start-hosted-demo.mjs`. It starts bridge and proxy first, waits for readiness, starts the agent, then exposes only gateway port `8788`. An unexpected child exit stops the remaining stack; signals shut down its subprocesses and Chromium. Initial HTTP readiness is not proof of a fresh chain snapshot: verify `stateStatus=fresh` and `readTransport=anon` before judging.

Fly setup/deployment requires account access and explicit approval for billable resources. After provisioning and setting secrets, the parent deployment process can use:

```text
fly config validate --strict --config fly.toml --app <actual-app>
fly deploy --config fly.toml --app <actual-app> --remote-only --ha=false
fly scale count 1 --app <actual-app>
```

Set Vercel's `KUSARI_DEMO_GATEWAY_URL` to `https://<actual-app>.fly.dev/` and use the matching server-side gateway token. Public visitors still cannot call trade controls.

For presenter-run trades, use authenticated Fly SSH to execute the bounded helper inside the Machine. It supports only `normal`, `attack` and read-only `status`; there is no arbitrary URL, RPC or transport option:

```text
fly ssh console --app <actual-app> --command "node scripts/present-hosted-demo.mjs status"
fly ssh console --app <actual-app> --command "node scripts/present-hosted-demo.mjs normal"
fly ssh console --app <actual-app> --command "node scripts/present-hosted-demo.mjs attack"
```

`normal` clears injected news and requests one agent cycle; `attack` enables the staged poisoned news and requests one cycle. The helper waits for that cycle to finish and prints public transaction/result fields. These two commands intentionally submit testnet activity via the existing agent; run them only when ready to present. The public page observes the results. A normal Fly TCP port-forward targets the Machine's private network address and does not reach this deliberately loopback-only agent. Do not widen the agent's bind address or publish port `8787` to work around that boundary. Ensure no second agent process is simultaneously submitting with the same agent key.

No Docker daemon is available on the development machine used to prepare this package, so the container build and Chromium startup must be verified by the approved remote build/deployment before claiming this hosting path works.
