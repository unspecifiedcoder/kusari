import proof from "../../public/evidence/owned-workspaces.json";
import "./IsolationProof.css";

const explorer = "https://sepolia.etherscan.io";
const source = "https://github.com/unspecifiedcoder/kusari/blob/67fd59f5fab87aebccd837f0925508b4eedaf27b/docs/evidence/owned-workspaces.json";
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;

const steps = [
  { label: "Agent A trades 1 kUSD", result: "Confirmed", tone: "safe", hash: proof.runs[0].hash },
  { label: "Agent B trades 1 kUSD", result: "Confirmed", tone: "safe", hash: proof.runs[1].hash },
  { label: "Owner A freezes Agent A", result: "Role revoked", tone: "blocked", hash: proof.transactions.find((tx) => tx.step === "A: freezes its own agent")!.hash },
  { label: "Agent A requests another 1 kUSD", result: "Reverted onchain", tone: "blocked", hash: proof.runs[2].hash },
  { label: "Agent B trades while A is frozen", result: "Confirmed", tone: "safe", hash: proof.runs[3].hash },
  { label: "Owner A restores Agent A", result: "Role restored", tone: "safe", hash: proof.transactions.find((tx) => tx.step === "A: restores its own agent")!.hash },
];

export function IsolationProof() {
  return (
    <details id="two-agent-proof" className="workspace-details isolation-proof">
      <summary>
        <div><h2>Two-agent isolation proof</h2><p>Recorded Sepolia transactions · independent owners, names and vaults</p></div>
        <svg className="disclosure-icon" aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m6 8 4 4 4-4" /></svg>
      </summary>
      <div className="workspace-details-body">
        <p className="isolation-explanation">Owner A froze Agent A. Its next trade reverted, while Agent B continued trading under its own ENS policy.</p>
        <p className="workspace-detail-note">Recorded on 6 November 2026. These receipts are separate from your live run above. Inspect the proof without connecting a wallet.</p>
        <div className="isolation-identities">
          {Object.entries(proof.workspaces).map(([id, workspace]) => (
            <section key={id} aria-labelledby={`isolation-agent-${id}`}>
              <h3 id={`isolation-agent-${id}`}>Agent {id}</h3>
              <p className="isolation-name">{workspace.name}</p>
              <dl>
                {([['Owner', workspace.owner], ['Agent', workspace.agent], ['Vault', workspace.vault], ['Resolver', workspace.resolver]] as const).map(([label, address]) => (
                  <div key={label}><dt>{label}</dt><dd><a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" title={address} aria-label={`Agent ${id} ${label.toLowerCase()}: ${address}`}>{short(address)}</a></dd></div>
                ))}
                <div><dt>Per-trade cap</dt><dd>{workspace.maxPerSwap} kUSD</dd></div>
              </dl>
            </section>
          ))}
        </div>
        <ol className="isolation-sequence" aria-label="Recorded two-owner isolation sequence">
          {steps.map((step) => <li key={step.hash}>
            <span>{step.label}</span>
            <strong data-tone={step.tone}>{step.result}</strong>
            <a href={`${explorer}/tx/${step.hash}`} target="_blank" rel="noreferrer" aria-label={`${step.label}: view Sepolia transaction`}>View receipt</a>
          </li>)}
        </ol>
        <p className="isolation-accounting">At the end of this rehearsal: Agent A spent {proof.spending.A} kUSD; Agent B spent {proof.spending.B} kUSD. Spending was accounted for independently by agent address.</p>
        <p className="workspace-detail-note">Each owner could revoke the marker role on their own agent’s ENS label. Policy editing and vault withdrawals stayed with the respective owners. Kusari uses ENSv2’s <code>ROLE_RENEW</code> (65536) as that narrow authorization marker.</p>
        <p className="workspace-detail-note">These were CLI rehearsal identities, with temporary keys discarded afterward. They are not reusable Alpha/Beta browser accounts.</p>
        <div className="isolation-links"><a href="/evidence/owned-workspaces.json" target="_blank" rel="noreferrer">Open evidence report</a><a href={source} target="_blank" rel="noreferrer">View source record</a></div>
      </div>
    </details>
  );
}
