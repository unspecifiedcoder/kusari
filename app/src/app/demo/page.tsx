"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useEventStream, StatusDot } from "@/components/LiveFeed";
import { useKillSwitch } from "@/lib/killswitch";
import { AGENT_URL, ANON_BRIDGE, PROXY_URL, allowDemoControls } from "@/lib/endpoints";
import { HostedNotice } from "@/components/HostedNotice";
import { SandboxControls } from "@/components/SandboxControls";
import { AuthorityDiagram } from "@/components/AuthorityDiagram";
import { OwnerPolicyControls } from "@/components/OwnerPolicyControls";
import { IsolationProof } from "@/components/IsolationProof";
import { deployment, ensDeployment } from "@/generated/deployment";

const PROXY_EVENTS = `${PROXY_URL}/events`;
const BRIDGE_EVENTS = `${ANON_BRIDGE}/events`;
const AGENT = AGENT_URL;

type AgentState = {
  price: number;
  vaultToken0: number;
  vaultToken1: number;
  maxPerSwap: number;
  dailyCap: number;
  spentToday: number;
  maxImpactBps: number;
  authorized: boolean;
  active: boolean;
  allowedPool?: string;
};
type Connection = "connecting" | "live" | "offline";

const time = (t?: unknown) => (typeof t === "number" ? new Date(t).toLocaleTimeString() : "");
const short = (h?: unknown) => (typeof h === "string" ? `${h.slice(0, 10)}…${h.slice(-6)}` : "");

// Live panels need the agent, bridge and proxy, which run on the demo machine. Decide after mount so the
// server render (which has no window) and the first client render agree.
export default function Demo() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (!mounted) return <p className="text-sm text-zinc-500">Connecting to the demonstration…</p>;
  return AGENT ? <LiveDemo /> : <HostedNotice />;
}
const subscribe = () => () => {};

