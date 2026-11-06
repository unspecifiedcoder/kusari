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
  const [controlError, setControlError] = useState<string | null>(null);
  const k = useKillSwitch();

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      void fetch(`${AGENT}/status`, { cache: "no-store", signal: controller.signal }).then((r) => { if (!r.ok) throw new Error("Runner unavailable"); return r.json(); }).then(setStatus).catch(() => {});
      void fetch(`${ANON_BRIDGE}/metrics`, { cache: "no-store", signal: controller.signal }).then((r) => { if (!r.ok) throw new Error("Bridge unavailable"); return r.json(); }).then((metrics) => setBridgeMode(metrics.mode ?? null)).catch(() => setBridgeMode(null));
    };
    void refresh();
    const interval = setInterval(refresh, 5_000);
    return () => { controller.abort(); clearInterval(interval); };
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

  const post = async (path: string) => {
    if (!allowDemoControls) return;
    setControlError(null);
    try { const r = await fetch(`${AGENT}${path}`, { method: "POST" }); if (!r.ok) throw new Error(r.status === 409 ? "A cycle is already running. Wait for it to finish." : "The runner did not accept this action."); }
    catch (error) { setControlError(error instanceof Error ? error.message : "Action failed"); }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3"><p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Live demonstration · Sepolia</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Watch the boundary hold.</h1><p className="max-w-3xl text-sm leading-6 text-zinc-400">Follow a normal trade, an intentionally poisoned news feed, and owner revocation. The attack is staged: the agent prompt is deliberately gullible. Contract enforcement is real.</p></section>
      {agent.status === "offline" && <div role="status" className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-4 text-sm leading-6 text-amber-200">The live runner is disconnected. Panels retain the last received state; they are not current readings. <Link href="/#onchain-evidence" className="underline underline-offset-4">Verify the recorded run</Link> or <Link href="/" className="underline underline-offset-4">inspect the contracts</Link>.</div>}
      {!allowDemoControls && <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm leading-6 text-zinc-400"><span className="font-medium text-zinc-200">Public observation mode.</span> The presenter operates the shared testnet agent. Its live state and event streams appear below; trading and transport controls are restricted to the presenter’s local machine.</div>}
      {status.stateStatus === "stale" && <p role="status" className="rounded-xl border border-amber-800/60 p-4 text-sm text-amber-200">The runner’s last successful chain snapshot is stale. {status.lastStateAt ? `Received ${new Date(status.lastStateAt).toLocaleTimeString()}.` : ""} Current chain values remain available on the overview.</p>}
      {bridgeMode === "direct" && <p role="status" className="rounded-xl border border-amber-800/60 p-4 text-sm font-medium text-amber-200">The bridge is in direct fallback mode. Its current traffic is not anonymized.</p>}
      <Controls
        injected={injected}
        running={running}
        online={agent.status === "live"}
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
              <div className="text-2xl font-semibold text-emerald-400">Active</div>
            ) : (
              <div className="text-2xl font-semibold text-red-400">Frozen</div>
            )
          ) : (
            <div className="text-2xl font-semibold text-zinc-500">…</div>
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

      <Card title="Agent activity" right={<StatusDot status={agent.status} />}>
        <Activity entries={agent.entries} />
      </Card>

      <section className="grid gap-4 md:grid-cols-2">
        <Card title="Anon-RPC OFF: the RPC provider's log" right={<StatusDot status={proxy.status} />}>
          <Feed
            empty="Empty: with Anon-RPC on, the agent sends this provider nothing. Turn Anon-RPC OFF to see what a provider learns."
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
            empty="No traffic yet. Press “Run agent once”."
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
        {k.hash && <span className="font-mono text-xs text-zinc-400">{k.confirmed ? "✓" : "…"} {short(k.hash)}</span>}
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

function Activity({ entries }: { entries: Record<string, unknown>[] }) {
  const rows = entries.filter((e) => ["decision", "swap", "error", "inject"].includes(String(e.type)));
  if (!rows.length) return <p className="text-sm text-zinc-600">No activity yet. Press “Run agent once”.</p>;
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
