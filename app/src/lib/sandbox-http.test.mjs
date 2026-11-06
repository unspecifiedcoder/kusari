import test from "node:test";
import assert from "node:assert/strict";
import { createSandboxProxy } from "./sandbox-http.mjs";

const origin = "https://kusari.outcomeseal.com";
const request = (body = { address: "demo", scenario: "normal" }, headers = {}) => new Request(`${origin}/api/sandbox/challenge`, {
  method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});

test("sandbox proxy forwards only fixed actions and keeps gateway authority server-side", async () => {
  const calls = [];
  const proxy = createSandboxProxy({ gatewayUrl: "https://backend.example/", token: "private-test-token", fetchImpl: async (url, options) => {
    calls.push({ url: String(url), ...options });
    return Response.json({ nonce: "public-nonce", message: "public-message" });
  } });
  const response = await proxy(request(), "challenge");
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "https://backend.example/sandbox/challenge");
  assert.equal(calls[0].headers.authorization, "Bearer private-test-token");
  assert.equal(calls[0].redirect, "error");
  assert.equal((await response.text()).includes("private-test-token"), false);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await proxy(request(), "agent/tick")).status, 404);
  assert.equal(calls.length, 1);
});

test("sandbox proxy rejects cross-origin, unknown origin, non-JSON and oversized bodies before forwarding", async () => {
  let calls = 0;
  const proxy = createSandboxProxy({ gatewayUrl: "https://backend.example/", token: "secret", fetchImpl: async () => { calls++; return Response.json({}); } });
  assert.equal((await proxy(request({}, { origin: "https://evil.example" }), "challenge")).status, 403);
  assert.equal((await proxy(request({}, { origin: "null" }), "challenge")).status, 403);
  assert.equal((await proxy(request({}, { "content-type": "text/plain" }), "challenge")).status, 400);
  assert.equal((await proxy(request({ value: "x".repeat(5000) }), "challenge")).status, 413);
  assert.equal(calls, 0);
  const alias = new Request("https://kusari-demo.vercel.app/api/sandbox/challenge", { method: "POST", headers: { origin: "https://kusari-demo.vercel.app", "content-type": "application/json" }, body: "{}" });
  assert.equal((await proxy(alias, "challenge")).status, 403);
  assert.equal(calls, 0);
});

test("sandbox proxy preserves bounded rate/busy replies and fails closed on misconfiguration and redirects", async () => {
  const proxy = createSandboxProxy({ gatewayUrl: "https://backend.example/", token: "secret", fetchImpl: async () => Response.json({ error: "Cooldown", retryAfterSeconds: 30 }, { status: 429 }) });
  const r = await proxy(request(), "run");
  assert.equal(r.status, 429);
  assert.equal((await r.json()).retryAfterSeconds, 30);
  assert.equal((await createSandboxProxy({ gatewayUrl: "http://backend.example", token: "secret" })(request(), "challenge")).status, 503);
  assert.equal((await createSandboxProxy({ gatewayUrl: "https://backend.example/path", token: "secret" })(request(), "challenge")).status, 503);
  const redirect = createSandboxProxy({ gatewayUrl: "https://backend.example/", token: "secret", fetchImpl: async () => { throw new Error("redirect"); } });
  assert.equal((await redirect(request(), "run")).status, 503);
});
