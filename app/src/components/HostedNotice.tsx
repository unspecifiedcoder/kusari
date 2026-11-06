import Link from "next/link";

const REPO = "https://github.com/unspecifiedcoder/kusari/tree/codex/judge-ready";
const TX = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;

const BEATS = [
  { number: "01", label: "A normal trade", detail: "Gemini requests a 5 kUSD swap within the owner’s policy. It executes.", hash: "0x7816c314503bcf336d7780c3d567da65e7a37b2e9ec761b5a120a3b01aab0ad4", result: "Executed", tone: "text-emerald-300" },
  { number: "02", label: "An oversized trade", detail: "Poisoned news makes the staged agent request 95 kUSD. The hook rejects it; vault funds stay unchanged.", hash: "0xa0295bab9d5006f67b61ad8d7a04d5a0919317b2cbd7b92aa70aec01ca13df00", result: "ExceedsPerSwap", tone: "text-red-300" },
  { number: "03", label: "Owner revocation", detail: "The owner removes the agent’s ENS authorization role.", hash: "0x0091c5259fc3abfaac082c62c7b8cbf7d662d6ca0608c85306e6afc921f04981", result: "Role revoked", tone: "text-zinc-300" },
  { number: "04", label: "The next trade", detail: "Even a 0.1 kUSD trade is blocked because the agent no longer has authority.", hash: "0xe8a72a961db3e7195c047b3dd4987901a74ec81777a74287362b7d176bc66dc6", result: "NotAuthorized", tone: "text-red-300" },
  { number: "05", label: "The owner restores access", detail: "Only the owner can grant the ENS role again.", hash: "0x4e9b9c1aeee0fdf5659bd677204fb01a24cab9c7121cf7cb37fe1a857e3dffaf", result: "Re-enabled", tone: "text-emerald-300" },
  { number: "06", label: "Trading resumes", detail: "The re-enabled agent completes a 0.1 kUSD swap. The complete loop is verified.", hash: "0x5275c8476b62ed7128d39ac0f22708f19b64806912a5f2dcbe58951193c3f897", result: "Executed", tone: "text-emerald-300" },
];

export function Evidence() {
  return (
    <section id="onchain-evidence" aria-labelledby="evidence-title" className="scroll-mt-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Independently verifiable</p><h2 id="evidence-title" className="mt-2 text-2xl font-semibold tracking-tight">Follow the evidence onchain.</h2></div><span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">Recorded Sepolia run</span></div>
      <p className="max-w-3xl text-sm leading-6 text-zinc-400">Verified on 6 November 2026 for alpha.kusari-pramod.eth, the deployment shown above. These recorded receipts remain available when the live runner is offline. The owner restored access after the rehearsal.</p>
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
