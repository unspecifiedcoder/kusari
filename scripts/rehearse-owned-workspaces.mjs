// Real two-owner onboarding + hosted Gemini/Nox execution. Sepolia only; no fixture private keys are saved.
// Run after frontend/backend deployment: node scripts/rehearse-owned-workspaces.mjs
// Four fresh test wallets receive 0.0001 Sepolia ETH each (hard cap 0.0004 total) from local AGENT_PRIVATE_KEY.
// Owner setup transactions use a direct public RPC; the product's prepare/read/relay path must use Nox.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const require = createRequire(new URL("../agent/package.json", import.meta.url));
const { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, encodeAbiParameters,
  parseEther, keccak256, toHex, namehash, encodePacked, decodeEventLog, formatEther } = require("viem");
const { privateKeyToAccount, generatePrivateKey, nonceManager } = require("viem/accounts");
const { sepolia } = require("viem/chains");
const { packetToBytes } = require("viem/ens");
const root = fileURLToPath(new URL("../", import.meta.url));
const atomic = process.argv.includes("--atomic");
if (existsSync(root + ".env")) process.loadEnvFile(root + ".env");
const deployment = JSON.parse(readFileSync(root + "deployments/11155111.json", "utf8"));
const owned = JSON.parse(readFileSync(root + "deployments/11155111-owned.json", "utf8"));
const chain = JSON.parse(readFileSync(root + "config/chains.json", "utf8"))["11155111"];
const origin = "https://kusari.outcomeseal.com";
if (deployment.chainId !== sepolia.id || owned.chainId !== sepolia.id) throw new Error("Sepolia manifests required");
if (!process.env.AGENT_PRIVATE_KEY) throw new Error("Local AGENT_PRIVATE_KEY needed for bounded Sepolia funding");
const funder = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY, { nonceManager });
const transport = http(process.env.SEPOLIA_RPC_URL || chain.rpc, { timeout: 60_000 });
const pub = createPublicClient({ chain: sepolia, transport });
const wallet = account => createWalletClient({ account, chain: sepolia, transport });
const fundWallet = wallet(funder);
const ALL = BigInt("0x" + "1".repeat(64));
const AUTH = 1n << 16n;
const funding = parseEther("0.0001");
if (funding * 4n > parseEther("0.0004")) throw new Error("Rehearsal funding exceeds ceiling");
const registryAbi = parseAbi([
  "function grantRoles(uint256 anyId,uint256 roleBitmap,address account) returns (bool)",
  "function revokeRoles(uint256 anyId,uint256 roleBitmap,address account) returns (bool)",
  "function getOwner(uint256 anyId) view returns (address)",
]);
const resolverAbi = parseAbi([
  "function initialize((address account,uint256 roleBitmap)[] grants,bytes[] calls)",
  "function setData(bytes name,string key,bytes value)",
]);
const proxyAbi = parseAbi([
  "function deployProxy(address implementation,uint256 salt,bytes data) returns (address)",
  "event ProxyDeployed(address indexed sender,address indexed proxyAddress,uint256 salt,address implementation)",
]);
const registrarAbi = parseAbi([
  "function claim(address agent,address resolver) returns (string)",
  "function labelFor(address owner,address agent) pure returns (string)",
]);
const sourceAbi = parseAbi([
  "function bind(address agent,string label,bytes dnsName,bytes32 node)",
  "function isAuthorized(address agent) view returns (bool)",
]);
const factoryAbi = parseAbi([
  "function create(address agent) returns (address)",
  "event VaultCreated(address indexed owner,address indexed vault,address indexed agent)",
]);
const coordinatorAbi = parseAbi([
  "function create(address agent,uint128 maxPerSwap,uint128 dailyCap,uint16 maxImpactBps) payable returns(address vault,address resolver,string label)",
  "function workspaceOf(address owner,address agent) view returns(address vault,address resolver,string label)",
]);
const tokenAbi = parseAbi(["function mint(address to,uint256 amount)", "function balanceOf(address who) view returns (uint256)"]);
const hookAbi = parseAbi(["function spentOn(address agent,uint256 day) view returns (uint256)"]);
const vaultAbi = JSON.parse(readFileSync(root + "contracts/out/AgentVault.sol/AgentVault.json", "utf8")).abi;
const policyType = [{ type: "tuple", components: [
  { name: "maxPerSwap", type: "uint128" }, { name: "dailyCap", type: "uint128" },
  { name: "maxImpactBps", type: "uint16" }, { name: "allowedPool", type: "bytes32" }, { name: "active", type: "bool" },
] }];
const swapIntentTypes = { SwapIntent: [
  { name: "agent", type: "address" }, { name: "vault", type: "address" }, { name: "poolId", type: "bytes32" },
  { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint256" }, { name: "minAmountOut", type: "uint256" },
  { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
] };
const evidence = { chainId: sepolia.id, origin, onboarding: atomic ? "atomic-v1" : "owner-signed-six-step", startedAt: new Date().toISOString(), status: "running",
  fundingCeilingSepoliaETH: "0.0004", setupTransport: "direct public RPC for this CLI rehearsal only",
  executionTransport: "hosted workspace API: Anon-RPC / Nox; independently signed local agent transactions",
  keyHandling: "Four random private keys generated in memory, never sent to API or written to disk",
  assertions: {}, transactions: [], workspaces: {}, runs: [] };
const evidenceDir = root + "docs/evidence";
mkdirSync(evidenceDir, { recursive: true });
const evidenceName = atomic ? "atomic-workspaces.json" : "owned-workspaces.json";
const save = () => writeFileSync(evidenceDir + "/" + evidenceName, JSON.stringify(evidence, null, 2) + "\n");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, text) => { if (!condition) throw new Error(text); };
const fixtures = ["A", "B"].map(id => ({ id,
  owner: privateKeyToAccount(generatePrivateKey(), { nonceManager }),
  agent: privateKeyToAccount(generatePrivateKey(), { nonceManager }),
}));
const [a, b] = fixtures;
let frozen = false;

async function send(w, title, request) {
  const hash = await w.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  assert(receipt.status === "success", `${title} reverted: ${hash}`);
  evidence.transactions.push({ step: title, hash, status: receipt.status }); save();
  console.log(`${title}: ${hash}`);
  return receipt;
}
function eventAddress(receipt, abi, event, field, address) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue;
    try { const parsed = decodeEventLog({ abi, data: log.data, topics: log.topics }); if (parsed.eventName === event) return parsed.args[field]; } catch {}
  }
  throw new Error(`${event} event missing`);
}
async function onboard(f) {
  const w = wallet(f.owner);
  const init = encodeFunctionData({ abi: resolverAbi, functionName: "initialize", args: [[{ account: f.owner.address, roleBitmap: ALL }], []] });
  const salt = BigInt(keccak256(encodePacked(["string", "address", "address"], ["kusari.owned.resolver.v1", f.owner.address, f.agent.address])));
  const receipt = await send(w, `${f.id}: owner deploys dedicated resolver`, { address: owned.verifiableFactory, abi: proxyAbi, functionName: "deployProxy", args: [owned.permissionedResolverImpl, salt, init] });
  f.resolver = eventAddress(receipt, proxyAbi, "ProxyDeployed", "proxyAddress", owned.verifiableFactory);
  f.label = await pub.readContract({ address: owned.registrar, abi: registrarAbi, functionName: "labelFor", args: [f.owner.address, f.agent.address] });
  f.name = `${f.label}.${owned.parentName}`;
  f.dns = toHex(packetToBytes(f.name));
  f.labelId = BigInt(keccak256(toHex(f.label)));
  await send(w, `${f.id}: claims owned ENS label`, { address: owned.registrar, abi: registrarAbi, functionName: "claim", args: [f.agent.address, f.resolver] });
  const policy = { maxPerSwap: parseEther("5"), dailyCap: parseEther("100"), maxImpactBps: 200, allowedPool: deployment.poolId, active: true };
  await send(w, `${f.id}: publishes ENS policy`, { address: f.resolver, abi: resolverAbi, functionName: "setData", args: [f.dns, "kusari.policy", encodeAbiParameters(policyType, [policy])] });
  await send(w, `${f.id}: binds agent to ENS policy`, { address: owned.policySource, abi: sourceAbi, functionName: "bind", args: [f.agent.address, f.label, f.dns, namehash(f.name)] });
  await send(w, `${f.id}: authorizes restricted agent`, { address: owned.registry, abi: registryAbi, functionName: "grantRoles", args: [f.labelId, AUTH, f.agent.address] });
  const created = await send(w, `${f.id}: creates owner-held vault`, { address: deployment.vaultFactory, abi: factoryAbi, functionName: "create", args: [f.agent.address] });
  f.vault = eventAddress(created, factoryAbi, "VaultCreated", "vault", deployment.vaultFactory);
  await send(w, `${f.id}: funds vault with 10 test kUSD`, { address: deployment.token0, abi: tokenAbi, functionName: "mint", args: [f.vault, parseEther("10")] });
  const owner = await pub.readContract({ address: owned.registry, abi: registryAbi, functionName: "getOwner", args: [f.labelId] });
  assert(owner.toLowerCase() === f.owner.address.toLowerCase(), `${f.id}: ENS ownership mismatch`);
  evidence.workspaces[f.id] = { owner: f.owner.address, agent: f.agent.address, resolver: f.resolver, name: f.name, vault: f.vault, maxPerSwap: "5", dailyCap: "100" }; save();
}
async function onboardAtomic(f) {
  assert(owned.atomicReady && owned.atomicCoordinator && owned.personalVaultFactory, "Atomic onboarding is not deployed/wired");
  const w = wallet(f.owner);
  const request = { address: owned.atomicCoordinator, abi: coordinatorAbi, functionName: "create", args: [f.agent.address, parseEther("5"), parseEther("100"), 200], value: parseEther("0.0001") };
  const estimatedGas = await pub.estimateContractGas({ ...request, account: f.owner });
  await send(w, `${f.id}: ONE owner transaction creates ENS, policy, vault, 25 test kUSD and agent gas`, request);
  const [vault, resolver, label] = await pub.readContract({ address: owned.atomicCoordinator, abi: coordinatorAbi, functionName: "workspaceOf", args: [f.owner.address, f.agent.address] });
  Object.assign(f, { vault, resolver, label, name: `${label}.${owned.parentName}`, labelId: BigInt(keccak256(toHex(label))) });
  f.dns = toHex(packetToBytes(f.name));
  const rolesAbi = parseAbi(["function roles(uint256 id,address who) view returns(uint256)"]);
  const [nameOwner, coordinatorLabelRoles, coordinatorResolverRoles, ownerResolverRoles, agentGas] = await Promise.all([
    pub.readContract({ address: owned.registry, abi: registryAbi, functionName: "getOwner", args: [f.labelId] }),
    pub.readContract({ address: owned.registry, abi: rolesAbi, functionName: "roles", args: [f.labelId, owned.atomicCoordinator] }),
    pub.readContract({ address: resolver, abi: rolesAbi, functionName: "roles", args: [0n, owned.atomicCoordinator] }),
    pub.readContract({ address: resolver, abi: rolesAbi, functionName: "roles", args: [0n, f.owner.address] }),
    pub.getBalance({ address: f.agent.address }),
  ]);
  assert(nameOwner.toLowerCase() === f.owner.address.toLowerCase(), "Atomic name was not handed to the owner");
  assert(coordinatorLabelRoles === 0n && coordinatorResolverRoles === 0n && ownerResolverRoles === ALL, "Coordinator retained temporary ENS or resolver authority");
  assert(agentGas === parseEther("0.0001"), "Atomic agent gas funding mismatch");
  evidence.workspaces[f.id] = { owner: f.owner.address, agent: f.agent.address, resolver, name: f.name, vault,
    maxPerSwap: "5", dailyCap: "100", initialTestKUSD: "25", agentGasETH: "0.0001", createEstimatedGas: estimatedGas.toString(),
    coordinatorLabelRoles: coordinatorLabelRoles.toString(), coordinatorResolverRoles: coordinatorResolverRoles.toString(),
    ownerResolverRoles: ownerResolverRoles.toString() }; save();
}
function api(action, body) {
  // curl preserves HTTPS verification while avoiding the known stale local DNS cache.
  const raw = execFileSync("curl.exe", ["--silent", "--show-error", "--max-time", "90", "--resolve", "kusari.outcomeseal.com:443:76.76.21.21", "--request", "POST",
    "--header", "content-type: application/json", "--header", `origin: ${origin}`, "--data-binary", "@-", "--write-out", "\n%{http_code}", `${origin}/api/workspace/${action}`], { input: JSON.stringify(body), encoding: "utf8", maxBuffer: 262144 });
  const split = raw.lastIndexOf("\n");
  const status = Number(raw.slice(split + 1));
  let value;
  try { value = JSON.parse(raw.slice(0, split)); } catch { throw new Error(`Workspace ${action} returned non-JSON HTTP ${status}`); }
  if (status >= 400) { const error = new Error(`Workspace ${action}: HTTP ${status}: ${value.error ?? "request failed"}`); error.status = status; throw error; }
  return value;
}
async function run(f, label, expected) {
  const ws = { owner: f.owner.address, agent: f.agent.address, vault: f.vault, scenario: "normal" };
  let prepared;
  for (let attempt = 0; attempt < 3; attempt++) {
    const challenge = api("challenge", ws);
    const signature = await f.owner.signMessage({ message: challenge.message });
    try { prepared = api("prepare", { ...ws, nonce: challenge.nonce, signature }); break; }
    catch (error) { if (error.status !== 429 || attempt === 2) throw error; await sleep(31_000); }
  }
  let result;
  const deadline = Date.now() + 180_000;
  do { result = api("result", { runId: prepared.runId }); if (result.status !== "preparing") break; await sleep(2000); } while (Date.now() < deadline);
  assert(result.status === "ready", `${label}: Gemini did not propose a signable swap (status ${result.status}); no amount was substituted`);
  const intent = { ...result.intent };
  for (const field of ["amountIn", "minAmountOut", "nonce", "deadline"]) intent[field] = BigInt(intent[field]);
  const signature = await f.agent.signTypedData({ domain: { name: "Kusari", version: "1", chainId: sepolia.id, verifyingContract: deployment.policyHook }, types: swapIntentTypes, primaryType: "SwapIntent", message: intent });
  const data = encodeFunctionData({ abi: vaultAbi, functionName: "swap", args: [result.poolKey, intent, signature] });
  const tx = { ...result.transaction, data };
  for (const field of ["gas", "maxFeePerGas", "maxPriorityFeePerGas", "value"]) tx[field] = BigInt(tx[field]);
  const rawTransaction = await f.agent.signTransaction(tx);
  const relayed = api("relay", { runId: prepared.runId, signature, rawTransaction });
  const receipt = await pub.waitForTransactionReceipt({ hash: relayed.hash, timeout: 180_000 });
  result = api("result", { runId: prepared.runId });
  assert(receipt.status === expected, `${label}: expected ${expected}, got ${receipt.status}`);
  assert(result.status === (expected === "success" ? "success" : "reverted"), `${label}: public result disagrees with receipt`);
  assert(result.routing?.route === "Anon-RPC / Nox" && result.routing?.rpcRequests > 0 && result.routing?.submissionRequests > 0, `${label}: missing observed Nox read/submission counters`);
  evidence.runs.push({ label, workspace: f.id, runId: prepared.runId, decision: result.decision,
    requestedKUSD: formatEther(intent.amountIn), limitKUSD: "5", status: result.status, hash: relayed.hash,
    preflightReason: result.preflightReason, routing: result.routing }); save();
  console.log(`${label}: ${result.status} ${relayed.hash}`);
  return result;
}
async function authorized(f) { return pub.readContract({ address: owned.policySource, abi: sourceAbi, functionName: "isAuthorized", args: [f.agent.address] }); }
async function setAuthorization(f, grant) {
  await send(wallet(f.owner), `${f.id}: ${grant ? "restores" : "freezes"} its own agent`, { address: owned.registry, abi: registryAbi, functionName: grant ? "grantRoles" : "revokeRoles", args: [f.labelId, AUTH, f.agent.address] });
}
async function cleanup() {
  for (const f of fixtures) for (const account of [f.owner, f.agent]) {
    try {
      const balance = await pub.getBalance({ address: account.address });
      const fees = await pub.estimateFeesPerGas();
      const reserve = 21_000n * fees.maxFeePerGas;
      if (balance > reserve) {
        const hash = await wallet(account).sendTransaction({ to: funder.address, value: balance - reserve, gas: 21_000n, ...fees });
        const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
        evidence.transactions.push({ step: "Return remaining ephemeral-wallet Sepolia ETH", from: account.address, hash, status: receipt.status });
      }
    } catch { evidence.transactions.push({ step: "Ephemeral wallet cleanup could not be confirmed", address: account.address }); }
  }
  save();
}

