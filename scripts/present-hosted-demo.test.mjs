import test from "node:test";
import assert from "node:assert/strict";
import { presentHostedDemo } from "./present-hosted-demo.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("presenter status is read-only and omits internal URLs and raw error details", async () => {
  const calls = [];
  const result = await presentHostedDemo(["status"], { fetchImpl: async (url, options) => {
    calls.push([url, options.method]);
    return json({ agent: "0xagent", vault: "0xvault", busy: false, readRpc: "secret-endpoint", recentEvents: [{ message: "private detail" }], stateStatus: "fresh" });
  } });
  assert.deepEqual(calls, [["http://127.0.0.1:8787/status", "GET"]]);
  assert.equal(result.agent, "0xagent");
  assert.equal(result.readRpc, undefined);
  assert.equal(result.recentEvents, undefined);
});

test("presenter attack requests one explicit local scenario and waits for its result", async () => {
  const calls = [];
  let statusCalls = 0;
  const result = await presentHostedDemo(["attack"], { fetchImpl: async (url, options) => {
    calls.push([url, options.method]);
    if (url.endsWith("/status")) {
      statusCalls++;
      return json(statusCalls === 1 ? { busy: false, recentEvents: [{ id: 5, type: "idle" }] } : {
        busy: false, recentEvents: [{ id: 8, type: "idle" }, { id: 7, type: "swap", status: "blocked", hash: "0xpublichash", reason: "ExceedsPerSwap" }, { id: 6, type: "error", message: "secret-endpoint" }],
      });
    }
    return json({ started: true });
  } });
  assert.deepEqual(calls.map(([url, method]) => [new URL(url).pathname + new URL(url).search, method]), [["/status", "GET"], ["/inject?on=1", "POST"], ["/tick", "POST"], ["/status", "GET"]]);
  assert.equal(result.events[1].hash, "0xpublichash");
  assert.doesNotMatch(JSON.stringify(result), /secret-endpoint/);
});

test("presenter rejects unknown commands and busy agents without mutating them", async () => {
  let calls = 0;
  await assert.rejects(presentHostedDemo(["transport"], { fetchImpl: async () => { calls++; return json({}); } }), /Usage/);
  assert.equal(calls, 0);
  await assert.rejects(presentHostedDemo(["normal"], { fetchImpl: async (_url, options) => { calls++; assert.equal(options.method, "GET"); return json({ busy: true }); } }), /already running/);
  assert.equal(calls, 1);
});
