"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useConnection } from "wagmi";
import { useKillSwitch } from "@/lib/killswitch";

export default function Freeze() {
  const { isConnected } = useConnection();
  const k = useKillSwitch();
  const { confirmed, refetch } = k;
  useEffect(() => { if (confirmed) void refetch(); }, [confirmed, refetch]);
  const frozen = k.authorized === false;

  return (
    <div className="mx-auto max-w-2xl space-y-7">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Owner authority</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">One role. A hard stop.</h1><p className="mt-4 text-sm leading-6 text-zinc-400">The configured agent’s authorization is public. Only its verified name owner can revoke or restore that authority. Revocation blocks future swaps after the transaction confirms.</p></div>
      <section className="overflow-hidden rounded-2xl border border-zinc-800">
        <div className="border-b border-zinc-800 bg-zinc-900/30 p-6"><p className="text-xs text-zinc-500">Demonstration agent</p><h2 className="mt-2 break-all font-mono text-lg">{k.name ?? "Identity unavailable"}</h2></div>
        <div className="space-y-6 p-6">
          <div className={`rounded-xl p-5 text-center ${k.authorized === undefined || k.statusError ? "bg-zinc-900 text-zinc-500" : frozen ? "bg-red-950/60 text-red-300" : "bg-emerald-950/60 text-emerald-300"}`}><div className="text-xs uppercase tracking-widest">Onchain authorization</div><div className="mt-2 text-3xl font-semibold">{k.statusError ? "Unavailable" : k.authorized === undefined ? "Checking…" : frozen ? "Revoked" : "Authorized"}</div></div>
          <div className="space-y-2 text-sm"><p className="text-xs text-zinc-500">Name owner, read from the registry</p>{k.owner ? <a href={`https://sepolia.etherscan.io/address/${k.owner}`} target="_blank" rel="noreferrer" className="block break-all font-mono text-xs text-zinc-300 underline underline-offset-4">{k.owner} ↗</a> : <p className="text-zinc-500">{k.ownerError ? "Owner lookup unavailable. Controls stay disabled." : "Reading the registry…"}</p>}</div>
          {!isConnected ? <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm leading-6 text-zinc-400">You’re viewing public status. Connect the owner wallet in the header to manage this agent.</p> : !k.isOwner ? <p className="rounded-xl border border-zinc-800 p-4 text-sm leading-6 text-zinc-400">This wallet is in read-only mode. Management is reserved for the name owner shown above.</p> : !k.correctChain ? <p className="rounded-xl border border-amber-800 p-4 text-sm text-amber-200">Switch the connected wallet to Sepolia to continue.</p> : <button type="button" onClick={frozen ? k.unfreeze : k.freeze} disabled={!k.canManage || k.isPending || k.authorized === undefined || Boolean(k.statusError)} className={`w-full rounded-xl px-5 py-5 text-lg font-semibold disabled:opacity-40 ${frozen ? "border border-zinc-600 text-zinc-200 hover:border-zinc-400" : "bg-red-500 text-zinc-950 hover:bg-red-400"}`}>{k.isPending ? "Waiting for confirmation…" : frozen ? "Restore agent authorization" : "Revoke agent authorization"}</button>}
          <p className="text-xs leading-5 text-zinc-500">Uses {k.via}. This does not withdraw funds or undo a completed trade. The agent has no permission to grant itself this role.</p>
          {k.hash && <a className="block break-all font-mono text-xs text-zinc-300 underline underline-offset-4" href={`https://sepolia.etherscan.io/tx/${k.hash}`} target="_blank" rel="noreferrer">{k.transactionFailed ? "Transaction reverted" : k.confirmed ? "Confirmed" : "Transaction submitted"} · {k.hash} ↗</a>}
          {(k.error || k.statusError) && <p role="alert" className="text-sm text-red-300">{(k.error ?? k.statusError)?.message.split("\n")[0]}</p>}
        </div>
      </section>
      <div className="flex flex-wrap justify-between gap-3 text-xs text-zinc-400"><Link href="/" className="hover:text-white">← Back to the overview</Link><Link href="/setup" className="text-zinc-500 hover:text-zinc-300">Advanced testnet vault tools →</Link></div>
    </div>
  );
}
