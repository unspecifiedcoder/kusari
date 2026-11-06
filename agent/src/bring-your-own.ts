// Local EOA-agent integration example. Preview by default; --send explicitly enables a simulated swap.
// Your agent key remains on your machine. This does not call the hosted shared-agent API.
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, http, parseAbi, parseEther, formatEther,
  getAddress, isAddress, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { stateViewAbi, agentVaultAbi, policySourceAbi } from "./abi.ts";
import { swapIntentTypes, kusariDomain } from "../../shared/types.ts";
import { sharedTradeMinimum } from "../../scripts/api-trade.mjs";

const argv = process.argv.slice(2);
if (argv.includes("--help")) {
  console.log("node src/bring-your-own.ts [--amount 1] [--send]\nRequires KUSARI_VAULT_ADDRESS and ANON_RPC_URL. --send additionally requires the vault's own AGENT_PRIVATE_KEY. Without --send: read-only unsigned intent preview.");
  process.exit(0);
}

async function main() {
  const amountAt = argv.indexOf("--amount");
  const send = argv.includes("--send");
  const allowed = new Set(["--send", "--amount"]);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--amount") { i++; continue; }
    if (!allowed.has(argv[i])) throw new Error("Unknown argument; use --help");
  }
  const amountText = amountAt < 0 ? "1" : argv[amountAt + 1];
  if (!amountText || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(amountText)) throw new Error("--amount must be a positive kUSD decimal with at most 18 decimals");
  const amountIn = parseEther(amountText);
  if (amountIn <= 0n || amountIn >= 2n ** 128n) throw new Error("Amount is outside the supported uint128 policy range");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  if (existsSync(root + ".env")) process.loadEnvFile(root + ".env");
  const deployment = JSON.parse(readFileSync(root + "deployments/11155111.json", "utf8"));
  const chain = JSON.parse(readFileSync(root + "config/chains.json", "utf8"))["11155111"];
  const address = process.env.KUSARI_VAULT_ADDRESS;
  if (!address || !isAddress(address)) throw new Error("Set KUSARI_VAULT_ADDRESS to your own provisioned vault; there is no shared-vault fallback");
  const vault = getAddress(address);
  if (vault.toLowerCase() === deployment.demoVault.toLowerCase()) throw new Error("This example requires your own vault, not the shared demo vault");
  if (!process.env.ANON_RPC_URL) throw new Error("Set ANON_RPC_URL to your own running Anon-RPC bridge; direct RPC fallback is disabled");
  const rpc = new URL(process.env.ANON_RPC_URL);
  if (!["http:", "https:"].includes(rpc.protocol)) throw new Error("ANON_RPC_URL must be an HTTP(S) bridge URL");
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc.href, { timeout: 60_000, retryCount: 1 }) });
  if (deployment.chainId !== sepolia.id || await publicClient.getChainId() !== sepolia.id) throw new Error("Only Sepolia chain ID 11155111 is supported");
  const vaultIdentityAbi = parseAbi(["function owner() view returns(address)", "function agent() view returns(address)", "function hook() view returns(address)", "function poolManager() view returns(address)"]);
  const [owner, agent, hook, poolManager] = await Promise.all([
    publicClient.readContract({ address: vault, abi: vaultIdentityAbi, functionName: "owner" }),
    publicClient.readContract({ address: vault, abi: vaultIdentityAbi, functionName: "agent" }),
    publicClient.readContract({ address: vault, abi: vaultIdentityAbi, functionName: "hook" }),
    publicClient.readContract({ address: vault, abi: vaultIdentityAbi, functionName: "poolManager" }),
  ]);
  if (hook.toLowerCase() !== deployment.policyHook.toLowerCase() || poolManager.toLowerCase() !== chain.uniswap.poolManager.toLowerCase()) throw new Error("Vault does not use the configured Kusari hook and Sepolia PoolManager");
  const key = process.env.AGENT_PRIVATE_KEY;
  if (send && (!key || !/^0x[0-9a-fA-F]{64}$/.test(key))) throw new Error("--send requires a valid user-held AGENT_PRIVATE_KEY; never use the owner key");
  const account = key && /^0x[0-9a-fA-F]{64}$/.test(key) ? privateKeyToAccount(key as Hex) : undefined;
  if (account && account.address.toLowerCase() !== agent.toLowerCase()) throw new Error("Local agent key does not match this vault's immutable agent");
  if (owner.toLowerCase() === agent.toLowerCase()) throw new Error("Owner and restricted agent must be separate identities");
  const [slot, authorized, policy] = await Promise.all([
    publicClient.readContract({ address: chain.uniswap.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [deployment.poolId] }),
    publicClient.readContract({ address: deployment.policySource, abi: policySourceAbi, functionName: "isAuthorized", args: [agent] }),
    publicClient.readContract({ address: deployment.policySource, abi: policySourceAbi, functionName: "policyOf", args: [agent] }),
  ]);
  // Same quote protection as the shared executor: 0.3% pool fee + 3.0% slippage, rounded down.
  const minAmountOut = sharedTradeMinimum(amountIn, slot[0], 300n);
  if (minAmountOut <= 0n) throw new Error("Quote is too small for a nonzero protected minimum output");
  const intent = {
    agent, vault, poolId: deployment.poolId as Hex, zeroForOne: true,
    amountIn, minAmountOut, nonce: BigInt("0x" + randomBytes(32).toString("hex")),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
  };
  const domain = kusariDomain(sepolia.id, deployment.policyHook as Address);
  console.log(JSON.stringify({ mode: send ? "simulate-then-send" : "unsigned-read-only-preview", chainId: sepolia.id,
    owner, agent, vault, hook, route: "Configured ANON_RPC_URL; no direct fallback. Routing depends on your bridge configuration.",
    policy: { authorized, active: policy.active, maxPerSwapKUSD: formatEther(policy.maxPerSwap), dailyCapKUSD: formatEther(policy.dailyCap), allowedPool: policy.allowedPool },
    typedData: { domain, types: swapIntentTypes, primaryType: "SwapIntent", message: intent },
  }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
  if (!send) return;
  if (!account) throw new Error("Local restricted agent signer is unavailable");
  if (!authorized || !policy.active || policy.allowedPool.toLowerCase() !== deployment.poolId.toLowerCase()) throw new Error("Agent is frozen, inactive or bound to a different allowed pool; nothing submitted");
  const signature = await account.signTypedData({ domain, types: swapIntentTypes, primaryType: "SwapIntent", message: intent });
  const poolKey = { currency0: deployment.token0, currency1: deployment.token1, fee: 3000, tickSpacing: 60, hooks: deployment.policyHook } as const;
  // A rejected simulation aborts. There is deliberately no force-send or skip-simulation flag.
  const { request } = await publicClient.simulateContract({ account, address: vault, abi: agentVaultAbi, functionName: "swap", args: [poolKey, intent, signature] });
  if (await publicClient.getChainId() !== sepolia.id) throw new Error("RPC changed chains before submission; nothing submitted");
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc.href, { timeout: 60_000, retryCount: 0 }) });
  const hash = await wallet.writeContract(request);
  console.log(`Submitted: https://sepolia.etherscan.io/tx/${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  console.log(`Receipt: ${receipt.status}`);
  if (receipt.status !== "success") process.exitCode = 1;
}

await main().catch(error => {
  console.error(error && typeof error.shortMessage === "string" ? error.shortMessage : error instanceof Error ? error.message.split("\n")[0] : "Own-agent example failed");
  process.exitCode = 1;
});
