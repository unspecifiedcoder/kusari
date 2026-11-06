"use client";

import { useEffect, useState } from "react";
import { AGENT_URL, ANON_BRIDGE, PROXY_URL, allowDemoControls } from "@/lib/endpoints";

type Entry = Record<string, unknown> & { t?: number };

/** Subscribes to a server-sent-events stream and keeps the latest entries. */
export function useEventStream(url: string, max = 25) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");

  useEffect(() => {
    if (!allowDemoControls) {
      const controller = new AbortController();
      let disposed = false;
      let busy = false;
      const kind = url === `${AGENT_URL}/events` ? "agent" : url === `${ANON_BRIDGE}/events` ? "bridge" : "proxy";
      const readUrl = kind === "agent" ? `${AGENT_URL}/status` : kind === "bridge" ? `${ANON_BRIDGE}/metrics` : `${PROXY_URL}/log`;
      const poll = async () => {
        if (busy) return;
        busy = true;
        try {
          const response = await fetch(readUrl, { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error("Feed unavailable");
          const data = await response.json();
          const list: unknown = kind === "agent" ? data.recentEvents : kind === "bridge" ? data.recent : data;
          if (!Array.isArray(list)) throw new Error("Invalid feed response");
          const next = list.filter((item): item is Entry => typeof item === "object" && item !== null && !item.hello).sort((a, b) => (b.t ?? 0) - (a.t ?? 0)).slice(0, max);
          if (!disposed) { setEntries(next); setStatus("live"); }
        } catch { if (!disposed) setStatus("offline"); }
        finally { busy = false; }
      };
      void poll();
      const interval = setInterval(() => void poll(), 5_000);
      return () => { disposed = true; controller.abort(); clearInterval(interval); };
    }
    const es = new EventSource(url);
    es.onopen = () => setStatus("live");
    es.onerror = () => setStatus("offline");
    es.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data) as Entry;
        if (e.hello) return;
        setEntries((prev) => [e, ...prev].slice(0, max));
      } catch { setStatus("offline"); }
    };
    return () => es.close();
  }, [url, max]);

  return { entries, status };
}

export function StatusDot({ status }: { status: string }) {
  const color = status === "live" ? "bg-emerald-400" : status === "offline" ? "bg-red-500" : "bg-amber-400";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {status}
    </span>
  );
}
