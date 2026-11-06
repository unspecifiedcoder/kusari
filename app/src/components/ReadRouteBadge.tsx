"use client";

import { useSyncExternalStore } from "react";
import { readsViaAnonRpc } from "@/lib/endpoints";
import { Dot } from "@/components/ui";

const noop = () => () => {};

/** Discloses where this page's chain reads go. Rendered after mount (depends on window.location). */
export function ReadRouteBadge() {
  const anon = useSyncExternalStore(noop, () => readsViaAnonRpc, () => null);
  if (anon === null) return null;
  return (
    <span
      className="inline-flex items-center gap-2 text-xs text-muted"
      title={
        anon
          ? "This page's reads go through the local Anon-RPC bridge (Nox mixnet)"
          : "Hosted preview: no Anon-RPC bridge here, so reads use a public Sepolia RPC"
      }
    >
      <Dot tone={anon ? "safe" : "warn"} />
      {anon ? "Private reads (Anon-RPC)" : "Reads via public RPC"}
    </span>
  );
}