function LiveDemo() {
  const proxy = useEventStream(PROXY_EVENTS);
  const bridge = useEventStream(BRIDGE_EVENTS);
  const agent = useEventStream(`${AGENT}/events`, 40);
  const [status, setStatus] = useState<{ agent?: string; vault?: string; injected?: boolean; transport?: string; readTransport?: string; busy?: boolean; activeRunId?: string; lastState?: AgentState | null; lastStateAt?: number; stateStatus?: string; stateError?: string }>({});
  const [observedAt, setObservedAt] = useState(0);
  const [bridgeMode, setBridgeMode] = useState<string | null>(null);
  const [statusConnection, setStatusConnection] = useState<Connection>("connecting");
  const [controlError, setControlError] = useState<string | null>(null);
  const k = useKillSwitch();

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let refreshing = false;
    const read = async (url: string) => {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
      if (!response.ok) throw new Error("Service unavailable");
      return response.json();
    };
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const [runner, metrics] = await Promise.allSettled([read(`${AGENT}/status`), read(`${ANON_BRIDGE}/metrics`)]);
        if (disposed) return;
        if (runner.status === "fulfilled") { setStatus(runner.value); setObservedAt(Date.now()); setStatusConnection("live"); }
        else setStatusConnection("offline");
        setBridgeMode(metrics.status === "fulfilled" ? metrics.value.mode ?? null : null);
      } finally { refreshing = false; }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 5_000);
    return () => { disposed = true; controller.abort(); clearInterval(interval); };
  }, []);

  const latest = useMemo(() => agent.entries.find((e) => e.type === "state") as unknown as AgentState | undefined, [agent.entries]);
  const state = status.lastState ?? latest ?? undefined;
  const injectEvent = agent.entries.find((e) => e.type === "inject");
  const injected = injectEvent ? Boolean(injectEvent.injected) : Boolean(status.injected);
  const transportEvent = agent.entries.find((e) => e.type === "transport");
  const anonOn = (transportEvent ? String(transportEvent.transport) : (status.transport ?? "anon")) === "anon";
  // Busy from "reading" until "idle". Live Sepolia cycles take ~20s (mixnet reads + tx confirmation).
  const lastCycleEvent = agent.entries.find((e) => e.type === "reading" || e.type === "idle");
  const running = lastCycleEvent ? lastCycleEvent.type === "reading" : Boolean(status.busy);
  const connection: Connection = agent.status === "offline" || statusConnection === "offline" ? "offline" : agent.status === "live" && statusConnection === "live" ? "live" : "connecting";
  const matchingIdentity = status.agent?.toLowerCase() === ensDeployment.agent.toLowerCase() && status.vault?.toLowerCase() === deployment.demoVault.toLowerCase();
  const currentState = Boolean(state && matchingIdentity && connection === "live" && status.stateStatus === "fresh" && status.lastStateAt && observedAt - status.lastStateAt < 60_000);
  const routeFresh = currentState && bridge.status === "live";
  const readRoute = routeFresh && status.readTransport === "anon" && bridgeMode === "anon" ? "anon" : routeFresh && (status.readTransport === "direct" || status.readTransport === "leak" || bridgeMode === "direct") ? "direct" : "unknown";
  const runEvent = status.busy && status.activeRunId ? agent.entries.find((event) => event.runId === status.activeRunId) : undefined;
  const stage = runEvent?.type === "swapping" ? "executing" : runEvent?.type === "decision" || runEvent?.type === "state" ? "thinking" : runEvent?.type === "reading" ? "reading" : status.busy ? "waiting" : "idle";
  const lastSnapshot = status.lastStateAt ? new Date(status.lastStateAt).toLocaleTimeString() : null;

  const post = async (path: string) => {
    if (!allowDemoControls) return;
    setControlError(null);
    try { const r = await fetch(`${AGENT}${path}`, { method: "POST" }); if (!r.ok) throw new Error(r.status === 409 ? "A cycle is already running. Wait for it to finish." : "The runner did not accept this action."); }
    catch (error) { setControlError(error instanceof Error ? error.message : "Action failed"); }
  };

  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div><h1>Agent workspace</h1><p>Request a real Gemini trade and see how the owner’s policy applies.</p></div>
        <Link href="/#onchain-evidence" className="workspace-proof-link">View recorded transactions <ExternalLinkIcon /></Link>
      </header>

      <section aria-label="Configured agent and vault" className="workspace-agent">
        <div className="workspace-agent-identity">
          <span className="agent-monogram" aria-hidden="true">A</span>
          <div><h2>{k.name ?? ensDeployment.name}</h2><p>Shared Sepolia agent <span aria-hidden="true">·</span> Gemini</p></div>
        </div>
        <div className="workspace-agent-state">
          <StatusValue label="Trading authority" value={currentState && state ? state.authorized && state.active ? "Authorized" : "Trading blocked" : state ? "Last snapshot is stale" : "Checking authority"} tone={currentState && state ? state.authorized && state.active ? "safe" : "blocked" : "unknown"} />
          <StatusValue label="Agent RPC route" value={readRoute === "anon" ? "Anon-RPC / Nox" : readRoute === "direct" ? "Direct · not anonymous" : "Not verified"} tone={readRoute === "anon" ? "safe" : readRoute === "direct" ? "blocked" : "unknown"} />
        </div>
        <dl className="workspace-vault-balance">
          <div><dt>Shared vault{!currentState && state ? " · last received" : ""}</dt><dd>{state ? `${formatNumber(state.vaultToken0)} kUSD` : "—"}</dd></div>
          <div><dt>Received asset{!currentState && state ? " · last received" : ""}</dt><dd>{state ? `${formatNumber(state.vaultToken1)} kETH` : "—"}</dd></div>
        </dl>
      </section>

      {connection === "connecting" && <p role="status" className="workspace-notice">Connecting to the runner. You can review recorded transactions while live readings load.</p>}
      {connection === "offline" && <div role="status" className="workspace-notice" data-tone="warning"><strong>The live runner is unavailable.</strong><p>Reconnecting automatically. {state ? "Displayed values are the last received snapshot." : "No live snapshot has been received."} <Link href="/#onchain-evidence">View recorded transactions</Link>.</p></div>}
      {status.stateStatus === "stale" && <p role="status" className="workspace-notice" data-tone="warning">The last chain snapshot is stale{lastSnapshot ? ` (${lastSnapshot})` : ""}. Waiting for fresh readings.</p>}
      {bridgeMode === "direct" && <p role="status" className="workspace-notice" data-tone="warning">The bridge is using direct fallback. Its current traffic is not anonymized.</p>}

      <div className="workspace-grid">
        <div className="workspace-main"><SandboxControls /></div>
        <aside aria-label="Agent policy" className="policy-panel">
          <header className="policy-heading"><h2>Agent policy</h2><span className="workspace-status" data-tone={currentState ? "safe" : "unknown"}>{currentState ? "Current snapshot" : "Awaiting fresh data"}</span></header>
          <p className="policy-description">These limits apply to every requested trade.</p>
          <dl className="policy-values" data-fresh={currentState}>
            <PolicyValue label="Per-trade cap" value={state ? `${formatNumber(state.maxPerSwap)} kUSD` : "—"} />
            <PolicyValue label="Remaining today" value={state ? `${formatNumber(Math.max(0, state.dailyCap - state.spentToday))} kUSD` : "—"} />
            <PolicyValue label="Daily cap" value={state ? `${formatNumber(state.dailyCap)} kUSD` : "—"} />
            <PolicyValue label="Max pool impact" value={state ? `${formatNumber(state.maxImpactBps / 100)}%` : "—"} />
            <div className="policy-value policy-pool"><dt>Allowed pool</dt><dd className="policy-pool-id" title={state?.allowedPool}>{state?.allowedPool ? short(state.allowedPool) : "Awaiting policy read"}</dd></div>
          </dl>
          <div className="policy-sources"><a href={`https://sepolia.etherscan.io/address/${deployment.policySource}`} target="_blank" rel="noreferrer">ENS policy source <ExternalLinkIcon /></a><a href={`https://sepolia.etherscan.io/address/${deployment.policyHook}`} target="_blank" rel="noreferrer">Uniswap v4 hook <ExternalLinkIcon /></a></div>
          <p className="policy-observed">{currentState ? `Observed${lastSnapshot ? ` at ${lastSnapshot}` : " onchain"}.` : state ? `Last received${lastSnapshot ? ` at ${lastSnapshot}` : ""}; values may have changed.` : "Waiting for the chain snapshot."}</p>
          <div className="policy-footer">
            <Controls injected={injected} running={running} online={connection === "live"} onRun={() => post("/tick")} onInject={() => post(`/inject?on=${injected ? 0 : 1}`)} anonOn={anonOn} onTransport={() => post(`/transport?mode=${anonOn ? "leak" : "anon"}`)} agentAddress={status.agent} />
            {controlError && <p role="alert" className="workspace-notice" data-tone="warning">{controlError}</p>}
          </div>
        </aside>
      </div>

      <OwnerPolicyControls owner={k.owner} />

      <IsolationProof />

      <details className="workspace-activity workspace-details">
        <summary><div><h2>Shared activity</h2><p>Recent decisions and transactions from all visitors</p></div><StatusDot status={connection} /><DisclosureIcon /></summary>
        <div className="workspace-details-body"><p className="workspace-detail-note">This history is shared. Your result in the workspace follows only your signed request.</p><div className="activity-scroll" tabIndex={0} role="region" aria-label="Shared run history"><Activity entries={agent.entries} connection={connection} running={running} /></div></div>
      </details>

      <details className="workspace-details workspace-integrations">
        <summary><div><h2>Integration details</h2><p>ENSv2 policy, Uniswap v4 enforcement and Anon-RPC / Nox routing</p></div><DisclosureIcon /></summary>
        <div className="workspace-details-body">
          <AuthorityDiagram stage={stage} readRoute={readRoute} fresh={currentState} deterministic={Boolean(runEvent?.ownerPolicyCheck)} />
          <section aria-label="Observed RPC traffic" className="integration-grid">
            <Card title="Public-provider comparison log" right={<StatusDot status={proxy.status} />}>
              <Feed empty={proxy.status === "offline" ? "The comparison log is unavailable. Reconnecting automatically." : proxy.status === "connecting" ? "Connecting to the comparison log…" : allowDemoControls ? "No calls have reached the comparison provider. Turn Anon-RPC off for the controlled leak comparison." : "No calls have reached the comparison provider in this session. Routing changes stay presenter-controlled. An empty log alone does not prove anonymity."} rows={proxy.entries.map((e) => ({ t: time(e.t), main: `${String(e.ip)}  ${String(e.method)}`, sub: typeof e.detail === "object" && e.detail && "fn" in e.detail ? String((e.detail as { fn: string }).fn) : "", tone: "leak" }))} />
            </Card>
            <Card title={bridgeMode === "anon" ? "Anon-RPC bridge: Nox mixnet" : bridgeMode === "direct" ? "Bridge: direct fallback (not anonymous)" : "Bridge traffic · verifying route"} right={<StatusDot status={bridge.status} />}>
              <Feed empty={bridge.status === "offline" ? "Bridge traffic is unavailable. Its current route cannot be verified." : bridge.status === "connecting" ? "Connecting to the bridge traffic feed…" : "Observed RPC methods and timings appear here when the agent reads or submits a transaction."} rows={bridge.entries.map((e) => ({ t: time(e.t), main: `${String(e.transport ?? "route unknown")}  ${String(e.method)}`, sub: `${String(e.ms)} ms · ${String(e.transport)}`, tone: e.ok ? "safe" : "leak" }))} />
            </Card>
          </section>
          <p className="workspace-detail-note">Agent routing is separate from the wallet’s own RPC. Transactions remain public onchain. The poisoned-news scenario is staged; contract enforcement and receipts are real.</p>
        </div>
      </details>
    </div>
  );
}

