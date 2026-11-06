// Deploy the public, register-only ENS onboarding helper. Run locally; never ship OWNER_PRIVATE_KEY.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../agent/package.json", import.meta.url));
const { createPublicClient, createWalletClient, http, parseAbi } = require("viem");
const { privateKeyToAccount, nonceManager } = require("viem/accounts");
const { sepolia } = require("viem/chains");
const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(root + ".env")) process.loadEnvFile(root + ".env");
const ens = JSON.parse(readFileSync(root + "deployments/11155111-ens.json", "utf8"));
const chain = JSON.parse(readFileSync(root + "config/chains.json", "utf8"))["11155111"];
const out = root + "deployments/11155111-owned.json";
const state = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
if (!process.env.OWNER_PRIVATE_KEY) throw new Error("Local OWNER_PRIVATE_KEY is required");
const account = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY, { nonceManager });
if (account.address.toLowerCase() !== ens.owner.toLowerCase()) throw new Error("Owner does not match parent ENS owner");
const transport = http(process.env.SEPOLIA_RPC_URL || chain.rpc, { timeout: 60_000 });
const pub = createPublicClient({ chain: sepolia, transport });
const wallet = createWalletClient({ chain: sepolia, transport, account });
if (await pub.getChainId() !== sepolia.id) throw new Error("Deployment requires Sepolia RPC");
const artifact = JSON.parse(readFileSync(root + "contracts/out/OwnedAgentRegistrar.sol/OwnedAgentRegistrar.json", "utf8"));
if (!state.registrar) {
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [ens.userRegistry] });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Registrar deployment reverted: ${hash}`);
  Object.assign(state, {
    chainId: sepolia.id,
    registrar: receipt.contractAddress,
    registry: ens.userRegistry,
    policySource: ens.policySource,
    parentName: ens.name.split(".").slice(1).join("."),
    verifiableFactory: chain.ens.verifiableFactory,
    permissionedResolverImpl: chain.ens.permissionedResolverImpl,
    registrarDeploymentTx: hash,
    custody: "owner-wallet-and-browser-local-agent-key",
  });
  writeFileSync(out, JSON.stringify(state, null, 2) + "\n");
  console.log(`Registrar deployed: ${state.registrar} (${hash})`);
}
if (state.registry.toLowerCase() !== ens.userRegistry.toLowerCase()) throw new Error("Onboarding manifest registry mismatch");
if (!(await pub.getCode({ address: state.registrar }))) throw new Error("Registrar code missing");
const registryAbi = parseAbi([
  "function grantRootRoles(uint256 roleBitmap,address account) returns (bool)",
  "function roles(uint256 anyId,address account) view returns (uint256)",
]);
const role = await pub.readContract({ address: ens.userRegistry, abi: registryAbi, functionName: "roles", args: [0n, state.registrar] });
if (role !== 0n && role !== 1n) throw new Error("Registrar has unexpected authority; inspect roles before proceeding");
if (role === 0n) {
  const hash = await wallet.writeContract({ address: ens.userRegistry, abi: registryAbi, functionName: "grantRootRoles", args: [1n, state.registrar] });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Register-only role grant reverted: ${hash}`);
  state.registrarRoleTx = hash;
  writeFileSync(out, JSON.stringify(state, null, 2) + "\n");
  console.log(`Granted only ROLE_REGISTRAR: ${hash}`);
}
const verified = await pub.readContract({ address: ens.userRegistry, abi: registryAbi, functionName: "roles", args: [0n, state.registrar] });
if (verified !== 1n) throw new Error("Register-only authority verification failed");
console.log(`Verified registrar authority = 1; parent namespace ${state.parentName}. Shared demo unchanged.`);
