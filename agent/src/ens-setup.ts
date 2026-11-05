// B2 + B3 + B4-live: set up the agent's ENSv2 identity on Sepolia, as the OWNER wallet.
//   1. own UserRegistry + PermissionedResolver proxies (ENS VerifiableFactory)
//   2. register <PARENT>.eth via ETHRegistrar (commit -> wait 60s -> register, paid in MockUSDC)
//   3. create alpha.<PARENT>.eth, deploy ENSPolicySource, bind the agent, grant it ROLE_RENEW
// Resumable: progress is saved to deployments/11155111-ens.json after every step.
//   node src/ens-setup.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, keccak256, toHex, namehash, type Address, type Hex } from "viem";
import { privateKeyToAccount, nonceManager } from "viem/accounts";
import { sepolia } from "viem/chains";
import { packetToBytes } from "viem/ens";
import { config, ANON_RPC } from "./config.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const OUT = root + (process.env.ENS_OUT ?? "deployments/11155111-ens.json");
const PARENT = process.env.ENS_PARENT_LABEL ?? "kusari-demo";
const LABEL = process.env.ENS_AGENT_LABEL || "alpha";
const FULL = `${LABEL}.${PARENT}.eth`;

const ENS = JSON.parse(readFileSync(root + "config/chains.json", "utf8"))["11155111"].ens;
const ALL = BigInt("0x" + "1".repeat(64)); // every role + admin role, one bit per 4-bit nybble
const ROLE_RENEW = 1n << 16n;
const YEAR = 365n * 24n * 3600n;

const ownerKey = process.env.OWNER_PRIVATE_KEY as Hex;
if (!ownerKey) throw new Error("OWNER_PRIVATE_KEY not set");
const owner = privateKeyToAccount(ownerKey, { nonceManager });
const agent = config.agentAddress!;
const rpc = process.env.SEPOLIA_RPC_URL || ANON_RPC; // owner actions go through Anon-RPC too
const pub = createPublicClient({ chain: sepolia, transport: http(rpc, { timeout: 60_000 }) });
const wallet = createWalletClient({ account: owner, chain: sepolia, transport: http(rpc, { timeout: 60_000 }) });

const factoryAbi = parseAbi(["function deployProxy(address implementation, uint256 salt, bytes data) returns (address)", "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)"]);
const registryAbi = parseAbi([
  "function initialize((address account, uint256 roleBitmap)[] grants)",
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "function grantRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)",
  "function hasRoles(uint256 anyId, uint256 roleBitmap, address account) view returns (bool)",
  "function getOwner(uint256 anyId) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "function setParent(address parent, string label)",
]);
const resolverAbi = parseAbi(["function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)", "function setData(bytes name, string key, bytes value)", "function setAddress(bytes name, uint256 coinType, bytes addressBytes)", "function setText(bytes name, string key, string value)"]);
const registrarAbi = parseAbi([
  "function isAvailable(string label) view returns (bool)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256, uint256)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function commitmentAt(bytes32 commitment) view returns (uint64)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
]);
const erc20Abi = parseAbi(["function mint(address to, uint256 amount)", "function approve(address spender, uint256 value) returns (bool)"]);
const sourceAbi = parseAbi(["function bind(address agent, string label, bytes dnsName, bytes32 node)", "function isAuthorized(address agent) view returns (bool)", "function registry() view returns (address)"]);

type State = Record<string, string>;
const state: State = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const save = () => writeFileSync(OUT, JSON.stringify(state, null, 2) + "\n");

async function send(label: string, req: Parameters<typeof wallet.writeContract>[0]) {
  const hash = await wallet.writeContract(req);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`  ✓ ${label}  ${hash}  gas ${r.gasUsed}`);
  return r;
}

async function step(key: string, title: string, fn: () => Promise<string>) {
  if (state[key]) return console.log(`• ${title}: done (${state[key]})`);
  console.log(`• ${title}`);
  state[key] = await fn();
  save();
}

const grants = [{ account: owner.address, roleBitmap: ALL }];
async function deployProxy(impl: Address, saltTag: string, data: Hex): Promise<string> {
  const salt = BigInt(keccak256(toHex(`kusari:${FULL}:${saltTag}`)));
  const { result } = await pub.simulateContract({ account: owner, address: ENS.verifiableFactory, abi: factoryAbi, functionName: "deployProxy", args: [impl, salt, data] });
  await send(`deploy ${saltTag} proxy`, { address: ENS.verifiableFactory, abi: factoryAbi, functionName: "deployProxy", args: [impl, salt, data] } as never);
  return result;
}

console.log(`owner ${owner.address} -> ${FULL} for agent ${agent}`);
state.owner = owner.address;
state.agent = agent;
state.name = FULL;

await step("userRegistry", `UserRegistry for ${PARENT}.eth`, () =>
  deployProxy(ENS.userRegistryImpl, "registry", encodeFunctionData({ abi: registryAbi, functionName: "initialize", args: [grants] })),
);
await step("resolver", "PermissionedResolver", () =>
  deployProxy(ENS.permissionedResolverImpl, "resolver", encodeFunctionData({ abi: resolverAbi, functionName: "initialize", args: [grants, []] })),
);

