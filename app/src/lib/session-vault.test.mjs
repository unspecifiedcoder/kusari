import test from "node:test";
import assert from "node:assert/strict";
import { parseEther } from "viem";
import { sessionApproval, suggestedSessionRate } from "./session-vault.ts";

test("owner session encodes exact 18-decimal token budget and output rate against the observed chain timestamp", () => {
  const approved = sessionApproval("5.125", "15", "0.0004975", 1_800_000_000n);
  assert.equal(approved.totalBudget, parseEther("5.125"));
  assert.equal(approved.minRateWad, parseEther("0.0004975"));
  assert.equal(approved.expiresAt, 1_800_000_900n);
  assert.equal(sessionApproval("1", "43200", "1", 1n).expiresAt, 2_592_001n);
});

test("owner session rejects ambiguous precision, zero/negative budgets, invalid rates and durations beyond 30 days", () => {
  for (const [budget, minutes, rate] of [["0", "15", "1"], ["-1", "15", "1"], ["1", "0", "1"], ["1", "43201", "1"], ["1", "1.5", "1"], ["1", "15", "0"], ["1e6", "15", "1"], ["1.0000000000000000001", "15", "1"], ["1", "15", "0.0000000000000000001"]]) {
    assert.throws(() => sessionApproval(budget, minutes, rate, 1_800_000_000n));
  }
  assert.throws(() => sessionApproval((2n ** 256n).toString(), "15", "1", 1n));
  assert.throws(() => sessionApproval("1", "15", "1", 2n ** 64n));
});

test("owner reference floor uses live sqrt price, observed LP fee and an explicit 2% margin", () => {
  const suggestion = suggestedSessionRate(2n ** 96n, 3000);
  assert.equal(suggestion.afterFee, parseEther("0.997"));
  assert.equal(suggestion.floor, parseEther("0.97706"));
  assert.throws(() => suggestedSessionRate(0n, 3000));
  assert.throws(() => suggestedSessionRate(2n ** 96n, 1_000_000));
});
