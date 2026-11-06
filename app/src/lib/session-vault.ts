import { parseAbi, parseEther, type Hex } from "viem";

export const sessionVaultAbi = parseAbi([
  "function owner() view returns(address)",
  "function agent() view returns(address)",
  "function hook() view returns(address)",
  "function token0() view returns(address)",
  "function token1() view returns(address)",
  "function allowedPool() view returns(bytes32)",
  "function remainingBudget() view returns(uint256)",
  "function sessionExpiresAt() view returns(uint64)",
  "function minRateWad() view returns(uint256)",
  "function sessionId() view returns(uint256)",
  "function openSession(uint256 totalBudget,uint64 expiresAt,uint256 minRateWad)",
  "function closeSession()",
  "event SessionOpened(uint256 indexed sessionId,uint256 totalBudget,uint64 expiresAt,uint256 minRateWad)",
  "event SessionSwap(uint256 indexed sessionId,uint256 requestedInput,uint256 actualInput,uint256 actualOutput,uint256 remainingBudget)",
  "event SessionClosed(uint256 indexed sessionId)",
]);
export const sessionStateViewAbi = parseAbi(["function getSlot0(bytes32 poolId) view returns(uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)"]);

export function sessionApproval(budget: string, durationMinutes: string, minimumRate: string, blockTimestamp: bigint) {
  if (!/^\d+$/.test(durationMinutes)) throw new Error("Choose a whole number of minutes from 1 to 43,200 (30 days).");
  const minutes = BigInt(durationMinutes);
  if (minutes < 1n || minutes > 43_200n) throw new Error("Choose a session lasting 1 minute to 30 days.");
  if (!/^\d+(\.\d{1,18})?$/.test(budget) || !/^\d+(\.\d{1,18})?$/.test(minimumRate)) throw new Error("Enter positive decimal amounts with at most 18 decimals; scientific notation and rounded inputs are not accepted.");
  let totalBudget: bigint, minRateWad: bigint;
  try { totalBudget = parseEther(budget); minRateWad = parseEther(minimumRate); } catch { throw new Error("Enter a positive token amount and minimum output rate with at most 18 decimals."); }
  if (totalBudget <= 0n || minRateWad <= 0n || totalBudget >= 2n ** 256n || minRateWad >= 2n ** 256n) throw new Error("The session budget and minimum output rate must both be positive uint256 amounts.");
  if (blockTimestamp < 0n || blockTimestamp + minutes * 60n >= 2n ** 64n) throw new Error("The session expiry is outside the contract's uint64 timestamp range.");
  return { totalBudget, minRateWad, expiresAt: blockTimestamp + minutes * 60n };
}

export function suggestedSessionRate(sqrtPriceX96: bigint, feePips: number) {
  if (sqrtPriceX96 <= 0n || !Number.isInteger(feePips) || feePips < 0 || feePips >= 1_000_000) throw new Error("A valid live pool price and fee are required for a reference rate.");
  const unit = 10n ** 18n;
  const quote = (((unit * sqrtPriceX96) / (2n ** 96n)) * sqrtPriceX96) / (2n ** 96n);
  const afterFee = (quote * BigInt(1_000_000 - feePips)) / 1_000_000n;
  return { afterFee, floor: (afterFee * 9800n) / 10_000n };
}

export type SessionSwapEvidence = { hash: Hex; block: bigint; sessionId: bigint; requestedInput: bigint; actualInput: bigint; actualOutput: bigint; remainingBudget: bigint };
