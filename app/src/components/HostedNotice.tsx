import Link from "next/link";
import { Badge, buttonClass, Hex, Icon, type Tone } from "@/components/ui";

// Shown on /demo when the page is served from a public host (e.g. Vercel), where the agent, the Anon-RPC
// bridge and the logging proxy aren't reachable. Points visitors at the on-chain evidence instead.
const REPO = "https://github.com/unspecifiedcoder/kusari";
const TX = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;

const BEATS: { title: string; body: string; outcome: string; tone: Tone; hash: string }[] = [
  {
    title: "A normal trade",
    body: "The agent makes a small swap within its limits.",
    outcome: "Allowed",
    tone: "safe",
    hash: "0xe79db59b22da6d38add13d5d053457aae3a405aef67ff664cfbef3bd58d11bb4",
  },
  {
    title: "The agent is hijacked",
    body: "Poisoned news makes the LLM try an 89.9 kUSD swap. The hook reverts it on-chain (ExceedsPerSwap).",
    outcome: "Blocked",
    tone: "danger",
    hash: "0x29d7862d9241f3843278c03dd800472c61a227636c3cc3b05f24b0ea6cb95248",
  },
  {
    title: "The owner pulls the plug",
    body: "The owner revokes the agent's ENS role.",
    outcome: "Frozen",
    tone: "neutral",
    hash: "0xa22fdeb76d2e072b9b748c3a3ec9dcbee43539b57223cb8fb7b0a5ecd9d7bc1e",
  },
  {
    title: "The agent tries again",
    body: "Its next swap reverts: NotAuthorized.",
    outcome: "Blocked",
    tone: "danger",
    hash: "0xfbf74e590c107025e227d5bb329847f86fc580bfa395479d33fd88ed500912b8",
  },
];

export function HostedNotice() {
  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">The demo, on-chain</h1>
        <p className="max-w-2xl text-muted">
          The live agent, the Anon-RPC bridge (headless Chromium + the Nox worker) and the leak proxy run on the team&apos;s machine, so this hosted page
          can&apos;t show them live. Every beat of the demo is a real Sepolia transaction you can check right now.
        </p>
      </header>

      <ol className="relative space-y-3 before:absolute before:top-6 before:bottom-6 before:left-[1.4rem] before:w-px before:bg-line">
        {BEATS.map((b, i) => (
          <li key={b.hash} className="relative grid grid-cols-[2.8rem_1fr] gap-4">
            <span className="z-10 mt-4 grid size-11 place-items-center rounded-full border border-line-strong bg-ink text-sm tabular-nums text-muted">{i + 1}</span>
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-raised p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="flex items-center gap-2 font-medium">
                  {b.title} <Badge tone={b.tone}>{b.outcome}</Badge>
                </p>
                <p className="text-sm text-muted">{b.body}</p>
              </div>
              <Hex value={b.hash} href={TX(b.hash)} head={10} tail={6} />
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-3">
        <a href={`${REPO}#demo-4-minutes`} target="_blank" rel="noreferrer" className={buttonClass("primary", "lg")}>
          Screenshots + walkthrough <Icon name="external" />
        </a>
        <Link href="/freeze" className={buttonClass("secondary", "lg")}>
          <Icon name="power" /> Try the kill switch
        </Link>
      </div>
      <p className="text-sm text-faint">The kill switch works here too: connect the owner wallet to freeze or unfreeze the agent via ENS.</p>
    </div>
  );
}
