"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useEventStream, StatusDot } from "@/components/LiveFeed";
import { useKillSwitch } from "@/lib/killswitch";
import { AGENT_URL, ANON_BRIDGE, PROXY_URL, allowDemoControls } from "@/lib/endpoints";
import { HostedNotice } from "@/components/HostedNotice";
import { SandboxControls } from "@/components/SandboxControls";
import { AuthorityDiagram } from "@/components/AuthorityDiagram";
import { deployment, ensDeployment } from "@/generated/deployment";

const PROXY_EVENTS = `${PROXY_URL}/events`;
const BRIDGE_EVENTS = `${ANON_BRIDGE}/events`;
const AGENT = AGENT_URL;

type AgentState = {
  price: number;
  vaultToken0: number;
  vaultToken1: number;
  maxPerSwap: number;
  dailyCap: number;
  spentToday: number;
  maxImpactBps: number;
  authorized: boolean;
  active: boolean;
  allowedPool?: string;
};
type Connection = "connecting" | "live" | "offline";

const time = (t?: unknown) => (typeof t === "number" ? new Date(t).toLocaleTimeString() : "");
const short = (h?: unknown) => (typeof h === "string" ? `${h.slice(0, 10)}…${h.slice(-6)}` : "");

// Live panels need the agent, bridge and proxy, which run on the demo machine. Decide after mount so the
// server render (which has no window) and the first client render agree.
export default function Demo() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (!mounted) return <p className="text-sm text-zinc-500">Connecting to the demonstration…</p>;
  return AGENT ? <LiveDemo /> : <HostedNotice />;
}
const subscribe = () => () => {};

