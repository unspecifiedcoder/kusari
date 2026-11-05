// Mirrors contracts/src/interfaces/PolicyTypes.sol. Keep the two in sync.
import type { Address, Hex } from "viem";

export interface Policy {
  maxPerSwap: bigint;
  dailyCap: bigint;
  maxImpactBps: number;
  allowedPool: Hex; // PoolId (bytes32)
  active: boolean;
}

export interface SwapIntent {
  agent: Address;
  vault: Address;
  poolId: Hex;
  zeroForOne: boolean;
  amountIn: bigint;
  nonce: bigint;
  deadline: bigint;
}

export const swapIntentTypes = {
  SwapIntent: [
    { name: "agent", type: "address" },
    { name: "vault", type: "address" },
    { name: "poolId", type: "bytes32" },
    { name: "zeroForOne", type: "bool" },
    { name: "amountIn", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** EIP-712 domain. verifyingContract is the PolicyHook address. */
export const kusariDomain = (chainId: number, policyHook: Address) =>
  ({ name: "Kusari", version: "1", chainId, verifyingContract: policyHook }) as const;

/** Custom errors from IPolicyHook / IAgentVault, mapped to plain English for the UI. */
export const revertReasons: Record<string, string> = {
  NotAuthorized: "Blocked: the agent's role was revoked",
  PolicyInactive: "Blocked: the policy is switched off",
  PoolNotAllowed: "Blocked: this pool isn't allowed",
  ExactInputOnly: "Blocked: only exact-input swaps are allowed",
  IntentMismatch: "Blocked: the swap doesn't match the signed intent",
  ExceedsPerSwap: "Blocked: exceeds the per-swap cap",
  ExceedsDaily: "Blocked: exceeds the daily cap",
  PriceImpactTooHigh: "Blocked: price impact too high",
  BadSignature: "Blocked: invalid agent signature",
  Expired: "Blocked: the signed intent expired",
  NonceUsed: "Blocked: replayed intent",
  OnlyAgent: "Blocked: only the agent can swap",
  WrongHook: "Blocked: pool doesn't use the Kusari hook",
  IntentNotForVault: "Blocked: the signed intent is for a different vault or agent",
};
