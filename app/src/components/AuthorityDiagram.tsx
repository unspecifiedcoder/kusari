type AuthorityDiagramProps = {
  stage: "idle" | "waiting" | "reading" | "thinking" | "executing";
  readRoute: "anon" | "direct" | "unknown";
  fresh: boolean;
};

/** Structural paths, with highlights driven only by the caller's observed phase. */
export function AuthorityDiagram({ stage, readRoute, fresh }: AuthorityDiagramProps) {
  const observedStage = fresh ? stage : "idle";
  const stageLabel = !fresh ? "Awaiting current observation" : observedStage === "waiting" ? "Run in progress · awaiting phase" : observedStage === "reading" ? "Reading chain state" : observedStage === "thinking" ? "Model deciding" : observedStage === "executing" ? "Trade attempt in progress" : "Ready for a request";
  const anonymousRoute = fresh && readRoute === "anon";
  const directRoute = fresh && readRoute === "direct";
  const routeLabel = anonymousRoute ? "Anon-RPC via Nox observed" : directRoute ? "Direct RPC route observed" : "RPC route not currently verified";
  const steps = [
    { title: "Gemini agent", detail: "Proposes a trade", active: observedStage === "thinking" },
    { title: "Vault", detail: "Holds trading funds", active: observedStage === "executing" },
    { title: "Uniswap v4 hook", detail: "Checks owner policy", active: observedStage === "executing" },
    { title: "Swap or revert", detail: "Enforced atomically", active: false },
  ];

  return (
    <section aria-label="Kusari authority and RPC architecture" className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium text-zinc-200">Authority path</h2>
        <p className="text-xs text-zinc-400">{stageLabel}</p>
      </div>

      <ol aria-label="Trade execution path" className="grid gap-3">
        {steps.map((step, index) => (
          <li key={step.title} className={`relative flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 rounded-lg border px-3 py-2 ${step.active ? "border-emerald-700 bg-emerald-950/40" : "border-zinc-800 bg-zinc-900/30"}`}>
            <p className={`text-xs font-medium leading-5 ${step.active ? "text-emerald-200" : "text-zinc-200"}`}>{step.title}</p>
            <p className="text-xs leading-5 text-zinc-400">{step.detail}</p>
            {index < steps.length - 1 && <span aria-hidden="true" className={`absolute -bottom-3 left-3 text-xs leading-none ${step.active ? "text-emerald-400" : "text-zinc-500"}`}>↓</span>}
          </li>
        ))}
      </ol>

      <div className="mt-3 grid gap-3 border-t border-zinc-800 pt-3 text-xs leading-5">
        <div className="min-w-0">
          <p className="font-medium text-zinc-200">Owner → ENSv2 → PolicyHook</p>
          <p className="mt-0.5 text-zinc-400">The owner can revoke authority. The hook reads ENS authorization and limits on each swap.</p>
        </div>
        <div className="min-w-0">
          <p className={`font-medium ${anonymousRoute ? "text-emerald-300" : directRoute ? "text-amber-200" : "text-zinc-300"}`}>{routeLabel}</p>
          <p className="mt-0.5 text-zinc-400">{anonymousRoute ? "Agent RPC → Anon-RPC / Nox → RPC provider." : directRoute ? "Agent RPC currently uses a direct route; it is not anonymized." : "The agent’s RPC path is separate from trade execution."} Onchain transactions remain public.</p>
        </div>
      </div>
    </section>
  );
}
