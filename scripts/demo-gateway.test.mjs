import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createDemoGateway } from "./demo-gateway.mjs";
import { createSnapshotCache } from "../agent/src/snapshot-cache.mjs";

const TOKEN = "test-only-secret-with-more-than-32-characters";
const listen = async (server) => { server.listen(0, "127.0.0.1"); await once(server, "listening"); return `http://127.0.0.1:${server.address().port}`; };
const close = async (server) => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); };

test("gateway admits only authenticated fixed read paths and redacts nested endpoint/IP information", async (t) => {
  let calls = 0;
  const source = createServer((req, res) => {
    calls++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/log" ? [{ ip: "203.0.113.5", ua: "private browser", method: "eth_call" }] : {
      canControl: true, readRpc: "https://private-key@rpc.invalid/", transport: "anon", lastStateAt: 123,
      recentEvents: [{ id: 1, type: "reading", via: "https://secret.invalid/", t: 123 }, { id: 2, type: "error", message: "private RPC URL" }],
    }));
  });
  const sourceUrl = await listen(source);
  const gateway = createDemoGateway({ token: TOKEN, upstreams: { agent: sourceUrl, bridge: sourceUrl, proxy: sourceUrl } });
  const base = await listen(gateway);
  t.after(async () => { await close(gateway); await close(source); });
  const auth = { authorization: `Bearer ${TOKEN}` };
  assert.equal((await fetch(`${base}/agent/status`)).status, 401);
  assert.equal((await fetch(`${base}/agent/status`, { headers: { authorization: "Bearer incorrect" } })).status, 401);
  assert.equal((await fetch(`${base}/agent/tick`, { method: "POST", headers: auth })).status, 405);
  assert.equal((await fetch(`${base}/bridge`, { method: "POST", headers: auth, body: '{"method":"eth_sendRawTransaction"}' })).status, 405);
  assert.equal((await fetch(`${base}/agent/status?url=http://attacker.invalid`, { headers: auth })).status, 400);
  assert.equal((await fetch(`${base}/agent/transport`, { headers: auth })).status, 404);
  assert.equal(calls, 0, "rejected requests must never reach a local service");
  const response = await fetch(`${base}/agent/status`, { headers: auth });
  const status = await response.json();
  assert.equal(response.headers.get("cache-control"), "no-store, no-transform");
  assert.equal(status.canControl, false);
  assert.equal(status.readRpc, undefined);
  assert.equal(status.recentEvents[0].via, undefined);
  assert.equal(status.recentEvents[0].id, 1);
  assert.doesNotMatch(status.recentEvents[1].message, /private RPC/);
  const log = await (await fetch(`${base}/proxy/log`, { headers: auth })).json();
  assert.equal(log[0].ip, "demo client (IP redacted)");
  assert.equal(log[0].ua, undefined);
  const health = await (await fetch(`${base}/health`, { headers: auth })).json();
  assert.deepEqual(health.services, { agent: true, bridge: true, proxy: true });
});

test("gateway bounds SSE viewers and releases an upstream connection when the viewer disconnects", async (t) => {
  let sourceClosed = false;
  const source = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"id":1,"type":"reading","via":"https://private.invalid/"}\n\n');
    res.on("close", () => { sourceClosed = true; });
  });
  const sourceUrl = await listen(source);
  const gateway = createDemoGateway({ token: TOKEN, upstreams: { agent: sourceUrl, bridge: sourceUrl, proxy: sourceUrl }, maxStreams: 1, streamDurationMs: 3000 });
  const base = await listen(gateway);
  t.after(async () => { await close(gateway); await close(source); });
  const abort = new AbortController();
  const headers = { authorization: `Bearer ${TOKEN}` };
  const response = await fetch(`${base}/agent/events`, { headers, signal: abort.signal });
  const reader = response.body.getReader();
  const event = new TextDecoder().decode((await reader.read()).value);
  assert.match(event, /"id":1/);
  assert.doesNotMatch(event, /private.invalid/);
  assert.equal((await fetch(`${base}/agent/events`, { headers })).status, 429);
  abort.abort();
  await reader.cancel().catch(() => {});
  for (let i = 0; i < 30 && !sourceClosed; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sourceClosed, true);
});

test("gateway times out an unresponsive local service with a non-secret error", async (t) => {
  const source = createServer(() => {});
  const sourceUrl = await listen(source);
  const gateway = createDemoGateway({ token: TOKEN, upstreams: { agent: sourceUrl, bridge: sourceUrl, proxy: sourceUrl }, requestTimeoutMs: 50 });
  const base = await listen(gateway);
  t.after(async () => { await close(gateway); await close(source); });
  const response = await fetch(`${base}/agent/status`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "agent is unavailable", service: "agent" });
});

test("parallel SSE requests reserve capacity before waiting for upstream headers and release failed reservations", async (t) => {
  let upstreamCalls = 0;
  const source = createServer((_req, res) => {
    upstreamCalls++;
    setTimeout(() => { if (!res.destroyed) res.writeHead(503).end(); }, 80);
  });
  const sourceUrl = await listen(source);
  const gateway = createDemoGateway({ token: TOKEN, upstreams: { agent: sourceUrl, bridge: sourceUrl, proxy: sourceUrl }, maxStreams: 1 });
  const base = await listen(gateway);
  t.after(async () => { await close(gateway); await close(source); });
  const headers = { authorization: `Bearer ${TOKEN}` };
  const responses = await Promise.all([fetch(`${base}/agent/events`, { headers }), fetch(`${base}/agent/events`, { headers })]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [429, 503]);
  assert.equal(upstreamCalls, 1, "only the reserved viewer may contact the upstream");
  assert.equal((await fetch(`${base}/agent/events`, { headers })).status, 503, "failed upstream requests must release their reservation");
  assert.equal(upstreamCalls, 2);
});

test("status snapshots share refreshes, distinguish stale failures and reject results from an old transport", async () => {
  let time = 100;
  let resolveRead;
  let loads = 0;
  const cache = createSnapshotCache({ now: () => time, maxAgeMs: 10, retryDelayMs: 1, load: () => { loads++; return new Promise((resolve) => { resolveRead = resolve; }); } });
  assert.equal(cache.get().stateStatus, "refreshing");
  cache.get(); cache.get();
  await Promise.resolve();
  assert.equal(loads, 1);
  resolveRead({ balance: 5 });
  await cache.refresh();
  assert.equal(cache.get().stateStatus, "fresh");
  time += 11;
  assert.equal(cache.get().stateStatus, "stale");
  await Promise.resolve();
  cache.invalidate();
  resolveRead({ balance: 999 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(cache.peek().lastState, { balance: 5 }, "an old transport result must not become fresh after invalidation");
  const broken = createSnapshotCache({ load: async () => { throw new Error("secret URL"); }, now: () => time });
  broken.record({ balance: 1 });
  time += 10_001;
  await broken.refresh();
  assert.equal(broken.peek().stateStatus, "stale");
  assert.match(broken.peek().stateError, /refresh failed/);
  assert.doesNotMatch(broken.peek().stateError, /secret URL/);
});