const formatNumber = (value: number) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";

function PolicyValue({ label, value }: { label: string; value: string }) {
  return <div className="policy-value"><dt>{label}</dt><dd>{value}</dd></div>;
}

function StatusValue({ label, value, tone }: { label: string; value: string; tone: "safe" | "blocked" | "unknown" }) {
  return <div className="workspace-status-value"><span>{label}</span><strong className="workspace-status" data-tone={tone}>{value}</strong></div>;
}

function Controls(props: {
  injected: boolean;
  running: boolean;
  online: boolean;
  onRun: () => void;
  onInject: () => void;
  anonOn: boolean;
  onTransport: () => void;
  agentAddress?: string;
}) {
  const k = useKillSwitch();
  const frozen = k.authorized === false;

  if (!allowDemoControls && !k.canManage) return <div className="policy-owner-note"><p>Only the verified ENS owner can freeze or restore this agent.</p><Link href="/freeze">View owner controls</Link></div>;

  return (
    <section aria-label="Owner authorization controls" className="policy-owner-controls">
      {allowDemoControls && <div className="presenter-controls"><button onClick={props.onRun} disabled={!props.online || props.running} className="workspace-secondary-button">{props.running ? "Agent thinking…" : "Run agent once"}</button><button onClick={props.onInject} disabled={!props.online} className="workspace-secondary-button" data-active={props.injected}>{props.injected ? "Poisoned news: ON" : "Inject poisoned news"}</button><button onClick={props.onTransport} disabled={!props.online || props.running} title="Where the agent's reads and transactions go" className="workspace-secondary-button" data-active={props.anonOn}>{props.anonOn ? "Anon-RPC: ON" : "Anon-RPC: OFF (leaking)"}</button><p>The staged attack uses a deliberately gullible prompt.</p></div>}
      <div className="owner-action-group">
        <div className="owner-action-heading"><h3>Owner control</h3><Link href="/freeze">Details</Link></div>
        <p>Revoke the ENS role to block the agent’s next trade.</p>
        {k.error && <p role="alert" className="owner-error">{k.error.message.split("\n")[0]}</p>}
        {k.hash && <a className="owner-receipt" data-failed={k.transactionFailed} href={`https://sepolia.etherscan.io/tx/${k.hash}`} target="_blank" rel="noreferrer">{k.transactionFailed ? "Transaction reverted" : k.confirmed ? "Confirmed" : "Transaction submitted"} · {short(k.hash)} <ExternalLinkIcon /></a>}
        <button onClick={frozen ? k.unfreeze : k.freeze} disabled={!k.canManage || k.isPending || k.authorized === undefined} title={k.canManage ? `Owner ${frozen ? "re-grants" : "revokes"} the agent (${k.via})` : "Only the verified ENS owner on Sepolia can change authority"} className="owner-authorization-button" data-frozen={frozen}>{k.isPending ? "Confirming…" : frozen ? "Restore agent authorization" : "Freeze agent"}</button>
      </div>
    </section>
  );
}

