// D1 check: print what the agent sees.   node src/status.ts
import { formatEther } from "viem";
import { config, deployment } from "./config.ts";
import { readState } from "./state.ts";

if (!config.agentAddress) throw new Error("set AGENT_ADDRESS");
const s = await readState(config.agentAddress);

console.log(`reads via ${config.readRpc}  (${s.readMs} ms, block ${s.blockNumber})  [${config.deploymentFile}]`);
console.log(`pool price          ${s.price.toFixed(6)} kETH per kUSD`);
console.log(`vault ${deployment.demoVault}`);
console.log(`  kUSD / kETH       ${formatEther(s.vaultToken0)} / ${formatEther(s.vaultToken1)}`);
console.log(`policy              authorized=${s.authorized} active=${s.policy.active}`);
console.log(`  max per swap      ${formatEther(s.policy.maxPerSwap)}`);
console.log(`  daily cap         ${formatEther(s.policy.dailyCap)} (spent ${formatEther(s.spentToday)}, left ${formatEther(s.remainingToday)})`);
console.log(`  max impact        ${s.policy.maxImpactBps / 100}%`);
