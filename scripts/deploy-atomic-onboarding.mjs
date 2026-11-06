// Local deployment/wiring of one-transaction owned-agent onboarding. Owner key never leaves this machine.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../agent/package.json", import.meta.url));
const { createPublicClient, createWalletClient, http, parseAbi, namehash, toHex } = require("viem");
const { privateKeyToAccount, nonceManager } = require("viem/accounts");
const { sepolia } = require("viem/chains");
const { packetToBytes } = require("viem/ens");
const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(root + ".env")) process.loadEnvFile(root + ".env");
const deployment = JSON.parse(readFileSync(root + "deployments/11155111.json", "utf8"));
const ens = JSON.parse(readFileSync(root + "deployments/11155111-ens.json", "utf8"));
const chain = JSON.parse(readFileSync(root + "config/chains.json", "utf8"))["11155111"];
const out = root + "deployments/11155111-owned.json";
const state = JSON.parse(readFileSync(out, "utf8"));
const account = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY, { nonceManager });
if (account.address.toLowerCase() !== ens.owner.toLowerCase()) throw new Error("Local key must match ENS parent owner");
const transport = http(process.env.SEPOLIA_RPC_URL || chain.rpc, { timeout: 60_000 });
const pub = createPublicClient({ chain: sepolia, transport });
const wallet = createWalletClient({ account, chain: sepolia, transport });
if (await pub.getChainId() !== sepolia.id || deployment.chainId !== sepolia.id) throw new Error("Sepolia only");
const save = () => writeFileSync(out, JSON.stringify(state, null, 2) + "\n");
async function deploy(field, name, args) {
  if (state[field]) { if (!(await pub.getCode({ address: state[field] }))) throw new Error(`${field} has no code`); return; }
  const artifact = JSON.parse(readFileSync(root + `contracts/out/${name}.sol/${name}.json`, "utf8"));
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deployment reverted: ${hash}`);
  state[field] = receipt.contractAddress;
  state[field + "DeploymentTx"] = hash; save();
  console.log(`${name} ${receipt.contractAddress}: ${hash}`);
}
await deploy("personalVaultFactory", "PersonalAgentVaultFactory", [chain.uniswap.poolManager, deployment.policyHook]);
await deploy("atomicCoordinator", "OwnedAgentCoordinator", [state.registry, deployment.policySource, state.verifiableFactory,
  state.permissionedResolverImpl, state.personalVaultFactory, deployment.token0, deployment.poolId,
  toHex(packetToBytes(state.parentName)), namehash(state.parentName)]);
const factoryAbi = parseAbi([
  "function coordinator() view returns(address)", "function initializer() view returns(address)",
  "function initializeCoordinator(address who)",
]);
async function send(address, abi, functionName, args, field) {
  const hash = await wallet.writeContract({ address, abi, functionName, args });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  state[field] = hash; save(); console.log(`${functionName}: ${hash}`);
}
const coordinator = await pub.readContract({ address: state.personalVaultFactory, abi: factoryAbi, functionName: "coordinator" });
if (coordinator === "0x0000000000000000000000000000000000000000") {
  await send(state.personalVaultFactory, factoryAbi, "initializeCoordinator", [state.atomicCoordinator], "atomicFactoryWiringTx");
} else if (coordinator.toLowerCase() !== state.atomicCoordinator.toLowerCase()) throw new Error("Factory has different coordinator");
const registryAbi = parseAbi(["function grantRootRoles(uint256 roles,address who) returns(bool)", "function roles(uint256 id,address who) view returns(uint256)"]);
const roles = await pub.readContract({ address: state.registry, abi: registryAbi, functionName: "roles", args: [0n, state.atomicCoordinator] });
if (roles !== 0n && roles !== 1n) throw new Error("Unexpected coordinator parent authority");
if (roles === 0n) await send(state.registry, registryAbi, "grantRootRoles", [1n, state.atomicCoordinator], "atomicRegistrarRoleTx");
const [verifiedRoles, initializer] = await Promise.all([
  pub.readContract({ address: state.registry, abi: registryAbi, functionName: "roles", args: [0n, state.atomicCoordinator] }),
  pub.readContract({ address: state.personalVaultFactory, abi: factoryAbi, functionName: "initializer" }),
]);
if (verifiedRoles !== 1n || initializer !== "0x0000000000000000000000000000000000000000") throw new Error("Atomic authority verification failed");
Object.assign(state, { atomicVersion: 1, atomicTestFundingKUSD: "25", atomicDefaultAgentGasETH: "0.0001", atomicMaxAgentGasETH: "0.001",
  atomicNameTransfer: "Explicit ENS unsafeTransfer for known parent authority and retained restricted agent role; all temporary owner roles move to the user", atomicReady: true }); save();
console.log("Atomic onboarding ready; coordinator retains only parent register role, factory initializer erased. Shared contracts unchanged.");
