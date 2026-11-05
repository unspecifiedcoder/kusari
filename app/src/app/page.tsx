"use client";

import { useConnection } from "wagmi";
import { deployment, deploymentFile } from "@/generated/deployment";
import { walletConnectEnabled } from "@/lib/wagmi";

// F1: app shell. The wizard steps are wired up in F2-F7.
const STEPS = [
  { id: "F2", title: "Create your vault", body: "Funds live in a vault, never in the agent's wallet." },
  { id: "F3", title: "Set the limits", body: "Per-swap cap, daily cap and max price impact, written to your ENS name." },
  { id: "F4", title: "Connect your agent", body: "Give the agent a key that can only ask the vault to swap." },
  { id: "F5", title: "Fund it", body: "Deposit tokens. Only you can ever withdraw." },
];

export default function Home() {
  const { isConnected } = useConnection();

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">Your agent can be fooled. Your money can&apos;t.</h1>
        <p className="max-w-2xl text-zinc-400">
          Kusari keeps an AI trading agent on a leash: its funds sit in a vault, every swap is checked on-chain by a
          Uniswap v4 hook against limits you set in ENS, and you can freeze it from your phone in one tap.
        </p>
      </section>

      {!isConnected ? (
        <div className="rounded-xl border border-zinc-800 p-6 text-zinc-300">
          Connect a wallet to set up a protected agent.
          {!walletConnectEnabled && (
            <span className="block pt-2 text-xs text-zinc-500">
              Browser wallets work now. Mobile QR (WalletConnect) turns on when NEXT_PUBLIC_REOWN_PROJECT_ID is set.
            </span>
          )}
        </div>
      ) : (
        <ol className="grid gap-4 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.id} className="rounded-xl border border-zinc-800 p-5">
              <div className="text-xs text-zinc-500">Step {i + 1}</div>
              <div className="pt-1 font-medium">{s.title}</div>
              <p className="pt-1 text-sm text-zinc-400">{s.body}</p>
              <div className="pt-3 text-xs text-zinc-600">Coming next</div>
            </li>
          ))}
        </ol>
      )}

      <footer className="text-xs text-zinc-600">
        {deployment ? (
          <>
            Contracts from <span className="font-mono">{deploymentFile}</span>: hook{" "}
            <span className="font-mono">{deployment.policyHook}</span>
          </>
        ) : (
          "Not deployed yet."
        )}
      </footer>
    </div>
  );
}
