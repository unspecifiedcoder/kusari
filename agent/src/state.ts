import { createPublicClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { config, deployment } from "./config.ts";
import { stateViewAbi, erc20Abi, policySourceAbi, policyHookAbi } from "./abi.ts";

const makeReader = (url: string) =>
  createPublicClient({ chain: sepolia, transport: http(url, { timeout: 45_000, retryCount: 2 }), batch: { multicall: false } });

/** Live binding: importers always see the current client, so the transport can be switched at runtime. */
export let reader = makeReader(config.readRpc);
export let readRpc = config.readRpc;

/** Switch where reads go (used by the demo's Anon-RPC ON/OFF toggle). */
export function setReadRpc(url: string) {
  readRpc = url;
  reader = makeReader(url);
}

export interface AgentState {
  blockNumber: bigint;
  price: number; // token1 per token0
  sqrtPriceX96: bigint;
  vaultToken0: bigint;
  vaultToken1: bigint;
  policy: { maxPerSwap: bigint; dailyCap: bigint; maxImpactBps: number; allowedPool: `0x${string}`; active: boolean };
  authorized: boolean;
  spentToday: bigint;
  remainingToday: bigint;
  readMs: number;
}

/** Everything the agent needs, in ONE eth_call (Multicall3). Mixnet reads are slow, so round trips matter. */
export async function readState(agent: Address, vault: Address = deployment.demoVault): Promise<AgentState> {
  const t0 = performance.now();
  const day = BigInt(Math.floor(Date.now() / 1000 / 86_400));
  const [slot0, bal0, bal1, policy, authorized, spent] = await reader.multicall({
    allowFailure: false,
    contracts: [
      { address: config.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [deployment.poolId] },
      { address: deployment.token0, abi: erc20Abi, functionName: "balanceOf", args: [vault] },
      { address: deployment.token1, abi: erc20Abi, functionName: "balanceOf", args: [vault] },
      { address: deployment.policySource, abi: policySourceAbi, functionName: "policyOf", args: [agent] },
      { address: deployment.policySource, abi: policySourceAbi, functionName: "isAuthorized", args: [agent] },
      { address: deployment.policyHook, abi: policyHookAbi, functionName: "spentOn", args: [agent, day] },
    ],
  });
  const blockNumber = await reader.getBlockNumber();
  const sqrt = Number(slot0[0]) / 2 ** 96;
  return {
    blockNumber,
    price: sqrt * sqrt,
    sqrtPriceX96: slot0[0],
    vaultToken0: bal0,
    vaultToken1: bal1,
    policy,
    authorized,
    spentToday: spent,
    remainingToday: policy.dailyCap > spent ? policy.dailyCap - spent : 0n,
    readMs: Math.round(performance.now() - t0),
  };
}
