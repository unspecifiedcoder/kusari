"use client";

import { useEffect, useState } from "react";
import { readsViaAnonRpc } from "@/lib/endpoints";

/** Discloses where this page's chain reads go. Rendered after mount (depends on window.location). */
export function ReadRouteBadge() {
  const [anon, setAnon] = useState<boolean | null>(null);
  useEffect(() => setAnon(readsViaAnonRpc), []);
  if (anon === null) return null;
  return anon ? (
    <span className="text-xs text-emerald-400" title="This page's reads go through the local Anon-RPC bridge (Nox mixnet)">
      reads: Anon-RPC (Nox)
    </span>
  ) : (
    <span className="text-xs text-amber-400" title="Hosted preview: no Anon-RPC bridge here, so reads use a public Sepolia RPC">
      reads: public RPC (hosted preview)
    </span>
  );
}
