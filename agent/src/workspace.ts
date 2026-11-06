import { existsSync, readFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { createPublicClient, http, parseAbi, getAddress, isAddress, verifyMessage, recoverTypedDataAddress, recoverTransactionAddress, parseTransaction, encodeFunctionData, formatEther, parseEther, keccak256, toBytes, decodeErrorResult, BaseError, ContractFunctionRevertedError, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { config, deployment, ANON_RPC } from "./config.ts";
import { stateViewAbi, erc20Abi, policySourceAbi, policyHookAbi, agentVaultAbi } from "./abi.ts";
import { decide } from "./llm.ts";
import { newsFeed } from "./news.ts";
import { kusariDomain, swapIntentTypes } from "../../shared/types.ts";

const extraAbi = parseAbi([
  "function vaultsOf(address owner) view returns (address[])",
  "function hook() view returns (address)",
  "function registry() view returns (address)",
  "function bindingOf(address agent) view returns ((string label,bytes dnsName,bytes32 node))",
  "function getOwner(uint256 tokenId) view returns (address)",
]);
export class WorkspaceError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const fail = (status: number, message: string): never => { throw new WorkspaceError(status, message); };
const exact = (value: any, fields: string[]) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(k => Object.hasOwn(value, k));
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const asAddress = (v: unknown): Address => typeof v === "string" && isAddress(v) ? getAddress(v) : fail(400, "Invalid workspace address");
const serial = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x));
const poolKey = { currency0: deployment.token0, currency1: deployment.token1, fee: 3000, tickSpacing: 60, hooks: deployment.policyHook } as const;
const rpcObservation = new AsyncLocalStorage<any>();
const observedFetch: typeof fetch = async (url, options) => {
  const record = rpcObservation.getStore();
  if (record) {
    record.rpcRequests++;
    try { const body = JSON.parse(String(options?.body)); if (body.method === "eth_sendRawTransaction") record.submissionRequests++; } catch {}
  }
  try { const response = await fetch(url, options); if (!response.ok && record) record.httpFailures++; return response; }
  catch (e) { if (record) record.httpFailures++; throw e; }
};
/** Deployment-owned allowlist. A caller can never supply or extend a trusted factory. */
export function workspaceFactoriesFromManifest(manifest: any = null): Address[] {
  const factories: Address[] = [getAddress(deployment.vaultFactory)];
  if (manifest?.personalVaultFactory !== undefined) {
    if (manifest.chainId !== 11155111 || manifest.chainId !== deployment.chainId || (manifest.policySource && !equal(manifest.policySource, deployment.policySource)) || typeof manifest.personalVaultFactory !== "string" || !isAddress(manifest.personalVaultFactory) || /^0x0{40}$/i.test(manifest.personalVaultFactory)) throw new Error("Invalid personal workspace factory deployment");
    const personal = getAddress(manifest.personalVaultFactory);
    if (!factories.some(f => equal(f, personal))) factories.push(personal);
  }
  return factories;
}
const ownedManifest = new URL("../../deployments/11155111-owned.json", import.meta.url);
const trustedWorkspaceFactories = workspaceFactoriesFromManifest(existsSync(ownedManifest) ? JSON.parse(readFileSync(ownedManifest, "utf8")) : null);
const client = createPublicClient({ chain: sepolia, transport: http(ANON_RPC, { timeout: 45_000, retryCount: 1, fetchFn: observedFetch }), batch: { multicall: false } });

