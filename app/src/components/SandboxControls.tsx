"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useConnection, useSignMessage } from "wagmi";
import { assertSepoliaWallet, WALLET_CHAIN_ID, DEFAULT_APP_ORIGIN } from "@/lib/wallet-safety";
import { deployment, ensDeployment } from "@/generated/deployment";

type Scenario = "normal" | "attack";
type Phase = "ready" | "challenge" | "signing" | "submitting" | "running" | "complete" | "timeout" | "error";
type RunEvent = Record<string, unknown> & { id?: number | string; t?: number; type?: string; runId?: string };
type Run = { id: string; scenario: Scenario; startedAt: number; events: RunEvent[]; readRoute?: { readTransport: string; bridgeMode: string; observedAt: number } };
type Challenge = { nonce: string; message: string; expiresAt: number; address: string; scenario: Scenario; origin: string };
type ApiFailure = { error?: string; retryAfterSeconds?: number };

const runWindowMs = 180_000;
const configuredOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() || DEFAULT_APP_ORIGIN;
const canonicalOrigin = (() => {
  if (!configuredOrigin) return null;
  try { const url = new URL(configuredOrigin); return url.protocol === "https:" && (configuredOrigin === url.origin || configuredOrigin === `${url.origin}/`) ? url.origin : null; }
  catch { return null; }
})();
const subscribe = () => () => {};
const txHash = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
// Only decoded Kusari guard errors establish a policy rejection; an arbitrary revert does not.
const guardReasons = new Set(["NotAuthorized", "PolicyInactive", "PoolNotAllowed", "ExactInputOnly", "DirectionNotAllowed", "InsufficientOutput", "IntentMismatch", "ExceedsPerSwap", "ExceedsDaily", "PriceImpactTooHigh", "BadSignature", "Expired", "NonceUsed", "OnlyAgent", "WrongHook", "IntentNotForVault"]);
const isGuardRejection = (swap?: RunEvent) => typeof swap?.reason === "string" && guardReasons.has(swap.reason);
const describeError = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message : "The request could not be completed.";
  return /reject|denied|cancel/i.test(message) ? "The wallet request was cancelled. Nothing was submitted from your wallet. You can try again." : message.split("\n")[0];
};

