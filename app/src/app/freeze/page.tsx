"use client";

import { useEffect } from "react";
import { useConnection } from "wagmi";
import { useKillSwitch } from "@/lib/killswitch";

// F7: the owner's phone. Open this page in your wallet's in-app browser and tap once.
export default function Freeze() {
  const { isConnected } = useConnection();
  const k = useKillSwitch();
  useEffect(() => {
    if (k.confirmed) k.refetch();
  }, [k.confirmed]); // eslint-disable-line react-hooks/exhaustive-deps

  const frozen = k.authorized === false;
  return (
    <div className="mx-auto max-w-sm space-y-6 pt-4 text-center">
      <div>
        <div className="text-sm text-zinc-500">Agent</div>
        <div className="font-mono text-lg">{k.name ?? "…"}</div>
      </div>
      <div className={`rounded-2xl py-6 text-3xl font-bold ${k.authorized === undefined ? "bg-zinc-900 text-zinc-500" : frozen ? "bg-red-950 text-red-300" : "bg-emerald-950 text-emerald-300"}`}>
        {k.authorized === undefined ? "…" : frozen ? "FROZEN" : "ACTIVE"}
      </div>

      {!isConnected ? (
        <p className="text-sm text-zinc-400">Connect the owner wallet (top right) to use the kill switch.</p>
      ) : frozen ? (
        <button onClick={k.unfreeze} disabled={k.isPending} className="w-full rounded-2xl border border-zinc-600 py-5 text-xl font-semibold disabled:opacity-40">
          {k.isPending ? "Confirming…" : "Unfreeze agent"}
        </button>
      ) : (
        <button onClick={k.freeze} disabled={k.isPending} className="w-full rounded-2xl bg-red-600 py-8 text-2xl font-bold text-white active:bg-red-700 disabled:opacity-40">
          {k.isPending ? "Freezing…" : "FREEZE AGENT"}
        </button>
      )}

      <p className="text-xs text-zinc-500">
        Uses {k.via}. Takes effect on the agent&apos;s very next swap. The agent can&apos;t stop it.
      </p>
      {k.hash && (
        <a className="block text-xs text-zinc-400 underline" href={`https://sepolia.etherscan.io/tx/${k.hash}`} target="_blank" rel="noreferrer">
          {k.confirmed ? "confirmed ✓" : "pending…"} {k.hash.slice(0, 10)}…
        </a>
      )}
      {k.error && <p className="text-xs text-red-400">{k.error.message.split("\n")[0]}</p>}
    </div>
  );
}