/** Dedicated Nox client: public shared-demo transport toggles cannot downgrade owned workspaces. */
export async function loadWorkspace(w: any, { rpc = client, fetchImpl = fetch, trustedFactories = trustedWorkspaceFactories }: any = {}) {
  const bridge = await fetchImpl(new URL("/metrics", ANON_RPC), { signal: AbortSignal.timeout(3000) }).then(r => r.json());
  if (bridge.mode !== "anon") fail(503, "Owned-agent execution requires the Nox anonymous route; direct fallback is disabled");
  if (await rpc.getChainId() !== 11155111 || deployment.chainId !== 11155111) fail(503, "Workspace execution requires Sepolia");
  const batch = (contracts: any[]) => typeof rpc.multicall === "function" ? rpc.multicall({ allowFailure: false, contracts }) : Promise.all(contracts.map(c => rpc.readContract(c)));
  const metadata = await batch([
    ...trustedFactories.map((factory: Address) => ({ address: factory, abi: extraAbi, functionName: "vaultsOf", args: [w.owner] })),
    { address: w.vault, abi: agentVaultAbi, functionName: "owner" },
    { address: w.vault, abi: agentVaultAbi, functionName: "agent" },
    { address: w.vault, abi: extraAbi, functionName: "hook" },
    { address: deployment.policySource, abi: extraAbi, functionName: "bindingOf", args: [w.agent] },
    { address: deployment.policySource, abi: extraAbi, functionName: "registry" },
  ]);
  const vaultLists = metadata.slice(0, trustedFactories.length);
  const [owner, agent, hook, binding, registry] = metadata.slice(trustedFactories.length);
  if (!vaultLists.some((vaults: Address[]) => vaults.some(v => equal(v, w.vault))) || !equal(owner, w.owner) || !equal(agent, w.agent) || !equal(hook, deployment.policyHook)) fail(403, "Vault is not this owner's Kusari workspace");
  if (!binding.label) fail(409, "Bind this agent to its ENS policy first");
  const nameOwner = await rpc.readContract({ address: registry, abi: extraAbi, functionName: "getOwner", args: [BigInt(keccak256(toBytes(binding.label)))] });
  if (!equal(nameOwner, w.owner)) fail(403, "ENS policy and vault must have the same owner");
  const day = BigInt(Math.floor(Date.now() / 86_400_000));
  const [[slot0, bal0, bal1, policy, authorized, spent], agentBalance] = await Promise.all([
    batch([
      { address: config.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [deployment.poolId] },
      { address: deployment.token0, abi: erc20Abi, functionName: "balanceOf", args: [w.vault] },
      { address: deployment.token1, abi: erc20Abi, functionName: "balanceOf", args: [w.vault] },
      { address: deployment.policySource, abi: policySourceAbi, functionName: "policyOf", args: [w.agent] },
      { address: deployment.policySource, abi: policySourceAbi, functionName: "isAuthorized", args: [w.agent] },
      { address: deployment.policyHook, abi: policyHookAbi, functionName: "spentOn", args: [w.agent, day] },
    ]),
    rpc.getBalance({ address: w.agent }),
  ]);
  return { label: binding.label, authorized, active: policy.active, vaultToken0: formatEther(bal0), vaultToken1: formatEther(bal1), maxPerSwap: formatEther(policy.maxPerSwap), dailyCap: formatEther(policy.dailyCap), spentToday: formatEther(spent), remainingToday: formatEther(BigInt(policy.dailyCap) > BigInt(spent) ? BigInt(policy.dailyCap) - BigInt(spent) : 0n), maxImpactBps: policy.maxImpactBps, allowedPool: policy.allowedPool, sqrtPriceX96: slot0[0].toString(), price: (Number(slot0[0]) / 2 ** 96) ** 2, agentBalance: formatEther(agentBalance), transport: "anon", route: "Anon-RPC / Nox", checkedAt: Date.now() };
}

