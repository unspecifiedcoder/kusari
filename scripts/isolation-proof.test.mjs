import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const load = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const recorded = await load("../docs/evidence/owned-workspaces.json");
const published = await load("../app/public/evidence/owned-workspaces.json");

test("public isolation evidence exactly matches the recorded source", () => {
  assert.deepEqual(published, recorded);
  assert.equal(published.chainId, 11155111);
  assert.equal(published.status, "passed");
});

test("isolation evidence identifies distinct owners, agents, names, resolvers and vaults", () => {
  for (const field of ["owner", "agent", "name", "resolver", "vault"]) {
    assert.notEqual(published.workspaces.A[field].toLowerCase(), published.workspaces.B[field].toLowerCase(), field);
  }
  assert.equal(published.assertions.anonymityProven, false);
});

test("recorded isolation sequence distinguishes A's revert from B's successful trade", () => {
  assert.deepEqual(published.runs.map(({ workspace, status }) => [workspace, status]), [
    ["A", "success"], ["B", "success"], ["A", "reverted"], ["B", "success"],
  ]);
  for (const step of ["A: freezes its own agent", "A: restores its own agent"]) {
    const tx = published.transactions.find((item) => item.step === step);
    assert.ok(tx, step);
    assert.equal(tx.status, "success");
    assert.match(tx.hash, /^0x[0-9a-f]{64}$/);
  }
  assert.equal(published.spending.A, "1");
  assert.equal(published.spending.B, "2");
});
