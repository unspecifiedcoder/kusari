"use client";

import { useEffect, useRef, useState } from "react";
import { useConnection, usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import { formatEther, keccak256, parseEther, stringToHex, type Address, type Hex } from "viem";
import { deployment, ensDeployment } from "@/generated/deployment";
import { policySourceAbi } from "@/lib/abi";
import { useCanonicalSite } from "@/lib/canonical-site";
import { assertSepoliaWallet } from "@/lib/wallet-safety";
import { assertSharedENSIdentity, encodeSharedCapPolicy, sharedOwnerIdentityAbi, sharedOwnerRegistryAbi, sharedOwnerResolverAbi, validateOwnerPolicyChallenge, type SharedPolicy } from "@/lib/owner-policy";
import "./OwnerPolicyControls.css";

type Snapshot = { owner: Address; resolver: Address; policy: SharedPolicy; authorized: boolean; checkedAt: string };
type CheckResult = { requestId: string; status: "accepted" | "running" | "pending" | "success" | "reverted" | "error"; requested: string; limit?: string; outcome?: string; reason?: string; preflightReason?: string; hash?: Hex; source: string; route?: string };
const explorer = "https://sepolia.etherscan.io";
const short = (value: string) => `${value.slice(0, 10)}…${value.slice(-6)}`;
const label = ensDeployment.name.split(".")[0];
const labelId = BigInt(keccak256(stringToHex(label)));
const terminal = new Set(["success", "reverted", "error"]);

export function OwnerPolicyControls({ owner }: { owner?: Address }) {
  const { address, chainId, connector, isConnected } = useConnection();
  const { isCanonical, canonicalOrigin } = useCanonicalSite();
  const client = usePublicClient({ chainId: 11155111 });
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [policyHash, setPolicyHash] = useState<Hex>();
  const [result, setResult] = useState<CheckResult>();
  const [requestId, setRequestId] = useState<string>();
  const [pollError, setPollError] = useState("");
  const [waitingSince, setWaitingSince] = useState(0);
  const inFlight = useRef(false);
  const epoch = useRef(0);
  const matchesOwner = Boolean(address && owner && address.toLowerCase() === owner.toLowerCase());
  const canManage = matchesOwner && isConnected && chainId === 11155111 && isCanonical;
  const checking = Boolean(requestId && !terminal.has(result?.status ?? "accepted"));

  async function readSnapshot(minimumBlock = 0n) {
    if (!client || deployment.chainId !== 11155111 || deployment.policySource.toLowerCase() !== ensDeployment.policySource.toLowerCase() || await client.getChainId() !== 11155111) throw new Error("The verified Sepolia ENS deployment is unavailable.");
    const head = await client.getBlockNumber({ cacheTime: 0 });
    const blockNumber = head < minimumBlock ? minimumBlock : head;
    const [liveOwner, resolver, policy, authorized, registry, binding] = await Promise.all([
      client.readContract({ address: ensDeployment.userRegistry, abi: sharedOwnerRegistryAbi, functionName: "getOwner", args: [labelId], blockNumber }),
      client.readContract({ address: ensDeployment.userRegistry, abi: sharedOwnerRegistryAbi, functionName: "getResolver", args: [label], blockNumber }),
      client.readContract({ address: deployment.policySource, abi: policySourceAbi, functionName: "policyOf", args: [ensDeployment.agent], blockNumber }),
      client.readContract({ address: deployment.policySource, abi: policySourceAbi, functionName: "isAuthorized", args: [ensDeployment.agent], blockNumber }),
      client.readContract({ address: deployment.policySource, abi: sharedOwnerIdentityAbi, functionName: "registry", blockNumber }),
      client.readContract({ address: deployment.policySource, abi: sharedOwnerIdentityAbi, functionName: "bindingOf", args: [ensDeployment.agent], blockNumber }),
    ]);
    assertSharedENSIdentity(registry, binding, { registry: ensDeployment.userRegistry, label, dnsName: ensDeployment.dnsName, node: ensDeployment.node });
    if (resolver === "0x0000000000000000000000000000000000000000" || policy.allowedPool.toLowerCase() !== deployment.poolId.toLowerCase()) throw new Error("The current ENS resolver or allowed pool could not be verified.");
    return { owner: liveOwner, resolver, policy, authorized, checkedAt: new Date().toLocaleTimeString() };
  }

  useEffect(() => {
    const generation = ++epoch.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset chain-bound owner controls when wallet context changes.
    setSnapshot(undefined); setError("");
    if (!open || !canManage) return;
    let disposed = false;
    const refresh = async () => { if (inFlight.current) return; try { const next = await readSnapshot(); if (!disposed && epoch.current === generation) setSnapshot(next); } catch (cause) { if (!disposed && epoch.current === generation) setError(explain(cause)); } };
    void refresh();
    const timer = setInterval(() => void refresh(), 12_000);
    return () => { disposed = true; clearInterval(timer); epoch.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only the verified wallet context and disclosure own this read lifecycle.
  }, [open, canManage, address, chainId, connector?.uid, owner]);

  async function post<T>(action: string, body: object): Promise<T> {
    let response: Response;
    try { response = await fetch(`/api/policy-check/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), cache: "no-store" }); }
    catch { throw new Error(action === "run" ? "Run acceptance is unknown. Check shared activity before starting another test; this request may already be executing." : "The owner test service is unavailable. No completed test is confirmed."); }
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "The owner policy check was not accepted.");
    return value as T;
  }

  async function readResult(id: string) {
    const value = await post<CheckResult>("result", { requestId: id });
    if (value.requestId !== id || value.source !== "owner-policy-check" || value.requested !== "2" || !["accepted", "running", "pending", "success", "reverted", "error"].includes(value.status) || (value.hash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(value.hash))) throw new Error("The test service returned an unrecognized result. No execution outcome is inferred.");
    return value;
  }

  useEffect(() => {
    if (!requestId || !checking) return;
    let disposed = false, polling = false;
    const poll = async () => {
      if (polling || disposed) return;
      polling = true;
      try { const next = await readResult(requestId); if (!disposed) { setResult(next); setPollError(""); } }
      catch (cause) { if (!disposed) setPollError(explain(cause)); }
      finally { polling = false; }
    };
    void poll();
    const timer = setInterval(() => { if (Date.now() - waitingSince < 180_000) void poll(); else if (!disposed) setPollError("The observation window ended. Use Refresh result or inspect the known transaction; do not resubmit to check its status."); }, 2_000);
    return () => { disposed = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The accepted job ID remains readable across owner/account changes, without any further signing.
  }, [requestId, checking, waitingSince]);

  async function perform(action: (guard: () => void) => Promise<void>) {
    if (inFlight.current || checking) return;
    if (!canManage || !address) { setError("Connect the verified name owner on Sepolia to use these controls."); return; }
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    const generation = epoch.current;
    const guard = () => { if (generation !== epoch.current) throw new Error("The wallet or page context changed. The pending owner action was stopped; refresh before retrying."); };
    try { await action(guard); } catch (cause) { setError(explain(cause)); } finally { inFlight.current = false; setBusy(false); }
  }

  async function editCap(cap: "1" | "5", guard: () => void) {
    if (!client || !address) throw new Error("The owner wallet and Sepolia reader are required.");
    const generation = epoch.current;
    const account = address;
    const live = await readSnapshot(); guard();
    if (live.owner.toLowerCase() !== account.toLowerCase()) throw new Error("This wallet is no longer the ENS name owner.");
    setSnapshot(live);
    const encoded = encodeSharedCapPolicy(live.policy, cap, deployment.poolId);
    const call = { address: live.resolver, abi: sharedOwnerResolverAbi, functionName: "setData", args: [ensDeployment.dnsName, "kusari.policy", encoded], account } as const;
    const [gas, fees, balance] = await Promise.all([client.estimateContractGas(call), client.estimateFeesPerGas(), client.getBalance({ address: account })]); guard();
    const fee = fees.maxFeePerGas ?? fees.gasPrice;
    if (fee === undefined || balance < ((gas * 120n + 99n) / 100n) * fee) throw new Error("The owner wallet needs Sepolia ETH for the estimated transaction fee. No wallet transaction was requested.");
    await assertSepoliaWallet(connector, account); guard();
    const beforeSigning = await readSnapshot(); guard();
    if (beforeSigning.owner.toLowerCase() !== account.toLowerCase() || beforeSigning.resolver.toLowerCase() !== live.resolver.toLowerCase() || encodeSharedCapPolicy(beforeSigning.policy, cap, deployment.poolId) !== encoded) throw new Error("ENS settings changed while preparing this edit. Refresh and review before retrying. No policy transaction was requested.");
    await assertSepoliaWallet(connector, account); guard();
    setMessage(`Confirm one Sepolia transaction to set the ENS per-trade cap to ${cap} kUSD. The other settings are copied from the verified ENS snapshot read at ${live.checkedAt}.`);
    const hash = await writeContractAsync({ ...call, chainId: 11155111, connector });
    setPolicyHash(hash); setMessage("ENS policy transaction submitted. Waiting for its Sepolia receipt. Switching accounts or closing these controls cannot cancel a submitted transaction.");
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error("The ENS policy transaction reverted. No policy change is confirmed.");
    setMessage(`The ENS policy transaction setting a ${cap} kUSD cap confirmed on Sepolia. No contract was redeployed.`);
    // Context cancellation prevents new signing, but cannot undo an already submitted transaction.
    if (generation !== epoch.current) return;
    const next = await readSnapshot(receipt.blockNumber);
    if (generation !== epoch.current) return;
    setSnapshot(next);
    setMessage(`ENS record updated. The latest per-trade cap is ${formatEther(next.policy.maxPerSwap)} kUSD. No contract was redeployed.`);
  }

  async function runFixedCheck(guard: () => void) {
    if (!address) throw new Error("Connect the ENS owner wallet.");
    const account = address;
    await assertSepoliaWallet(connector, account); guard();
    const challenge = await post<unknown>("challenge", { address: account }); guard();
    validateOwnerPolicyChallenge(challenge, { owner: account, agent: ensDeployment.agent, vault: deployment.demoVault, origin: canonicalOrigin });
    setMessage("Sign one gas-free request for the fixed 2 kUSD test. This deterministic check does not call Gemini.");
    await assertSepoliaWallet(connector, account); guard();
    const signature = await signMessageAsync({ account, connector, message: challenge.message }); guard();
    if (Date.now() >= challenge.expiresAt) throw new Error("The fixed-test signing request expired. Request a fresh test.");
    await assertSepoliaWallet(connector, account); guard();
    const accepted = await post<{ requestId: string; status: string }>("run", { address: account, nonce: challenge.nonce, signature });
    if (accepted.status !== "accepted" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accepted.requestId)) throw new Error("No valid test acceptance was returned. Check shared activity before retrying.");
    setResult(undefined); setPollError(""); setWaitingSince(Date.now()); setRequestId(accepted.requestId);
    setMessage("The fixed request was accepted. The shared agent supplies test tokens and gas; follow this test’s actual receipt below.");
  }

  return <details className="owner-policy-section" id="owner-policy-demo" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><div><h2>ENS policy demonstration</h2><p>Change the owner’s cap and check the same fixed 2 kUSD request against it.</p></div><svg className="owner-policy-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></summary>
    <div className="owner-policy-body">
      {!canManage ? <p className="owner-policy-help">{!isCanonical ? "Open the official Kusari site to manage this policy." : !isConnected || !matchesOwner ? "Only the verified ENS name owner can edit this shared policy or authorize the fixed test. Connect that owner wallet to continue." : "Switch the owner wallet to Sepolia to continue."} The visitor demo above keeps its 1 kUSD normal-run ceiling.</p> : <>
        <div className="owner-policy-grid">
          <section><h3>Edit the live ENS cap</h3><p className="owner-policy-help">One owner transaction writes the ABI-encoded <code>kusari.policy</code> data record in the existing resolver. The hook reads that record on every swap.</p>
            <dl className="owner-policy-facts"><div><dt>Current per-trade cap</dt><dd>{snapshot ? `${formatEther(snapshot.policy.maxPerSwap)} kUSD` : "Reading ENS…"}</dd></div><div><dt>Daily allowance</dt><dd>{snapshot ? `${formatEther(snapshot.policy.dailyCap)} kUSD` : "Reading ENS…"}</dd></div><div><dt>Maximum pool impact</dt><dd>{snapshot ? `${snapshot.policy.maxImpactBps / 100}%` : "Reading ENS…"}</dd></div></dl>
            <div className="owner-policy-actions"><button className="owner-policy-secondary" disabled={busy || checking || !snapshot || snapshot.policy.maxPerSwap === parseEther("1")} onClick={() => void perform((guard) => editCap("1", guard))}>Set cap to 1 kUSD</button><button className="owner-policy-secondary" disabled={busy || checking || !snapshot || snapshot.policy.maxPerSwap === parseEther("5")} onClick={() => void perform((guard) => editCap("5", guard))}>Restore cap to 5 kUSD</button></div>
            <p className={`owner-policy-help mt-4`}>This changes the shared agent’s policy for every visitor. Restore 5 kUSD after the demonstration. The transaction copies the other settings from its verified snapshot; avoid simultaneous policy edits from another owner session.</p>
            {snapshot && <p className={`owner-policy-help mt-3`}>ENS read at {snapshot.checkedAt}. Authorization: {snapshot.authorized ? "granted" : "revoked"}. <a className="owner-policy-link" href={`https://sepolia.explorer.ens.domains/${ensDeployment.name}/records`} target="_blank" rel="noreferrer">Inspect ENS records ↗</a></p>}
          </section>
          <section><h3>Check a fixed 2 kUSD request</h3><p className="owner-policy-help">This owner-authorized test uses the same agent, vault and hook. Its amount is always 2 kUSD. It bypasses the model’s decision so the policy boundary is predictable; it does not bypass contract enforcement.</p>
            <ol className="owner-policy-sequence"><li>With a 5 kUSD cap, run the test and inspect its actual outcome.</li><li>Set the cap to 1 kUSD, wait for confirmation, then repeat the same test.</li><li>Restore 5 kUSD when finished. Other policy checks can still reject a request.</li></ol>
            <button className="request-action" disabled={busy || checking || !snapshot} onClick={() => void perform(runFixedCheck)}>{busy ? "Waiting for wallet or Sepolia…" : checking ? "Fixed test in progress…" : "Sign & run fixed 2 kUSD test"}</button>
            <p className={`owner-policy-help mt-4`}>Your signature authorizes one bounded test. The shared agent submits the transaction even when simulation predicts rejection, so a policy block can produce a real reverted receipt. Your wallet sends no funds or token approval.</p>
          </section>
        </div>
      </>}
      {message && <p role="status" aria-live="polite" className="owner-policy-status">{message}</p>}
      {policyHash && <p className="owner-policy-status"><a className="owner-policy-link" href={`${explorer}/tx/${policyHash}`} target="_blank" rel="noreferrer">Latest submitted ENS policy transaction {short(policyHash)} ↗</a></p>}
      {error && <p role="alert" className="owner-policy-error">{error}</p>}
      {requestId && <section className="owner-policy-result"><h3>Fixed test result</h3><dl><div><dt>Requested</dt><dd>2 kUSD · deterministic owner policy check</dd></div><div><dt>Limit at policy read</dt><dd>{result?.limit ? `${result.limit} kUSD per trade` : "Awaiting this test’s policy read"}</dd></div><div><dt>Result</dt><dd>{result?.status === "success" ? "Confirmed successful on Sepolia" : result?.status === "reverted" ? "Transaction reverted on Sepolia" : result?.status === "error" ? "Test could not complete" : result?.hash ? "Transaction submitted; receipt pending" : "Waiting for the test runner"}</dd></div><div><dt>Reason</dt><dd>{result?.reason ?? "No final outcome has been received."}</dd></div>{result?.preflightReason && <div><dt>Simulation observation</dt><dd>{result.preflightReason}. The receipt establishes whether execution succeeded or reverted.</dd></div>}<div><dt>Transaction</dt><dd>{result?.hash ? <a className="owner-policy-link" href={`${explorer}/tx/${result.hash}`} target="_blank" rel="noreferrer">{result.hash} ↗</a> : "No transaction hash received"}</dd></div><div><dt>Source</dt><dd>Owner policy check · no Gemini call{result?.route ? ` · ${result.route}` : ""}</dd></div></dl><div className="owner-policy-actions"><button className="owner-policy-secondary" onClick={() => void readResult(requestId).then((next) => { setResult(next); setPollError(""); }).catch((cause) => setPollError(explain(cause)))}>Refresh result</button></div>{pollError && <p role="status" className="owner-policy-error">{pollError}</p>}</section>}
    </div>
  </details>;
}

function explain(cause: unknown) { const message = cause instanceof Error ? cause.message.split("\n")[0] : "The owner action could not finish. Refresh chain state before retrying."; return /reject|denied|cancel/i.test(message) ? "The wallet request was cancelled. Check any known transaction before retrying." : message; }