try {
  assert(await pub.getChainId() === sepolia.id, "RPC must be Sepolia");
  // Check deployed public API before moving even test funds.
  api("challenge", { owner: a.owner.address, agent: a.agent.address, vault: deployment.demoVault, scenario: "normal" });
  assert(await pub.getBalance({ address: funder.address }) > funding * 4n, "Shared agent has insufficient bounded test funding");
  for (const f of fixtures) for (const account of atomic ? [f.owner] : [f.owner, f.agent]) {
    const amount = atomic ? funding * 2n : funding;
    const hash = await fundWallet.sendTransaction({ to: account.address, value: amount });
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    assert(receipt.status === "success", "Test gas funding reverted");
    evidence.transactions.push({ step: `Fund fresh rehearsal wallet with ${formatEther(amount)} Sepolia ETH`, to: account.address, hash, status: receipt.status }); save();
  }
  await Promise.all(fixtures.map(atomic ? onboardAtomic : onboard));
  await run(a, "A: normal Gemini trade", "success");
  await run(b, "B: normal Gemini trade", "success");
  await setAuthorization(a, false); frozen = true;
  assert(!await authorized(a) && await authorized(b), "Freezing A changed B's authorization");
  await run(a, "A: frozen Gemini trade", "reverted");
  await run(b, "B: Gemini trade while A is frozen", "success");
  const day = BigInt(Math.floor(Date.now() / 86_400_000));
  const [spentA, spentB] = await Promise.all(fixtures.map(f => pub.readContract({ address: deployment.policyHook, abi: hookAbi, functionName: "spentOn", args: [f.agent.address, day] })));
  const aRunAmount = parseEther(evidence.runs[0].requestedKUSD);
  const bRunAmount = evidence.runs.filter(r => r.workspace === "B").reduce((sum, r) => sum + parseEther(r.requestedKUSD), 0n);
  assert(spentA === aRunAmount && spentB === bRunAmount, "Per-agent daily spending accounting is not isolated");
  await setAuthorization(a, true); frozen = false;
  assert(await authorized(a) && await authorized(b), "Restore did not leave both independent agents active");
  evidence.assertions = { distinctOwners: a.owner.address !== b.owner.address, distinctAgents: a.agent.address !== b.agent.address,
    distinctResolvers: a.resolver !== b.resolver, distinctENSNames: a.name !== b.name, distinctVaults: a.vault !== b.vault,
    frozenARejectedOnchain: true, bTradedWhileAFrozen: true, independentDailyAccounting: true, restoredA: true,
    actualGeminiDecisions: true, observedNoxReadsAndBroadcasts: true, anonymityProven: false };
  evidence.spending = { A: formatEther(spentA), B: formatEther(spentB) };
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.error = error instanceof Error ? error.message.split("\n")[0] : "Rehearsal failed";
  console.error(evidence.error);
  process.exitCode = 1;
} finally {
  if (frozen) { try { await setAuthorization(a, true); } catch { evidence.restoreNeeded = a.agent.address; } }
  await cleanup();
  evidence.finishedAt = new Date().toISOString(); save();
  console.log(`Public evidence: docs/evidence/${evidenceName} (${evidence.status}). No private keys saved.`);
}
