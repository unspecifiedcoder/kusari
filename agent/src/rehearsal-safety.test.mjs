import test from "node:test";
import assert from "node:assert/strict";
import { assertDeploymentAccounts, withAuthorizationRestoration } from "./rehearsal-safety.mjs";

const agent = "0x1111111111111111111111111111111111111111";
const owner = "0x2222222222222222222222222222222222222222";
const source = "0x3333333333333333333333333333333333333333";
const valid = { agent, owner, expectedAgent: agent, expectedOwner: owner, vaultAgent: agent, vaultOwner: owner, nameOwner: owner, chainId: 11155111, readerChainId: 11155111, policySource: source, expectedPolicySource: source };

test("rehearsal rejects copied keys or RPCs that do not match the live deployment", () => {
  assert.doesNotThrow(() => assertDeploymentAccounts(valid));
  for (const change of [{ agent: owner }, { owner: agent }, { vaultAgent: owner }, { nameOwner: agent }, { vaultOwner: agent }, { chainId: 1 }, { readerChainId: 1 }, { expectedPolicySource: owner }]) {
    assert.throws(() => assertDeploymentAccounts({ ...valid, ...change }), /no transaction was sent/);
  }
});

test("failed rehearsal restores a revoked agent even when the receipt was ambiguous", async () => {
  let authorized = true;
  let restores = 0;
  await assert.rejects(withAuthorizationRestoration({
    initiallyAuthorized: true,
    readAuthorized: async () => authorized,
    restoreAuthorization: async (original) => { restores++; authorized = original; },
  }, async (mark) => {
    mark();
    authorized = false; // submission succeeded, but waiting for its receipt failed
    throw new Error("receipt unavailable");
  }), /receipt unavailable/);
  assert.equal(authorized, true);
  assert.equal(restores, 1);
});

test("rehearsal never grants an initially unauthorized agent or rewrites an already restored role", async () => {
  let restores = 0;
  const settings = { initiallyAuthorized: false, readAuthorized: async () => false, restoreAuthorization: async () => { restores++; } };
  await assert.rejects(withAuthorizationRestoration(settings, async (mark) => mark()), /will not grant it new access/);
  await withAuthorizationRestoration({ ...settings, initiallyAuthorized: true, readAuthorized: async () => true }, async (mark, confirmRestored) => { mark(); confirmRestored(); });
  assert.equal(restores, 0);
});

test("a pending revoke still enqueues recovery even while reads show the original authorization", async () => {
  let authorized = true;
  let revokePending = false;
  const order = [];
  await assert.rejects(withAuthorizationRestoration({
    initiallyAuthorized: true,
    readAuthorized: async () => { order.push("read"); return authorized; },
    restoreAuthorization: async (original) => {
      order.push("restore");
      assert.equal(revokePending, true);
      authorized = false; // the earlier pending revoke mines before the queued recovery
      revokePending = false;
      authorized = original;
    },
  }, async (mark) => {
    mark();
    revokePending = true;
    assert.equal(authorized, true, "the pending write has not changed the readable state yet");
    throw new Error("revoke receipt unavailable");
  }), /revoke receipt unavailable/);
  assert.deepEqual(order, ["restore", "read"], "no stale read may bypass the recovery transaction");
  assert.equal(authorized, true);
  assert.equal(revokePending, false);
});

test("a failed recovery is explicit and cannot report the rehearsal as successful", async () => {
  await assert.rejects(withAuthorizationRestoration({
    initiallyAuthorized: true,
    readAuthorized: async () => false,
    restoreAuthorization: async () => { throw new Error("RPC offline"); },
  }, async (mark) => { mark(); }), /Authorization recovery could not be verified/);
});
