"use client";

import { useSyncExternalStore } from "react";
import { readsViaAnonRpc } from "@/lib/endpoints";

/** Discloses where this page's chain reads go. Rendered after mount (depends on window.location). */
export function ReadRouteBadge() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (!mounted) return <span className="text-xs text-zinc-500">Sepolia testnet</span>;
  return readsViaAnonRpc ? (
    <span className="text-xs text-zinc-400" title="Independent contract reads use the local bridge. See the live snapshot panel for its verified transport mode.">
      reader: local bridge
    </span>
  ) : (
    <span className="text-xs text-zinc-500" title="When a fresh presenter snapshot is unavailable, independent contract reads use public Sepolia RPC. The policy panel labels its actual data source.">
      fallback reader: public RPC
    </span>
  );
}

const subscribe = () => () => {};
