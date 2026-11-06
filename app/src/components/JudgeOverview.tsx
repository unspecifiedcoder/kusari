"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { useReadContracts } from "wagmi";
import { deployment, ensDeployment } from "@/generated/deployment";
import { policyHookReadAbi, policySourceAbi, tokenAbi, vaultAbi } from "@/lib/abi";
import { AGENT_URL, ANON_BRIDGE, isLocalDemo } from "@/lib/endpoints";

type Policy = { maxPerSwap: bigint; dailyCap: bigint; maxImpactBps: number; allowedPool: string; active: boolean };
type Snapshot = { authorized: boolean; active: boolean; maxPerSwap: number; dailyCap: number; spentToday: number; vaultToken0: number; vaultToken1: number; maxImpactBps: number };
type Runner = { online: boolean; transport?: string; readTransport?: string; bridgeMode?: string; scriptedOnly?: boolean; busy?: boolean; agent?: string; vault?: string; lastState?: Snapshot | null; lastStateAt?: number; stateStatus?: string };
const explorer = "https://sepolia.etherscan.io";
const short = (address: string) => `${address.slice(0, 8)}…${address.slice(-6)}`;
const format = (value: bigint | undefined, decimals: number | undefined) => value === undefined || decimals === undefined ? "—" : Number(formatUnits(value, decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 });