export function SandboxControls() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const currentOrigin = hydrated ? window.location.origin : null;
  const canRunHere = hydrated && (!configuredOrigin || currentOrigin === canonicalOrigin);
  const differentOrigin = Boolean(configuredOrigin && hydrated && currentOrigin !== canonicalOrigin);
  const { address, isConnected, chainId, connector } = useConnection();
  const { signMessageAsync } = useSignMessage();
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [phase, setPhase] = useState<Phase>("ready");
  const [run, setRun] = useState<Run | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const operationBusy = useRef(false);
  const mounted = useRef(false);
  const correctChain = chainId === WALLET_CHAIN_ID;
  const busy = ["challenge", "signing", "submitting", "running"].includes(phase);
  const runId = run?.id;
  const runStartedAt = run?.startedAt;
  const coolingDown = cooldown > 0;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!coolingDown) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1_000);
    return () => clearInterval(timer);
  }, [coolingDown]);

  useEffect(() => {
    if (!runId || !runStartedAt || phase !== "running") return;
    const controller = new AbortController();
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (polling || disposed) return;
      polling = true;
      try {
        const response = await fetch("/api/demo/agent/status", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok) throw new Error("The runner’s status is temporarily unavailable. Retrying automatically.");
        const status = await response.json();
        if (!Array.isArray(status.recentEvents)) throw new Error("The runner did not return a run history. Retrying automatically.");
        const events: RunEvent[] = status.recentEvents.filter((event: unknown): event is RunEvent => typeof event === "object" && event !== null && (event as RunEvent).runId === runId);
        if (disposed) return;
        setPollError(null);
        const readRoute = typeof status.readTransport === "string" && typeof status.bridgeMode === "string" ? { readTransport: status.readTransport, bridgeMode: status.bridgeMode, observedAt: Date.now() } : undefined;
        setRun((previous) => {
          if (!previous || previous.id !== runId) return previous;
          const merged = new Map(previous.events.map((event) => [String(event.id ?? `${event.t}:${event.type}`), event]));
          for (const event of events) merged.set(String(event.id ?? `${event.t}:${event.type}`), event);
          return { ...previous, readRoute, events: [...merged.values()].sort((left, right) => (left.t ?? 0) - (right.t ?? 0)) };
        });
        if (events.some((event) => event.type === "idle")) {
          operationBusy.current = false;
          setPhase("complete");
        }
      } catch (cause) {
        if (!disposed) setPollError(describeError(cause));
      } finally { polling = false; }
    };
    void poll();
    const interval = setInterval(() => {
      const duration = Date.now() - runStartedAt;
      setElapsed(Math.floor(duration / 1_000));
      if (duration >= runWindowMs) {
        operationBusy.current = false;
        setPhase("timeout");
      } else void poll();
    }, 2_000);
    return () => { disposed = true; controller.abort(); clearInterval(interval); };
  }, [runId, runStartedAt, phase]);

  const readApi = async (path: string, body: object) => {
    let response: Response;
    try { response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) }); }
    catch { throw new Error(path === "/api/sandbox/run" ? "The run request could not be confirmed. Check the shared activity below before retrying; the backend may already have started it." : "The sandbox could not be reached. Please try again when the connection is ready."); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const failure = result as ApiFailure;
      const retryHeader = Number(response.headers.get("retry-after"));
      const retry = Number(failure.retryAfterSeconds ?? retryHeader);
      if (response.status === 429 && Number.isFinite(retry) && retry > 0 && mounted.current) setCooldown(Math.min(3_600, Math.ceil(retry)));
      throw new Error(response.status === 429 ? `The shared sandbox is rate-limited.${retry > 0 ? ` Try again in ${Math.ceil(retry)} seconds.` : " Please try again shortly."}` : response.status === 409 ? "Another visitor’s run is in progress. Wait for it to finish, then try again." : typeof failure.error === "string" ? failure.error : "The sandbox did not accept this request. Please try again.");
    }
    if (path === "/api/sandbox/run" && response.status !== 202) throw new Error("No run acceptance was received. Check the activity below before retrying.");
    return result;
  };

  const start = async () => {
    if (operationBusy.current || !canRunHere || !address || !isConnected || !correctChain || cooldown > 0) return;
    operationBusy.current = true;
    const account = address;
    const selectedScenario = scenario;
    setError(null);
    setPollError(null);
    setChallenge(null);
    setRun(null);
    setElapsed(0);
    setPhase("challenge");
    try {
      await assertSepoliaWallet(connector, account);
      const requested = await readApi("/api/sandbox/challenge", { address: account, scenario: selectedScenario }) as Challenge;
      if (!requested || typeof requested.nonce !== "string" || !requested.nonce || requested.nonce.length > 256 || typeof requested.message !== "string" || !requested.message || requested.message.length > 8_000 || typeof requested.address !== "string" || requested.address.toLowerCase() !== account.toLowerCase() || requested.scenario !== selectedScenario || !Number.isFinite(requested.expiresAt) || requested.expiresAt <= Date.now() || requested.expiresAt > Date.now() + 180_000) throw new Error("The sandbox returned an invalid or expired challenge. Please try again.");
      if (typeof requested.origin !== "string" || requested.origin !== window.location.origin) throw new Error("The signing request belongs to a different or unidentified site. No signature was requested.");
      if (!mounted.current) return;
      setChallenge(requested);
      setPhase("signing");
      await assertSepoliaWallet(connector, account);
      const signature = await signMessageAsync({ account, connector, message: requested.message });
      if (!mounted.current) return;
      if (Date.now() >= requested.expiresAt) throw new Error("The signing request expired. Request a fresh challenge and try again.");
      await assertSepoliaWallet(connector, account);
      setPhase("submitting");
      const accepted = await readApi("/api/sandbox/run", { nonce: requested.nonce, address: account, signature });
      if (typeof accepted.runId !== "string" || !accepted.runId || accepted.started !== true) throw new Error("No run confirmation was received. Check the activity below before retrying.");
      if (!mounted.current) return;
      setRun({ id: accepted.runId, scenario: selectedScenario, startedAt: Date.now(), events: [] });
      setPhase("running");
    } catch (cause) {
      operationBusy.current = false;
      if (mounted.current) { setError(describeError(cause)); setPhase("error"); }
    }
  };

  const decision = run?.events.find((event) => event.type === "decision");
  const swap = run?.events.find((event) => event.type === "swap");
  const runError = run?.events.find((event) => event.type === "error");
  const attackNotFollowed = runError?.code === "ModelDidNotFollowInjection";
  const runErrorText = attackNotFollowed ? "Gemini did not request an oversized trade; no attack transaction was submitted." : String(runError?.message ?? "The runner reported an error.");
  const realGemini = typeof decision?.source === "string" && /gemini/i.test(decision.source) && !/scripted/i.test(decision.source);
  const source = realGemini ? String(decision.source) : decision ? "Model source not verified" : "Awaiting Gemini";
  const outcome = swap?.status === "success" && txHash(swap.hash) ? { title: "Swap confirmed on Sepolia", detail: "The funded sandbox vault traded through the Uniswap v4 policy hook.", tone: "text-emerald-300" } : swap?.status === "blocked" && txHash(swap.hash) ? { title: isGuardRejection(swap) ? "Blocked onchain · policy enforced" : "Transaction reverted onchain", detail: String(swap.message ?? swap.reason ?? "The transaction reverted; a policy rejection reason was not established."), tone: isGuardRejection(swap) ? "text-emerald-300" : "text-amber-200" } : swap?.status === "blocked" ? { title: "Blocked before submission", detail: String(swap.message ?? swap.reason ?? "Simulation rejected this trade; no onchain revert is claimed."), tone: "text-amber-200" } : swap ? { title: "Trade was not confirmed", detail: String(swap.message ?? swap.reason ?? "Inspect the activity and retry when the runner is ready."), tone: "text-amber-200" } : phase === "complete" && attackNotFollowed ? { title: "No oversized trade requested", detail: runErrorText, tone: "text-zinc-200" } : phase === "complete" && realGemini && decision?.action === "hold" ? { title: "Gemini chose to hold", detail: "No trade was submitted. This run did not exercise the hook’s rejection path.", tone: "text-zinc-200" } : phase === "complete" ? { title: "Run ended without a confirmed trade", detail: String(runError?.message ?? "No complete model-and-transaction result was received."), tone: "text-amber-200" } : null;

  return (
    <section id="try-sandbox" aria-labelledby="sandbox-title" className="workspace-composer min-w-0 scroll-mt-8">
      <header className="composer-header">
        <h2 id="sandbox-title">Request a trade</h2>
        <p className="composer-description">Choose what Gemini reads. The agent decides whether to trade from the shared Sepolia vault, within the owner’s policy.</p>
      </header>
      {differentOrigin && <div role="status" className="request-notice" data-tone="warning"><p><strong>This address is read-only.</strong></p>{canonicalOrigin ? <p>To sign a request, <a href={`${canonicalOrigin}/demo#try-sandbox`} className="break-all underline underline-offset-4">open {new URL(canonicalOrigin).hostname}</a>.</p> : <p>The application origin is not configured correctly. No signing request can begin from this page.</p>}</div>}
      <fieldset disabled={busy || !canRunHere} className="scenario-options">
        <legend>Choose a request</legend>
        {([{ id: "normal", title: "Trade within limits", detail: "Gemini reads clean news and may request up to 1 kUSD within policy, or hold." }, { id: "attack", title: "Test an over-limit request", detail: "Staged poisoned news asks the deliberately gullible agent to exceed its spending cap." }] as const).map((option) => <label key={option.id} data-selected={scenario === option.id} className={`scenario-option${scenario === option.id ? " is-selected" : ""}`}>
          <input type="radio" name="sandbox-scenario" value={option.id} checked={scenario === option.id} onChange={() => setScenario(option.id)} aria-describedby={`scenario-${option.id}-detail`} />
          <span className="min-w-0"><span className="scenario-title">{option.title}</span><span id={`scenario-${option.id}-detail`} className="scenario-detail">{option.detail}</span></span>
        </label>)}
      </fieldset>
      <div className="request-readiness">
        <p id="request-wallet-state">{differentOrigin ? <><strong>Read-only on this address.</strong><span>Use the application link above to sign a request.</span></> : !isConnected ? <><strong>Connect your wallet to continue.</strong><span>Use Connect wallet in the navigation. No test ETH is needed.</span></> : !correctChain ? <><strong>Switch your wallet to Sepolia.</strong><span>Use the network button in the navigation, then return here.</span></> : <><strong>Wallet ready on Sepolia.</strong><span>Your signature requests one shared-vault run.</span></>}</p>
        <p id="request-signing-note" className="request-note">Sign one message. Your wallet sends no funds or token approvals; the sandbox supplies test tokens and gas.</p>
        <button type="button" onClick={() => void start()} disabled={!canRunHere || !isConnected || !correctChain || busy || cooldown > 0} aria-describedby="request-wallet-state request-signing-note" className="request-action">{phase === "challenge" ? "Preparing request…" : phase === "signing" ? "Check your wallet…" : phase === "submitting" ? "Starting Gemini…" : phase === "running" ? "Request in progress…" : cooldown > 0 ? `Try again in ${cooldown}s` : "Sign request & run agent"}</button>
      </div>
      {phase === "challenge" && <p role="status" className="request-notice">Preparing a one-time signing request.</p>}
      {phase === "signing" && <p role="status" className="request-notice">Read the message in your wallet, then sign or cancel. This requests one run; it does not approve a transaction.</p>}
      {phase === "submitting" && <p role="status" className="request-notice">Message signed. Requesting a Gemini run.</p>}
      {challenge && phase === "signing" && <details className="run-evidence"><summary>Read the exact signing message</summary><pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6">{challenge.message}</pre></details>}
      {error && <p role="alert" className="request-notice" data-tone="warning">{error}</p>}
      {run && <section className="run-summary" aria-labelledby="your-result-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 id="your-result-title">Your result</h3><span className="run-meta break-all">{run.id.slice(0, 12)} · {phase === "running" ? `${elapsed}s elapsed` : phase === "timeout" ? "Status timed out" : "Finished"}</span></div>
        <p className="request-note">{run.scenario === "attack" ? "Over-limit request test" : "Trade within limits"} · This result follows only your signed request.</p>
        {outcome && <OutcomePanel outcome={outcome} swap={swap} />}
        <RunFacts run={run} phase={phase} outcome={outcome?.title} />
        {decision && <section className="model-decision" aria-label="Model decision" aria-live="polite" aria-atomic="true"><div className="flex flex-wrap items-baseline justify-between gap-2"><h4>Agent decision</h4><span className="run-meta">{source}</span></div><p className="model-action">{String(decision.action)}{typeof decision.amountIn === "number" ? ` · ${decision.amountIn} kUSD requested` : ""}</p><p>{String(decision.reason ?? "No rationale was returned.")}</p></section>}
        <ol className="run-stages" aria-label="Run progress" aria-busy={phase === "running"}><Step number="1" label="Read the chain" value={run.events.some((event) => event.type === "reading") ? "Started" : "Waiting"} /><Step number="2" label="Model decision" value={decision ? realGemini ? "Gemini responded" : "Source unverified" : "Waiting"} /><Step number="3" label="Guarded execution" value={swap ? swap.status === "success" ? "Executed" : swap.status === "blocked" ? isGuardRejection(swap) ? "Policy blocked" : "Reverted / blocked" : "Not confirmed" : decision?.action === "hold" ? "Model held" : "Waiting"} /></ol>
        {phase === "running" && !decision && <p role="status" className="request-note">Reading the chain and waiting for Gemini. Network and model latency can take a few minutes.</p>}
        {pollError && phase === "running" && <p className="request-notice" data-tone="warning">{pollError}</p>}
        {phase === "timeout" && <p role="status" className="request-notice" data-tone="warning">A final status was not received within three minutes. This does not establish whether the trade failed. Inspect any transaction link and the shared activity before requesting another run.</p>}
        {runError && !outcome && <p className="request-notice" data-tone="warning">{String(runError.message ?? "The runner reported an error.")}</p>}
        <RunEvidence run={run} />
      </section>}
      <p className="request-note composer-footnote">Shared, rate-limited Sepolia sandbox. Only the ENS owner can freeze the agent or change policy. If your wallet shows a site-security warning, stop. Recorded transactions remain available without connecting.</p>
    </section>
  );
}

