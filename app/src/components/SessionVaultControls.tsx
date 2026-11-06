"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useConnection, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { formatEther, isAddress, parseAbiItem, type Address, type Hex } from "viem";
import { sessionDeployment, sepoliaConfig } from "@/generated/deployment";
import { factoryAbi, tokenAbi } from "@/lib/abi";
import { sessionApproval, sessionStateViewAbi, sessionVaultAbi, suggestedSessionRate, type SessionSwapEvidence } from "@/lib/session-vault";
import { assertSepoliaWallet } from "@/lib/wallet-safety";
import { useCanonicalSite } from "@/lib/canonical-site";
import styles from "./SessionVaultControls.module.css";

type SessionDeployment = { chainId: number; sessionVaultFactory: Address; policyHook: Address; policySource: Address; token0: Address; token1: Address; poolId: Hex; sessionVault?: Address; sessionVaultDeploymentBlock?: number | string };
type Snapshot = { owner: Address; agent: Address; remaining: bigint; expiresAt: bigint; rate: bigint; id: bigint; inputBalance: bigint; outputBalance: bigint; blockTimestamp: bigint; checkedAt: string; reference?: bigint; suggested?: bigint };
const config = sessionDeployment as SessionDeployment | null;
const explorer = "https://sepolia.etherscan.io";
const units = (amount: bigint) => formatEther(amount);
const short = (address: string) => `${address.slice(0, 8)}…${address.slice(-6)}`;
const date = (seconds: bigint) => seconds === 0n ? "Not set" : new Date(Number(seconds) * 1000).toLocaleString();
const swapEvent = parseAbiItem("event SessionSwap(uint256 indexed sessionId,uint256 requestedInput,uint256 actualInput,uint256 actualOutput,uint256 remainingBudget)");