export function JudgeOverview() {
  const agent = ensDeployment.agent as Address;
  const [runner, setRunner] = useState<Runner | null>(null);
  const [observedAt, setObservedAt] = useState<number | null>(null);
  const snapshot = runner?.lastState;
  const expectedIdentity = runner?.agent?.toLowerCase() === agent.toLowerCase() && runner?.vault?.toLowerCase() === deployment.demoVault.toLowerCase();
  const snapshotValid = snapshot && typeof snapshot.authorized === "boolean" && typeof snapshot.active === "boolean" && [snapshot.maxPerSwap, snapshot.dailyCap, snapshot.spentToday, snapshot.vaultToken0, snapshot.vaultToken1, snapshot.maxImpactBps].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const snapshotFresh = Boolean(runner?.online && expectedIdentity && snapshotValid && runner.stateStatus === "fresh" && runner.lastStateAt && observedAt && observedAt - runner.lastStateAt < 60_000);
  const readerReady = runner !== null && observedAt !== null;
  const day = BigInt(Math.floor((observedAt ?? 0) / 86_400_000));
  const chain = useReadContracts({
    contracts: [
      { chainId: deployment.chainId, address: deployment.policySource, abi: policySourceAbi, functionName: "isAuthorized", args: [agent] },
      { chainId: deployment.chainId, address: deployment.policySource, abi: policySourceAbi, functionName: "policyOf", args: [agent] },
      { chainId: deployment.chainId, address: deployment.policyHook, abi: policyHookReadAbi, functionName: "spentOn", args: [agent, day] },
      { chainId: deployment.chainId, address: deployment.token0, abi: tokenAbi, functionName: "balanceOf", args: [deployment.demoVault] },
      { chainId: deployment.chainId, address: deployment.token1, abi: tokenAbi, functionName: "balanceOf", args: [deployment.demoVault] },
      { chainId: deployment.chainId, address: deployment.token0, abi: tokenAbi, functionName: "decimals" },
      { chainId: deployment.chainId, address: deployment.token1, abi: tokenAbi, functionName: "decimals" },
      { chainId: deployment.chainId, address: deployment.demoVault, abi: vaultAbi, functionName: "owner" },
    ],
    query: { enabled: readerReady && !snapshotFresh, refetchInterval: snapshotFresh ? false : 12_000, retry: 1 },
  });
  const authorized = chain.data?.[0].result as boolean | undefined;
  const policy = chain.data?.[1].result as Policy | undefined;
  const spent = chain.data?.[2].result as bigint | undefined;
  const balance0 = chain.data?.[3].result as bigint | undefined;
  const balance1 = chain.data?.[4].result as bigint | undefined;
  const decimals0 = chain.data?.[5].result as number | undefined;
  const decimals1 = chain.data?.[6].result as number | undefined;
  const owner = chain.data?.[7].result as Address | undefined;
  const directReady = authorized !== undefined && policy !== undefined && spent !== undefined;
  const ready = snapshotFresh || directReady;
  const failed = !snapshotFresh && (Boolean(chain.error) || Boolean(chain.data && !directReady));
  const active = snapshotFresh && snapshot ? snapshot.authorized && snapshot.active : directReady && authorized && policy.active;
  const remaining = policy && spent !== undefined ? policy.dailyCap > spent ? policy.dailyCap - spent : 0n : undefined;
  const spentPct = policy?.dailyCap && spent !== undefined ? Math.min(100, Number(spent * 100n / policy.dailyCap)) : 0;
  const snapshotRemaining = snapshot ? Math.max(0, snapshot.dailyCap - snapshot.spentToday) : 0;
  const numberFormat = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const viaAnon = snapshotFresh && runner?.readTransport === "anon" && runner?.bridgeMode === "anon";
  const valueMax = snapshotFresh && snapshot ? numberFormat(snapshot.maxPerSwap) : format(policy?.maxPerSwap, decimals0);
  const valueRemaining = snapshotFresh ? numberFormat(snapshotRemaining) : format(remaining, decimals0);
  const valueImpact = snapshotFresh && snapshot ? String(snapshot.maxImpactBps / 100) : policy ? String(policy.maxImpactBps / 100) : "—";
  const valueBalance0 = snapshotFresh && snapshot ? numberFormat(snapshot.vaultToken0) : format(balance0, decimals0);
  const valueBalance1 = snapshotFresh && snapshot ? numberFormat(snapshot.vaultToken1) : format(balance1, decimals1);
  const valueProgress = snapshotFresh && snapshot ? snapshot.dailyCap > 0 ? Math.min(100, snapshot.spentToday / snapshot.dailyCap * 100) : 0 : spentPct;
  const budgetDetail = snapshotFresh && snapshot ? `${numberFormat(snapshot.spentToday)} of ${numberFormat(snapshot.dailyCap)} spent · resets 00:00 UTC` : policy ? `${format(spent, decimals0)} of ${format(policy.dailyCap, decimals0)} spent · resets 00:00 UTC` : "Waiting for the policy and spending counter";

  useEffect(() => {
    let disposed = false;
    let busy = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        if (!AGENT_URL) throw new Error("Runner not configured");
        const response = await fetch(`${AGENT_URL}/status`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok) throw new Error("Runner unavailable");
        const value = await response.json();
        let bridgeMode: string | undefined = value.bridgeMode;
        try { const bridgeResponse = await fetch(`${ANON_BRIDGE}/metrics`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]) }); if (bridgeResponse.ok) bridgeMode = (await bridgeResponse.json()).mode; } catch { /* An unavailable bridge never receives an anonymity label. */ }
        if (!disposed) setRunner({ online: true, transport: value.transport, readTransport: value.readTransport, bridgeMode, scriptedOnly: value.scriptedOnly, busy: value.busy, agent: value.agent, vault: value.vault, lastState: value.lastState, lastStateAt: value.lastStateAt, stateStatus: value.stateStatus });
      } catch { if (!disposed) setRunner({ online: false }); }
      finally { busy = false; if (!disposed) setObservedAt(Date.now()); }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 5_000);
    return () => { disposed = true; controller.abort(); clearInterval(interval); };
  }, []);

  return (
    <section aria-labelledby="live-policy" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Inspect, without connecting</p><h2 id="live-policy" className="mt-2 text-2xl font-semibold tracking-tight">The policy lives on ENS.</h2></div>
        <div className="flex flex-wrap items-center gap-3 text-xs"><span className={`inline-flex items-center gap-2 ${failed ? "text-amber-300" : ready ? "text-emerald-400" : "text-zinc-500"}`}><span className={`h-1.5 w-1.5 rounded-full ${failed ? "bg-amber-400" : ready ? "bg-emerald-400" : "bg-zinc-500"}`} />{failed ? "Chain read unavailable" : snapshotFresh ? viaAnon ? "Live snapshot · Nox mixnet" : "Live snapshot · route not anonymous/verified" : ready ? isLocalDemo ? "Live chain reads · local bridge" : "Live chain reads · public RPC fallback" : "Reading Sepolia…"}</span>{!snapshotFresh && readerReady && <button type="button" onClick={() => void chain.refetch()} disabled={chain.isFetching} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-zinc-300 disabled:opacity-40">{chain.isFetching ? "Refreshing…" : "Refresh"}</button>}</div>
      </div>
      {failed && <p role="status" className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-4 text-sm leading-6 text-amber-200">The chain reader could not refresh the policy. Any previous readings remain visible below; verify the contracts or retry. No authorization state is inferred from a failed request.</p>}
      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/25">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 px-5 py-5 sm:px-6">
          <div><p className="text-xs text-zinc-500">Configured demonstration identity</p><p className="mt-1 break-all font-mono text-lg text-zinc-100">{ensDeployment.name}</p></div>
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${!ready || failed ? "border-zinc-700 text-zinc-400" : active ? "border-emerald-700/60 bg-emerald-950/50 text-emerald-300" : "border-red-800 bg-red-950/40 text-red-300"}`}>{failed ? "Status unavailable" : !ready ? "Checking policy" : active ? "Authorized & active" : "Trading blocked"}</span>
        </div>
        <div className="grid gap-px bg-zinc-800 sm:grid-cols-3">
          <Metric label="Per-swap limit" value={valueMax} unit="kUSD" detail="Read from the ENS policy record" />
          <Metric label="Remaining today" value={valueRemaining} unit="kUSD" detail={budgetDetail} progress={valueProgress} />
          <Metric label="Maximum pool impact" value={valueImpact} unit="%" detail="Checked against the actual pool-price movement" />
        </div>
        <div className="grid gap-5 px-5 py-5 text-sm sm:grid-cols-2 sm:px-6">
          <div><p className="text-xs text-zinc-500">Funds inside the demonstration vault</p><p className="mt-2 font-mono text-zinc-200">{valueBalance0} kUSD <span className="mx-2 text-zinc-600">/</span> {valueBalance1} kETH</p></div>
          <div><p className="text-xs text-zinc-500">Agent runner</p><p className={`mt-2 ${runner?.online ? "text-emerald-300" : "text-zinc-400"}`}>{runner === null ? "Checking connection…" : runner.online ? `${runner.busy ? "Running a cycle" : "Connected · awaiting presenter"}${runner.scriptedOnly ? " · scripted mode" : ""}` : "Offline · onchain inspection is still available"}</p></div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-zinc-800 px-5 py-4 font-mono text-xs text-zinc-400 sm:px-6">
          <ContractLink label="Vault" address={deployment.demoVault} /><ContractLink label="Policy source" address={deployment.policySource} /><ContractLink label="Hook" address={deployment.policyHook} />{owner && <ContractLink label="Vault owner" address={owner} />}
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-3 text-xs leading-5 text-zinc-500"><p>{snapshotFresh && runner?.lastStateAt ? `Chain snapshot: ${new Date(runner.lastStateAt).toLocaleTimeString()}. Updated via the presenter gateway; no duplicate public-RPC policy polling.` : directReady && chain.dataUpdatedAt ? `Last policy response: ${new Date(chain.dataUpdatedAt).toLocaleTimeString()}. ${isLocalDemo ? "Local bridge reads." : "Public-RPC fallback because a fresh runner snapshot is unavailable."}` : "Values above are queried from the deployed contracts, not sample balances."}</p><Link href="/freeze" className="text-zinc-300 hover:text-white">Inspect owner revocation <span aria-hidden="true">→</span></Link></div>
    </section>
  );
}

function Metric({ label, value, unit, detail, progress }: { label: string; value: string; unit: string; detail: string; progress?: number }) {
  return <div className="bg-zinc-950 p-5 sm:p-6"><p className="text-xs text-zinc-400">{label}</p><p className="mt-3 font-mono text-3xl tracking-tight text-zinc-100">{value}<span className="ml-2 text-sm text-zinc-500">{unit}</span></p>{progress !== undefined && <div aria-label="Daily budget used" className="mt-3 h-1 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-emerald-400" style={{ width: `${progress}%` }} /></div>}<p className="mt-3 text-xs leading-5 text-zinc-500">{detail}</p></div>;
}

function ContractLink({ label, address }: { label: string; address: string }) {
  return <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" className="break-all hover:text-emerald-300" title={address}>{label} {short(address)} ↗</a>;
}
