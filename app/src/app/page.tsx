import Link from "next/link";
import { JudgeOverview } from "@/components/JudgeOverview";
import { Evidence } from "@/components/HostedNotice";

export default function Home() {
  return (
    <div className="overview-content space-y-10 sm:space-y-12">
      <section className="overview-heading" aria-labelledby="kusari-title">
        <div><h1 id="kusari-title">Agent overview</h1><p>Inspect the policy and funded vault, then try a real Gemini trade request.</p></div>
        <Link href="/demo#try-sandbox" className="product-primary-link">Open agent workspace <span aria-hidden="true">↗</span></Link>
      </section>
      <JudgeOverview />
      <section aria-labelledby="how-it-works" className="space-y-5">
        <h2 id="how-it-works" className="max-w-[34ch] text-2xl font-semibold leading-snug tracking-tight">How a trade request works</h2>
        <ol className="grid gap-6 sm:grid-cols-3">
          {[
            ["01", "The agent decides", "A model reads pool state and news, then signs a swap intent. Anon-RPC routes the agent’s chain requests through the Nox mixnet."],
            ["02", "The contract checks", "The vault routes into a guarded pool. The hook reads authorization and limits from ENS and checks the actual swap result."],
            ["03", "The owner stays in control", "Oversized trades revert. Revoking the agent’s ENS role blocks its next swap, even when that swap was signed earlier."],
          ].map(([number, title, body]) => <li key={number} className="min-w-0 border-t border-zinc-700/70 pt-4"><span className="font-mono text-xs text-zinc-500">{number}</span><h3 className="mt-3 font-medium text-zinc-100">{title}</h3><p className="mt-2 text-sm leading-6 text-zinc-400">{body}</p></li>)}
        </ol>
      </section>
      <Evidence />
      <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 text-sm leading-6 text-zinc-400"><p><strong className="font-medium text-zinc-200">What the protection covers.</strong> Spending caps, an allowed pool, direction, signed output bounds and owner revocation. Transactions remain public onchain; RPC anonymity does not hide a trade. An allowed trade can still lose value. The injection demonstration is staged, and these contracts are unaudited.</p></aside>
    </div>
  );
}
