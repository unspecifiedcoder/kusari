// B5 + owner tools: manage the agent's ENSv2 policy, as the OWNER wallet.
//   node src/ens-policy.ts set [maxPerSwap] [dailyCap] [maxImpactBps]   write limits into ENS (resolver data record)
//   node src/ens-policy.ts revoke                                       kill switch: revoke the agent's ENS role
//   node src/ens-policy.ts grant                                        re-authorize the agent
//   node src/ens-policy.ts show                                         what the hook will read
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi, encodeAbiParameters, parseEther, formatEther, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount, nonceManager } from "viem/accounts";
import { sepolia } from "viem/chains";
import { deployment } from "./config.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ens = JSON.parse(readFileSync(root + (process.env.ENS_OUT ?? "deployments/11155111-ens.json"), "utf8"));
const owner = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY as Hex, { nonceManager });
const rpc = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const pub = createPublicClient({ chain: sepolia, transport: http(rpc, { timeout: 60_000 }) });
const wallet = createWalletClient({ account: owner, chain: sepolia, transport: http(rpc, { timeout: 60_000 }) });

const POLICY = [{ type: "tuple", components: [
  { name: "maxPerSwap", type: "uint128" }, { name: "dailyCap", type: "uint128" }, { name: "maxImpactBps", type: "uint16" },
  { name: "allowedPool", type: "bytes32" }, { name: "active", type: "bool" },
] }] as const;
const resolverAbi = parseAbi(["function setData(bytes name, string key, bytes value)"]);
const registryAbi = parseAbi(["function grantRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)", "function revokeRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)"]);
const sourceAbi = parseAbi([
  "function isAuthorized(address agent) view returns (bool)",
  "function policyOf(address agent) view returns ((uint128 maxPerSwap, uint128 dailyCap, uint16 maxImpactBps, bytes32 allowedPool, bool active))",
]);
const ROLE_RENEW = 1n << 16n;
const labelId = BigInt(keccak256(toHex(ens.name.split(".")[0])));

async function tx(label: string, req: Parameters<typeof wallet.writeContract>[0]) {
  const hash = await wallet.writeContract(req);
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`${r.status === "success" ? "✓" : "✗"} ${label}  https://sepolia.etherscan.io/tx/${hash}`);
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
} else if (cmd !== "show") {
  throw new Error(`unknown command ${cmd}`);
}
await show();
