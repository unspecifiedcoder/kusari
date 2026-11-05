import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

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
const deploymentFile = process.env.DEPLOYMENT_FILE ?? "deployments/11155111.json";
export const deployment: Deployment = JSON.parse(readFileSync(root + deploymentFile, "utf8"));
const chain = chains[String(deployment.chainId)];

/** Anon-RPC bridge (reader/): every call leaves this machine through the Nox mixnet. The default. */
export const ANON_RPC = process.env.ANON_RPC_URL || "http://localhost:8546";
/** Logging "public provider" proxy (proxy/): only for showing the leak in the demo. */
export const LEAK_RPC = process.env.LEAK_RPC_URL || "http://localhost:8547";
/** Direct public RPC: last resort, never the default. */
export const PUBLIC_RPC: string = chain.rpc;

export const config = {
  deploymentFile,
  // Reads AND transaction submission go through Anon-RPC by default, so the provider never sees this
  // machine's IP or its pattern of reads. Override only on purpose (e.g. the leak demo uses LEAK_RPC).
  readRpc: process.env.AGENT_READ_RPC_URL || ANON_RPC,
  writeRpc: process.env.AGENT_WRITE_RPC_URL || process.env.AGENT_READ_RPC_URL || ANON_RPC,
  stateView: chain.uniswap.stateView as Address,
  agentAddress: (process.env.AGENT_ADDRESS ||
    (process.env.AGENT_PRIVATE_KEY ? privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as Hex).address : undefined)) as
    | Address
    | undefined,
  agentKey: process.env.AGENT_PRIVATE_KEY as Hex | undefined,
  model: process.env.AGENT_MODEL?.startsWith("gemini") ? process.env.AGENT_MODEL : "gemini-flash-lite-latest",
  eventsPort: Number(process.env.AGENT_EVENTS_PORT ?? 8787),
};
