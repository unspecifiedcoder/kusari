import { parseAbi } from "viem";

const POLICY = "(uint128 maxPerSwap, uint128 dailyCap, uint16 maxImpactBps, bytes32 allowedPool, bool active)";
const INTENT =
  "(address agent, address vault, bytes32 poolId, bool zeroForOne, uint256 amountIn, uint256 minAmountOut, uint256 nonce, uint256 deadline)";
const POOL_KEY = "(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)";

export const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
]);

export const policySourceAbi = parseAbi([
  `function policyOf(address agent) view returns (${POLICY})`,
  "function isAuthorized(address agent) view returns (bool)",
]);

export const policyHookAbi = parseAbi([
  "function spentOn(address agent, uint256 day) view returns (uint256)",
  "function nonceUsed(address agent, uint256 nonce) view returns (bool)",
  "function priceImpactBps(uint160 sqrtBefore, uint160 sqrtAfter) pure returns (uint256)",
  "event SwapApproved(address indexed agent, address indexed vault, uint256 amountIn, uint256 spentToday)",
  "error NotAuthorized()",
  "error PolicyInactive()",
  "error PoolNotAllowed()",
  "error ExactInputOnly()",
  "error DirectionNotAllowed()",
  "error InsufficientOutput()",
  "error IntentMismatch()",
  "error ExceedsPerSwap()",
  "error ExceedsDaily()",
  "error PriceImpactTooHigh()",
  "error BadSignature()",
  "error Expired()",
  "error NonceUsed()",
]);

export const agentVaultAbi = parseAbi([
  `function swap(${POOL_KEY} key, ${INTENT} intent, bytes signature) returns (int256)`,
  "function agent() view returns (address)",
  "function owner() view returns (address)",
  "event Swapped(address indexed agent, uint256 amountIn, int128 amount0, int128 amount1)",
  "error OnlyAgent()",
  "error OnlyOwner()",
  "error WrongHook()",
  "error IntentNotForVault()",
  // v4 wraps hook reverts in this
  "error WrappedError(address target, bytes4 selector, bytes reason, bytes details)",
]);
