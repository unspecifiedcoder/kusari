import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createSandboxAccess, runRealSandboxCycle } from "./sandbox-access.mjs";

const require = createRequire(new URL("../agent/package.json", import.meta.url));
const { privateKeyToAccount } = require("viem/accounts");
// Public deterministic test identities, never funded or used by the application.
const wallet = privateKeyToAccount(`0x${"11".repeat(32)}`);
const other = privateKeyToAccount(`0x${"22".repeat(32)}`);
const sign = async (challenge, signer = wallet, message = challenge.message) => ({ nonce: challenge.nonce, address: challenge.address, signature: await signer.signMessage({ message }) });
const rejected = (status) => (error) => error.status === status;

test("challenge binds exact origin, chain, wallet, scenario and millisecond expiry without starting work", () => {
  const access = createSandboxAccess({ now: () => 1000 });
  const c = access.challenge({ address: wallet.address, scenario: "attack" });
  assert.equal(c.expiresAt, 121000);
  assert.equal(c.origin, "https://kusari.outcomeseal.com");
  assert.match(c.message, /Origin: https:\/\/kusari\.outcomeseal\.com/);
  assert.match(c.message, /Chain ID: 11155111/);
  assert.match(c.message, /Scenario: attack/);
  assert.match(c.message, /grants no authority over your wallet funds/);
  assert.throws(() => access.challenge({ address: wallet.address, scenario: "normal", chainId: 1 }), rejected(400));
  assert.throws(() => access.challenge({ address: wallet.address, scenario: "arbitrary" }), rejected(400));
  assert.throws(() => createSandboxAccess({ origin: "https://example.com/path" }));
});

test("one signed challenge admits one run even when a replay arrives while its start is pending", async () => {
  const access = createSandboxAccess();
  const input = await sign(access.challenge({ address: wallet.address, scenario: "normal" }));
  let entered;
  let release;
  let starts = 0;
  const started = new Promise((resolve) => { entered = resolve; });
  const run = access.run(input, async ({ scenario }) => {
    starts++;
    assert.equal(scenario, "normal");
    entered();
    await new Promise((resolve) => { release = resolve; });
  });
  await started;
  await assert.rejects(access.run(input, async () => { starts++; }), rejected(409));
  release();
  assert.equal((await run).started, true);
  assert.equal(starts, 1);
});

test("wrong domain, wrong wallet and mainnet message signatures cannot authorize a sandbox run", async () => {
  const access = createSandboxAccess();
  let starts = 0;
  const start = async () => { starts++; };
  const c1 = access.challenge({ address: wallet.address, scenario: "normal" });
  const otherOriginMessage = c1.message.replace(c1.origin, "https://attacker.invalid");
  assert.notEqual(otherOriginMessage, c1.message);
  await assert.rejects(access.run(await sign(c1, wallet, otherOriginMessage), start), rejected(401));
  const c2 = access.challenge({ address: wallet.address, scenario: "normal" });
  await assert.rejects(access.run({ ...await sign(c2), address: other.address }, start), rejected(401));
  const c3 = access.challenge({ address: wallet.address, scenario: "normal" });
  await assert.rejects(access.run(await sign(c3, wallet, c3.message.replace("Chain ID: 11155111", "Chain ID: 1")), start), rejected(401));
  assert.equal(starts, 0);
});

test("expired challenges and altered run fields fail closed; nonce storage is bounded and reclaims expiry", async () => {
  let t = 1000;
  const access = createSandboxAccess({ now: () => t, maxNonces: 2 });
  const c = access.challenge({ address: wallet.address, scenario: "normal" });
  const input = await sign(c);
  access.challenge({ address: other.address, scenario: "normal" });
  assert.throws(() => access.challenge({ address: wallet.address, scenario: "normal" }), rejected(429));
  await assert.rejects(access.run({ ...input, scenario: "attack" }, async () => {}), rejected(400));
  t = c.expiresAt;
  await assert.rejects(access.run(input, async () => {}), rejected(410));
  assert.doesNotThrow(() => access.challenge({ address: wallet.address, scenario: "normal" }));
});

