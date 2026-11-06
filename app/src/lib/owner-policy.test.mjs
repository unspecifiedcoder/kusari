import test from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters, parseEther } from "viem";
import { assertSharedENSIdentity, encodeSharedCapPolicy, validateOwnerPolicyChallenge } from "./owner-policy.ts";
import { buildOwnerPolicyMessage } from "../generated/owner-policy-message.mjs";

const pool = `0x${"12".repeat(32)}`;
const parameters = [{ type: "tuple", components: [{ name: "maxPerSwap", type: "uint128" }, { name: "dailyCap", type: "uint128" }, { name: "maxImpactBps", type: "uint16" }, { name: "allowedPool", type: "bytes32" }, { name: "active", type: "bool" }] }];
test("shared policy editor rejects a rebound agent even when the other label has the same owner", () => {
  const registry = `0x${"11".repeat(20)}`;
  const binding = { label: "alpha", dnsName: "0x05616c70686100", node: pool };
  const expected = { registry, ...binding };
  assert.doesNotThrow(() => assertSharedENSIdentity(registry, binding, expected));
  assert.throws(() => assertSharedENSIdentity(registry, { ...binding, label: "beta" }, expected));
  assert.throws(() => assertSharedENSIdentity(registry, { ...binding, dnsName: "0x00" }, expected));
  assert.throws(() => assertSharedENSIdentity(`0x${"22".repeat(20)}`, binding, expected));
});
test("5 to 1 ENS edit preserves every other field, including an inactive flag", () => {
  const policy = { maxPerSwap: parseEther("5"), dailyCap: parseEther("73.25"), maxImpactBps: 175, allowedPool: pool, active: false };
  const decoded = decodeAbiParameters(parameters, encodeSharedCapPolicy(policy, "1", pool))[0];
  assert.deepEqual(decoded, { ...policy, maxPerSwap: parseEther("1") });
  assert.equal(policy.maxPerSwap, parseEther("5"));
  assert.equal(decodeAbiParameters(parameters, encodeSharedCapPolicy(decoded, "5", pool))[0].maxPerSwap, parseEther("5"));
});
test("owner cap edit rejects an unverified pool, unsupported target and daily cap below the requested per-trade cap", () => {
  const policy = { maxPerSwap: parseEther("5"), dailyCap: parseEther("100"), maxImpactBps: 200, allowedPool: pool, active: true };
  assert.throws(() => encodeSharedCapPolicy(policy, "2", pool));
  assert.throws(() => encodeSharedCapPolicy(policy, "1", `0x${"34".repeat(32)}`));
  assert.throws(() => encodeSharedCapPolicy({ ...policy, dailyCap: parseEther("2") }, "5", pool));
  assert.throws(() => encodeSharedCapPolicy({ ...policy, maxImpactBps: 0 }, "1", pool));
});
test("owner test signs only the exact bounded canonical Sepolia challenge for the expected owner, agent and vault", () => {
  const now = 1_800_000_000_000;
  const expected = { owner: `0x${"11".repeat(20)}`, agent: `0x${"22".repeat(20)}`, vault: `0x${"33".repeat(20)}`, origin: "https://kusari.outcomeseal.com" };
  const challenge = { address: expected.owner, agent: expected.agent, vault: expected.vault, origin: expected.origin, chainId: 11155111, amountIn: "2", purpose: "owner-policy-check", nonce: `0x${"aa".repeat(32)}`, expiresAt: now + 120_000 };
  const valid = { ...challenge, message: buildOwnerPolicyMessage(challenge) };
  assert.doesNotThrow(() => validateOwnerPolicyChallenge(valid, expected, now));
  for (const patch of [{ address: expected.agent }, { agent: expected.owner }, { vault: expected.owner }, { origin: "https://example.com" }, { chainId: 1 }, { amountIn: "200" }, { purpose: "normal" }, { expiresAt: now }, { expiresAt: now + 180_001 }, { message: valid.message + "\nAuthorize additional funds." }]) {
    assert.throws(() => validateOwnerPolicyChallenge({ ...valid, ...patch }, expected, now));
  }
});