function Activity({ entries, connection, running }: { entries: Record<string, unknown>[]; connection: Connection; running: boolean }) {
  const rows = entries.filter((e) => ["decision", "swap", "error", "inject"].includes(String(e.type)));
  if (!rows.length) return <div className="activity-empty"><p>{connection === "offline" ? "The activity feed is unavailable. This page will reconnect automatically." : connection === "connecting" ? "Connecting to the agent’s activity feed…" : running ? "The agent is reading the chain. Its decision and transaction result will appear here." : allowDemoControls ? "No activity yet. Run the agent once to begin the demonstration." : "The runner is connected. Request a trade to see a real decision and result here."}</p>{!allowDemoControls && <Link href="/#onchain-evidence">View recorded transactions</Link>}</div>;
  return <ul className="activity-list">{rows.map((e, i) => {
    if (e.type === "decision") return <li key={i} className="activity-row" data-kind="decision"><div className="activity-row-heading"><span className="activity-time">{time(e.t)}</span><strong>{e.source === "owner-policy-check" ? "Fixed owner test" : "Agent decision"}: {String(e.action)} {String(e.amountIn)} kUSD</strong>{e.injected ? <span className="activity-scenario">Poisoned news</span> : null}</div><p>{String(e.reason)}</p><span className="activity-source">{String(e.source)}</span></li>;
    if (e.type === "swap") return <li key={i} className="activity-row" data-kind={e.status === "success" ? "success" : e.status === "blocked" ? "blocked" : "error"}><div className="activity-row-heading"><span className="activity-time">{time(e.t)}</span><strong>{e.status === "success" ? `${String(e.amountIn)} kUSD swap confirmed` : e.status === "blocked" && typeof e.hash === "string" ? `${String(e.amountIn)} kUSD transaction reverted onchain` : e.status === "blocked" ? `${String(e.amountIn)} kUSD request blocked in simulation` : "Swap could not be submitted"}</strong></div><p>{e.status === "success" ? "Executed within policy" : String(e.message ?? e.reason ?? "No confirmed execution")}</p>{typeof e.hash === "string" && <a className="activity-receipt" href={`https://sepolia.etherscan.io/tx/${e.hash}`} target="_blank" rel="noreferrer">View transaction {short(e.hash)} <ExternalLinkIcon /></a>}</li>;
    if (e.type === "inject") return <li key={i} className="activity-row" data-kind="decision"><span className="activity-time">{time(e.t)}</span><p>Poisoned news {e.injected ? "injected into the feed" : "removed"}</p></li>;
    return <li key={i} className="activity-row" data-kind="error"><span className="activity-time">{time(e.t)}</span><p>{String(e.message)}</p></li>;
  })}</ul>;
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return <div className="integration-panel"><div className="integration-panel-heading"><h3>{title}</h3>{right}</div>{children}</div>;
}

function Feed({ rows, empty }: { rows: { t: string; main: string; sub: string; tone: string }[]; empty: string }) {
  if (!rows.length) return <p className="integration-empty">{empty}</p>;
  return <ul className="rpc-feed">{rows.map((r, i) => <li key={i} data-tone={r.tone}><span className="activity-time">{r.t}</span><span>{r.main}</span>{r.sub && <span className="rpc-feed-detail">{r.sub}</span>}</li>)}</ul>;
}

function ExternalLinkIcon() {
  return <svg className="inline-icon" aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 4H4v12h12v-3M10 4h6v6M16 4l-8 8" /></svg>;
}

function DisclosureIcon() {
  return <svg className="disclosure-icon" aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m6 8 4 4 4-4" /></svg>;
}
