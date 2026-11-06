"use client";

import { useEffect, useRef, useState } from "react";
import { isAddress, parseEther, formatEther, type Address } from "viem";
import { useConnection, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { deployment, sepoliaConfig } from "@/generated/deployment";
import { factoryAbi, vaultAbi, tokenAbi } from "@/lib/abi";
import { assertSepoliaWallet } from "@/lib/wallet-safety";

const explorer = (sepoliaConfig as { explorer?: string }).explorer ?? "https://sepolia.etherscan.io";

/** F2 + F5: create a vault for an agent, fund it, withdraw from it. */
export function VaultSetup() {
  const { address, chainId, isConnected } = useConnection();
  const vaults = useReadContract({
    chainId: deployment.chainId,
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
      {(!isConnected || chainId !== deployment.chainId) && <p role="status" className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-4 text-sm leading-6 text-amber-200">Vault actions are disabled. Connect your wallet and switch it to Sepolia in the header before creating, funding or withdrawing from a test vault. Every transaction must show Sepolia in your wallet.</p>}
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
  const r = useWaitForTransactionReceipt({ hash, chainId: deployment.chainId });
  if (!hash) return null;
  return (
    <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer" className="text-xs text-zinc-400 underline">
      {r.isLoading ? "pending…" : r.data?.status === "success" ? "confirmed ✓" : r.data ? "failed ✗" : "sent"} ({hash.slice(0, 10)}…)
    </a>
  );
}

function CreateVault({ onCreated }: { onCreated: () => void }) {
  const [agent, setAgent] = useState("");
  const { address, connector, chainId, isConnected } = useConnection();
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const [checkingNetwork, setCheckingNetwork] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const submitting = useRef(false);
  const correctChain = isConnected && chainId === deployment.chainId;
  const receipt = useWaitForTransactionReceipt({ hash, chainId: deployment.chainId });
  useEffect(() => {
    if (receipt.data?.status === "success") onCreated();
  }, [receipt.data?.status, onCreated]);
  const valid = isAddress(agent);
  const create = async () => {
    if (submitting.current) return;
    if (!correctChain || !address || !connector) { setNetworkError("Switch your connected wallet to Sepolia before creating a vault."); return; }
    if (!valid) return;
    submitting.current = true;
    setCheckingNetwork(true);
    setNetworkError(null);
    try {
      await assertSepoliaWallet(connector, address);
      await writeContractAsync({ chainId: deployment.chainId, account: address, connector, address: deployment.vaultFactory, abi: factoryAbi, functionName: "create", args: [agent as Address] });
    } catch (cause) { setNetworkError(cause instanceof Error ? cause.message.split("\n")[0] : "Wallet verification failed. No transaction was submitted."); }
    finally { submitting.current = false; setCheckingNetwork(false); }
  };

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
          disabled={!valid || !correctChain || checkingNetwork || isPending || receipt.isLoading}
          onClick={() => void create()}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {checkingNetwork && !isPending ? "Checking wallet network…" : isPending ? "Confirm on Sepolia…" : receipt.isLoading ? "Waiting for confirmation…" : "Create vault"}
        </button>
      </div>
      <div className="pt-2">
        {agent && !valid && <span className="text-xs text-red-400">That isn&apos;t a valid address.</span>}
        {networkError && <p role="alert" className="text-xs text-red-400">{networkError}</p>}
        {error && !networkError && <span className="text-xs text-red-400">{error.message.split("\n")[0]}</span>}
        <TxStatus hash={hash} />
      </div>
    </section>
  );
}

function VaultCard({ vault, owner }: { vault: Address; owner: Address }) {
  const { address, connector, chainId, isConnected } = useConnection();
  const t0 = deployment!.token0;
  const t1 = deployment!.token1;
  const reads = useReadContracts({
    contracts: [
      { chainId: deployment.chainId, address: vault, abi: vaultAbi, functionName: "agent" },
      { chainId: deployment.chainId, address: t0, abi: tokenAbi, functionName: "balanceOf", args: [vault] },
      { chainId: deployment.chainId, address: t1, abi: tokenAbi, functionName: "balanceOf", args: [vault] },
      { chainId: deployment.chainId, address: t0, abi: tokenAbi, functionName: "balanceOf", args: [owner] },
    ],
    query: { refetchInterval: 5000 },
  });
  const [agent, v0, v1, mine] = (reads.data ?? []).map((r) => r.result) as [Address?, bigint?, bigint?, bigint?];
  const [amount, setAmount] = useState("10");
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const [checkingNetwork, setCheckingNetwork] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const submitting = useRef(false);
  const correctChain = isConnected && chainId === deployment.chainId && address?.toLowerCase() === owner.toLowerCase();
  let wei = 0n;
  try {
    wei = parseEther(amount || "0");
  } catch {}
  const write = async (action: "mint" | "transfer" | "withdraw") => {
    if (submitting.current) return;
    if (!correctChain || !address || !connector) { setNetworkError("Connect the vault owner’s wallet and switch it to Sepolia before using vault actions."); return; }
    if (wei <= 0n) return;
    submitting.current = true;
    setCheckingNetwork(true);
    setNetworkError(null);
    try {
      await assertSepoliaWallet(connector, address);
      const wallet = { chainId: deployment.chainId, account: address, connector } as const;
      if (action === "mint") await writeContractAsync({ ...wallet, address: t0, abi: tokenAbi, functionName: "mint", args: [owner, wei] });
      else if (action === "transfer") await writeContractAsync({ ...wallet, address: t0, abi: tokenAbi, functionName: "transfer", args: [vault, wei] });
      else await writeContractAsync({ ...wallet, address: vault, abi: vaultAbi, functionName: "withdraw", args: [t0, owner, wei] });
    } catch (cause) { setNetworkError(cause instanceof Error ? cause.message.split("\n")[0] : "Wallet verification failed. No transaction was submitted."); }
    finally { submitting.current = false; setCheckingNetwork(false); }
  };
  const blocked = !correctChain || checkingNetwork || isPending || wei <= 0n;

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
        <Btn disabled={blocked} onClick={() => void write("mint")}>
          Get test kUSD
        </Btn>
        <Btn
          disabled={blocked || (mine ?? 0n) < wei}
          onClick={() => void write("transfer")}
        >
          Deposit
        </Btn>
        <Btn
          disabled={blocked || (v0 ?? 0n) < wei}
          onClick={() => void write("withdraw")}
        >
          Withdraw
        </Btn>
      </div>
      <div className="pt-2">
        {checkingNetwork && !isPending && <p role="status" className="text-xs text-zinc-400">Checking the wallet’s Sepolia network before requesting a transaction…</p>}
        {networkError && <p role="alert" className="text-xs text-red-400">{networkError}</p>}
        {error && !networkError && <span className="text-xs text-red-400">{error.message.split("\n")[0]}</span>}
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