export function SessionVaultControls() {
  const { address, chainId, connector, isConnected } = useConnection();
  const { isCanonical } = useCanonicalSite();
  const client = usePublicClient({ chainId: 11155111 });
  const { writeContractAsync } = useWriteContract();
  const [vault, setVault] = useState<Address | undefined>(config?.sessionVault);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [budget, setBudget] = useState("5");
  const [duration, setDuration] = useState("15");
  const [floor, setFloor] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [hash, setHash] = useState<Hex>();
  const [evidence, setEvidence] = useState<SessionSwapEvidence[]>([]);
  const [evidenceError, setEvidenceError] = useState("");
  const requestGeneration = useRef(0);
  const submitting = useRef(false);
  const ownVaults = useReadContract({ chainId: 11155111, address: config?.sessionVaultFactory, abi: factoryAbi, functionName: "vaultsOf", args: address ? [address] : undefined, query: { enabled: Boolean(address && config?.sessionVaultFactory), refetchInterval: 15_000 } });
  const vaults = [...new Set([...(config?.sessionVault ? [config.sessionVault] : []), ...((ownVaults.data ?? []) as readonly Address[])])];
  const ownerMatches = Boolean(snapshot && address?.toLowerCase() === snapshot.owner.toLowerCase());
  const canManage = Boolean(ownerMatches && isConnected && chainId === 11155111 && isCanonical);
  const expired = Boolean(snapshot && snapshot.expiresAt > 0n && snapshot.expiresAt <= snapshot.blockTimestamp);
  const active = Boolean(snapshot && snapshot.remaining > 0n && snapshot.rate > 0n && snapshot.expiresAt > snapshot.blockTimestamp);

  useEffect(() => {
    if (vault || !ownVaults.data?.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Select an actual vault discovered from the external owner-indexed factory.
    setVault(ownVaults.data[0]);
  }, [vault, ownVaults.data]);

  async function refresh(selected = vault) {
    if (!client || !config || !selected) return;
    if (config.chainId !== 11155111 || await client.getChainId() !== 11155111) throw new Error("Session controls require the separate Sepolia deployment.");
    const generation = ++requestGeneration.current;
    const [owner, agent, hook, token0, token1, pool, remaining, expiresAt, rate, id, block] = await Promise.all([
      client.readContract({ address: selected, abi: sessionVaultAbi, functionName: "owner" }),
      client.readContract({ address: selected, abi: sessionVaultAbi, functionName: "agent" }),
      client.readContract({ address: selected, abi: sessionVaultAbi, functionName: "hook" }),
      client.readContract({ address: selected, abi: sessionVaultAbi, functionName: "token0" }),
      client.readContract({ address: selected, abi: sessionVaultAbi, functionName: "token1" }),
      client.readContract({ address: selected, abi: sessionVaultAbi, functionName: "allowedPool" }),
      client.readContract({ address: selected, abi: sessionVaultAbi, functionName: "remainingBudget" }),
      client.readContract({ address: selected, abi: sessionVaultAbi, functionName: "sessionExpiresAt" }),
      client.readContract({ address: selected, abi: sessionVaultAbi, functionName: "minRateWad" }),
      client.readContract({ address: selected, abi: sessionVaultAbi, functionName: "sessionId" }),
      client.getBlock(),
    ]);
    if (hook.toLowerCase() !== config.policyHook.toLowerCase() || token0.toLowerCase() !== config.token0.toLowerCase() || token1.toLowerCase() !== config.token1.toLowerCase() || pool.toLowerCase() !== config.poolId.toLowerCase()) throw new Error("This vault does not match the separate session deployment’s hook, tokens and pool.");
    const [inputBalance, outputBalance, decimals0, decimals1, slot] = await Promise.all([
      client.readContract({ address: token0, abi: tokenAbi, functionName: "balanceOf", args: [selected] }),
      client.readContract({ address: token1, abi: tokenAbi, functionName: "balanceOf", args: [selected] }),
      client.readContract({ address: token0, abi: tokenAbi, functionName: "decimals" }),
      client.readContract({ address: token1, abi: tokenAbi, functionName: "decimals" }),
      client.readContract({ address: sepoliaConfig.uniswap.stateView, abi: sessionStateViewAbi, functionName: "getSlot0", args: [pool] }).catch(() => undefined),
    ]);
    if (decimals0 !== 18 || decimals1 !== 18) throw new Error("This session view supports the deployment’s 18-decimal kUSD/kETH test-token pair only.");
    const quote = slot ? suggestedSessionRate(slot[0], slot[3]) : undefined;
    if (generation !== requestGeneration.current) return;
    setSnapshot({ owner, agent, remaining, expiresAt, rate, id, inputBalance, outputBalance, blockTimestamp: block.timestamp, checkedAt: new Date().toLocaleTimeString(), reference: quote?.afterFee, suggested: quote?.floor });
    try {
      const start = config.sessionVaultDeploymentBlock ? BigInt(config.sessionVaultDeploymentBlock) : block.number > 2000n ? block.number - 2000n : 0n;
      const logs = await client.getLogs({ address: selected, event: swapEvent, fromBlock: start, toBlock: block.number, strict: true });
      if (generation !== requestGeneration.current) return;
      setEvidence(logs.slice(-10).reverse().map((log) => ({ hash: log.transactionHash, block: log.blockNumber, ...log.args })));
      setEvidenceError("");
    } catch { if (generation === requestGeneration.current) setEvidenceError("Recent swap events could not be read. No execution evidence is inferred from the current balance."); }
  }

  useEffect(() => {
    requestGeneration.current += 1;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A selected external contract changes the verified chain snapshot and transaction evidence.
    setSnapshot(undefined); setEvidence([]); setError(""); setHash(undefined);
    if (!vault) return;
    void refresh(vault).catch((cause) => setError(explain(cause)));
    const interval = setInterval(() => void refresh(vault).catch((cause) => setError(explain(cause))), 12_000);
    return () => { clearInterval(interval); requestGeneration.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Vault selection owns this external polling lifecycle; form edits must not restart it.
  }, [vault]);

  async function perform(action: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(""); setStatus("");
    try { await action(); } catch (cause) { setError(explain(cause)); } finally { submitting.current = false; setBusy(false); }
  }

  async function changeSession(close: boolean) {
    if (!client || !config || !vault || !snapshot || !canManage || !address) throw new Error("Connect this vault’s owner wallet on Sepolia to manage its session.");
    const selected = vault;
    const owner = snapshot.owner;
    const liveOwner = await client.readContract({ address: selected, abi: sessionVaultAbi, functionName: "owner" });
    if (liveOwner.toLowerCase() !== owner.toLowerCase()) throw new Error("The current owner could not be verified. Refresh the vault before signing.");
    const block = await client.getBlock();
    const approval = close ? undefined : sessionApproval(budget, duration, floor, block.timestamp);
    const call = close ? { address: selected, abi: sessionVaultAbi, functionName: "closeSession", account: owner } as const : { address: selected, abi: sessionVaultAbi, functionName: "openSession", args: [approval!.totalBudget, approval!.expiresAt, approval!.minRateWad], account: owner } as const;
    const [gas, fees, balance] = await Promise.all([client.estimateContractGas(call), client.estimateFeesPerGas(), client.getBalance({ address: owner })]);
    const price = fees.maxFeePerGas ?? fees.gasPrice;
    if (price === undefined || balance < ((gas * 120n + 99n) / 100n) * price) throw new Error("The owner wallet needs enough Sepolia ETH for this transaction’s estimated network fee. No wallet request was sent.");
    await assertSepoliaWallet(connector, owner);
    setStatus(close ? "Confirm closing this session on Sepolia. This removes its remaining trading budget." : "Review and confirm the session budget, duration and minimum rate in your Sepolia wallet.");
    const tx = await writeContractAsync({ ...call, chainId: 11155111, connector });
    setHash(tx); setStatus("Session transaction submitted. Waiting for its Sepolia receipt…");
    const receipt = await client.waitForTransactionReceipt({ hash: tx, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error("The session transaction reverted on Sepolia. No session change is confirmed.");
    setStatus(close ? "Session closed on Sepolia. Its remaining budget is zero." : "Session opened on Sepolia. The approved budget, expiry and minimum rate now apply to this vault.");
    await refresh(selected);
  }

  return <div className={`workspace-page ${styles.page}`}>
    <div className="workspace-heading"><div><h1>Bounded sessions · Beta</h1><p>Approve a finite trading budget, an expiry and a minimum output rate. The agent can trade only inside that owner-approved session.</p></div><Link href="/demo" className="product-primary-link">Try the main demo ↗</Link></div>
    <p className={styles.notice}>This is a separate experimental session vault. The existing shared demo and personal beta use their original policy vaults; they do not gain this session protection from visiting this page. Web agent execution is not connected here.</p>
    {!config || config.chainId !== 11155111 ? <section className={styles.panel}><h2>No session deployment configured</h2><p className={styles.description}>Session controls become available when the separate Sepolia deployment is published. The working shared demo remains available.</p></section> : <>
      <div className={styles.actions}><label htmlFor="session-vault" className={styles.help}>Session vault</label><select id="session-vault" value={vault ?? ""} disabled={busy || !vaults.length} onChange={(event) => { if (isAddress(event.target.value)) setVault(event.target.value); }} className="rounded-lg border border-zinc-600 bg-zinc-900 p-3 text-sm"><option value="" disabled>{vaults.length ? "Choose a vault" : "No session vault found"}</option>{vaults.map((value) => <option value={value} key={value}>{short(value)}</option>)}</select><button disabled={busy || !vault} className={styles.secondary} onClick={() => void perform(async () => { await refresh(); setStatus("Session chain state refreshed."); })}>Refresh chain state</button></div>
      {!vault ? <section className={styles.panel}><h2>No session vault selected</h2><p className={styles.description}>Connect an owner wallet to discover its existing session vaults from the separate factory. Creating and running a session vault currently uses the integration tools; this page does not deploy one or request any private key.</p>{ownVaults.error && <p className={styles.help}>The factory’s owner-vault list could not be read. Retry after reconnecting on Sepolia.</p>}</section> : <div className={styles.grid}><div><section className={styles.panel}><h2>Approve a session</h2><p className={styles.description}>The owner sets these bounds in one transaction. The agent cannot raise the total budget, extend the expiry or lower this rate. ENS authorization and hook policy still apply.</p>
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void perform(() => changeSession(false)); }}>
          <label>Total session budget (kUSD)<input inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} disabled={busy} /></label>
          <label>Duration (minutes)<input type="number" min="1" max="43200" step="1" value={duration} onChange={(event) => setDuration(event.target.value)} disabled={busy} /></label>
          <label>Minimum kETH received per 1 kUSD<input inputMode="decimal" value={floor} placeholder="Choose an owner-approved rate" onChange={(event) => setFloor(event.target.value)} disabled={busy} /></label>
          {snapshot?.reference !== undefined && <div><p className={styles.help}>Live pool reference after the observed LP fee: {units(snapshot.reference)} kETH per kUSD. This is a spot reference, not a guaranteed execution quote.</p><button type="button" className={styles.link} disabled={busy || !snapshot.suggested} onClick={() => { if (snapshot.suggested) setFloor(units(snapshot.suggested)); }}>Use reference minus 2% as my floor</button></div>}
          <div className={styles.review}><p>You approve at most <strong>{budget || "—"} kUSD</strong> for <strong>{duration || "—"} minutes</strong>, with at least <strong>{floor || "choose a rate"} kETH per kUSD</strong> received.</p><p className={styles.help}>Opening a new session replaces its prior remaining budget and expiry. The session budget charges the full requested input even if a trade fills partially; the output-rate floor uses actual input and output. Both test tokens use 18 decimals.</p></div>
          {!canManage && <p className={styles.help}>{!snapshot ? "Reading the actual session vault owner…" : !ownerMatches ? "Only this vault’s owner can approve or close its session. Connect that owner wallet to continue." : chainId !== 11155111 ? "Switch the owner’s wallet to Sepolia before approving a session." : "Use the canonical application to manage this session."}</p>}
          <div className={styles.actions}><button type="submit" className="request-action" disabled={busy || !canManage || !floor || !budget || !duration}>{busy ? "Waiting for wallet or Sepolia…" : active ? "Replace current session" : "Approve session"}</button><button type="button" className={styles.secondary} disabled={busy || !canManage || !snapshot || snapshot.remaining === 0n} onClick={() => void perform(() => changeSession(true))}>Close session</button></div>
        </form>
      </section><section className={styles.panel} style={{ marginTop: 24 }}><h2>Actual swap evidence</h2><p className={styles.description}>These values come from this vault’s SessionSwap events. An event is not invented for a failed attempt, and a balance change alone is not treated as proof of a swap.</p>{evidenceError && <p className={styles.help}>{evidenceError}</p>}{!evidence.length ? <p className={styles.help}>No session swap events were returned for the inspected range. This does not claim that an agent run was attempted.</p> : <ul className={styles.evidence}>{evidence.map((event, index) => <li key={`${event.hash}-${index}`}><a className={styles.link} href={`${explorer}/tx/${event.hash}`} target="_blank" rel="noreferrer">Session {event.sessionId.toString()} · {short(event.hash)} ↗</a><dl><div><dt>Requested input</dt><dd>{units(event.requestedInput)} kUSD</dd></div><div><dt>Actual input</dt><dd>{units(event.actualInput)} kUSD</dd></div><div><dt>Actual output</dt><dd>{units(event.actualOutput)} kETH</dd></div><div><dt>Remaining session budget</dt><dd>{units(event.remainingBudget)} kUSD</dd></div></dl></li>)}</ul>}</section></div>
      <aside className={styles.panel}><h2>Onchain session</h2>{!snapshot ? <p className={styles.description}>Reading this separate vault’s owner and session bounds…</p> : <><dl className={styles.facts}><div><dt>Status</dt><dd>{active ? "Active within its remaining budget" : expired ? "Expired — future swaps fail" : snapshot.remaining === 0n ? "No remaining session budget" : "Session inactive"}</dd></div><div><dt>Remaining total budget</dt><dd>{units(snapshot.remaining)} kUSD</dd></div><div><dt>Expires</dt><dd>{date(snapshot.expiresAt)}</dd></div><div><dt>Owner’s output floor</dt><dd>{units(snapshot.rate)} kETH per kUSD</dd></div><div><dt>Session ID</dt><dd>{snapshot.id.toString()}</dd></div><div><dt>Vault balances</dt><dd>{units(snapshot.inputBalance)} kUSD<br />{units(snapshot.outputBalance)} kETH</dd></div><div><dt>Owner</dt><dd><a target="_blank" rel="noreferrer" href={`${explorer}/address/${snapshot.owner}`}>{short(snapshot.owner)} ↗</a></dd></div><div><dt>Restricted agent</dt><dd><a target="_blank" rel="noreferrer" href={`${explorer}/address/${snapshot.agent}`}>{short(snapshot.agent)} ↗</a></dd></div><div><dt>Session vault</dt><dd><a target="_blank" rel="noreferrer" href={`${explorer}/address/${vault}`}>{short(vault)} ↗</a></dd></div></dl><p className={`${styles.help} mt-5`}>Snapshot read at {snapshot.checkedAt}. Expiry status uses the observed Sepolia block timestamp; refresh before relying on it.</p></>}
        <h3>Execution boundary</h3><p className={styles.help}>This page manages owner-approved session bounds and reads event evidence. It does not run an LLM, request an agent key or expose an agent trade button. The separate integration runner must sign its SwapIntent and call this vault; the existing demo API continues using its original vault.</p><p className={`${styles.help} mt-4`}>Policy and session reads here use the app’s Sepolia reader. This interface does not claim Nox routing or anonymity for its browser requests.</p>
      </aside></div>}
    </>}
    {status && <p role="status" aria-live="polite" className={styles.status}>{status}</p>}{hash && <a className={styles.link} href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">View owner transaction {short(hash)} ↗</a>}{error && <p role="alert" className={styles.error}>{error}</p>}
  </div>;
}

function explain(cause: unknown) { const message = cause instanceof Error ? cause.message.split("\n")[0] : "The session request failed. Refresh chain state and retry."; return /reject|denied|cancel/i.test(message) ? "The wallet request was cancelled. No session change is confirmed; you can retry when ready." : message; }
