"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/ui";

// The home page's one moving part: a trade request travelling agent -> vault -> hook, and the hook's verdict.
// The two scenarios are the demo's real beats (a routine buy, and the 89.9 kUSD hijack reverted on-chain).

const SCENARIOS = {
  normal: {
    tab: "Normal trade",
    request: "Buy with 1 kUSD",
    why: "The agent read the news and wants a small buy.",
    verdict: "Allowed",
    detail: "Within the per-swap and daily limits in your ENS name, so the swap goes through.",
    ok: true,
  },
  hijack: {
    tab: "Hijacked agent",
    request: "Swap 89.9 kUSD",
    why: "Poisoned news told the agent to ignore its limits and swap everything.",
    verdict: "Blocked on-chain",
    detail: "Over the per-swap cap. The hook reverts the whole transaction and the funds never move.",
    ok: false,
  },
} as const;

type Key = keyof typeof SCENARIOS;

const STOPS: { icon: IconName; title: string; body: string }[] = [
  { icon: "bot", title: "AI agent", body: "Decides to trade. Holds no money." },
  { icon: "vault", title: "Your vault", body: "Holds the funds. Only you can withdraw." },
  { icon: "shield", title: "Uniswap v4 hook", body: "Checks every swap against your limits." },
];

export function GuardDiagram() {
  const [key, setKey] = useState<Key>("hijack");
  const [step, setStep] = useState(3); // 0..3: how far the request has travelled; 3 = verdict shown
  const [auto, setAuto] = useState(true);
  const [run, setRun] = useState(0); // bumps to replay the same scenario
  const s = SCENARIOS[key];

  // Replay the request whenever the scenario changes; in auto mode, alternate scenarios.
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timers = still ? [setTimeout(() => setStep(3), 0)] : [0, 1, 2, 3].map((n) => setTimeout(() => setStep(n), n * 750));
    if (auto && !still)
      timers.push(
        setTimeout(() => {
          setStep(0);
          setKey((k) => (k === "normal" ? "hijack" : "normal"));
        }, 5200),
      );
    return () => timers.forEach(clearTimeout);
  }, [key, auto, run]);

  const pick = (k: Key) => {
    setAuto(false);
    setStep(0);
    setKey(k);
    setRun((r) => r + 1);
  };

  const tone = s.ok ? "text-safe" : "text-danger";

  return (
    <div className="rounded-3xl border border-line bg-raised p-5 shadow-[0_30px_80px_-40px_rgb(0_0_0/0.9),inset_0_1px_0_rgb(255_255_255/0.04)] sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">What happens when the agent trades</p>
        <div role="tablist" aria-label="Scenario" className="inline-flex rounded-full bg-white/[0.05] p-1 text-[13px]">
          {(Object.keys(SCENARIOS) as Key[]).map((k) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={k === key}
              onClick={() => pick(k)}
              className={`rounded-full px-3 py-1 ${k === key ? "bg-fg text-ink" : "text-muted hover:text-fg"}`}
            >
              {SCENARIOS[k].tab}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-ink/60 px-4 py-3 text-sm ring-1 ring-line">
        <span className="font-medium">{s.request}</span>
        <span className="text-muted"> · {s.why}</span>
      </div>

      <ol className="relative mt-6 grid gap-3 sm:grid-cols-3 sm:gap-4">
        {STOPS.map((stop, i) => {
          const reached = step > i;
          const isHook = i === 2;
          const verdictHere = isHook && step >= 3;
          return (
            <li
              key={stop.title}
              className={`relative rounded-2xl border p-4 transition-[border-color,background-color] duration-500 ${
                verdictHere ? (s.ok ? "border-safe/40 bg-safe/[0.06]" : "border-danger/45 bg-danger/[0.07]") : reached ? "border-line-strong bg-white/[0.03]" : "border-line"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`grid size-9 place-items-center rounded-xl transition-colors duration-500 ${
                    verdictHere ? (s.ok ? "bg-safe/15 text-safe" : "bg-danger/15 text-danger") : reached ? "bg-white/[0.08] text-fg" : "bg-white/[0.04] text-faint"
                  }`}
                >
                  <Icon name={verdictHere ? (s.ok ? "shieldCheck" : "shieldX") : stop.icon} className="size-5" />
                </span>
                <span className="text-sm font-medium">{stop.title}</span>
              </div>
              <p className="mt-2.5 text-[13px] leading-relaxed text-muted">{stop.body}</p>
              {i < 2 && (
                <span aria-hidden className={`absolute top-1/2 -right-3 z-10 hidden -translate-y-1/2 transition-colors duration-500 sm:block ${step > i + 1 ? "text-fg" : "text-faint/50"}`}>
                  <Icon name="arrowRight" className="size-4" />
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div aria-live="polite" className={`mt-4 flex items-start gap-3 rounded-2xl px-4 py-3.5 transition-opacity duration-500 ${step >= 3 ? "opacity-100" : "opacity-0"} ${s.ok ? "bg-safe/[0.07]" : "bg-danger/[0.08]"}`}>
        <Icon name={s.ok ? "check" : "x"} className={`mt-0.5 size-4 ${tone}`} />
        <p className="text-sm">
          <span className={`font-semibold ${tone}`}>{s.verdict}.</span> <span className="text-muted">{s.detail}</span>
        </p>
      </div>
    </div>
  );
}
