import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { ConnectButton } from "@/components/ConnectButton";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Kusari: agents that can't be watched or go rogue",
  description: "Your agent can be fooled. Your money can't.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-zinc-950 text-zinc-100">
        <Providers>
          <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
            <nav className="flex items-center gap-6">
              <Link href="/" className="text-lg font-semibold">
                Kusari <span className="text-zinc-500">鎖</span>
              </Link>
              <Link href="/" className="text-sm text-zinc-400 hover:text-white">
                My agent
              </Link>
              <Link href="/demo" className="text-sm text-zinc-400 hover:text-white">
                Live demo
              </Link>
              <Link href="/freeze" className="text-sm text-red-400 hover:text-red-300">
                Kill switch
              </Link>
            </nav>
            <ConnectButton />
          </header>
          <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
