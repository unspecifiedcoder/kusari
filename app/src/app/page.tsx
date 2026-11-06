"use client";

import Link from "next/link";
import { useConnection } from "wagmi";
import { walletConnectEnabled } from "@/lib/wagmi";
import { VaultSetup } from "@/components/VaultSetup";
import { GuardDiagram } from "@/components/GuardDiagram";
import { ConnectButton } from "@/components/ConnectButton";
import { buttonClass, Icon } from "@/components/ui";

// F1/F2/F5: connect, create a vault, fund it. Limits live in ENS (see /demo and agent/src/ens-policy.ts).
const STEPS = [
  { id: "F2", title: "Create your vault", body: "Funds live in a vault, never in the agent's wallet." },
  { id: "F3", title: "Set the limits", body: "Per-swap cap, daily cap and max price impact, written to your ENS name." },
  { id: "F4", title: "Connect your agent", body: "Give the agent a key that can only ask the vault to swap." },
  { id: "F5", title: "Fund it", body: "Deposit tokens. Only you can ever withdraw." },
];

const LAYERS = [
  { name: "Uniswap v4 hook", body: "Checks every swap on-chain and reverts anything outside your limits." },
  { name: "ENS", body: "Your limits and the agent's permission live on its name. Revoke it and the agent stops." },
  { name: "Anon-RPC", body: "The agent's reads and transactions leave through a mixnet, so no provider sees what it's about to trade." },
];

export default function Home() {
  const { isConnected } = useConnection();

  return (
    <div className="space-y-20 sm:space-y-28">
      <section className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-14">
        <div className="space-y-6">
          <h1 className="text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-6xl">
            Your agent can be fooled.
            <br />
            <span className="text-muted">Your money can&apos;t.</span>
          </h1>
          <p className="max-w-xl text-[17px] leading-relaxed text-muted">
            Kusari puts an AI trading agent on a leash. Its money sits in a vault, every trade is checked on-chain against
            limits you set, and you can freeze it from your phone in one tap.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {isConnected ? (
              <a href="#setup" className={buttonClass("primary", "lg")}>
                Set up your agent <Icon name="arrowRight" />
              </a>
            ) : (
              <ConnectButton size="lg" />
            )}
            <Link href="/demo" className={buttonClass("secondary", "lg")}>
              <Icon name="play" className="size-3.5" /> Watch the live demo
            </Link>
          </div>
          {!isConnected && !walletConnectEnabled && (
            <p className="text-xs text-faint">Works with browser wallets like MetaMask or Rabby, on the Sepolia testnet.</p>
          )}
        </div>
        <GuardDiagram />
      </section>

      <section className="grid gap-10 border-t border-line pt-12 md:grid-cols-[0.8fr_2fr]">
        <h2 className="text-2xl font-semibold tracking-tight">Three locks, one leash</h2>
        <dl className="grid gap-8 sm:grid-cols-3">
          {LAYERS.map((l) => (
            <div key={l.name} className="space-y-2">
              <dt className="flex items-center gap-2 font-medium">
                <Icon name="link" className="size-4 text-faint" />
                {l.name}
              </dt>
              <dd className="text-sm leading-relaxed text-muted">{l.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="setup" className="scroll-mt-24 space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">Protect your own agent</h2>
            <p className="text-muted">Four steps. You stay the owner the whole time.</p>
          </div>
        </div>
        <ol className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.id} className="bg-raised p-5">
              <span className="grid size-7 place-items-center rounded-full border border-line-strong text-xs tabular-nums text-muted">{i + 1}</span>
              <h3 className="mt-4 font-medium">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>

        {isConnected ? (
          <VaultSetup />
        ) : (
          <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-dashed border-line-strong px-6 py-8 sm:flex-row sm:items-center">
            <div>
              <p className="font-medium">Connect a wallet to create your vault</p>
              <p className="mt-1 text-sm text-muted">
                Everything runs on the Sepolia testnet with free test tokens.
                {!walletConnectEnabled && " Mobile QR (WalletConnect) turns on when NEXT_PUBLIC_REOWN_PROJECT_ID is set."}
              </p>
            </div>
            <ConnectButton size="md" />
          </div>
        )}
      </section>
    </div>
  );
}
