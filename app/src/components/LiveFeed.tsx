"use client";

import { useEffect, useState } from "react";
import { Dot } from "@/components/ui";

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
  const tone = status === "live" ? "safe" : status === "offline" ? "danger" : "warn";
  const label = status === "live" ? "Live" : status === "offline" ? "Offline" : "Connecting";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted">
      <Dot tone={tone} live={status === "live"} />
      {label}
    </span>
  );
}
