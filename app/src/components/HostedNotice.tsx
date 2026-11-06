// Shown on /demo when the page is served from a public host (e.g. Vercel), where the agent, the Anon-RPC
// bridge and the logging proxy aren't reachable. Points visitors at the on-chain evidence instead.
const REPO = "https://github.com/unspecifiedcoder/kusari";
const TX = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;

const BEATS = [
  { label: "Normal agent swap within policy", hash: "0xe79db59b22da6d38add13d5d053457aae3a405aef67ff664cfbef3bd58d11bb4" },
  { label: "LLM hijacked by poisoned news: 89.9 kUSD swap reverted on-chain (ExceedsPerSwap)", hash: "0x29d7862d9241f3843278c03dd800472c61a227636c3cc3b05f24b0ea6cb95248" },
  { label: "Owner revokes the agent's ENS role", hash: "0xa22fdeb76d2e072b9b748c3a3ec9dcbee43539b57223cb8fb7b0a5ecd9d7bc1e" },
  { label: "Next swap reverts: NotAuthorized", hash: "0xfbf74e590c107025e227d5bb329847f86fc580bfa395479d33fd88ed500912b8" },
];

export function HostedNotice() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-700/60 bg-amber-950/30 p-5">
        <h1 className="text-lg font-semibold">The live demo runs on the team&apos;s machine</h1>
        <p className="pt-2 text-sm text-zinc-300">
          The agent, the Anon-RPC bridge (headless Chromium + the Nox worker) and the leak proxy are long-running local
          processes, so this hosted page can&apos;t show them live. Everything below is on Sepolia and can be checked now.
        </p>
      </div>
      <section className="rounded-xl border border-zinc-800 p-5">
        <h2 className="text-sm font-medium text-zinc-400">Every demo beat, on-chain</h2>
        <ul className="space-y-2 pt-3 text-sm">
          {BEATS.map((b) => (
            <li key={b.hash} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-900 px-3 py-2">
              <span>{b.label}</span>
              <a className="font-mono text-xs text-zinc-400 underline" href={TX(b.hash)} target="_blank" rel="noreferrer">
                {b.hash.slice(0, 10)}…{b.hash.slice(-6)}
              </a>
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        <a href={`${REPO}#demo-4-minutes`} className="rounded-xl border border-zinc-800 p-5 hover:bg-zinc-900">
          <div className="font-medium">Screenshots + walkthrough →</div>
          <p className="pt-1 text-sm text-zinc-400">Anon-RPC off vs on, the hijack blocked, the kill switch.</p>
        </a>
        <a href="/freeze" className="rounded-xl border border-zinc-800 p-5 hover:bg-zinc-900">
          <div className="font-medium">Kill switch (works here) →</div>
          <p className="pt-1 text-sm text-zinc-400">Connect the owner wallet to freeze or unfreeze the agent via ENS.</p>
        </a>
      </section>
    </div>
  );
}
