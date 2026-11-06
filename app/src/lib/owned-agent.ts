import { encodeFunctionData, isAddress, parseAbi, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { deployment } from "@/generated/deployment";
import { kusariDomain, swapIntentTypes } from "@/generated/types";

export const ownedRegistrarAbi = parseAbi(["function labelFor(address owner,address agent) pure returns(string)", "function claim(address agent,address resolver) returns(string)"]);
export const atomicCoordinatorAbi = parseAbi(["function create(address agent,uint128 maxPerSwap,uint128 dailyCap,uint16 maxImpactBps) payable returns(address vault,address resolver,string label)", "function workspaceOf(address owner,address agent) view returns(address vault,address resolver,string label)"]);
export const ownedRegistryAbi = parseAbi(["function getOwner(uint256 id) view returns(address)", "function getResolver(string label) view returns(address)", "function grantRoles(uint256 id,uint256 roles,address account) returns(bool)", "function revokeRoles(uint256 id,uint256 roles,address account) returns(bool)"]);
export const ownedResolverAbi = parseAbi(["function initialize((address account,uint256 roleBitmap)[] grants,bytes[] calls)", "function setData(bytes name,string key,bytes value)", "function resolve(bytes name,bytes data) view returns(bytes)", "function data(bytes32 node,string key) view returns(bytes)"]);
export const ownedProxyAbi = parseAbi(["function deployProxy(address implementation,uint256 salt,bytes data) returns(address)", "function predictProxyAddress(address deployer,uint256 salt) view returns(address)", "function verifyContract(address proxy) view returns(address)"]);
export const ownedSourceAbi = parseAbi(["function bindingOf(address agent) view returns((string label,bytes dnsName,bytes32 node))", "function bind(address agent,string label,bytes dnsName,bytes32 node)"]);
const swapAbi = parseAbi(["function swap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(address agent,address vault,bytes32 poolId,bool zeroForOne,uint256 amountIn,uint256 minAmountOut,uint256 nonce,uint256 deadline) intent,bytes signature) returns(int256)"]);

export type WorkspaceIdentity = { owner: Address; agent: Address; vault: Address };
export type WorkspaceRun = {
  runId: string;
  status: "preparing" | "ready" | "hold" | "error" | "pending" | "success" | "reverted";
  decision?: { action: string; amountIn?: number; reason: string; model?: string };
  state?: Record<string, unknown>;
  intent?: { agent: Address; vault: Address; poolId: Hex; zeroForOne: boolean; amountIn: string; minAmountOut: string; nonce: string; deadline: string };
  transaction?: { chainId: number; to: Address; nonce: number; gas: string; maxFeePerGas: string; maxPriorityFeePerGas: string; value: string };
  hash?: Hex;
  reason?: string;
  message?: string;
  error?: string;
  preflightReason?: string;
  routing?: { route: string; rpcRequests: number; httpFailures: number; submissionRequests: number; meaning: string };
};

export async function workspaceApi<T>(action: string, body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/workspace/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? data.message ?? `Workspace request failed (${response.status}).`);
  return data as T;
}

/** The browser independently pins every transaction field before its restricted agent signs. */
export async function signWorkspaceRun(run: WorkspaceRun, identity: WorkspaceIdentity, privateKey: Hex) {
  const intent = run.intent;
  const transaction = run.transaction;
  const account = privateKeyToAccount(privateKey);
  if (!intent || !transaction || account.address.toLowerCase() !== identity.agent.toLowerCase()) throw new Error("The unlocked key does not match this agent.");
  if (!isAddress(transaction.to) || transaction.chainId !== sepolia.id || transaction.to.toLowerCase() !== identity.vault.toLowerCase() || transaction.value !== "0") throw new Error("The prepared transaction is not a zero-value Sepolia call to your vault.");
  if (intent.agent.toLowerCase() !== identity.agent.toLowerCase() || intent.vault.toLowerCase() !== identity.vault.toLowerCase() || intent.poolId.toLowerCase() !== deployment.poolId.toLowerCase() || intent.zeroForOne !== true) throw new Error("The prepared intent does not match this agent, vault and allowed pool.");
  const now = BigInt(Math.floor(Date.now() / 1000));
  const message = { ...intent, amountIn: BigInt(intent.amountIn), minAmountOut: BigInt(intent.minAmountOut), nonce: BigInt(intent.nonce), deadline: BigInt(intent.deadline) };
  if (run.decision?.action !== "swap" || typeof run.decision.amountIn !== "number" || !Number.isFinite(run.decision.amountIn) || message.amountIn !== parseEther(String(run.decision.amountIn))) throw new Error("The prepared amount differs from the Gemini decision shown for this run.");
  if (message.amountIn <= 0n || message.amountIn > parseEther("10000") || message.minAmountOut < 0n || message.deadline <= now || message.deadline > now + 600n) throw new Error("The prepared amount or expiry is outside the testnet workspace boundary.");
  const sqrtPriceX96 = BigInt(String(run.state?.sqrtPriceX96 ?? "0"));
  const quote = (((message.amountIn * sqrtPriceX96) / (2n ** 96n)) * sqrtPriceX96) / (2n ** 96n);
  const minimum = (quote * 9670n) / 10_000n;
  if (sqrtPriceX96 <= 0n || minimum <= 0n || message.minAmountOut < minimum) throw new Error("The prepared minimum output removes the workspace’s slippage protection.");
  const gas = BigInt(transaction.gas);
  const maxFeePerGas = BigInt(transaction.maxFeePerGas);
  const maxPriorityFeePerGas = BigInt(transaction.maxPriorityFeePerGas);
  if (!Number.isSafeInteger(transaction.nonce) || transaction.nonce < 0 || gas <= 0n || gas > 1_000_000n || maxFeePerGas <= 0n || maxFeePerGas > parseEther("0.000001") || maxPriorityFeePerGas < 0n || maxPriorityFeePerGas > maxFeePerGas || gas * maxFeePerGas > parseEther("0.003")) throw new Error("The proposed gas cost is outside the workspace safety limit.");
  const signature = await account.signTypedData({ domain: kusariDomain(sepolia.id, deployment.policyHook), types: swapIntentTypes, primaryType: "SwapIntent", message });
  const data = encodeFunctionData({ abi: swapAbi, functionName: "swap", args: [{ currency0: deployment.token0, currency1: deployment.token1, fee: 3000, tickSpacing: 60, hooks: deployment.policyHook }, message, signature] });
  const rawTransaction = await account.signTransaction({ chainId: sepolia.id, type: "eip1559", to: identity.vault, nonce: transaction.nonce, gas, maxFeePerGas, maxPriorityFeePerGas, value: 0n, data });
  return { signature, rawTransaction };
}
