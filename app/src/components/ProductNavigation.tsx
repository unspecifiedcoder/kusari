"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./ConnectButton";

const destinations = [
  { href: "/demo", label: "Agent workspace", icon: "workspace" },
  { href: "/", label: "Overview & proof", icon: "overview" },
  { href: "/freeze", label: "Owner controls", icon: "shield" },
] as const;

function NavIcon({ kind }: { kind: "workspace" | "overview" | "shield" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "workspace" ? <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M9 9v11" /></> : kind === "overview" ? <><path d="m4 10 8-6 8 6v10H4Z" /><path d="M9 20v-7h6v7" /></> : <><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6Z" /><path d="m9 12 2 2 4-4" /></>}
  </svg>;
}

export function ProductNavigation() {
  const pathname = usePathname();
  return <aside className="app-sidebar">
    <Link href="/demo" aria-label="Kusari agent workspace" className="app-brand"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="m12 20-2 2a6 6 0 0 1-8-8l7-7a6 6 0 0 1 8 0M20 12l2-2a6 6 0 0 1 8 8l-7 7a6 6 0 0 1-8 0M11 21l10-10" /></svg><span>Kusari</span></Link>
    <div className="app-space-label">Agent control</div>
    <nav aria-label="Main navigation" className="app-navigation">
      {destinations.map((item) => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className="app-nav-link"><NavIcon kind={item.icon} /><span>{item.label}</span></Link>)}
    </nav>
    <div className="app-sidebar-footer"><div className="environment-note"><span className="environment-dot" />Sepolia testnet</div><p>Shared vault. Test tokens.</p><a href="https://github.com/unspecifiedcoder/kusari/tree/codex/judge-ready" target="_blank" rel="noreferrer">View source <span aria-hidden="true">↗</span></a></div>
  </aside>;
}

export function ProductHeader() {
  const pathname = usePathname();
  const title = pathname === "/demo" ? "Agent workspace" : pathname === "/freeze" ? "Owner controls" : pathname === "/setup" ? "Advanced vault tools" : "Overview & proof";
  return <header className="app-topbar"><div className="app-breadcrumb"><span>Kusari</span><span aria-hidden="true">/</span><strong>{title}</strong></div><ConnectButton /></header>;
}
