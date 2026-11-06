import Link from "next/link";
import { JudgeOverview } from "@/components/JudgeOverview";
import { Evidence } from "@/components/HostedNotice";

export default function Home() {
  return (
    <div className="space-y-10 sm:space-y-14">
      <section className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-linear-to-br from-emerald-950/40 via-zinc-950 to-zinc-900 p-6 sm:p-10">
        <div aria-hidden="true" className="pointer-events-none absolute -right-6 -top-14 select-none text-[240px] font-bold leading-none text-emerald-400/5">鎖</div>
        <div className="relative max-w-3xl">
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">AI agents · Human authority · Onchain enforcement</p>
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.12] tracking-tight sm:text-5xl">Give your agent a budget.<br /><span className="text-zinc-400">Keep the final say.</span></h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-300">Kusari puts an AI trading agent inside owner-defined boundaries. An ENS policy sets the rules, a Uniswap v4 hook enforces them, and the owner can revoke access.</p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/demo#try-sandbox" className="rounded-xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-zinc-950 hover:bg-emerald-300">Try the live AI agent <span aria-hidden="true">→</span></Link>
            <a href="#onchain-evidence" className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-medium text-zinc-200 hover:border-zinc-500">Verify the transactions</a>
          </div>
          <p className="mt-4 text-xs text-zinc-500">Inspect without a wallet, or connect to run the funded Sepolia sandbox. Your wallet supplies no tokens or gas.</p>
        </div>
      </section>
      <JudgeOverview />
      <section aria-labelledby="how-it-works" className="space-y-5">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">The complete loop</p><h2 id="how-it-works" className="mt-2 text-2xl font-semibold tracking-tight">A bad decision meets a hard boundary.</h2></div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["01", "The agent decides", "A model reads pool state and news, then signs a swap intent. Anon-RPC routes the agent’s chain requests through the Nox mixnet."],
            ["02", "The contract checks", "The vault routes into a guarded pool. The hook reads authorization and limits from ENS and checks the actual swap result."],
            ["03", "The owner stays in control", "Oversized trades revert. Revoking the agent’s ENS role blocks its next swap, even when that swap was signed earlier."],
          ].map(([number, title, body]) => <article key={number} className="rounded-2xl border border-zinc-800 p-5"><span className="font-mono text-xs text-emerald-400">{number}</span><h3 className="mt-4 font-medium text-zinc-100">{title}</h3><p className="mt-2 text-sm leading-6 text-zinc-400">{body}</p></article>)}
        </div>
      </section>
      <Evidence />
      <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 text-sm leading-6 text-zinc-400"><strong className="font-medium text-zinc-200">What the protection covers.</strong> Spending caps, an allowed pool, direction, signed output bounds and owner revocation. Transactions remain public onchain; RPC anonymity does not hide a trade. An allowed trade can still lose value. The injection demonstration is staged, and these contracts are unaudited.</aside>
    </div>
  );
}
