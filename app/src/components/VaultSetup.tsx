"use client";

import { useEffect, useState } from "react";
import { isAddress, parseEther, formatEther, type Address } from "viem";
import { useConnection, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { deployment, sepoliaConfig } from "@/generated/deployment";
import { factoryAbi, vaultAbi, tokenAbi } from "@/lib/abi";

const explorer = (sepoliaConfig as { explorer?: string }).explorer ?? "https://sepolia.etherscan.io";

/** F2 + F5: create a vault for an agent, fund it, withdraw from it. */
export function VaultSetup() {
  const { address } = useConnection();
  const vaults = useReadContract({
    address: deployment?.vaultFactory,
    abi: factoryAbi,
    functionName: "vaultsOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && deployment) },
  });

  if (!deployment) return <p className="text-zinc-500">Kusari isn&apos;t deployed on this network yet.</p>;
  const list = (vaults.data ?? []) as readonly Address[];

  return (
    <div className="space-y-6">
      <CreateVault onCreated={vaults.refetch} />
      {list.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-400">Your vaults</h2>
          {list.map((v) => (
            <VaultCard key={v} vault={v} owner={address!} />
          ))}
        </section>
      )}
    </div>
  );
}

function TxStatus({ hash }: { hash?: `0x${string}` }) {
  const r = useWaitForTransactionReceipt({ hash });
  if (!hash) return null;
  return (
    <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer" className="text-xs text-zinc-400 underline">
      {r.isLoading ? "pending…" : r.data?.status === "success" ? "confirmed ✓" : r.data ? "failed ✗" : "sent"} ({hash.slice(0, 10)}…)
    </a>
  );
}

function CreateVault({ onCreated }: { onCreated: () => void }) {
  const [agent, setAgent] = useState("");
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  useEffect(() => {
    if (receipt.isSuccess) onCreated();
  }, [receipt.isSuccess, onCreated]);
  const valid = isAddress(agent);

  return (
    <section className="rounded-xl border border-zinc-800 p-5">
      <div className="text-xs text-zinc-500">Step 1</div>
      <h2 className="pt-1 font-medium">Create a vault for your agent</h2>
      <p className="pt-1 text-sm text-zinc-400">
        The agent&apos;s key can only ask this vault to swap through Kusari-guarded pools. You stay the owner: only you can
        withdraw.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={agent}
          onChange={(e) => setAgent(e.target.value.trim())}
          placeholder="Agent address 0x…"
          className="min-w-80 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm"
        />
        <button
          disabled={!valid || isPending}
          onClick={() => writeContract({ address: deployment!.vaultFactory, abi: factoryAbi, functionName: "create", args: [agent as Address] })}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {isPending ? "Confirm in wallet…" : "Create vault"}
        </button>
      </div>
      <div className="pt-2">
        {agent && !valid && <span className="text-xs text-red-400">That isn&apos;t a valid address.</span>}
        {error && <span className="text-xs text-red-400">{error.message.split("\n")[0]}</span>}
        <TxStatus hash={hash} />
      </div>
    </section>
  );
}

function VaultCard({ vault, owner }: { vault: Address; owner: Address }) {
  const t0 = deployment!.token0;
  const t1 = deployment!.token1;
  const reads = useReadContracts({
    contracts: [
      { address: vault, abi: vaultAbi, functionName: "agent" },
      { address: t0, abi: tokenAbi, functionName: "balanceOf", args: [vault] },
      { address: t1, abi: tokenAbi, functionName: "balanceOf", args: [vault] },
      { address: t0, abi: tokenAbi, functionName: "balanceOf", args: [owner] },
    ],
    query: { refetchInterval: 5000 },
  });
  const [agent, v0, v1, mine] = (reads.data ?? []).map((r) => r.result) as [Address?, bigint?, bigint?, bigint?];
  const [amount, setAmount] = useState("10");
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  let wei = 0n;
  try {
    wei = parseEther(amount || "0");
  } catch {}

  const fmt = (x?: bigint) => (x === undefined ? "…" : Number(formatEther(x)).toLocaleString(undefined, { maximumFractionDigits: 4 }));

  return (
    <div className="rounded-xl border border-zinc-800 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <a href={`${explorer}/address/${vault}`} target="_blank" rel="noreferrer" className="font-mono text-sm underline">
          {vault}
        </a>
        <span className="text-xs text-zinc-500">agent {agent ? `${agent.slice(0, 6)}…${agent.slice(-4)}` : "…"}</span>
      </div>
      <div className="grid grid-cols-3 gap-3 pt-3 text-sm">
        <Stat label="Vault kUSD" value={fmt(v0)} />
        <Stat label="Vault kETH" value={fmt(v1)} />
        <Stat label="Your kUSD" value={fmt(mine)} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-28 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          inputMode="decimal"
        />
        <span className="text-sm text-zinc-500">kUSD</span>
        <Btn disabled={isPending} onClick={() => writeContract({ address: t0, abi: tokenAbi, functionName: "mint", args: [owner, wei] })}>
          Get test kUSD
        </Btn>
        <Btn
          disabled={isPending || !wei || (mine ?? 0n) < wei}
          onClick={() => writeContract({ address: t0, abi: tokenAbi, functionName: "transfer", args: [vault, wei] })}
        >
          Deposit
        </Btn>
        <Btn
          disabled={isPending || !wei || (v0 ?? 0n) < wei}
          onClick={() => writeContract({ address: vault, abi: vaultAbi, functionName: "withdraw", args: [t0, owner, wei] })}
        >
          Withdraw
        </Btn>
      </div>
      <div className="pt-2">
        {error && <span className="text-xs text-red-400">{error.message.split("\n")[0]}</span>}
        <TxStatus hash={hash} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-900 px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function Btn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="rounded-lg border border-zinc-600 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-40" />;
}
