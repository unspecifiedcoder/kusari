"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@/components/ConnectButton";
import { ReadRouteBadge } from "@/components/ReadRouteBadge";

const NAV = [
  { href: "/", label: "My agent" },
  { href: "/demo", label: "Live demo" },
  { href: "/freeze", label: "Kill switch", danger: true },
];

/** The vermilion seal: Kusari's only brand colour. */
export function Seal({ className = "size-7 text-[15px]" }: { className?: string }) {
  return (
    <span aria-hidden className={`grid place-items-center rounded-[7px] bg-seal font-semibold leading-none text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)] ${className}`}>
      鎖
    </span>
  );
}

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ink/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Kusari home">
          <Seal />
          <span className="text-[17px] font-semibold tracking-tight">Kusari</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          <NavLinks path={path} />
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden lg:block">
            <ReadRouteBadge />
          </span>
          <ConnectButton />
        </div>
      </div>
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-4 pb-2.5 md:hidden">
        <NavLinks path={path} />
      </nav>
    </header>
  );
}

function NavLinks({ path }: { path: string }) {
  return NAV.map((n) => {
    const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={active ? "page" : undefined}
        className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm transition-colors ${
          active ? "bg-white/[0.08] text-fg" : "text-muted hover:text-fg"
        }`}
      >
        {n.danger && <span className="size-1.5 rounded-full bg-danger" aria-hidden />}
        {n.label}
      </Link>
    );
  });
}