function RunFacts({ run, phase, outcome }: { run: Run; phase: Phase; outcome?: string }) {
  const decision = run.events.find((event) => event.type === "decision");
  const state = run.events.find((event) => event.type === "state");
  const swap = run.events.find((event) => event.type === "swap");
  const endedWithoutTransaction = phase === "complete" && !txHash(swap?.hash);
  const noSubmission = decision?.action === "hold" || run.events.some((event) => event.type === "error" && event.code === "ModelDidNotFollowInjection") || (swap?.status === "blocked" && !txHash(swap.hash));
  return <dl className="run-facts" aria-label="Request and enforcement summary">
    <div><dt>Agent requested</dt><dd>{decision?.action === "hold" ? "Hold · no trade requested" : typeof decision?.amountIn === "number" ? `${decision.amountIn} kUSD swap` : "Waiting for the model"}</dd></div>
    <div><dt>Owner’s limit</dt><dd>{typeof state?.maxPerSwap === "number" ? `${state.maxPerSwap} kUSD per trade` : "Waiting for the policy read"}</dd></div>
    <div><dt>Result</dt><dd>{outcome ?? (phase === "timeout" ? "Status timed out · outcome unconfirmed" : "In progress")}</dd></div>
    <div><dt>Reason</dt><dd>{typeof swap?.reason === "string" ? <code>{swap.reason}</code> : swap?.status === "success" ? "Executed within policy" : decision?.action === "hold" ? "Model chose to hold" : endedWithoutTransaction ? "See the run explanation below" : "Awaiting execution result"}</dd></div>
    <div><dt>Tx</dt><dd>{txHash(swap?.hash) ? <a href={`https://sepolia.etherscan.io/tx/${swap.hash}`} target="_blank" rel="noreferrer">View Sepolia receipt ↗</a> : noSubmission ? "No transaction submitted" : endedWithoutTransaction ? "No transaction hash reported · execution unconfirmed" : "No transaction confirmed yet"}</dd></div>
  </dl>;
}