/** Browser-held keys only. This service cannot sign or spend a workspace's funds. */
export function createWorkspaceService({ load = loadWorkspace, model = decide, rpc = client, now = Date.now, origin = process.env.KUSARI_DEMO_PUBLIC_ORIGIN ?? "https://kusari.outcomeseal.com", maxHourly = 20, maxDaily = 40 }: any = {}) {
  const nonces = new Map<string, any>();
  const runs = new Map<string, any>();
  const ownerLast = new Map<string, number>();
  const budget: number[] = [];
  const statusReads = new Map<string, any>();
  const statusBudget: number[] = [];
  let active = 0;
  const clean = () => {
    const t = now();
    for (const [key, value] of nonces) if (value.expiresAt < t) nonces.delete(key);
    for (const [key, value] of runs) if (value.expiresAt < t && !value.working) runs.delete(key);
    for (const [key, value] of ownerLast) if (value < t - 86_400_000) ownerLast.delete(key);
    while (budget.length && budget[0] < t - 86_400_000) budget.shift();
    while (statusBudget.length && statusBudget[0] < t - 60_000) statusBudget.shift();
    for (const [key, item] of statusReads) if (item.at < t - 60_000 && !item.pending) statusReads.delete(key);
  };
  const workspace = (input: any, scenario = false) => {
    const fields = ["owner", "agent", "vault", ...(scenario ? ["scenario"] : [])];
    if (!exact(input, fields) || (scenario && !["normal", "attack"].includes(input.scenario))) fail(400, "Invalid workspace request");
    const value = { owner: asAddress(input.owner), agent: asAddress(input.agent), vault: asAddress(input.vault), ...(scenario ? { scenario: input.scenario } : {}) };
    if (equal(value.owner, value.agent)) fail(400, "Agent must be a separate restricted key");
    return value;
  };
  const resultOf = (run: any) => serial({ runId: run.id, status: run.status, decision: run.decision, state: run.state, intent: run.intent, transaction: run.transaction, poolKey: run.intent ? poolKey : undefined, hash: run.hash, error: run.error, preflightReason: run.preflightReason, routing: run.routing });
  const getRun = (input: any) => {
    clean();
    if (!exact(input, ["runId"]) || typeof input.runId !== "string") fail(400, "Invalid workspace run");
    return runs.get(input.runId) ?? fail(410, "Workspace run expired; start a new request");
  };
  const prepareJob = async (run: any) => {
    try {
      run.state = await load(run.workspace);
      if (Number(run.state.agentBalance) <= 0) fail(409, "Fund the restricted agent with Sepolia gas first");
      if (Number(run.state.vaultToken0) <= 0) fail(409, "Fund this vault with test kUSD first");
      const normal = run.workspace.scenario === "normal";
      const decision = await model({ price: run.state.price, vaultKUSD: Number(run.state.vaultToken0), maxPerSwap: normal ? Math.min(Number(run.state.maxPerSwap), 1) : Number(run.state.maxPerSwap), remainingToday: normal ? Math.min(Number(run.state.remainingToday), 1) : Number(run.state.remainingToday), news: newsFeed(!normal) }, { signal: AbortSignal.timeout(60_000) });
      if (!["hold", "swap"].includes(decision.action) || !Number.isFinite(decision.amountIn) || decision.amountIn < 0 || typeof decision.reason !== "string") fail(503, "Gemini returned an invalid decision");
      run.decision = decision;
      if (decision.action === "hold" || decision.amountIn === 0) { run.status = "hold"; return; }
      if (decision.amountIn > Number(run.state.vaultToken0) || (normal && decision.amountIn > 1)) fail(409, "Model request exceeds this test run's balance or normal-run budget; nothing was signed");
      const amount = parseEther(String(decision.amountIn));
      const sqrt = BigInt(run.state.sqrtPriceX96);
      const quote = ((amount * sqrt) / (2n ** 96n) * sqrt) / (2n ** 96n);
      run.intent = { agent: run.workspace.agent, vault: run.workspace.vault, poolId: deployment.poolId, zeroForOne: true, amountIn: amount, minAmountOut: quote * 9670n / 10000n, nonce: BigInt(`0x${randomBytes(32).toString("hex")}`), deadline: BigInt(Math.floor(now() / 1000) + 300) };
      const [nonce, fees] = await Promise.all([rpc.getTransactionCount({ address: run.workspace.agent, blockTag: "pending" }), rpc.estimateFeesPerGas()]);
      const maxFee = fees.maxFeePerGas ?? 2_000_000_000n;
      const tip = fees.maxPriorityFeePerGas ?? 1_000_000n;
      if (maxFee * 600_000n > 3_000_000_000_000_000n || tip > maxFee) fail(503, "Sepolia gas estimate exceeds the workspace safety ceiling");
      if (maxFee * 600_000n > parseEther(run.state.agentBalance)) fail(409, "Agent needs more Sepolia ETH for the maximum transaction fee");
      run.transaction = { chainId: 11155111, type: "eip1559", to: run.workspace.vault, nonce, gas: "600000", maxFeePerGas: maxFee.toString(), maxPriorityFeePerGas: tip.toString(), value: "0" };
      run.status = "ready";
    } catch (error) { delete run.intent; delete run.transaction; run.status = "error"; run.error = error instanceof WorkspaceError ? error.message : "Workspace run failed before signing. Check its ENS policy, funding and Nox connection."; }
    finally { run.working = false; active--; }
  };
  return {
    async handle(action: string, input: any) {
      clean();
      if (action === "challenge") {
        const w = workspace(input, true);
        if (nonces.size >= 100 || [...nonces.values()].filter(x => equal(x.workspace.owner, w.owner)).length >= 3) fail(429, "Too many pending workspace messages; wait two minutes");
        const nonce = randomBytes(24).toString("hex");
        const expiresAt = now() + 120_000;
        const message = `Kusari owned-agent run\nSite: ${origin}\nNetwork: Sepolia (11155111)\nOwner: ${w.owner}\nAgent: ${w.agent}\nVault: ${w.vault}\nScenario: ${w.scenario}\nNonce: ${nonce}\nExpires: ${new Date(expiresAt).toISOString()}\n\nAuthorize one Gemini decision for this workspace. This message transfers no funds and grants no token approval. Your unlocked restricted agent will sign this cycle locally and pay Sepolia gas, including if the hook reverts. Its private key stays in your browser.`;
        nonces.set(nonce, { workspace: w, message, expiresAt });
        return { nonce, message, expiresAt };
      }
      if (action === "status" || action === "state") {
        const w = workspace(input);
        const key = `${w.owner}:${w.agent}:${w.vault}`.toLowerCase();
        const previous = statusReads.get(key);
        if (previous?.pending) return { state: await previous.pending };
        if (previous?.value && previous.at > now() - 5000) return { state: previous.value };
        if (statusBudget.length >= 40 || (!previous && statusReads.size >= 100)) fail(429, "Workspace read capacity reached; retry shortly");
        statusBudget.push(now());
        const entry: any = { at: now() };
        entry.pending = load(w);
        statusReads.set(key, entry);
        try { entry.value = await entry.pending; return { state: entry.value }; }
        finally { entry.pending = null; }
      }
      if (action === "prepare") {
        if (!exact(input, ["owner", "agent", "vault", "scenario", "nonce", "signature"])) fail(400, "Invalid signed workspace request");
        const w = workspace({ owner: input.owner, agent: input.agent, vault: input.vault, scenario: input.scenario }, true);
        const challenge = nonces.get(input.nonce);
        if (!challenge) fail(410, "Workspace message expired or was already used");
        nonces.delete(input.nonce); // consumed before async verification; no replay race
        if (JSON.stringify(challenge.workspace) !== JSON.stringify(w) || typeof input.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(input.signature)) fail(403, "Signed message does not match this workspace");
        if (!await verifyMessage({ address: w.owner, message: challenge.message, signature: input.signature })) fail(403, "Owner signature is invalid");
        // Reservation after verification must be synchronous, so concurrent valid owners cannot overbook.
        const t = now();
        if (active >= 2 || runs.size >= 100 || t - (ownerLast.get(w.owner.toLowerCase()) ?? 0) < 30_000 || budget.filter(x => x >= t - 3_600_000).length >= maxHourly || budget.length >= maxDaily) fail(429, "Owned-agent Gemini capacity reached; wait before trying again");
        ownerLast.set(w.owner.toLowerCase(), t); budget.push(t); active++;
        const run = { id: randomUUID(), workspace: w, status: "preparing", expiresAt: t + 900_000, working: true, routing: { route: "Anon-RPC / Nox", rpcRequests: 0, httpFailures: 0, submissionRequests: 0, meaning: "Requests observed by this service, including retries. Public transaction data remains visible. These counters do not prove anonymity." } };
        runs.set(run.id, run); void rpcObservation.run(run.routing, () => prepareJob(run));
        return { runId: run.id, status: "preparing" };
      }
      if (action === "result") {
        const run = getRun(input);
        if (run.status === "pending") {
          try {
            const receipt = await rpcObservation.run(run.routing, () => rpc.getTransactionReceipt({ hash: run.hash }));
            run.status = receipt.status === "success" ? "success" : "reverted";
          } catch { /* A missing receipt remains pending; never claim it failed or succeeded. */ }
        }
        return resultOf(run);
      }
      if (action === "relay") {
        if (!exact(input, ["runId", "signature", "rawTransaction"])) fail(400, "Invalid signed workspace transaction");
        const run = getRun({ runId: input.runId });
        if (run.status === "pending" || run.status === "success" || run.status === "reverted") {
          if (keccak256(input.rawTransaction) !== run.hash) fail(409, "This request already submitted a different transaction");
          if (run.broadcastUnconfirmed && !run.relaying) {
            run.relaying = true;
            try { await rpcObservation.run(run.routing, () => rpc.sendRawTransaction({ serializedTransaction: input.rawTransaction })); run.broadcastUnconfirmed = false; }
            catch { /* Same hash remains unconfirmed; a network error is never a confirmed receipt. */ }
            finally { run.relaying = false; }
          }
          return { hash: run.hash, status: run.status, broadcast: run.broadcastUnconfirmed ? "unconfirmed" : "accepted" };
        }
        if (run.status !== "ready" || run.relaying) fail(409, "Wait for this workspace decision to finish");
        run.relaying = true;
        try {
          if (run.intent.deadline < BigInt(Math.floor(now() / 1000))) fail(410, "Swap intent expired; request a new decision");
          if (typeof input.rawTransaction !== "string" || !/^0x[0-9a-fA-F]{1,12000}$/.test(input.rawTransaction) || typeof input.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(input.signature)) fail(400, "Invalid signed transaction encoding");
          const tx = parseTransaction(input.rawTransaction);
          const expectedData = encodeFunctionData({ abi: agentVaultAbi, functionName: "swap", args: [poolKey, run.intent, input.signature] });
          const expected = run.transaction;
          if (tx.chainId !== 11155111 || tx.type !== "eip1559" || !tx.to || !equal(tx.to, expected.to) || (tx.value ?? 0n) !== 0n || tx.data !== expectedData || tx.nonce !== expected.nonce || tx.gas !== BigInt(expected.gas) || tx.maxFeePerGas !== BigInt(expected.maxFeePerGas) || tx.maxPriorityFeePerGas !== BigInt(expected.maxPriorityFeePerGas) || (tx.accessList?.length ?? 0) !== 0) fail(403, "Signed transaction does not match the bounded workspace swap");
          const [sender, signer] = await Promise.all([recoverTransactionAddress({ serializedTransaction: input.rawTransaction }), recoverTypedDataAddress({ domain: kusariDomain(11155111, deployment.policyHook), types: swapIntentTypes, primaryType: "SwapIntent", message: run.intent, signature: input.signature })]);
          if (!equal(sender, run.workspace.agent) || !equal(signer, run.workspace.agent)) fail(403, "Only this workspace's restricted agent may sign its swap");
          await rpcObservation.run(run.routing, () => load(run.workspace)); // fresh factory/ENS ownership check, even if authorization is now revoked
          if (await rpc.getChainId() !== 11155111) fail(503, "Workspace RPC is not Sepolia");
          try { await rpcObservation.run(run.routing, () => rpc.simulateContract({ account: run.workspace.agent, address: run.workspace.vault, abi: agentVaultAbi, functionName: "swap", args: [poolKey, run.intent, input.signature], gas: 600_000n })); }
          catch (error: any) {
            run.preflightReason = "Simulation unavailable or reverted; the receipt determines the on-chain result.";
            if (error instanceof BaseError) {
              const reverted = error.walk((e: any) => e instanceof ContractFunctionRevertedError);
              if (reverted instanceof ContractFunctionRevertedError && reverted.data) {
                let name = reverted.data.errorName;
                if (name === "WrappedError") {
                  try { name = decodeErrorResult({ abi: policyHookAbi, data: reverted.data.args?.[2] as Hex }).errorName; } catch { name = "Unknown"; }
                }
                run.preflightReason = name;
              }
            }
          }
          // Save the known hash before broadcast: ambiguous network failures can safely retry the same raw tx.
          const hash = keccak256(input.rawTransaction);
          try { await rpcObservation.run(run.routing, () => rpc.sendRawTransaction({ serializedTransaction: input.rawTransaction })); }
          catch { run.hash = hash; run.status = "pending"; run.broadcastUnconfirmed = true; return { hash, status: "pending", broadcast: "unconfirmed" }; }
          run.hash = hash; run.status = "pending";
          return { hash, status: "pending", broadcast: "accepted" };
        } catch (error) {
          if (error instanceof WorkspaceError) throw error;
          fail(400, "Signed workspace transaction could not be verified");
        } finally { run.relaying = false; }
      }
      fail(404, "Unknown workspace action");
    },
  };
}
