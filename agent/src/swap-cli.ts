// D3 check: a normal swap, then a drain attempt sent on-chain anyway.
//   node src/swap-cli.ts
import { formatEther } from "viem";
import { executeSwap, agentAccount } from "./swap.ts";
import { readState } from "./state.ts";

const show = async (label: string) => {
  const s = await readState(agentAccount.address);
  console.log(`${label}: vault ${formatEther(s.vaultToken0)} t0 / ${formatEther(s.vaultToken1)} t1, spent today ${formatEther(s.spentToday)}`);
};

await show("before");
console.log("normal swap 1:", await executeSwap(1));
await show("after normal");
console.log("drain attempt 100 (sent anyway):", await executeSwap(100, { sendEvenIfBlocked: true }));
await show("after drain attempt");