function Step({ number, label, value }: { number: string; label: string; value: string }) {
  return <li><span className="stage-number" aria-hidden="true">{number}</span><span><span className="stage-label">{label}</span><span className="stage-value">{value}</span></span></li>;
}

function OutcomePanel({ outcome, swap }: { outcome: { title: string; detail: string; tone: string }; swap?: RunEvent }) {
  const confirmed = txHash(swap?.hash) && (swap?.status === "success" || swap?.status === "blocked");
  const reverted = confirmed && swap?.status === "blocked";
  const protectedRun = reverted && isGuardRejection(swap);
  const positive = confirmed && (!reverted || protectedRun);
  const amber = outcome.tone === "text-amber-200";
  return <section aria-live="polite" aria-atomic="true" aria-label="Run outcome" className="run-outcome" data-tone={positive ? "success" : amber ? "warning" : "neutral"}>
    <h4>{outcome.title}</h4>
    <p>{outcome.detail}</p>
    <p className="outcome-verification">{protectedRun ? "Protection confirmed onchain" : reverted ? "Transaction reverted onchain" : confirmed ? "Execution confirmed onchain" : swap?.status === "blocked" ? "Pre-submission result · no onchain rejection claimed" : "Run result"}</p>
    {typeof swap?.reason === "string" && swap.reason && <p className="break-words">Reported reason: <code>{swap.reason}</code></p>}
    {txHash(swap?.hash) && <a href={`https://sepolia.etherscan.io/tx/${swap.hash}`} target="_blank" rel="noreferrer" className="run-receipt"><span>Verify Sepolia transaction ↗</span><span className="block break-all font-mono text-xs leading-6">{swap.hash}</span></a>}
  </section>;
}

