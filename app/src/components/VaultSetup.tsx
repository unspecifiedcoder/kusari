"use client";

import { useEffect, useState } from "react";
import { isAddress, parseEther, formatEther, type Address } from "viem";
import { useConnection, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { deployment, sepoliaConfig } from "@/generated/deployment";
import { factoryAbi, vaultAbi, tokenAbi } from "@/lib/abi";
import { Badge, buttonClass, firstLine, Hex, Icon, Panel, Skeleton } from "@/components/ui";

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

  if (!deployment) return <p className="text-muted">Kusari isn&apos;t deployed on this network yet.</p>;
  const list = (vaults.data ?? []) as readonly Address[];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <CreateVault onCreated={vaults.refetch} hasVaults={list.length > 0} />
      <section className="space-y-4" aria-label="Your vaults">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted">Your vaults</h3>
          {list.length > 0 && <span className="text-xs tabular-nums text-faint">{list.length}</span>}
        </div>
        {vaults.isLoading ? (
          <div className="rounded-2xl border border-line p-5">
            <Skeleton className="h-4 w-48" />
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          </div>
        ) : list.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center">
            <Icon name="vault" className="size-6 text-faint" />
            <p className="mt-3 font-medium">No vaults yet</p>
            <p className="mt-1 max-w-xs text-sm text-muted">Create one for your agent and it will show up here with its balances.</p>
          </div>
        ) : (
          list.map((v) => <VaultCard key={v} vault={v} owner={address!} />)
        )}
      </section>
    </div>
  );
}

/** Wallet → chain progress for one transaction, in words. */
function TxStatus({ hash, pending, error }: { hash?: `0x${string}`; pending?: boolean; error?: { message: string } | null }) {
  const r = useWaitForTransactionReceipt({ hash });
  if (error) return <p role="alert" className="text-xs text-danger">{firstLine(error)}</p>;
  if (pending) return <p className="text-xs text-muted">Confirm in your wallet…</p>;
  if (!hash) return null;
  const state = r.isLoading ? { tone: "neutral", text: "Waiting for Sepolia…" } : r.data?.status === "success" ? { tone: "safe", text: "Confirmed" } : r.data ? { tone: "danger", text: "Failed" } : { tone: "neutral", text: "Sent" };
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs" aria-live="polite">
      <Badge tone={state.tone as "safe" | "danger" | "neutral"}>{state.text}</Badge>
      <Hex value={hash} href={`${explorer}/tx/${hash}`} head={10} />
    </p>
  );
}

function CreateVault({ onCreated, hasVaults }: { onCreated: () => void; hasVaults: boolean }) {
  const [agent, setAgent] = useState("");
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  useEffect(() => {
    if (receipt.isSuccess) onCreated();
  }, [receipt.isSuccess, onCreated]);
  const valid = isAddress(agent);
  const invalid = agent !== "" && !valid;

  return (
    <Panel title={hasVaults ? "Create another vault" : "Create a vault for your agent"}>
      <p className="text-sm leading-relaxed text-muted">
        The agent&apos;s key can only ask this vault to swap through Kusari-guarded pools. You stay the owner: only you can
        withdraw.
      </p>
      <form
        className="mt-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) writeContract({ address: deployment!.vaultFactory, abi: factoryAbi, functionName: "create", args: [agent as Address] });
        }}
      >
        <label htmlFor="agent" className="block text-xs font-medium text-muted">
          Agent address
        </label>
        <input
          id="agent"
          value={agent}
          onChange={(e) => setAgent(e.target.value.trim())}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid}
          aria-describedby="agent-help"
          className={`h-11 w-full rounded-xl border bg-ink px-3.5 font-mono text-sm outline-none transition-colors focus:border-fg/50 ${invalid ? "border-danger/60" : "border-line-strong"}`}
        />
        <p id="agent-help" className={`text-xs ${invalid ? "text-danger" : "text-faint"}`}>
          {invalid ? "That isn't a valid address. It should start with 0x and be 42 characters long." : "The wallet address your AI agent signs with."}
        </p>
        <button type="submit" disabled={!valid || isPending || receipt.isLoading} className={`${buttonClass("primary")} w-full`}>
          {isPending ? "Confirm in wallet…" : receipt.isLoading ? "Creating vault…" : "Create vault"}
        </button>
        <TxStatus hash={hash} error={error} />
      </form>
    </Panel>
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

  const fmt = (x?: bigint) => (x === undefined ? undefined : Number(formatEther(x)).toLocaleString(undefined, { maximumFractionDigits: 4 }));
  const tooMuchToDeposit = wei > 0n && mine !== undefined && mine < wei;
  const tooMuchToWithdraw = wei > 0n && v0 !== undefined && v0 < wei;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Icon name="vault" className="size-4 text-faint" /> Vault <Hex value={vault} href={`${explorer}/address/${vault}`} />
        </span>
      }
      aside={<span className="text-xs text-faint">agent {agent ? <Hex value={agent} /> : <Skeleton className="h-3 w-16" />}</span>}
    >
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-line ring-1 ring-line">
        <Stat label="In vault" value={fmt(v0)} unit="kUSD" />
        <Stat label="In vault" value={fmt(v1)} unit="kETH" />
        <Stat label="In your wallet" value={fmt(mine)} unit="kUSD" />
      </dl>

      <div className="mt-5 space-y-2">
        <label htmlFor={`amt-${vault}`} className="block text-xs font-medium text-muted">
          Amount
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-10 items-center rounded-xl border border-line-strong bg-ink pr-3 focus-within:border-fg/50">
            <input
              id={`amt-${vault}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              className="h-full w-24 bg-transparent px-3 text-sm tabular-nums outline-none"
              inputMode="decimal"
            />
            <span className="text-sm text-faint">kUSD</span>
          </div>
          <button
            type="button"
            className={buttonClass("primary")}
            disabled={isPending || !wei || tooMuchToDeposit}
            onClick={() => writeContract({ address: t0, abi: tokenAbi, functionName: "transfer", args: [vault, wei] })}
          >
            Deposit
          </button>
          <button
            type="button"
            className={buttonClass("secondary")}
            disabled={isPending || !wei || tooMuchToWithdraw}
            onClick={() => writeContract({ address: vault, abi: vaultAbi, functionName: "withdraw", args: [t0, owner, wei] })}
          >
            Withdraw
          </button>
          <button
            type="button"
            className={`${buttonClass("ghost")} sm:ml-auto`}
            disabled={isPending}
            onClick={() => writeContract({ address: t0, abi: tokenAbi, functionName: "mint", args: [owner, wei || parseEther("10")] })}
            title="Mint free test kUSD to your wallet"
          >
            Get test kUSD
          </button>
        </div>
        {tooMuchToDeposit && <p className="text-xs text-warn">You only have {fmt(mine)} kUSD. Tap “Get test kUSD” first.</p>}
        {tooMuchToWithdraw && !tooMuchToDeposit && <p className="text-xs text-faint">The vault holds {fmt(v0)} kUSD, so you can withdraw up to that.</p>}
        <TxStatus hash={hash} pending={isPending} error={error} />
      </div>
    </Panel>
  );
}

function Stat({ label, value, unit }: { label: string; value?: string; unit: string }) {
  return (
    <div className="bg-raised px-3.5 py-3">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1">
        {value === undefined ? <Skeleton className="h-5 w-12" /> : <span className="text-lg font-medium tabular-nums">{value}</span>}
        <span className="text-xs text-faint">{unit}</span>
      </dd>
    </div>
  );
}
