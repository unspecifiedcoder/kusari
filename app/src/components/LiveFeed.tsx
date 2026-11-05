"use client";

import { useEffect, useState } from "react";

type Entry = Record<string, unknown> & { t?: number };

/** Subscribes to a server-sent-events stream and keeps the latest entries. */
export function useEventStream(url: string, max = 25) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");

  useEffect(() => {
    const es = new EventSource(url);
    es.onopen = () => setStatus("live");
    es.onerror = () => setStatus("offline");
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as Entry;
      if (e.hello) return;
      setEntries((prev) => [e, ...prev].slice(0, max));
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
