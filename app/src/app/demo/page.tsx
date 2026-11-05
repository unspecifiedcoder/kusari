"use client";

import { useEventStream, StatusDot } from "@/components/LiveFeed";
import { revertReasons } from "@/generated/types";

const PROXY_EVENTS = process.env.NEXT_PUBLIC_PROXY_EVENTS ?? "http://localhost:8547/events";
const BRIDGE_EVENTS = process.env.NEXT_PUBLIC_BRIDGE_EVENTS ?? "http://localhost:8546/events";

// E2: sample data until the agent's event stream (D4) is wired in E4.
const SAMPLE_TXS = [
  { kind: "ok", text: "Swapped 1.0 kUSD → 0.99 kETH", detail: "within cap" },
  { kind: "blocked", text: "Tried to swap 100 kUSD", detail: revertReasons.ExceedsPerSwap },
  { kind: "blocked", text: "Tried to swap 0.5 kUSD", detail: revertReasons.NotAuthorized },
];

const time = (t?: number) => (t ? new Date(t).toLocaleTimeString() : "");

export default function Demo() {
  const proxy = useEventStream(PROXY_EVENTS);
  const bridge = useEventStream(BRIDGE_EVENTS);

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-3">
        <Card title="Agent">
          <div className="text-2xl font-semibold text-emerald-400">Active</div>
          <div className="text-xs text-zinc-500">alpha.&lt;name&gt;.eth · sample data</div>
        </Card>
        <Card title="Today">
          <div className="text-2xl font-semibold">1 / 20 kUSD</div>
          <div className="mt-2 h-2 rounded bg-zinc-800">
            <div className="h-2 w-[5%] rounded bg-emerald-500" />
          </div>
        </Card>
        <Card title="Limits">
          <div className="text-sm text-zinc-300">5 kUSD per swap · 20 / day · 2% impact</div>
          <div className="text-xs text-zinc-500">read from ENS (sample data)</div>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card title="What a public RPC provider sees" right={<StatusDot status={proxy.status} />}>
          <Feed
            empty="No requests yet. Point the agent at :8547."
            rows={proxy.entries.map((e) => ({
              t: time(e.t),
              main: `${String(e.ip)}  ${String(e.method)}`,
              sub: typeof e.detail === "object" && e.detail && "fn" in e.detail ? String((e.detail as { fn: string }).fn) : "",
              tone: "leak",
            }))}
          />
        </Card>
        <Card title="With Anon-RPC (Nox mixnet)" right={<StatusDot status={bridge.status} />}>
          <Feed
            empty="No requests yet. Point the agent at :8546."
            rows={bridge.entries.map((e) => ({
              t: time(e.t),
              main: `mixnet exit  ${String(e.method)}`,
              sub: `${String(e.ms)} ms · ${String(e.transport)}`,
              tone: e.ok ? "safe" : "leak",
            }))}
          />
        </Card>
      </section>

      <Card title="Agent activity (sample data)">
        <ul className="space-y-2 text-sm">
          {SAMPLE_TXS.map((tx, i) => (
            <li key={i} className="flex items-center justify-between rounded-lg bg-zinc-900 px-3 py-2">
              <span>{tx.text}</span>
              <span className={tx.kind === "ok" ? "text-emerald-400" : "text-red-400"}>{tx.detail}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
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
