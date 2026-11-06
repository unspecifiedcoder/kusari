import test from "node:test";
import assert from "node:assert/strict";
import { createTradeApiProxy } from "./trade-api-http.mjs";
const origin = "https://kusari.outcomeseal.com";
const key = "test-only-api-key-at-least-32-characters";
const id = "12345678-1234-4234-8234-123456789012";
const req = (body = { amountIn: "1.0" }, h = {}, url = `${origin}/v1/trade`) => new Request(url, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...h }, body: JSON.stringify(body) });

test("external trade proxy permits agent clients without Origin and forwards only their demo bearer", async () => {
  const calls = [];
  const proxy = createTradeApiProxy({ gatewayUrl: "https://runner.example/", fetchImpl: async (url, options) => { calls.push({ url: String(url), ...options }); return Response.json({ requestId: id, status: "accepted" }, { status: 202 }); } });
  const response = await proxy(req());
  assert.equal(response.status, 202);
  assert.equal(calls[0].url, "https://runner.example/v1/trade");
  assert.equal(calls[0].headers.authorization, `Bearer ${key}`);
  assert.equal(calls[0].redirect, "error");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.text()).includes(key), false);
  assert.equal((await proxy(new Request(`${origin}/v1/trade/${id}`, { headers: { authorization: `Bearer ${key}` } }), id)).status, 202);
  assert.equal(calls[1].url, `https://runner.example/v1/trade/${id}`);
  assert.equal(calls[1].body, undefined);
});

test("external trade proxy rejects missing auth, aliases, oversized bodies, queries and path injection before forwarding", async () => {
  let calls = 0;
  const proxy = createTradeApiProxy({ gatewayUrl: "https://runner.example/", fetchImpl: async () => { calls++; return Response.json({}); } });
  assert.equal((await proxy(req({}, { authorization: "" }))).status, 401);
  assert.equal((await proxy(req({}, {}, "https://kusari-demo.vercel.app/v1/trade"))).status, 403);
  assert.equal((await proxy(req({ data: "x".repeat(5000) }))).status, 413);
  assert.equal((await proxy(req({}, { "content-type": "text/plain" }))).status, 400);
  assert.equal((await proxy(req({}, {}, `${origin}/v1/trade?url=http://evil.example`))).status, 400);
  assert.equal((await proxy(req(), "../agent/tick")).status, 404);
  assert.equal(calls, 0);
});

test("external trade proxy preserves authorization/quota failure and refuses an unsafe upstream", async () => {
  const proxy = createTradeApiProxy({ gatewayUrl: "https://runner.example/", fetchImpl: async () => Response.json({ error: "Cooldown" }, { status: 429, headers: { "retry-after": "30" } }) });
  const response = await proxy(req());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal((await createTradeApiProxy({ gatewayUrl: "http://runner.example/" })(req())).status, 503);
  const failed = createTradeApiProxy({ gatewayUrl: "https://runner.example/", fetchImpl: async () => { throw new Error("private connection detail"); } });
  const result = await failed(req());
  assert.equal(result.status, 503);
  assert.equal((await result.text()).includes("private connection detail"), false);
});