test("global and wallet cooldowns are independent, and failed accepted starts still consume daily budget", async () => {
  let t = 1000;
  const access = createSandboxAccess({ now: () => t });
  const first = access.challenge({ address: wallet.address, scenario: "normal" });
  const issuedBeforeCooldown = access.challenge({ address: other.address, scenario: "normal" });
  const issuedBeforeWalletCooldown = access.challenge({ address: wallet.address, scenario: "normal" });
  await access.run(await sign(first), async () => {});
  assert.throws(() => access.challenge({ address: other.address, scenario: "normal" }), (error) => error.status === 429 && error.retryAfterSeconds === 10);
  await assert.rejects(access.run(await sign(issuedBeforeCooldown, other), async () => {}), rejected(429));
  t += 10_000;
  assert.throws(() => access.challenge({ address: wallet.address, scenario: "normal" }), (error) => error.status === 429 && error.retryAfterSeconds === 20);
  await assert.rejects(access.run(await sign(issuedBeforeWalletCooldown), async () => {}), rejected(429));
  t += 20_000;
  await access.run(await sign(access.challenge({ address: wallet.address, scenario: "normal" })), async () => {});

  const daily = createSandboxAccess({ now: () => t, maxDaily: 1 });
  const dailyPending = daily.challenge({ address: other.address, scenario: "normal" });
  await assert.rejects(daily.run(await sign(daily.challenge({ address: wallet.address, scenario: "attack" })), async () => { throw new Error("backend busy or model failed"); }), /backend busy/);
  t += 31_000;
  assert.throws(() => daily.challenge({ address: other.address, scenario: "normal" }), (error) => error.status === 429 && error.retryAfterSeconds > 0);
  await assert.rejects(daily.run(await sign(dailyPending, other), async () => {}), rejected(429));
});

test("hourly budget and concurrent signature admissions are bounded", async () => {
  let t = 1000;
  const access = createSandboxAccess({ now: () => t, maxHourly: 1 });
  const pendingBeforeHourlyLimit = access.challenge({ address: other.address, scenario: "normal" });
  await access.run(await sign(access.challenge({ address: wallet.address, scenario: "normal" })), async () => {});
  t += 31_000;
  assert.throws(() => access.challenge({ address: other.address, scenario: "normal" }), (error) => error.status === 429 && error.retryAfterSeconds === 3569);
  await assert.rejects(access.run(await sign(pendingBeforeHourlyLimit, other), async () => {}), rejected(429));

  let release;
  let verifications = 0;
  const pending = createSandboxAccess({ verifySignature: async () => { verifications++; return new Promise((resolve) => { release = resolve; }); } });
  const a = await sign(pending.challenge({ address: wallet.address, scenario: "normal" }));
  const b = await sign(pending.challenge({ address: other.address, scenario: "attack" }), other);
  const first = pending.run(a, async () => {});
  await assert.rejects(pending.run(b, async () => {}), rejected(409));
  assert.equal(verifications, 1);
  release(true);
  await first;
});

test("public model failure, scripted mode, wrong chain and low gas never reach execution", async () => {
  let models = 0;
  let executions = 0;
  const base = { scenario: "normal", scripted: false, configuredChainId: 11155111, maxPerSwap: 5, getChainId: async () => 11155111, getAgentBalance: async () => 1_000_000_000_000_000n, decide: async () => { models++; return { action: "swap", amountIn: 1 }; }, execute: async () => { executions++; } };
  await assert.rejects(runRealSandboxCycle({ ...base, scripted: true }), /live Gemini/);
  await assert.rejects(runRealSandboxCycle({ ...base, getChainId: async () => 1 }), /Sepolia/);
  await assert.rejects(runRealSandboxCycle({ ...base, configuredChainId: 1 }), /Sepolia/);
  await assert.rejects(runRealSandboxCycle({ ...base, getAgentBalance: async () => 1n }), /gas reserve/);
  assert.equal(models, 0);
  await assert.rejects(runRealSandboxCycle({ ...base, decide: async () => { throw new Error("Gemini unavailable"); } }), /Gemini unavailable/);
  assert.equal(executions, 0);
});

test("public normal spend is capped and attack execution must genuinely exceed the onchain cap", async () => {
  let executions = 0;
  const base = { scenario: "normal", scripted: false, configuredChainId: 11155111, maxPerSwap: 5, getChainId: async () => 11155111, getAgentBalance: async () => 1_000_000_000_000_000n, execute: async () => { executions++; return { status: "blocked" }; } };
  await assert.rejects(runRealSandboxCycle({ ...base, decide: async () => ({ action: "swap", amountIn: 2 }) }), /at most 1/);
  await assert.rejects(runRealSandboxCycle({ ...base, scenario: "attack", decide: async () => ({ action: "swap", amountIn: 5 }) }), { name: "ModelDidNotFollowInjection" });
  assert.equal(executions, 0);
  await runRealSandboxCycle({ ...base, decide: async () => ({ action: "swap", amountIn: 1 }) });
  await runRealSandboxCycle({ ...base, scenario: "attack", decide: async () => ({ action: "swap", amountIn: 90 }) });
  assert.equal(executions, 2);
});
