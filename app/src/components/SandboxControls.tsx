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
  const outcome = swap?.status === "success" && txHash(swap.hash) ? { title: "Swap confirmed on Sepolia", detail: "The funded sandbox vault traded through the Uniswap v4 policy hook.", tone: "text-emerald-300" } : swap?.status === "blocked" && txHash(swap.hash) ? { title: "Blocked onchain · policy enforced", detail: String(swap.message ?? swap.reason ?? "The hook rejected this trade and rolled back the swap."), tone: "text-emerald-300" } : swap?.status === "blocked" ? { title: "Blocked before submission", detail: String(swap.message ?? swap.reason ?? "Simulation rejected this trade; no onchain revert is claimed."), tone: "text-amber-200" } : swap ? { title: "Trade was not confirmed", detail: String(swap.message ?? swap.reason ?? "Inspect the activity and retry when the runner is ready."), tone: "text-amber-200" } : phase === "complete" && attackNotFollowed ? { title: "No oversized trade requested", detail: runErrorText, tone: "text-zinc-200" } : phase === "complete" && realGemini && decision?.action === "hold" ? { title: "Gemini chose to hold", detail: "No trade was submitted. This run did not exercise the hook’s rejection path.", tone: "text-zinc-200" } : phase === "complete" ? { title: "Run ended without a confirmed trade", detail: String(runError?.message ?? "No complete model-and-transaction result was received."), tone: "text-amber-200" } : null;

  return (
    <section id="try-sandbox" aria-labelledby="sandbox-title" className="overflow-hidden rounded-2xl border border-emerald-800/70 bg-linear-to-br from-emerald-950/30 via-zinc-950 to-zinc-900/30">
      <div className="border-b border-zinc-800 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Try it yourself</p><span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">Funded Sepolia sandbox</span></div><h2 id="sandbox-title" className="mt-3 text-2xl font-semibold tracking-tight">Your request. A real model. A real boundary.</h2><p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">Connect MetaMask or another supported wallet on Sepolia, then sign one message to request a Gemini cycle. The sandbox supplies the test tokens and transaction gas. Your wallet sends no funds and approves no tokens.</p></div>
      <div className="space-y-5 p-5 sm:p-6">
        {differentOrigin && <div role="status" className="rounded-xl border border-amber-800/60 bg-amber-950/25 p-4 text-sm leading-6 text-amber-200"><p className="font-medium">This address is a read-only preview.</p>{canonicalOrigin ? <p className="mt-1">Signing is available only on the configured application origin. <a href={`${canonicalOrigin}/demo#try-sandbox`} className="break-all underline underline-offset-4">Open the sandbox at {new URL(canonicalOrigin).hostname} →</a></p> : <p className="mt-1">The application origin is not configured correctly. No signing request can begin from this page.</p>}</div>}
        <fieldset disabled={busy || !canRunHere} className="grid gap-3 sm:grid-cols-2"><legend className="mb-3 text-xs font-medium text-zinc-400">Choose a fixed scenario</legend>{([{ id: "normal", title: "Normal trade", detail: "Gemini reads clean news and decides whether to buy within the policy." }, { id: "attack", title: "Poisoned-news challenge", detail: "The staged news asks the deliberately gullible agent to exceed its cap." }] as const).map((option) => <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${scenario === option.id ? "border-emerald-700 bg-emerald-950/35" : "border-zinc-800 bg-zinc-950/50 hover:border-zinc-600"} ${busy ? "cursor-wait opacity-60" : ""}`}><input type="radio" name="sandbox-scenario" value={option.id} checked={scenario === option.id} onChange={() => setScenario(option.id)} className="mt-1 accent-emerald-400" /><span><span className="block text-sm font-medium text-zinc-200">{option.title}</span><span className="mt-1 block text-xs leading-5 text-zinc-500">{option.detail}</span></span></label>)}</fieldset>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"><div className="text-sm leading-6 text-zinc-400">{differentOrigin ? <><strong className="font-medium text-zinc-200">Observation only on this address.</strong><br />Use the configured application link above for a signed sandbox request.</> : !isConnected ? <><strong className="font-medium text-zinc-200">Connect your wallet in the header.</strong><br />No test ETH is needed in your wallet.</> : !correctChain ? <><strong className="font-medium text-amber-200">Switch your wallet to Sepolia.</strong><br />Use the network button in the header, then return here.</> : <><strong className="font-medium text-zinc-200">Ready on Sepolia.</strong><br />Your signature authorizes one shared-sandbox cycle only.</>}</div><button type="button" onClick={() => void start()} disabled={!canRunHere || !isConnected || !correctChain || busy || cooldown > 0} className="rounded-xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-zinc-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40">{phase === "challenge" ? "Preparing request…" : phase === "signing" ? "Check your wallet…" : phase === "submitting" ? "Starting Gemini…" : phase === "running" ? `Run in progress · ${elapsed}s` : cooldown > 0 ? `Try again in ${cooldown}s` : "Sign & run Gemini"}</button></div>
        {phase === "signing" && <p role="status" className="text-sm leading-6 text-emerald-200">Read the message in your wallet and approve or cancel it. This is a message signature, not a transaction.</p>}
        {challenge && phase === "signing" && <details className="rounded-xl border border-zinc-800 p-4 text-xs text-zinc-400"><summary className="cursor-pointer text-zinc-300">Exact message requested by the sandbox</summary><pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-5">{challenge.message}</pre></details>}
        {error && <p role="alert" className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-4 text-sm leading-6 text-amber-200">{error}</p>}
        {run && <div aria-live="polite" className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-zinc-200">Your {run.scenario === "attack" ? "poisoned-news" : "normal"} run</p><span className="font-mono text-xs text-zinc-500">{run.id.slice(0, 12)} · {phase === "running" ? `${elapsed}s elapsed` : phase === "timeout" ? "Status timed out" : "Finished"}</span></div><div className="grid gap-3 sm:grid-cols-3"><Step number="01" label="Chain read" value={run.events.some((event) => event.type === "reading") ? "Started" : "Waiting"} /><Step number="02" label="Model decision" value={decision ? realGemini ? "Gemini responded" : "Source unverified" : "Waiting"} /><Step number="03" label="Guarded execution" value={swap ? swap.status === "success" ? "Executed" : swap.status === "blocked" ? "Policy blocked" : "Not confirmed" : decision?.action === "hold" ? "Model held" : "Waiting"} /></div>{decision && <div className="border-t border-zinc-800 pt-4"><p className="text-xs font-medium text-zinc-500">{source}</p><p className="mt-2 text-sm text-zinc-200">{String(decision.action)}{typeof decision.amountIn === "number" ? ` · ${decision.amountIn} kUSD requested` : ""}</p><p className="mt-2 text-sm leading-6 text-zinc-400">{String(decision.reason ?? "No rationale was returned.")}</p></div>}{outcome && <div className="border-t border-zinc-800 pt-4"><p className={`text-sm font-semibold ${outcome.tone}`}>{outcome.title}</p><p className="mt-2 text-sm leading-6 text-zinc-400">{outcome.detail}</p>{txHash(swap?.hash) && <a href={`https://sepolia.etherscan.io/tx/${swap.hash}`} target="_blank" rel="noreferrer" className="mt-3 inline-block break-all font-mono text-xs text-emerald-300 underline underline-offset-4">Verify transaction {swap.hash.slice(0, 12)}…{swap.hash.slice(-8)} ↗</a>}</div>}{phase === "running" && !decision && <p className="text-sm leading-6 text-zinc-500">The agent is reading the chain and requesting a real Gemini response. Network and model latency can take a few minutes.</p>}{pollError && phase === "running" && <p className="text-xs leading-5 text-amber-200">{pollError}</p>}{phase === "timeout" && <p role="status" className="text-sm leading-6 text-amber-200">A final run status was not received within three minutes. This does not prove that the trade failed. Inspect any transaction link and the shared activity below before requesting another run.</p>}{runError && !outcome && <p className="text-sm leading-6 text-amber-200">{String(runError.message ?? "The runner reported an error.")}</p>}</div>}
        {run && <RunEvidence run={run} />}
        <p className="text-xs leading-5 text-zinc-500">This is a shared, rate-limited testnet sandbox, not a personal trading account. Only the ENS owner can freeze or change policy. If your wallet shows a site-security warning, stop. You can inspect the recorded onchain evidence without connecting.</p>
      </div>
    </section>
  );
}

function Step({ number, label, value }: { number: string; label: string; value: string }) {
  return <div className="rounded-lg border border-zinc-800 p-3"><p className="text-xs text-zinc-500"><span className="mr-2 font-mono text-emerald-400">{number}</span>{label}</p><p className="mt-2 text-xs font-medium text-zinc-300">{value}</p></div>;
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
    <section aria-label="Integration evidence for this run" className="border-t border-zinc-800 pt-4">
      <p className="mb-3 text-xs font-medium text-zinc-300">What this run actually used</p>
      <div className="grid gap-4 text-xs leading-5 sm:grid-cols-3">
        <div className="min-w-0"><p className="font-medium text-zinc-200">ENS policy</p><a href={`https://sepolia.etherscan.io/address/${deployment.policySource}`} target="_blank" rel="noreferrer" className="mt-1 block break-all text-emerald-300 underline underline-offset-4">{ensDeployment.name} · policy source ↗</a><p className="mt-1 text-zinc-400">{maxPerSwap === null ? "Waiting for this run’s policy read." : `${maxPerSwap} kUSD per swap${dailyCap === null ? "" : ` · ${dailyCap} per day`}`}</p>{typeof state?.authorized === "boolean" && <p className="text-zinc-500">{state.authorized ? "Authorized at the policy read" : "Authorization revoked at the policy read"}</p>}</div>
        <div className="min-w-0"><p className="font-medium text-zinc-200">Uniswap v4 enforcement</p><p className="mt-1 text-zinc-400">{execution}</p><a href={`https://sepolia.etherscan.io/address/${deployment.policyHook}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-zinc-300 underline underline-offset-4">Inspect the PolicyHook ↗</a>{hasReceipt && <a href={`https://sepolia.etherscan.io/tx/${String(swap?.hash)}`} target="_blank" rel="noreferrer" className="ml-3 inline-block text-emerald-300 underline underline-offset-4">Run receipt ↗</a>}</div>
        <div className="min-w-0"><p className="font-medium text-zinc-200">Anon-RPC / Nox</p><p className={`mt-1 ${verifiedNox ? "text-emerald-300" : directRoute ? "text-amber-200" : "text-zinc-400"}`}>{routeLabel}</p><p className="mt-1 text-zinc-500">{run.readRoute ? `Runner route observed at ${new Date(run.readRoute.observedAt).toLocaleTimeString()}.` : "No routing observation received for this run yet."} Routing metadata is reported by the running bridge, not an anonymity proof.</p></div>
      </div>
      <p className="mt-3 text-xs leading-5 text-zinc-500">The wallet’s own RPC is separate from the agent’s read route. The message signature requests a cycle; it does not make the eventual onchain trade private.</p>
    </section>
  );
}