function LiveDemo() {
  const proxy = useEventStream(PROXY_EVENTS);
  const bridge = useEventStream(BRIDGE_EVENTS);
  const agent = useEventStream(`${AGENT}/events`, 40);
  const [status, setStatus] = useState<{ agent?: string; vault?: string; injected?: boolean; transport?: string; readTransport?: string; busy?: boolean; activeRunId?: string; lastState?: AgentState | null; lastStateAt?: number; stateStatus?: string; stateError?: string }>({});
  const [observedAt, setObservedAt] = useState(0);
  const [bridgeMode, setBridgeMode] = useState<string | null>(null);
  const [statusConnection, setStatusConnection] = useState<Connection>("connecting");
  const [controlError, setControlError] = useState<string | null>(null);
  const k = useKillSwitch();

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let refreshing = false;
    const read = async (url: string) => {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
      if (!response.ok) throw new Error("Service unavailable");
      return response.json();
    };
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const [runner, metrics] = await Promise.allSettled([read(`${AGENT}/status`), read(`${ANON_BRIDGE}/metrics`)]);
        if (disposed) return;
        if (runner.status === "fulfilled") { setStatus(runner.value); setObservedAt(Date.now()); setStatusConnection("live"); }
        else setStatusConnection("offline");
        setBridgeMode(metrics.status === "fulfilled" ? metrics.value.mode ?? null : null);
      } finally { refreshing = false; }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 5_000);
    return () => { disposed = true; controller.abort(); clearInterval(interval); };
  }, []);

  const latest = useMemo(() => agent.entries.find((e) => e.type === "state") as unknown as AgentState | undefined, [agent.entries]);
  const state = status.lastState ?? latest ?? undefined;
  const injectEvent = agent.entries.find((e) => e.type === "inject");
  const injected = injectEvent ? Boolean(injectEvent.injected) : Boolean(status.injected);
  const transportEvent = agent.entries.find((e) => e.type === "transport");
  const anonOn = (transportEvent ? String(transportEvent.transport) : (status.transport ?? "anon")) === "anon";
  // Busy from "reading" until "idle". Live Sepolia cycles take ~20s (mixnet reads + tx confirmation).
  const lastCycleEvent = agent.entries.find((e) => e.type === "reading" || e.type === "idle");
  const running = lastCycleEvent ? lastCycleEvent.type === "reading" : Boolean(status.busy);
  const connection: Connection = agent.status === "offline" || statusConnection === "offline" ? "offline" : agent.status === "live" && statusConnection === "live" ? "live" : "connecting";
  const matchingIdentity = status.agent?.toLowerCase() === ensDeployment.agent.toLowerCase() && status.vault?.toLowerCase() === deployment.demoVault.toLowerCase();
  const currentState = Boolean(state && matchingIdentity && connection === "live" && status.stateStatus === "fresh" && status.lastStateAt && observedAt - status.lastStateAt < 60_000);
  const routeFresh = currentState && bridge.status === "live";
  const readRoute = routeFresh && status.readTransport === "anon" && bridgeMode === "anon" ? "anon" : routeFresh && (status.readTransport === "direct" || status.readTransport === "leak" || bridgeMode === "direct") ? "direct" : "unknown";
  const runEvent = status.busy && status.activeRunId ? agent.entries.find((event) => event.runId === status.activeRunId) : undefined;
  const stage = runEvent?.type === "swapping" ? "executing" : runEvent?.type === "decision" || runEvent?.type === "state" ? "thinking" : runEvent?.type === "reading" ? "reading" : status.busy ? "waiting" : "idle";
  const lastSnapshot = status.lastStateAt ? new Date(status.lastStateAt).toLocaleTimeString() : null;

  const post = async (path: string) => {
    if (!allowDemoControls) return;
    setControlError(null);
    try { const r = await fetch(`${AGENT}${path}`, { method: "POST" }); if (!r.ok) throw new Error(r.status === 409 ? "A cycle is already running. Wait for it to finish." : "The runner did not accept this action."); }
    catch (error) { setControlError(error instanceof Error ? error.message : "Action failed"); }
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Watch the boundary hold.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">A real Gemini decision. An owner-controlled vault. Limits enforced on Uniswap v4.</p></div>
        <Link href="/#onchain-evidence" className="shrink-0 rounded-lg border border-zinc-700 px-3 py-2.5 text-xs font-medium text-zinc-200 hover:border-zinc-500">Recorded onchain proof ↗</Link>
      </section>
      <section aria-label="Live demonstration status" className="sticky top-0 z-20 grid grid-cols-2 gap-x-5 gap-y-3 rounded-xl border border-zinc-700 bg-zinc-950/95 px-4 py-3 shadow-lg backdrop-blur-sm sm:grid-cols-[minmax(0,1.2fr)_auto_auto_auto] sm:items-center sm:px-5">
        <div className="min-w-0"><p className="text-xs text-zinc-400">Shared Sepolia agent</p><p className="mt-1 truncate font-mono text-xs text-zinc-100" title={k.name ?? ensDeployment.name}>{k.name ?? ensDeployment.name}</p></div>
        <StatusValue label="Authority" value={currentState && state ? state.authorized && state.active ? "Authorized" : "Trading blocked" : state ? "Snapshot stale" : "Checking…"} tone={currentState && state ? state.authorized && state.active ? "safe" : "blocked" : "unknown"} />
        <StatusValue label="Agent RPC route" value={readRoute === "anon" ? "Anon-RPC / Nox" : readRoute === "direct" ? "Direct · not anonymous" : "Not verified"} tone={readRoute === "anon" ? "safe" : readRoute === "direct" ? "blocked" : "unknown"} />
        <div className="min-w-0"><p className="text-xs text-zinc-400">Vault{!currentState && state ? " · last received" : ""}</p><p className="mt-1 text-sm font-medium tabular-nums text-zinc-200">{state ? `${formatNumber(state.vaultToken0)} kUSD` : "—"}</p></div>
      </section>
      {connection === "connecting" && <p role="status" className="rounded-xl border border-zinc-800 p-4 text-sm leading-6 text-zinc-400">Connecting to the runner. Policy readings and activity appear automatically. <Link href="/#onchain-evidence" className="text-zinc-200 underline underline-offset-4">Inspect recorded proof</Link> while you wait.</p>}
      {connection === "offline" && <div role="status" className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-4 text-sm leading-6 text-amber-200"><p className="font-medium">The live runner is unavailable. Reconnecting automatically.</p><p className="mt-1">{state ? "Displayed values are the last received snapshot." : "No live snapshot has been received."} <Link href="/#onchain-evidence" className="underline underline-offset-4">Inspect the recorded transactions</Link>.</p></div>}
      {status.stateStatus === "stale" && <p role="status" className="rounded-xl border border-amber-800/60 p-4 text-sm text-amber-200">The last chain snapshot is stale{lastSnapshot ? ` (${lastSnapshot})` : ""}. Waiting for fresh readings.</p>}
      {bridgeMode === "direct" && <p role="status" className="rounded-xl border border-amber-800/60 p-4 text-sm font-medium text-amber-200">The bridge is in direct fallback mode. Its current traffic is not anonymized.</p>}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.5fr)]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1"><SandboxControls /></div>
        <aside aria-label="Policy and authority" className="min-w-0 space-y-5 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <section className="overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900/20">
            <div className="border-b border-zinc-800 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-zinc-100">The owner sets the boundary</h2><span className={`text-xs ${currentState ? "text-emerald-300" : "text-zinc-400"}`}>{currentState ? "Live policy" : "Awaiting fresh data"}</span></div><a href={`https://sepolia.etherscan.io/address/${deployment.policySource}`} target="_blank" rel="noreferrer" className="mt-2 inline-block break-all font-mono text-xs text-emerald-300 underline underline-offset-4">{k.name ?? ensDeployment.name} ↗</a></div>
            <dl className={`grid grid-cols-2 gap-4 p-5 ${currentState ? "" : "opacity-60"}`}>
              <PolicyValue label="Per-swap cap" value={state ? `${formatNumber(state.maxPerSwap)} kUSD` : "—"} />
              <PolicyValue label="Remaining today" value={state ? `${formatNumber(Math.max(0, state.dailyCap - state.spentToday))} kUSD` : "—"} />
              <PolicyValue label="Daily cap" value={state ? `${formatNumber(state.dailyCap)} kUSD` : "—"} />
              <PolicyValue label="Max pool impact" value={state ? `${formatNumber(state.maxImpactBps / 100)}%` : "—"} />
              <div className="col-span-2"><dt className="text-xs text-zinc-400">Allowed pool</dt><dd className="mt-1"><a href={`https://sepolia.etherscan.io/address/${deployment.policyHook}`} target="_blank" rel="noreferrer" className="break-all font-mono text-xs text-zinc-200 underline underline-offset-4">{state?.allowedPool ? short(state.allowedPool) : "Awaiting policy read"}</a><span className="mt-1 block text-xs text-zinc-500">Pool ID enforced by the linked PolicyHook</span></dd></div>
            </dl>
            <div className="border-t border-zinc-800 px-5 py-3 text-xs leading-5 text-zinc-400">{currentState ? `Chain snapshot${lastSnapshot ? `: ${lastSnapshot}` : ""}.` : state ? `Last received${lastSnapshot ? `: ${lastSnapshot}` : ""}; values may have changed.` : "Waiting for the chain snapshot."} Authorization and limits come from ENSv2.</div>
            <Controls injected={injected} running={running} online={connection === "live"} onRun={() => post("/tick")} onInject={() => post(`/inject?on=${injected ? 0 : 1}`)} anonOn={anonOn} onTransport={() => post(`/transport?mode=${anonOn ? "leak" : "anon"}`)} agentAddress={status.agent} />
            {controlError && <p role="alert" className="m-4 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{controlError}</p>}
          </section>
          <AuthorityDiagram stage={stage} readRoute={readRoute} fresh={currentState} />
        </aside>
        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <Card title="Shared agent activity" right={<StatusDot status={connection} />}>
            <p className="mb-4 text-xs leading-5 text-zinc-400">Recent runs from all visitors. Your result above follows only your signed request.</p>
            <div className="max-h-[28rem] overflow-y-auto pr-1" tabIndex={0} role="region" aria-label="Shared run history"><Activity entries={agent.entries} connection={connection} running={running} /></div>
          </Card>
        </div>
      </div>
      <section aria-label="Observed RPC traffic" className="grid gap-4 md:grid-cols-2">
        <Card title="Public-provider comparison log" right={<StatusDot status={proxy.status} />}>
          <Feed empty={proxy.status === "offline" ? "The comparison log is unavailable. Reconnecting automatically." : proxy.status === "connecting" ? "Connecting to the comparison log…" : allowDemoControls ? "No calls have reached the comparison provider. Turn Anon-RPC off for the controlled leak comparison." : "No calls have reached the comparison provider in this session. Routing changes stay presenter-controlled. An empty log alone does not prove anonymity."} rows={proxy.entries.map((e) => ({ t: time(e.t), main: `${String(e.ip)}  ${String(e.method)}`, sub: typeof e.detail === "object" && e.detail && "fn" in e.detail ? String((e.detail as { fn: string }).fn) : "", tone: "leak" }))} />
        </Card>
        <Card title={bridgeMode === "anon" ? "Anon-RPC bridge: Nox mixnet" : bridgeMode === "direct" ? "Bridge: direct fallback (not anonymous)" : "Bridge traffic · verifying route"} right={<StatusDot status={bridge.status} />}>
          <Feed empty={bridge.status === "offline" ? "Bridge traffic is unavailable. Its current route cannot be verified." : bridge.status === "connecting" ? "Connecting to the bridge traffic feed…" : "Observed RPC methods and timings appear here when the agent reads or submits a transaction."} rows={bridge.entries.map((e) => ({ t: time(e.t), main: `→ ${String(e.transport ?? "route unknown")}  ${String(e.method)}`, sub: `${String(e.ms)} ms · ${String(e.transport)}`, tone: e.ok ? "safe" : "leak" }))} />
        </Card>
      </section>
      <p className="text-xs leading-5 text-zinc-400">Agent routing is separate from the wallet’s own RPC. Transactions remain public onchain. The poisoned-news scenario is staged; contract enforcement and receipts are real.</p>
    </div>
  );
}

