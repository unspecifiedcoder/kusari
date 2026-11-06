"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection } from "wagmi";
import { useEventStream, StatusDot } from "@/components/LiveFeed";
import { useKillSwitch } from "@/lib/killswitch";
import { AGENT_URL, ANON_BRIDGE, PROXY_URL } from "@/lib/endpoints";
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return AGENT ? <LiveDemo /> : <HostedNotice />;
}

function LiveDemo() {
  const proxy = useEventStream(PROXY_EVENTS);
  const bridge = useEventStream(BRIDGE_EVENTS);
  const agent = useEventStream(`${AGENT}/events`, 40);
  const [status, setStatus] = useState<{ agent?: string; injected?: boolean; transport?: string; lastState?: AgentState | null }>({});
  const k = useKillSwitch();

  useEffect(() => {
    fetch(`${AGENT}/status`)
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  const latest = useMemo(() => agent.entries.find((e) => e.type === "state") as unknown as AgentState | undefined, [agent.entries]);
  const state = latest ?? status.lastState ?? undefined;
  const injectEvent = agent.entries.find((e) => e.type === "inject");
  const injected = injectEvent ? Boolean(injectEvent.injected) : Boolean(status.injected);
  const transportEvent = agent.entries.find((e) => e.type === "transport");
  const anonOn = (transportEvent ? String(transportEvent.transport) : (status.transport ?? "anon")) === "anon";
  // Busy from "reading" until "idle". Live Sepolia cycles take ~20s (mixnet reads + tx confirmation).
  const lastCycleEvent = agent.entries.find((e) => e.type === "reading" || e.type === "idle");
  const running = lastCycleEvent?.type === "reading";

  const post = (path: string) => fetch(`${AGENT}${path}`, { method: "POST" }).catch(() => {});

  return (
    <div className="space-y-8">
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
              style={{ width: state ? `${Math.min(100, (state.spentToday / state.dailyCap) * 100)}%` : "0%" }}
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
        <Card title="Anon-RPC ON: what leaves this machine (Nox mixnet only)" right={<StatusDot status={bridge.status} />}>
          <Feed
            empty="No traffic yet. Press “Run agent once”."
            rows={bridge.entries.map((e) => ({
              t: time(e.t),
              main: `→ mixnet  ${String(e.method)}`,
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
  const { isConnected } = useConnection();
  const k = useKillSwitch();
  const frozen = k.authorized === false;

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 p-4">
      <button
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
      <div className="ml-auto flex items-center gap-2">
        {k.error && <span className="text-xs text-red-400">{k.error.message.split("\n")[0]}</span>}
        {k.hash && <span className="font-mono text-xs text-zinc-400">{k.confirmed ? "✓" : "…"} {short(k.hash)}</span>}
        <a href="/freeze" className="text-xs text-zinc-500 underline">phone view</a>
        <button
          onClick={frozen ? k.unfreeze : k.freeze}
          disabled={!isConnected || k.isPending || !k.agent}
          title={isConnected ? `Owner ${frozen ? "re-grants" : "revokes"} the agent (${k.via})` : "Connect the owner wallet first"}
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
                {e.status === "success" ? `✅ swapped ${String(e.amountIn)} kUSD` : `🛡️ ${String(e.amountIn)} kUSD swap reverted on-chain`}
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
