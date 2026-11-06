// B5 + owner tools: manage the agent's ENSv2 policy, as the OWNER wallet.
//   node src/ens-policy.ts set [maxPerSwap] [dailyCap] [maxImpactBps]   write limits into ENS (resolver data record)
//   node src/ens-policy.ts revoke                                       kill switch: revoke the agent's ENS role
//   node src/ens-policy.ts grant                                        re-authorize the agent
//   node src/ens-policy.ts set-vault                                    publish the deployed demo vault as kusari.vault text
//   node src/ens-policy.ts show                                         what the hook will read
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi, encodeAbiParameters, parseEther, formatEther, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount, nonceManager } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config, deployment, ANON_RPC } from "./config.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ens = JSON.parse(readFileSync(root + (process.env.ENS_OUT ?? "deployments/11155111-ens.json"), "utf8"));
const owner = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY as Hex, { nonceManager });
const rpc = process.env.SEPOLIA_RPC_URL || ANON_RPC; // owner actions go through Anon-RPC too
const pub = createPublicClient({ chain: sepolia, transport: http(rpc, { timeout: 60_000 }) });
const wallet = createWalletClient({ account: owner, chain: sepolia, transport: http(rpc, { timeout: 60_000 }) });

const POLICY = [{ type: "tuple", components: [
  { name: "maxPerSwap", type: "uint128" }, { name: "dailyCap", type: "uint128" }, { name: "maxImpactBps", type: "uint16" },
  { name: "allowedPool", type: "bytes32" }, { name: "active", type: "bool" },
] }] as const;
const resolverAbi = parseAbi(["function setData(bytes name, string key, bytes value)", "function setText(bytes name, string key, string value)"]);
const registryAbi = parseAbi(["function grantRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)", "function revokeRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)"]);
const sourceAbi = parseAbi([
  "function isAuthorized(address agent) view returns (bool)",
  "function policyOf(address agent) view returns ((uint128 maxPerSwap, uint128 dailyCap, uint16 maxImpactBps, bytes32 allowedPool, bool active))",
]);
const ROLE_RENEW = 1n << 16n;
const labelId = BigInt(keccak256(toHex(ens.name.split(".")[0])));

async function tx(label: string, req: Parameters<typeof wallet.writeContract>[0]) {
  if (!ens.policySource || deployment.policySource.toLowerCase() !== ens.policySource.toLowerCase()) {
    throw new Error("Deployment and ENS checkpoint use different policy sources; choose matching DEPLOYMENT_FILE and ENS_OUT");
  }
  if (!ens.owner || ens.owner.toLowerCase() !== owner.address.toLowerCase()) {
    throw new Error("Owner wallet does not match the ENS checkpoint; choose the correct ENS_OUT and owner identity");
  }
  if (!ens.agent || !config.agentAddress || ens.agent.toLowerCase() !== config.agentAddress.toLowerCase()) {
    throw new Error("Configured agent does not match the ENS checkpoint; check ENS_OUT and AGENT_ADDRESS/AGENT_PRIVATE_KEY");
  }
  if (config.agentKey && privateKeyToAccount(config.agentKey).address.toLowerCase() !== ens.agent.toLowerCase()) {
    throw new Error("Agent signing identity does not match the ENS checkpoint");
  }
  if (deployment.chainId !== sepolia.id || await pub.getChainId() !== sepolia.id) {
    throw new Error("Owner writes require the Sepolia deployment and a Sepolia RPC (chain ID 11155111)");
  }
  const hash = await wallet.writeContract(req);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted: https://sepolia.etherscan.io/tx/${hash}`);
  console.log(`✓ ${label}  https://sepolia.etherscan.io/tx/${hash}`);
}

async function show() {
  const [auth, p] = await Promise.all([
    pub.readContract({ address: ens.policySource, abi: sourceAbi, functionName: "isAuthorized", args: [ens.agent] }),
    pub.readContract({ address: ens.policySource, abi: sourceAbi, functionName: "policyOf", args: [ens.agent] }),
  ]);
  console.log(`${ens.name}: authorized=${auth} active=${p.active} maxPerSwap=${formatEther(p.maxPerSwap)} dailyCap=${formatEther(p.dailyCap)} maxImpact=${p.maxImpactBps / 100}% pool ${p.allowedPool === deployment.poolId ? "= Kusari pool" : p.allowedPool}`);
}

const [cmd = "show", ...args] = process.argv.slice(2);
if (cmd === "set") {
  const [max = "5", daily = "20", bps = "200"] = args;
  const value = encodeAbiParameters(POLICY, [{ maxPerSwap: parseEther(max), dailyCap: parseEther(daily), maxImpactBps: Number(bps), allowedPool: deployment.poolId, active: true }]);
  await tx(`set policy ${max}/swap ${daily}/day ${Number(bps) / 100}%`, { address: ens.resolver as Address, abi: resolverAbi, functionName: "setData", args: [ens.dnsName, "kusari.policy", value] } as never);
} else if (cmd === "revoke") {
  await tx("revoke agent role", { address: ens.userRegistry as Address, abi: registryAbi, functionName: "revokeRoles", args: [labelId, ROLE_RENEW, ens.agent] } as never);
} else if (cmd === "grant") {
  await tx("grant agent role", { address: ens.userRegistry as Address, abi: registryAbi, functionName: "grantRoles", args: [labelId, ROLE_RENEW, ens.agent] } as never);
} else if (cmd === "set-vault") {
  if (args.length) throw new Error("set-vault takes no arguments; it publishes deployment.demoVault");
  await tx("set kusari.vault text record", { address: ens.resolver as Address, abi: resolverAbi, functionName: "setText", args: [ens.dnsName, "kusari.vault", deployment.demoVault] } as never);
} else if (cmd !== "show") {
  throw new Error(`unknown command ${cmd}`);
}
await show();
