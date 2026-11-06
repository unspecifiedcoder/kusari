"use client";

import { useEffect } from "react";
import { useConnection } from "wagmi";
import { useKillSwitch } from "@/lib/killswitch";
import { ConnectButton } from "@/components/ConnectButton";
import { Badge, firstLine, Hex, Icon, Skeleton } from "@/components/ui";

// F7: the owner's phone. Open this page in your wallet's in-app browser and tap once.
export default function Freeze() {
  const { isConnected } = useConnection();
  const k = useKillSwitch();
  useEffect(() => {
    if (k.confirmed) k.refetch();
  }, [k.confirmed]); // eslint-disable-line react-hooks/exhaustive-deps

  const known = k.authorized !== undefined;
  const frozen = k.authorized === false;

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center text-center">
      <p className="text-sm text-muted">Kill switch for</p>
      <p className="mt-1 font-mono text-base">{k.name ?? <Skeleton className="h-5 w-44" />}</p>

      <div
        aria-live="polite"
        className={`mt-8 grid size-44 place-items-center rounded-full ring-1 transition-colors duration-500 ${
          !known ? "bg-white/[0.03] ring-line" : frozen ? "bg-danger/[0.08] ring-danger/30" : "bg-safe/[0.07] ring-safe/30"
        }`}
      >
        <div className="flex flex-col items-center gap-2">
          {known ? (
            <Icon name={frozen ? "power" : "shieldCheck"} className={`size-10 ${frozen ? "text-danger" : "text-safe"}`} />
          ) : (
            <Skeleton className="size-10 rounded-full" />
          )}
          <span className={`text-2xl font-semibold tracking-tight ${!known ? "text-faint" : frozen ? "text-danger" : "text-safe"}`}>
            {!known ? "Checking…" : frozen ? "Frozen" : "Active"}
          </span>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted">
        {!known ? "Reading the agent's permission from the chain." : frozen ? "The agent can't trade. Every swap it tries will revert." : "The agent can trade within its limits."}
      </p>

      <div className="mt-8 w-full">
        {!isConnected ? (
          <div className="space-y-3 rounded-2xl border border-line p-5">
            <p className="text-sm text-muted">Connect the owner wallet to use the kill switch.</p>
            <div className="flex justify-center">
              <ConnectButton size="md" />
            </div>
          </div>
        ) : frozen ? (
          <button
            type="button"
            onClick={k.unfreeze}
            disabled={k.isPending}
            className="h-16 w-full rounded-2xl border border-line-strong text-lg font-semibold transition-colors hover:bg-white/[0.05] disabled:opacity-40"
          >
            {k.isPending ? "Confirming…" : "Unfreeze agent"}
          </button>
        ) : (
          <button
            type="button"
            onClick={k.freeze}
            disabled={k.isPending || !known}
            className="flex h-24 w-full items-center justify-center gap-3 rounded-3xl bg-danger text-2xl font-semibold text-ink shadow-[0_18px_40px_-16px_rgb(255_93_108/0.55)] transition-[transform,filter] hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
          >
            <Icon name="power" className="size-7" />
            {k.isPending ? "Freezing…" : "Freeze agent"}
          </button>
        )}
      </div>

      {k.hash && (
        <p className="mt-4 flex items-center gap-2 text-xs">
          <Badge tone={k.confirmed ? "safe" : "neutral"}>{k.confirmed ? "Confirmed" : "Pending"}</Badge>
          <Hex value={k.hash} href={`https://sepolia.etherscan.io/tx/${k.hash}`} head={10} />
        </p>
      )}
      {k.error && (
        <p role="alert" className="mt-4 text-xs text-danger">
          {firstLine(k.error)}
        </p>
      )}

      <p className="mt-8 text-xs leading-relaxed text-faint">
        Uses {k.via}. Takes effect on the agent&apos;s very next swap. The agent can&apos;t stop it.
      </p>
    </div>
  );
}