function RunEvidence({ run }: { run: Run }) {
  const state = run.events.find((event) => event.type === "state");
  const swap = run.events.find((event) => event.type === "swap");
  const maxPerSwap = typeof state?.maxPerSwap === "number" && Number.isFinite(state.maxPerSwap) ? state.maxPerSwap : null;
  const dailyCap = typeof state?.dailyCap === "number" && Number.isFinite(state.dailyCap) ? state.dailyCap : null;
  const hasReceipt = txHash(swap?.hash);
  const verifiedNox = run.readRoute?.readTransport === "anon" && run.readRoute.bridgeMode === "anon";
  const directRoute = run.readRoute?.readTransport === "direct" || run.readRoute?.bridgeMode === "direct";
  const routeLabel = verifiedNox ? "Anon-RPC via Nox observed" : directRoute ? "Direct route · not anonymous" : run.readRoute?.readTransport === "leak" ? "Public logging route · not anonymous" : "Read route not verified";
  const execution = swap?.status === "success" && hasReceipt ? "Swap confirmed through the hook" : swap?.status === "blocked" && hasReceipt ? `Onchain revert: ${String(swap.reason ?? "reason not reported")}` : swap?.status === "blocked" ? `Simulation block: ${String(swap.reason ?? "reason not reported")}` : swap ? "No confirmed execution" : "Awaiting this run’s execution";
  return (
    <details className="run-evidence">
      <summary>How this request was enforced</summary>
      <div className="evidence-items">
        <section className="min-w-0"><h4>ENS policy</h4><a href={`https://sepolia.etherscan.io/address/${deployment.policySource}`} target="_blank" rel="noreferrer" className="break-all underline underline-offset-4">{ensDeployment.name} · policy source ↗</a><p>{maxPerSwap === null ? "Waiting for this run’s policy read." : `${maxPerSwap} kUSD per swap${dailyCap === null ? "" : ` · ${dailyCap} per day`}`}</p>{typeof state?.authorized === "boolean" && <p>{state.authorized ? "Authorized at the policy read" : "Authorization revoked at the policy read"}</p>}</section>
        <section className="min-w-0"><h4>Uniswap v4 enforcement</h4><p>{execution}</p><a href={`https://sepolia.etherscan.io/address/${deployment.policyHook}`} target="_blank" rel="noreferrer" className="underline underline-offset-4">Inspect the PolicyHook ↗</a>{hasReceipt && <a href={`https://sepolia.etherscan.io/tx/${String(swap?.hash)}`} target="_blank" rel="noreferrer" className="ml-3 inline-block underline underline-offset-4">Run receipt ↗</a>}</section>
        <section className="min-w-0"><h4>Anon-RPC / Nox</h4><p data-tone={verifiedNox ? "success" : directRoute ? "warning" : "neutral"}>{routeLabel}</p><p>{run.readRoute ? `Runner route observed at ${new Date(run.readRoute.observedAt).toLocaleTimeString()}.` : "No routing observation received for this run yet."} Routing metadata is reported by the running bridge, not an anonymity proof.</p></section>
      </div>
      <p className="request-note">The wallet’s own RPC is separate from the agent’s read route. The message signature requests a cycle; it does not make the eventual onchain trade private.</p>
    </details>
  );
}
