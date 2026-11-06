"use client";

import { useConnection, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";
import { buttonClass, Dot, firstLine, Icon, shortHex } from "@/components/ui";

export function ConnectButton({ size = "sm" }: { size?: "sm" | "md" | "lg" }) {
  const { address, isConnected } = useConnection();
  const chainId = useChainId();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex gap-2">
          {connectors.map((c) => (
            <button key={c.uid} type="button" onClick={() => connect({ connector: c })} disabled={isPending} className={buttonClass("primary", size)}>
              <Icon name="wallet" />
              {isPending ? "Connecting…" : c.name === "Injected" ? "Connect wallet" : c.name}
            </button>
          ))}
        </div>
        {error && (
          <span role="alert" className="max-w-64 text-right text-xs text-danger">
            {/provider not found|no injected/i.test(error.message) ? "No browser wallet found. Install MetaMask or Rabby." : firstLine(error)}
          </span>
        )}
      </div>
    );
  }

  if (chainId !== sepolia.id) {
    return (
      <button type="button" onClick={() => switchChain({ chainId: sepolia.id })} className={`${buttonClass("primary", size)} !bg-warn`}>
        <Icon name="alert" />
        Switch to Sepolia
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 rounded-full border border-line-strong py-1 pr-1 pl-3 text-[13px]">
      <Dot tone="safe" />
      <span className="ml-1 hidden text-muted sm:inline">Sepolia</span>
      <span className="ml-1 font-mono text-fg" title={address}>
        {shortHex(address!)}
      </span>
      <button type="button" onClick={() => disconnect()} className="ml-1 grid size-6 place-items-center rounded-full text-muted hover:bg-white/[0.08] hover:text-fg" aria-label="Disconnect wallet" title="Disconnect">
        <Icon name="logout" className="size-3.5" />
      </button>
    </div>
  );
}
