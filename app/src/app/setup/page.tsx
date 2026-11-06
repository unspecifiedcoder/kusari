"use client";

import Link from "next/link";
import { useConnection } from "wagmi";
import { VaultSetup } from "@/components/VaultSetup";

export default function Setup() {
  const { isConnected } = useConnection();
  return <div className="space-y-7"><div><p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Advanced testnet tools</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">Vault development tools</h1><p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">This tool creates and funds Sepolia test vaults. It does not provision an ENS policy or connect a new agent runner. The complete demonstration uses the configured agent and vault shown on the overview.</p><Link href="/" className="mt-4 inline-block text-sm text-emerald-300">Return to the complete demonstration →</Link></div>{isConnected ? <VaultSetup /> : <div className="rounded-xl border border-zinc-800 p-5 text-sm text-zinc-400">Connect a Sepolia wallet to use these development tools.</div>}</div>;
}
