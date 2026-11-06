"use client";

import { useState, type ReactNode } from "react";

// Shared building blocks: one icon set, one button vocabulary, one panel, one way to show addresses and txs.

const PATHS = {
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  copy: "M9 9h10v10H9zM5 15V5h10",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  shield: "M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z",
  shieldCheck: "M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6zM8.75 12l2.25 2.25 4.25-4.5",
  shieldX: "M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6zM9.5 9.5l5 5M14.5 9.5l-5 5",
  play: "M8 5.5v13l10.5-6.5z",
  alert: "M12 4l9 16H3zM12 10v4.5M12 17.5v.01",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  eyeOff: "M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.5 7.1C4 8.9 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9M9.9 9.9a2.5 2.5 0 0 0 3.5 3.5",
  power: "M12 3v8M7 6.3a7.5 7.5 0 1 0 10 0",
  wallet: "M4 7a2 2 0 0 1 2-2h11v4M4 7v10a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2zM16 14h.01",
  vault: "M4 4h16v16H4zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 9V7.5M12 16.5V15M4 8h-1M4 16h-1",
  bot: "M12 4v3M6 7h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM9 12.5v1M15 12.5v1",
  news: "M5 5h11v14H6a1 1 0 0 1-1-1zM16 9h3v9a1 1 0 0 1-2 0M8 9h5M8 12h5M8 15h3",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8v.01",
  phone: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

const BTN = {
  primary: "bg-fg text-ink hover:bg-white",
  secondary: "border border-line-strong text-fg hover:bg-white/[0.06]",
  danger: "bg-danger text-ink hover:brightness-110",
  ghost: "text-muted hover:text-fg hover:bg-white/[0.05]",
} as const;

export function buttonClass(variant: keyof typeof BTN = "secondary", size: "sm" | "md" | "lg" = "md") {
  const sizes = { sm: "h-8 px-3 text-[13px] gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-5 text-[15px] gap-2" };
  return `inline-flex shrink-0 items-center justify-center rounded-full font-medium transition-[background-color,filter,color] duration-150 disabled:pointer-events-none disabled:opacity-40 ${sizes[size]} ${BTN[variant]}`;
}

export function Panel({ title, aside, children, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-raised shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] ${className}`}>
      {(title || aside) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-medium text-fg">{title}</h2>
          {aside}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export type Tone = "safe" | "danger" | "warn" | "neutral";
const TONE: Record<Tone, string> = {
  safe: "bg-safe/10 text-safe ring-safe/25",
  danger: "bg-danger/10 text-danger ring-danger/25",
  warn: "bg-warn/10 text-warn ring-warn/25",
  neutral: "bg-white/[0.05] text-muted ring-line",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone]}`}>{children}</span>;
}

/** A coloured dot; `live` adds a soft ping so "connected" reads at a glance. */
export function Dot({ tone, live = false }: { tone: Tone; live?: boolean }) {
  const color = { safe: "bg-safe", danger: "bg-danger", warn: "bg-warn", neutral: "bg-faint" }[tone];
  return (
    <span className="relative inline-flex size-2" aria-hidden>
      {live && <span className={`absolute inset-0 animate-ping rounded-full opacity-60 ${color}`} />}
      <span className={`relative inline-flex size-2 rounded-full ${color}`} />
    </span>
  );
}

export function Skeleton({ className = "h-5 w-24" }: { className?: string }) {
  return <span className={`inline-block animate-shimmer rounded-md bg-white/[0.07] ${className}`} aria-hidden />;
}

export const shortHex = (h: string, head = 6, tail = 4) => `${h.slice(0, head)}…${h.slice(-tail)}`;

/** Monospace address/hash with copy, optionally linking to the explorer. */
export function Hex({ value, href, head = 6, tail = 4, className = "" }: { value: string; href?: string; head?: number; tail?: number; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  };
  const text = <span className="font-mono tabular-nums">{shortHex(value, head, tail)}</span>;
  return (
    <span className={`inline-flex items-center gap-1 text-[13px] text-muted ${className}`}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-fg" title={value}>
          {text}
          <Icon name="external" className="size-3" />
        </a>
      ) : (
        <span title={value}>{text}</span>
      )}
      <button type="button" onClick={copy} className="rounded p-0.5 hover:text-fg" aria-label={copied ? "Copied" : "Copy to clipboard"}>
        <Icon name={copied ? "check" : "copy"} className="size-3.5" />
      </button>
    </span>
  );
}

/** First line of a wallet/RPC error, without viem's "Request Arguments" wall. */
export const firstLine = (e: { message: string }) => {
  const line = e.message.split("\n")[0];
  return /user rejected|denied/i.test(line) ? "You cancelled the request in your wallet." : line;
};
