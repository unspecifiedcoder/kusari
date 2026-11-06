"use client";

import { useId, useRef, useState } from "react";
import { useConnection, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";
import { useCanonicalSite } from "@/lib/canonical-site";

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const explainError = (error: Error | null, action = "Connection") => {
  if (!error) return null;
  if (/reject|denied|cancel/i.test(error.message)) return `${action} was cancelled. You can try again when ready.`;
  return error.message.split("\n")[0] || "The wallet could not connect. Please try again.";
};

export function ConnectButton() {
  const { isCanonical, canonicalOrigin } = useCanonicalSite();
  const { address, isConnected, chainId } = useConnection();
  const { connectors, connect, isPending, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogId = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // EIP-6963 wallets identify their own providers. The generic injected connector
  // is a useful fallback only when no specific injected wallet was discovered.
  const hasSpecificWallet = connectors.some((connector) => connector.type === "injected" && connector.id !== "injected");
  const seen = new Set<string>();
  const choices = connectors.filter((connector) => {
    if (hasSpecificWallet && connector.id === "injected") return false;
    const identity = connector.id.toLowerCase();
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  const openChooser = () => {
    if (!isPending) { reset(); setSelected(null); }
    dialog.current?.showModal();
    setIsOpen(true);
  };

  if (!isCanonical && canonicalOrigin) return <a href={`${canonicalOrigin}/demo#try-sandbox`} className="rounded-xl border border-zinc-600 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-900">Open official sandbox</a>;

  if (isConnected) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs sm:text-sm">
        {chainId !== sepolia.id ? (
          <button type="button" onClick={() => switchChain({ chainId: sepolia.id })} disabled={isSwitching} className="rounded-lg bg-amber-400 px-3 py-2 font-medium text-zinc-950 disabled:opacity-50">{isSwitching ? "Switching…" : "Switch to Sepolia"}</button>
        ) : <span className="hidden text-xs text-zinc-500 sm:inline">Sepolia</span>}
        <span title={address} className="rounded-lg border border-zinc-700 px-2.5 py-2 font-mono text-zinc-200">{short(address!)}</span>
        <button type="button" onClick={() => disconnect()} className="rounded-lg px-1 py-2 text-zinc-400 hover:text-white">Disconnect</button>
        {switchError && <span role="alert" className="w-full max-w-xs break-words text-right text-xs text-amber-300">{explainError(switchError, "Network change")}</span>}
      </div>
    );
  }

  return (
    <>
      <button type="button" onClick={openChooser} aria-haspopup="dialog" aria-controls={dialogId} aria-expanded={isOpen} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-zinc-600 bg-zinc-100 px-3.5 py-2.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-white sm:px-4 sm:text-sm">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.5"><rect x="2.5" y="5" width="15" height="11" rx="2" /><path d="M3 5V4a1.5 1.5 0 0 1 1.5-1.5H15V5M13.5 9h4v3h-4a1.5 1.5 0 0 1 0-3Z" /></svg>
        {isPending ? "Waiting for wallet…" : "Connect wallet"}
      </button>
      <dialog ref={dialog} id={dialogId} aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-description`} onClose={() => setIsOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }} className="fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-sm overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 p-0 text-zinc-100 shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm">
        <div className="p-6">
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-widest text-emerald-400">Sepolia sandbox</p><h2 id={`${dialogId}-title`} className="mt-2 text-xl font-semibold tracking-tight">Choose your wallet</h2></div><button type="button" onClick={() => dialog.current?.close()} aria-label="Close wallet chooser" className="-mr-2 -mt-2 rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"><svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.5"><path d="m5 5 10 10M15 5 5 15" /></svg></button></div>
          <p id={`${dialogId}-description`} className="mt-3 text-sm leading-6 text-zinc-400">Connect to request a real Gemini cycle with shared test tokens. Only the configured owner can change the agent’s permissions.</p>
          <div className="mt-5 space-y-2">
            {choices.map((connector) => <button key={connector.id} type="button" disabled={isPending} onClick={() => { setSelected(connector.uid); connect({ connector }, { onSuccess: () => { dialog.current?.close(); setIsOpen(false); } }); }} className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-700 bg-zinc-900/50 px-4 py-3.5 text-left text-sm font-medium text-zinc-200 transition-colors hover:border-emerald-700 hover:bg-emerald-950/30 disabled:cursor-wait disabled:opacity-50"><span>{connector.id === "injected" ? "Browser wallet" : connector.name}</span><span aria-hidden="true" className="text-zinc-500">{isPending && selected === connector.uid ? "…" : "→"}</span></button>)}
            {choices.length === 0 && <p className="rounded-xl border border-zinc-800 p-4 text-sm leading-6 text-zinc-400">No wallet connector is available. Open this page in your wallet’s browser or enable a browser wallet extension.</p>}
          </div>
          {isPending && <p role="status" aria-live="polite" className="mt-4 text-sm leading-6 text-emerald-300">Approve or cancel the connection in your wallet. Closing this chooser does not cancel the wallet request.</p>}
          {error && <p role="alert" className="mt-4 break-words rounded-xl border border-red-900/70 bg-red-950/30 p-3 text-sm leading-6 text-red-300">{explainError(error)}</p>}
          <p className="mt-5 border-t border-zinc-800 pt-4 text-xs leading-5 text-zinc-500">Connecting does not grant spending permission or submit a transaction.</p>
        </div>
      </dialog>
    </>
  );
}