const formatNumber = (value: number) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";

function PolicyValue({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-zinc-400">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-zinc-100">{value}</dd></div>;
}

function StatusValue({ label, value, tone }: { label: string; value: string; tone: "safe" | "blocked" | "unknown" }) {
  return <div className="min-w-0"><p className="text-xs text-zinc-400">{label}</p><p className={`mt-1 text-xs font-medium ${tone === "safe" ? "text-emerald-300" : tone === "blocked" ? "text-amber-200" : "text-zinc-400"}`}>{value}</p></div>;
}

function Controls(props: {
  injected: boolean;
  running: boolean;
  online: boolean;
  onRun: () => void;
  onInject: () => void;
  anonOn: boolean;
  onTransport: () => void;
  agentAddress?: string;
}) {
  const k = useKillSwitch();
  const frozen = k.authorized === false;

  if (!allowDemoControls && !k.canManage) return <div className="space-y-3 border-t border-zinc-800 p-5"><p className="text-xs leading-5 text-zinc-400">Only the verified ENS owner can freeze or restore this agent. Visitors can run the two scenarios.</p><Link href="/freeze" className="text-xs font-medium text-zinc-200 underline underline-offset-4">Inspect owner revocation →</Link></div>;

  return (
    <section aria-label="Owner authorization controls" className="flex flex-wrap items-center gap-3 border-t border-zinc-800 p-5">
      {allowDemoControls && <><button
        onClick={props.onRun}
        disabled={!props.online || props.running}
        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
      >
        {props.running ? "Agent thinking…" : "Run agent once"}
      </button>
      <button
        onClick={props.onInject}
        disabled={!props.online}
        className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40 ${
          props.injected ? "bg-red-600 text-white" : "border border-red-700 text-red-300"
        }`}
      >
        {props.injected ? "Poisoned news: ON" : "Inject poisoned news"}
      </button>
      <button
        onClick={props.onTransport}
        disabled={!props.online || props.running}
        title="Where the agent's reads and transactions go"
        className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40 ${
          props.anonOn ? "bg-emerald-600 text-white" : "border border-amber-600 text-amber-300"
        }`}
      >
        {props.anonOn ? "Anon-RPC: ON" : "Anon-RPC: OFF (leaking)"}
      </button>
      <span className="text-xs text-zinc-500">staged attack: the agent is deliberately gullible</span>
      </>}
      <div className="flex w-full min-w-0 flex-wrap items-center gap-3">
        {k.error && <span className="text-xs text-red-400">{k.error.message.split("\n")[0]}</span>}
        {k.hash && <a className={`font-mono text-xs underline underline-offset-4 ${k.transactionFailed ? "text-red-300" : "text-zinc-400"}`} href={`https://sepolia.etherscan.io/tx/${k.hash}`} target="_blank" rel="noreferrer">{k.transactionFailed ? "Transaction reverted" : k.confirmed ? "Confirmed" : "Transaction submitted"} · {short(k.hash)} ↗</a>}
        <Link href="/freeze" className="text-xs text-zinc-500 underline">owner view</Link>
        <button
          onClick={frozen ? k.unfreeze : k.freeze}
          disabled={!k.canManage || k.isPending || k.authorized === undefined}
          title={k.canManage ? `Owner ${frozen ? "re-grants" : "revokes"} the agent (${k.via})` : "Only the verified ENS owner on Sepolia can change authority"}
          className={`w-full rounded-lg px-4 py-3 text-sm font-semibold disabled:opacity-40 ${frozen ? "border border-zinc-600" : "bg-red-500 text-black"}`}
        >
          {k.isPending ? "Confirming…" : frozen ? "Unfreeze agent" : "Revoke agent (owner)"}
        </button>
      </div>
    </section>
  );
}

