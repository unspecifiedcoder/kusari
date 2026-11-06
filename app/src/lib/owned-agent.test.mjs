import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseEther, parseTransaction, recoverTransactionAddress } from "viem";

// Node's native TypeScript runner needs the same generated-module aliases as Next.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/generated/")) return nextResolve(new URL(`../generated/${specifier.slice("@/generated/".length)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
const { signWorkspaceRun } = await import("./owned-agent.ts");
const { deployment } = await import("../generated/deployment.ts");

function fixture() {
  const privateKey = generatePrivateKey();
  const agent = privateKeyToAccount(privateKey).address;
  const identity = { owner: "0x1111111111111111111111111111111111111111", agent, vault: "0x2222222222222222222222222222222222222222" };
  const run = {
    runId: "fixture", status: "ready", decision: { action: "swap", amountIn: 1, reason: "fixture" },
    state: { sqrtPriceX96: (2n ** 96n).toString() },
    intent: { agent, vault: identity.vault, poolId: deployment.poolId, zeroForOne: true, amountIn: parseEther("1").toString(), minAmountOut: parseEther("0.967").toString(), nonce: "1", deadline: String(Math.floor(Date.now() / 1000) + 300) },
    transaction: { chainId: 11155111, to: identity.vault, nonce: 0, gas: "600000", maxFeePerGas: "22", maxPriorityFeePerGas: "2", value: "0" },
  };
  return { privateKey, identity, run };
}

test("browser signs only its restricted agent's bounded zero-value Sepolia vault call", async () => {
  const { privateKey, identity, run } = fixture();
  const result = await signWorkspaceRun(run, identity, privateKey);
  assert.equal(await recoverTransactionAddress({ serializedTransaction: result.rawTransaction }), identity.agent);
  const tx = parseTransaction(result.rawTransaction);
  assert.equal(tx.chainId, 11155111);
  assert.equal(tx.to.toLowerCase(), identity.vault.toLowerCase());
  assert.equal(tx.value ?? 0n, 0n);
});

test("browser rejects altered chain, vault, pool, signer, model amount and expired intent", async () => {
  for (const mutate of [
    r => { r.transaction.chainId = 1; },
    r => { r.transaction.to = "0x3333333333333333333333333333333333333333"; },
    r => { r.transaction.value = "1"; },
    r => { r.intent.poolId = `0x${"0".repeat(64)}`; },
    r => { r.intent.agent = "0x3333333333333333333333333333333333333333"; },
    r => { r.intent.amountIn = parseEther("2").toString(); },
    r => { r.decision.action = "hold"; },
    r => { r.intent.deadline = "1"; },
    r => { r.transaction.gas = "1000001"; },
    r => { r.transaction.maxFeePerGas = "1000000000000"; },
    r => { r.intent.minAmountOut = "0"; },
  ]) {
    const { privateKey, identity, run } = fixture();
    mutate(run);
    await assert.rejects(signWorkspaceRun(run, identity, privateKey));
  }
  const { identity, run } = fixture();
  await assert.rejects(signWorkspaceRun(run, identity, generatePrivateKey()), /does not match/);
});
