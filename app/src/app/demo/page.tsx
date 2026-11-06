"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useEventStream, StatusDot } from "@/components/LiveFeed";
import { useKillSwitch } from "@/lib/killswitch";
import { AGENT_URL, ANON_BRIDGE, PROXY_URL, allowDemoControls } from "@/lib/endpoints";
import { HostedNotice } from "@/components/HostedNotice";

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
  const [status, setStatus] = useState<{ agent?: string; injected?: boolean; transport?: string; busy?: boolean; lastState?: AgentState | null; lastStateAt?: number; stateStatus?: string; stateError?: string }>({});
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
        if (runner.status === "fulfilled") { setStatus(runner.value); setStatusConnection("live"); }
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
  const currentState = Boolean(state && connection === "live" && status.stateStatus === "fresh");
  const lastSnapshot = status.lastStateAt ? new Date(status.lastStateAt).toLocaleTimeString() : null;

  const post = async (path: string) => {
    if (!allowDemoControls) return;
    setControlError(null);
    try { const r = await fetch(`${AGENT}${path}`, { method: "POST" }); if (!r.ok) throw new Error(r.status === 409 ? "A cycle is already running. Wait for it to finish." : "The runner did not accept this action."); }
    catch (error) { setControlError(error instanceof Error ? error.message : "Action failed"); }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3"><p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Live demonstration · Sepolia</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Watch the boundary hold.</h1><p className="max-w-3xl text-sm leading-6 text-zinc-400">Follow a normal trade, an intentionally poisoned news feed, and owner revocation. The attack is staged: the agent prompt is deliberately gullible. Contract enforcement is real.</p></section>
      {!allowDemoControls && <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm leading-6 text-zinc-400"><div className="max-w-2xl"><span className="font-medium text-zinc-200">Watch without connecting a wallet.</span> The presenter runs this shared Sepolia agent; this page updates automatically. You don’t need test ETH or tokens to follow the demonstration.</div><Link href="/#onchain-evidence" className="shrink-0 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 hover:border-zinc-500">View the recorded proof ↗</Link></div>}
      <Walkthrough />
      {connection === "connecting" && <p role="status" className="rounded-xl border border-zinc-800 p-4 text-sm leading-6 text-zinc-400">Connecting to the presenter’s runner… Readings and activity will appear when the connection is ready. You can <Link href="/#onchain-evidence" className="text-zinc-200 underline underline-offset-4">inspect a recorded run</Link> while you wait.</p>}
      {connection === "offline" && <div role="status" className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-4 text-sm leading-6 text-amber-200"><p className="font-medium">The live runner is unavailable. Reconnecting automatically.</p><p className="mt-1">{state ? "The values below are the last received snapshot, not current readings." : "No live snapshot has been received in this visit."} <Link href="/#onchain-evidence" className="underline underline-offset-4">Follow the recorded transactions</Link> or <Link href="/" className="underline underline-offset-4">inspect the current policy</Link>.</p></div>}
      {status.stateStatus === "stale" && <p role="status" className="rounded-xl border border-amber-800/60 p-4 text-sm text-amber-200">The runner’s last successful chain snapshot is stale. {status.lastStateAt ? `Received ${new Date(status.lastStateAt).toLocaleTimeString()}.` : ""} Current chain values remain available on the overview.</p>}
      {bridgeMode === "direct" && <p role="status" className="rounded-xl border border-amber-800/60 p-4 text-sm font-medium text-amber-200">The bridge is in direct fallback mode. Its current traffic is not anonymized.</p>}
      <Controls
        injected={injected}
        running={running}
        online={connection === "live"}
        onRun={() => post("/tick")}
        onInject={() => post(`/inject?on=${injected ? 0 : 1}`)}
        anonOn={anonOn}
        onTransport={() => post(`/transport?mode=${anonOn ? "leak" : "anon"}`)}
        agentAddress={status.agent}
      />
      {controlError && <p role="alert" className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{controlError}</p>}

      <section className="grid gap-4 sm:grid-cols-3">
        <Card title="Agent">
          {state ? (
            state.authorized && state.active ? (
              <div className={`text-2xl font-semibold ${currentState ? "text-emerald-400" : "text-zinc-400"}`}>{currentState ? "Authorized" : "Last seen: authorized"}</div>
            ) : (
              <div className={`text-2xl font-semibold ${currentState ? "text-red-400" : "text-zinc-400"}`}>{currentState ? "Trading blocked" : "Last seen: blocked"}</div>
            )
          ) : (
            <div className="text-2xl font-semibold text-zinc-500">{connection === "offline" ? "Unavailable" : "Awaiting snapshot"}</div>
          )}
          <div className="font-mono text-xs text-zinc-400">{k.name ?? ""}</div>
          <div className="text-xs text-zinc-500">Vault holds {state ? `${state.vaultToken0.toFixed(2)} kUSD / ${state.vaultToken1.toFixed(3)} kETH` : "…"}</div>
        </Card>
        <Card title="Spent today">
          <div className="text-2xl font-semibold">{state ? `${state.spentToday} / ${state.dailyCap} kUSD` : "…"}</div>
          <div className="mt-2 h-2 rounded bg-zinc-800">
            <div
              className="h-2 rounded bg-emerald-500 transition-all"
              style={{ width: state && state.dailyCap > 0 ? `${Math.min(100, (state.spentToday / state.dailyCap) * 100)}%` : "0%" }}
            />
          </div>
        </Card>
        <Card title="On-chain limits">
          <div className="text-sm text-zinc-300">
            {state ? `${state.maxPerSwap} kUSD per swap · ${state.dailyCap} / day · ${state.maxImpactBps / 100}% impact` : "…"}
          </div>
          <div className="text-xs text-zinc-500">read from ENS on every swap · enforced by the Uniswap v4 hook</div>
        </Card>
      </section>
      <p className="text-xs leading-5 text-zinc-500">{currentState ? `Latest chain snapshot${lastSnapshot ? `: ${lastSnapshot}` : ""}.` : state ? `Last received values${lastSnapshot ? `: ${lastSnapshot}` : ""}; waiting for a fresh chain snapshot.` : "The cards will show actual chain readings when the runner is ready."} Event times below refer to when each event occurred.</p>

      <Card title="Agent activity" right={<StatusDot status={connection} />}>
        <Activity entries={agent.entries} connection={connection} running={running} />
      </Card>

      <section className="grid gap-4 md:grid-cols-2">
        <Card title="Public-provider comparison log" right={<StatusDot status={proxy.status} />}>
          <Feed
            empty={proxy.status === "offline" ? "The comparison log is unavailable and will reconnect automatically. Recorded evidence remains available above." : proxy.status === "connecting" ? "Connecting to the comparison log…" : allowDemoControls ? "No calls have reached the comparison provider. Turn Anon-RPC off for the controlled leak comparison." : "No calls have reached the comparison provider in this session. The presenter controls the leak comparison; an empty log alone does not prove anonymity."}
            rows={proxy.entries.map((e) => ({
              t: time(e.t),
              main: `${String(e.ip)}  ${String(e.method)}`,
              sub: typeof e.detail === "object" && e.detail && "fn" in e.detail ? String((e.detail as { fn: string }).fn) : "",
              tone: "leak",
            }))}
          />
        </Card>
        <Card title={bridgeMode === "anon" ? "Anon-RPC bridge: Nox mixnet" : bridgeMode === "direct" ? "Bridge: direct fallback (not anonymous)" : "Bridge traffic · verifying route"} right={<StatusDot status={bridge.status} />}>
          <Feed
            empty={bridge.status === "offline" ? "Bridge traffic is unavailable. Its current route cannot be verified; the page reconnects automatically." : bridge.status === "connecting" ? "Connecting to the bridge traffic feed…" : allowDemoControls ? "No bridge traffic yet. Run the agent once to inspect its RPC activity." : "No bridge traffic has been received yet. This panel fills automatically when the presenter’s runner reads the chain."}
            rows={bridge.entries.map((e) => ({
              t: time(e.t),
              main: `→ ${String(e.transport ?? "route unknown")}  ${String(e.method)}`,
              sub: `${String(e.ms)} ms · ${String(e.transport)}`,
              tone: e.ok ? "safe" : "leak",
            }))}
          />
        </Card>
      </section>
    </div>
  );
}

function Walkthrough() {
  return (
    <section aria-label="How to follow the demonstration" className="grid gap-3 sm:grid-cols-3">
      {[
        ["01", "Normal trade", "Look for a confirmed swap within the ENS spending limits."],
        ["02", "Staged attack", "The poisoned news asks for too much. Inspect the hook’s revert and transaction link."],
        ["03", "Owner revocation", "The owner revokes the ENS role. The next small trade should be blocked."],
      ].map(([number, title, description]) => <article key={number} className="rounded-xl border border-zinc-800/80 bg-zinc-950 p-4"><p className="text-sm font-medium text-zinc-200"><span className="mr-2 font-mono text-xs text-emerald-400">{number}</span>{title}</p><p className="mt-2 text-xs leading-5 text-zinc-500">{description}</p></article>)}
    </section>
  );
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

  if (!allowDemoControls && !k.canManage) return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 p-4"><p className="text-xs leading-5 text-zinc-400">Trading and transport changes are presenter-controlled. Owner revocation requires the verified ENS owner’s wallet.</p><Link href="/freeze" className="text-xs font-medium text-zinc-200 underline underline-offset-4">Inspect owner revocation →</Link></div>;

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 p-4">
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
      <div className="ml-auto flex items-center gap-2">
        {k.error && <span className="text-xs text-red-400">{k.error.message.split("\n")[0]}</span>}
        {k.hash && <a className={`font-mono text-xs underline underline-offset-4 ${k.transactionFailed ? "text-red-300" : "text-zinc-400"}`} href={`https://sepolia.etherscan.io/tx/${k.hash}`} target="_blank" rel="noreferrer">{k.transactionFailed ? "Transaction reverted" : k.confirmed ? "Confirmed" : "Transaction submitted"} · {short(k.hash)} ↗</a>}
        <Link href="/freeze" className="text-xs text-zinc-500 underline">owner view</Link>
        <button
          onClick={frozen ? k.unfreeze : k.freeze}
          disabled={!k.canManage || k.isPending || k.authorized === undefined}
          title={k.canManage ? `Owner ${frozen ? "re-grants" : "revokes"} the agent (${k.via})` : "Only the verified ENS owner on Sepolia can change authority"}
          className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40 ${frozen ? "border border-zinc-600" : "bg-red-500 text-black"}`}
        >
          {k.isPending ? "Confirming…" : frozen ? "Unfreeze agent" : "Revoke agent (owner)"}
        </button>
      </div>
    </section>
  );
}

function Activity({ entries, connection, running }: { entries: Record<string, unknown>[]; connection: Connection; running: boolean }) {
  const rows = entries.filter((e) => ["decision", "swap", "error", "inject"].includes(String(e.type)));
  if (!rows.length) return <div className="space-y-3 text-sm leading-6 text-zinc-400"><p>{connection === "offline" ? "The activity feed is unavailable. This page will reconnect automatically." : connection === "connecting" ? "Connecting to the presenter’s activity feed…" : running ? "The agent is reading the chain. Its decision and transaction result will appear here." : allowDemoControls ? "No activity yet. Run the agent once to begin the demonstration." : "The runner is connected and awaiting the presenter. Decisions and transaction results will appear here automatically."}</p>{!allowDemoControls && <Link href="/#onchain-evidence" className="inline-block text-xs font-medium text-zinc-200 underline underline-offset-4">Follow the previous run onchain →</Link>}</div>;
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
              className={`flex items-center justify-between rounded-lg px-3 py-2 ${e.status === "success" ? "bg-emerald-950/50" : "bg-red-950/60"}`}
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
  if (!rows.length) return <p className="text-sm text-zinc-600">{empty}</p>;
  return (
    <ul className="max-h-72 space-y-1 overflow-y-auto font-mono text-xs">
      {rows.map((r, i) => (
        <li key={i} className={`rounded px-2 py-1 ${r.tone === "leak" ? "bg-red-950/40" : "bg-emerald-950/40"}`}>
          <span className="text-zinc-500">{r.t}</span> {r.main}
          {r.sub && <div className="pl-16 text-zinc-500">{r.sub}</div>}
        </li>
      ))}
    </ul>
  );
}
