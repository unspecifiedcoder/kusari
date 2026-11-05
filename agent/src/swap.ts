// D3: sign a SwapIntent (EIP-712) and ask the vault to execute it.
import {
  createWalletClient,
  http,
  parseEther,
  decodeErrorResult,
  BaseError,
  ContractFunctionRevertedError,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config, deployment } from "./config.ts";
import { agentVaultAbi, policyHookAbi, stateViewAbi } from "./abi.ts";
import { reader } from "./state.ts";

const Q96 = 2n ** 96n;
import { swapIntentTypes, kusariDomain, revertReasons } from "../../shared/types.ts";

if (!config.agentKey) throw new Error("AGENT_PRIVATE_KEY not set");
export const agentAccount = privateKeyToAccount(config.agentKey);

const makeWallet = (url: string) => createWalletClient({ account: agentAccount, chain: sepolia, transport: http(url, { timeout: 45_000 }) });
let wallet = makeWallet(config.writeRpc);
export let writeRpc = config.writeRpc;

/** Switch where transactions are submitted (demo's Anon-RPC ON/OFF toggle). */
export function setWriteRpc(url: string) {
  writeRpc = url;
  wallet = makeWallet(url);
}

/** Max slippage the agent accepts vs the pre-swap price, on top of the 0.3% pool fee. */
const SLIPPAGE_BPS = BigInt(process.env.AGENT_SLIPPAGE_BPS ?? 300);

export const poolKey = {
  currency0: deployment.token0,
  currency1: deployment.token1,
  fee: 3000,
  tickSpacing: 60,
  hooks: deployment.policyHook,
} as const;

export interface SwapResult {
  status: "success" | "blocked" | "error";
  amountIn: number;
  hash?: Hex;
  reason?: string; // custom error name, e.g. ExceedsPerSwap
  message?: string; // plain-English reason for the UI
}

/** Unwraps v4's WrappedError(hook, selector, reason, details) down to our custom error name. */
export function explainRevert(err: unknown): { reason: string; message: string } {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data) {
      let name = revert.data.errorName;
      if (name === "WrappedError") {
        const inner = revert.data.args?.[2] as Hex;
        try {
          name = decodeErrorResult({ abi: policyHookAbi, data: inner }).errorName;
        } catch {
          name = "HookReverted";
        }
      }
      return { reason: name, message: revertReasons[name] ?? name };
    }
  }
  return { reason: "Unknown", message: err instanceof Error ? err.message.split("\n")[0] : String(err) };
}

/**
 * Sign the intent and send it. By default the swap is simulated first. With sendEvenIfBlocked the
 * transaction is broadcast anyway, so the demo can show the hook reverting it ON-CHAIN, with a tx hash.
 */
export async function executeSwap(
  amountIn: number,
  { sendEvenIfBlocked = false, sqrtPriceX96 }: { sendEvenIfBlocked?: boolean; sqrtPriceX96?: bigint } = {},
): Promise<SwapResult> {
  const amountInWei = parseEther(String(amountIn));
  // Signed minimum output, enforced by the hook against the real BalanceDelta (bounds sandwich loss).
  const sqrtP = sqrtPriceX96 ?? (await reader.readContract({ address: config.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [deployment.poolId] }))[0];
  const quote = (((amountInWei * sqrtP) / Q96) * sqrtP) / Q96; // token1 out at the pre-swap price
  const minAmountOut = (quote * (10_000n - 30n - SLIPPAGE_BPS)) / 10_000n;
  const intent = {
    agent: agentAccount.address,
    vault: deployment.demoVault,
    poolId: deployment.poolId,
    zeroForOne: true, // the vault holds token0 and buys token1 (the hook only allows this direction)
    amountIn: amountInWei,
    minAmountOut,
    nonce: BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000)),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
  };
  const signature = await agentAccount.signTypedData({
    domain: kusariDomain(deployment.chainId, deployment.policyHook),
    types: swapIntentTypes,
    primaryType: "SwapIntent",
    message: intent,
  });
  const call = {
    address: deployment.demoVault,
    abi: agentVaultAbi,
    functionName: "swap",
    args: [poolKey, intent, signature],
    account: agentAccount,
  } as const;

  let blocked: { reason: string; message: string } | undefined;
  try {
    await reader.simulateContract(call);
  } catch (e) {
    blocked = explainRevert(e);
    if (!sendEvenIfBlocked) return { status: "blocked", amountIn, ...blocked };
  }

  try {
    const hash = await wallet.writeContract({ ...call, gas: blocked ? 600_000n : undefined });
    const receipt = await reader.waitForTransactionReceipt({ hash });
    if (receipt.status === "success") return { status: "success", amountIn, hash };
    return { status: "blocked", amountIn, hash, ...(blocked ?? { reason: "Reverted", message: "Reverted on-chain" }) };
  } catch (e) {
    return { status: "error", amountIn, ...explainRevert(e) };
  }
}
