import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { ConnectButton } from "@/components/ConnectButton";
import { ReadRouteBadge } from "@/components/ReadRouteBadge";

export const metadata: Metadata = {
  title: "Kusari · Onchain boundaries for AI agents",
  description: "Inspect a live ENS policy, verify guarded Uniswap v4 trades, and watch an agent's authority being revoked on Sepolia.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-zinc-950 text-zinc-100">
        <Providers>
          <header className="border-b border-zinc-800/80 bg-zinc-950/90">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-4 px-5 py-4 sm:px-8">
            <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-5">
              <Link href="/" className="mr-2 flex items-center gap-2 text-xl font-semibold tracking-tight">
                <span aria-hidden="true" className="text-emerald-400">鎖</span> Kusari
              </Link>
              <Link href="/" className="text-sm text-zinc-400 hover:text-white">
                Overview
              </Link>
              <Link href="/demo" className="text-sm text-zinc-400 hover:text-white">
                Demonstration
              </Link>
              <Link href="/freeze" className="text-sm text-red-400 hover:text-red-300">
                Owner controls
              </Link>
            </nav>
            <div className="flex flex-wrap items-center gap-3">
              <ReadRouteBadge />
              <ConnectButton />
            </div>
            </div>
          </header>
          <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8 sm:py-12">{children}</main>
          <footer className="border-t border-zinc-800/80 px-5 py-5 text-xs leading-6 text-zinc-500">
            <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2">
              <span>ETHGlobal Mumbai · Sepolia testnet · Test tokens only</span>
              <a href="https://github.com/unspecifiedcoder/kusari" target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-white">Open-source code ↗</a>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
