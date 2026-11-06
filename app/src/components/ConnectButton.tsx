"use client";

import { useConnection, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function ConnectButton() {
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
            <button
              key={c.uid}
              onClick={() => connect({ connector: c })}
              disabled={isPending}
              className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-zinc-200 disabled:opacity-50"
            >
              {isPending ? "Connecting…" : c.name === "Injected" ? "Owner wallet" : c.name}
            </button>
          ))}
        </div>
        {error && <span className="text-xs text-red-400">{error.message.split("\n")[0]}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {chainId !== sepolia.id ? (
        <button
          onClick={() => switchChain({ chainId: sepolia.id })}
          className="rounded-lg bg-amber-500 px-3 py-1.5 font-medium text-black"
        >
          Switch to Sepolia
        </button>
      ) : (
        <span className="rounded-lg border border-zinc-700 px-2 py-1 text-zinc-300">Sepolia</span>
      )}
      <span className="rounded-lg border border-zinc-700 px-2 py-1 font-mono">{short(address!)}</span>
      <button onClick={() => disconnect()} className="text-zinc-400 hover:text-white">
        Disconnect
      </button>
    </div>
  );
}
