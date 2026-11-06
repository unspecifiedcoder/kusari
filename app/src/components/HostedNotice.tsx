import Link from "next/link";

const REPO = "https://github.com/unspecifiedcoder/kusari";
const TX = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;

const BEATS = [
  { number: "01", label: "A normal trade", detail: "The agent swaps within its owner-defined policy.", hash: "0xe79db59b22da6d38add13d5d053457aae3a405aef67ff664cfbef3bd58d11bb4", result: "Executed", tone: "text-emerald-300" },
  { number: "02", label: "An oversized trade", detail: "Poisoned news makes the staged agent request 89.9 kUSD. The hook rejects it.", hash: "0x29d7862d9241f3843278c03dd800472c61a227636c3cc3b05f24b0ea6cb95248", result: "ExceedsPerSwap", tone: "text-red-300" },
  { number: "03", label: "Owner revocation", detail: "The owner removes the agent’s ENS authorization role.", hash: "0xa22fdeb76d2e072b9b748c3a3ec9dcbee43539b57223cb8fb7b0a5ecd9d7bc1e", result: "Role revoked", tone: "text-zinc-300" },
  { number: "04", label: "The next trade", detail: "A small trade is blocked because the agent no longer has authority.", hash: "0xfbf74e590c107025e227d5bb329847f86fc580bfa395479d33fd88ed500912b8", result: "NotAuthorized", tone: "text-red-300" },
];

export function Evidence() {
  return (
    <section id="onchain-evidence" aria-labelledby="evidence-title" className="scroll-mt-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Independently verifiable</p><h2 id="evidence-title" className="mt-2 text-2xl font-semibold tracking-tight">Follow the evidence onchain.</h2></div><span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">Recorded Sepolia run</span></div>
      <p className="max-w-3xl text-sm leading-6 text-zinc-400">These transactions come from a previous demonstration. They remain available when the live runner is offline; they are separate from the current contract readings above.</p>
      <div className="divide-y divide-zinc-800 overflow-hidden rounded-2xl border border-zinc-800">
        {BEATS.map((beat) => <a key={beat.hash} href={TX(beat.hash)} target="_blank" rel="noreferrer" className="group flex flex-wrap items-center gap-4 bg-zinc-900/20 px-5 py-5 transition-colors hover:bg-zinc-900/70 sm:px-6"><span className="font-mono text-xs text-zinc-500">{beat.number}</span><div className="min-w-0 flex-1"><h3 className="text-sm font-medium text-zinc-200 group-hover:text-white">{beat.label}</h3><p className="mt-1 text-xs leading-5 text-zinc-500">{beat.detail}</p></div><span className={`font-mono text-xs ${beat.tone}`}>{beat.result} ↗</span></a>)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2"><a href={`${REPO}#demo-4-minutes`} target="_blank" rel="noreferrer" className="rounded-2xl border border-zinc-800 p-5 hover:border-zinc-600"><span className="text-sm font-medium text-zinc-200">Screenshots & technical walkthrough ↗</span><p className="mt-2 text-xs leading-5 text-zinc-500">The leak comparison, staged attack and owner kill switch, with source code.</p></a><Link href="/freeze" className="rounded-2xl border border-zinc-800 p-5 hover:border-zinc-600"><span className="text-sm font-medium text-zinc-200">Inspect the owner kill switch →</span><p className="mt-2 text-xs leading-5 text-zinc-500">Public status is readable without a wallet. Revocation requires the name owner.</p></Link></div>
    </section>
  );
}

export function HostedNotice() {
  return <div className="space-y-8"><div className="rounded-2xl border border-amber-800/60 bg-amber-950/30 p-5"><h2 className="font-medium text-amber-200">Live runner unavailable</h2><p className="mt-2 text-sm leading-6 text-zinc-400">The presenter’s agent and Anon-RPC bridge are not connected. You can still inspect the current ENS policy on the overview and verify the recorded run below.</p><Link href="/" className="mt-3 inline-block text-sm text-zinc-200 underline underline-offset-4">Inspect current policy →</Link></div><Evidence /></div>;
}
