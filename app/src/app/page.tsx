import Link from "next/link";
import { JudgeOverview } from "@/components/JudgeOverview";
import { Evidence } from "@/components/HostedNotice";

export default function Home() {
  return (
    <div className="kusari-home space-y-10 sm:space-y-14">
      <section className="kusari-hero" aria-labelledby="kusari-title">
        <div className="min-w-0">
          <p className="mb-5 text-sm font-medium text-zinc-400">Funded Sepolia sandbox</p>
          <h1 id="kusari-title" className="kusari-hero-title">Your agent decides.<br />You set the limits.</h1>
          <p className="mt-6 max-w-[62ch] text-base leading-7 text-zinc-300">Run Gemini against a funded Sepolia vault. ENS holds the owner’s policy, and a Uniswap v4 hook checks every swap against it.</p>
          <div className="mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Link href="/demo#try-sandbox" className="kusari-primary-action rounded-xl bg-emerald-400 px-5 py-3.5 text-center text-sm font-semibold text-zinc-950 hover:bg-emerald-300">Try the live AI agent</Link>
            <a href="#onchain-evidence" className="rounded-xl border border-zinc-700 px-5 py-3.5 text-center text-sm font-medium text-zinc-200 hover:border-zinc-500">Inspect transactions</a>
          </div>
          <p className="mt-4 max-w-[64ch] text-xs leading-6 text-zinc-400">Inspect wallet-free. To run a scenario, connect a wallet and sign one request. The sandbox supplies test tokens and gas.</p>
        </div>
        <div aria-hidden="true" className="kusari-hero-mark">鎖</div>
      </section>
      <JudgeOverview />
      <section aria-labelledby="how-it-works" className="space-y-5">
        <h2 id="how-it-works" className="max-w-[34ch] text-2xl font-semibold leading-snug tracking-tight">The model makes requests.<br />Contracts enforce limits.</h2>
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