function Activity({ entries, connection, running }: { entries: Record<string, unknown>[]; connection: Connection; running: boolean }) {
  const rows = entries.filter((e) => ["decision", "swap", "error", "inject"].includes(String(e.type)));
  if (!rows.length) return <div className="space-y-3 text-sm leading-6 text-zinc-400"><p>{connection === "offline" ? "The activity feed is unavailable. This page will reconnect automatically." : connection === "connecting" ? "Connecting to the agent’s activity feed…" : running ? "The agent is reading the chain. Its decision and transaction result will appear here." : allowDemoControls ? "No activity yet. Run the agent once to begin the demonstration." : "The runner is connected. Request a sandbox run above, or watch another run appear automatically."}</p>{!allowDemoControls && <Link href="/#onchain-evidence" className="inline-block text-xs font-medium text-zinc-200 underline underline-offset-4">Follow the previous run onchain →</Link>}</div>;
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((e, i) => {
        if (e.type === "decision")
          return (
            <li key={i} className="rounded-lg bg-zinc-900 px-3 py-2">
              <span className="text-zinc-500">{time(e.t)}</span> 🤖 decided <b>{String(e.action)} {String(e.amountIn)} kUSD</b>
              {e.injected ? <span className="ml-2 rounded bg-red-900 px-1.5 text-xs text-red-200">read poisoned news</span> : null}
              <div className="pt-1 text-xs text-zinc-400">“{String(e.reason)}” · {String(e.source)}</div>
            </li>
          );
        if (e.type === "swap")
          return (
            <li
              key={i}
              className={`flex flex-wrap items-start justify-between gap-2 rounded-lg px-3 py-2 ${e.status === "success" ? "bg-emerald-950/50" : "bg-red-950/60"}`}
            >
              <span>
                <span className="text-zinc-500">{time(e.t)}</span>{" "}
                {e.status === "success" ? `✅ swapped ${String(e.amountIn)} kUSD` : e.status === "blocked" && typeof e.hash === "string" ? `🛡️ ${String(e.amountIn)} kUSD swap reverted on-chain` : e.status === "blocked" ? `🛡️ ${String(e.amountIn)} kUSD swap blocked in simulation` : `Swap could not be submitted`}
                {typeof e.hash === "string" && (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${e.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 font-mono text-xs text-zinc-500 underline"
                  >
                    {short(e.hash)}
                  </a>
                )}
              </span>
              <span className={e.status === "success" ? "text-emerald-400" : "font-medium text-red-300"}>
                {e.status === "success" ? "within policy" : String(e.message)}
              </span>
            </li>
          );
        if (e.type === "inject")
          return (
            <li key={i} className="px-3 text-xs text-zinc-500">
              {time(e.t)} poisoned news {e.injected ? "injected into the feed" : "removed"}
            </li>
          );
        return (
          <li key={i} className="px-3 text-xs text-amber-400">
            {time(e.t)} {String(e.message)}
          </li>
        );
      })}
    </ul>
  );
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-400">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Feed({ rows, empty }: { rows: { t: string; main: string; sub: string; tone: string }[]; empty: string }) {
  if (!rows.length) return <p className="text-sm leading-6 text-zinc-400">{empty}</p>;
  return (
    <ul className="max-h-72 space-y-1 overflow-y-auto break-words font-mono text-xs">
      {rows.map((r, i) => (
        <li key={i} className={`rounded px-2 py-1 ${r.tone === "leak" ? "bg-red-950/40" : "bg-emerald-950/40"}`}>
          <span className="text-zinc-400">{r.t}</span> {r.main}
          {r.sub && <div className="break-words pl-2 text-zinc-400">{r.sub}</div>}
        </li>
      ))}
    </ul>
  );
}