await step("parentRegistered", `register ${PARENT}.eth`, async () => {
  const available = await pub.readContract({ address: ENS.ethRegistrar, abi: registrarAbi, functionName: "isAvailable", args: [PARENT] });
  if (!available) throw new Error(`${PARENT}.eth is not available`);
  const [base, premium] = await pub.readContract({ address: ENS.ethRegistrar, abi: registrarAbi, functionName: "getRegisterPrice", args: [PARENT, YEAR, ENS.mockUSDC] });
  const price = base + premium;
  await send(`mint ${price} MockUSDC`, { address: ENS.mockUSDC, abi: erc20Abi, functionName: "mint", args: [owner.address, price] } as never);
  await send("approve registrar", { address: ENS.mockUSDC, abi: erc20Abi, functionName: "approve", args: [ENS.ethRegistrar, price] } as never);
  const secret = keccak256(toHex(`kusari-secret:${FULL}:${owner.address}`));
  const args = [PARENT, owner.address, secret, state.userRegistry as Address, state.resolver as Address, YEAR, `0x${"0".repeat(64)}`] as const;
  const commitment = await pub.readContract({ address: ENS.ethRegistrar, abi: registrarAbi, functionName: "makeCommitment", args });
  await send("commit", { address: ENS.ethRegistrar, abi: registrarAbi, functionName: "commit", args: [commitment] } as never);
  console.log("  … waiting 70s (MIN_COMMITMENT_AGE)");
  await new Promise((r) => setTimeout(r, 70_000));
  await send("register", {
    address: ENS.ethRegistrar,
    abi: registrarAbi,
    functionName: "register",
    args: [PARENT, owner.address, secret, state.userRegistry as Address, state.resolver as Address, YEAR, ENS.mockUSDC, `0x${"0".repeat(64)}`],
  } as never);
  return "yes";
});

await step("parentLinked", "link registry to parent (setParent)", async () => {
  await send("setParent", { address: state.userRegistry as Address, abi: registryAbi, functionName: "setParent", args: [ENS.ethRegistry, PARENT] } as never);
  return "yes";
});

await step("labelRegistered", `create ${FULL}`, async () => {
  const expiry = BigInt(Math.floor(Date.now() / 1000)) + YEAR;
  await send(`register ${LABEL}`, {
    address: state.userRegistry as Address,
    abi: registryAbi,
    functionName: "register",
    args: [LABEL, owner.address, "0x0000000000000000000000000000000000000000", state.resolver as Address, ALL, expiry],
  } as never);
  return "yes";
});

await step("policySource", "deploy ENSPolicySource", async () => {
  const art = JSON.parse(readFileSync(root + "contracts/out/ENSPolicySource.sol/ENSPolicySource.json", "utf8"));
  // pinned trust root: the only registry this source will ever read
  const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args: [state.userRegistry as Address] });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) throw new Error(`deploy failed ${hash}`);
  console.log(`  ✓ ENSPolicySource ${r.contractAddress}  gas ${r.gasUsed}`);
  return r.contractAddress;
});

const dnsName = toHex(packetToBytes(FULL));
const node = namehash(FULL);
state.dnsName = dnsName;
state.node = node;

await step("bound", "bind agent to the ENS name", async () => {
  await send("bind", { address: state.policySource as Address, abi: sourceAbi, functionName: "bind", args: [agent, LABEL, dnsName, node] } as never);
  return "yes";
});

await step("roleGranted", "grant the agent ROLE_RENEW (the 'authorized' marker)", async () => {
  await send("grantRoles", { address: state.userRegistry as Address, abi: registryAbi, functionName: "grantRoles", args: [BigInt(keccak256(toHex(LABEL))), ROLE_RENEW, agent] } as never);
  return "yes";
});

await step("records", "make the name resolve to the agent (addr + text records)", async () => {
  await send("addr(60) -> agent", { address: state.resolver as Address, abi: resolverAbi, functionName: "setAddress", args: [dnsName, 60n, agent] } as never);
  const texts: [string, string][] = [
    ["description", "Kusari AI trading agent. Funds sit in a vault; every swap is checked by a Uniswap v4 hook against the policy in this name."],
    ["url", "https://github.com/unspecifiedcoder/kusari"],
    ["kusari.vault", process.env.KUSARI_VAULT ?? ""],
    ["kusari.policy.format", "abi(uint128 maxPerSwap,uint128 dailyCap,uint16 maxImpactBps,bytes32 allowedPool,bool active) in data record kusari.policy"],
  ];
  for (const [k, v] of texts) {
    if (!v) continue;
    await send(`text ${k}`, { address: state.resolver as Address, abi: resolverAbi, functionName: "setText", args: [dnsName, k, v] } as never);
  }
  return "yes";
});

save();
const authorized = await pub.readContract({ address: state.policySource as Address, abi: sourceAbi, functionName: "isAuthorized", args: [agent] });
const labelOwner = await pub.readContract({ address: state.userRegistry as Address, abi: registryAbi, functionName: "getOwner", args: [BigInt(keccak256(toHex(LABEL)))] });
console.log(`\n${FULL}: owner ${labelOwner}, agent authorized=${authorized}`);
console.log(`ENSPolicySource ${state.policySource}  (next: deploy the hook with POLICY_SOURCE=${state.policySource}, then write the policy record)`);
