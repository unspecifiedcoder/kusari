import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";

const root = fileURLToPath(new URL("../../", import.meta.url));
if (existsSync(root + ".env")) process.loadEnvFile(root + ".env");

export interface Deployment {
  chainId: number;
  policyHook: Address;
  policySource: Address;
  vaultFactory: Address;
  token0: Address;
  token1: Address;
  poolId: Hex;
  demoVault: Address;
}

const chains = JSON.parse(readFileSync(root + "config/chains.json", "utf8"));
const deploymentFile = process.env.DEPLOYMENT_FILE ?? "deployments/11155111-fork.json";
export const deployment: Deployment = JSON.parse(readFileSync(root + deploymentFile, "utf8"));
const chain = chains[String(deployment.chainId)];

export const config = {
  deploymentFile,
  // Reads go here. Point at the Anon-RPC bridge (http://localhost:8546) for private reads,
  // or the logging proxy (http://localhost:8547) to show the leak.
  readRpc: process.env.AGENT_READ_RPC_URL ?? chain.rpc,
  // Transactions go here (public by nature; see README limitations).
  writeRpc: process.env.AGENT_WRITE_RPC_URL ?? process.env.AGENT_READ_RPC_URL ?? chain.rpc,
  stateView: chain.uniswap.stateView as Address,
  agentAddress: process.env.AGENT_ADDRESS as Address | undefined,
  agentKey: process.env.AGENT_PRIVATE_KEY as Hex | undefined,
  model: process.env.AGENT_MODEL ?? "claude-haiku-5-5",
  eventsPort: Number(process.env.AGENT_EVENTS_PORT ?? 8787),
};
