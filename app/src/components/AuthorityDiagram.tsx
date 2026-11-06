type AuthorityDiagramProps = {
  stage: "idle" | "waiting" | "reading" | "thinking" | "executing";
  readRoute: "anon" | "direct" | "unknown";
  fresh: boolean;
};

/** Structural paths; only current observations can highlight a phase or route. */
export function AuthorityDiagram({ stage, readRoute, fresh }: AuthorityDiagramProps) {
  const observedStage = fresh ? stage : "idle";
  const stageLabel = !fresh ? "Awaiting current observation" : observedStage === "waiting" ? "Run in progress; awaiting phase" : observedStage === "reading" ? "Reading chain state" : observedStage === "thinking" ? "Model deciding" : observedStage === "executing" ? "Trade attempt in progress" : "Ready for a request";
  const anonymousRoute = fresh && readRoute === "anon";
  const directRoute = fresh && readRoute === "direct";
  const routeLabel = anonymousRoute ? "Anon-RPC via Nox observed" : directRoute ? "Direct RPC route observed" : "RPC route not currently verified";
  const steps = [
    { title: "Gemini agent", detail: "Reads state and proposes", active: observedStage === "reading" || observedStage === "thinking" },
    { title: "Vault", detail: "Holds trading funds", active: false },
    { title: "Uniswap v4 hook", detail: "Checks ENS policy", active: observedStage === "executing" },
    { title: "Swap or revert", detail: "Enforced atomically", active: false },
  ];

  return (
    <section aria-label="Kusari authority and RPC architecture" className="architecture-diagram @container text-[#F0F2F6]">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
        <h3 className="text-sm font-medium">Trade execution</h3>
        <p className="text-xs leading-5 text-[#A6ADBB]">{stageLabel}</p>
      </div>

      <ol aria-label="Trade execution path" className="grid grid-cols-1 gap-y-6 @min-[640px]:grid-cols-4 @min-[640px]:gap-x-8 @min-[640px]:gap-y-0">
        {steps.map((step, index) => (
          <li key={step.title} aria-current={step.active ? "step" : undefined} className="relative min-w-0">
            <p className={`text-sm font-medium leading-6 ${step.active ? "text-[#A6E3C2]" : "text-[#F0F2F6]"}`}>{step.title}</p>
            <p className="mt-1 text-sm leading-6 text-[#A6ADBB]">{step.detail}</p>
            {index < steps.length - 1 && <>
              <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="absolute -right-7 top-4 hidden h-5 w-5 text-[#A6ADBB] @min-[640px]:block"><path d="M3 12h17m-5-5 5 5-5 5" /></svg>
              <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="absolute -bottom-5 left-0 h-4 w-4 text-[#A6ADBB] @min-[640px]:hidden"><path d="M12 3v17m-5-5 5 5 5-5" /></svg>
            </>}
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-5 border-t border-[#252A34] pt-5 @min-[640px]:grid-cols-2 @min-[640px]:gap-8">
        <div className="min-w-0">
          <h4 className="text-sm font-medium">ENSv2 authority</h4>
          <p className="mt-1 text-sm leading-6 text-[#A6ADBB]">The owner can revoke the ENS role. The hook reads authorization and limits on every swap.</p>
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-medium">Agent RPC route</h4>
          <p className={`mt-1 text-sm leading-6 ${anonymousRoute ? "text-[#A6E3C2]" : directRoute ? "text-amber-200" : "text-[#A6ADBB]"}`}>{routeLabel}</p>
          <p className="mt-1 text-sm leading-6 text-[#A6ADBB]">{anonymousRoute ? "Agent chain requests reach the RPC provider through Anon-RPC/Nox." : directRoute ? "Agent chain requests currently use a direct route without mixnet anonymity." : "The current agent RPC route could not be verified."} Transactions remain public.</p>
        </div>
      </div>
      <p className="mt-4 max-w-[75ch] text-xs leading-5 text-[#A6ADBB]">Routing observations are not an anonymity proof. The wallet’s own RPC is separate from this agent route.</p>
    </section>
  );
}
