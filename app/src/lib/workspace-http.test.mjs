import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceProxy } from "./workspace-http.mjs";

const origin = "https://kusari.outcomeseal.com";
const request = (body = {}, headers = {}, url = `${origin}/api/workspace/state`) => new Request(url, {
  method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});

test("owned workspace proxy pins origin, action, upstream and server-side bearer", async () => {
  const calls = [];
  const proxy = createWorkspaceProxy({ gatewayUrl: "https://runner.example/", token: "server-only", fetchImpl: async (url, options) => {
    calls.push({ url: String(url), ...options });
    return Response.json({ status: "ready" });
  } });
  assert.equal((await proxy(request(), "state")).status, 200);
  assert.equal(calls[0].url, "https://runner.example/workspace/state");
  assert.equal(calls[0].headers.authorization, "Bearer server-only");
  assert.equal(calls[0].redirect, "error");
  assert.equal((await proxy(request(), "../agent/tick")).status, 404);
  assert.equal((await proxy(request({}, { origin: "https://evil.example" }), "relay")).status, 403);
  assert.equal((await proxy(request({}, {}, "https://kusari-demo.vercel.app/api/workspace/state"), "state")).status, 403);
  assert.equal((await proxy(request({}, {}, `${origin}/api/workspace/state?url=http://evil.example`), "state")).status, 400);
  assert.equal(calls.length, 1);
});

test("owned workspace proxy rejects oversized/non-JSON inputs and fails closed on unsafe upstreams", async () => {
  let calls = 0;
  const proxy = createWorkspaceProxy({ gatewayUrl: "https://runner.example/", token: "secret", fetchImpl: async () => { calls++; return Response.json({}); } });
  assert.equal((await proxy(request({ data: "x".repeat(17_000) }), "relay")).status, 413);
  assert.equal((await proxy(request({}, { "content-type": "text/plain" }), "prepare")).status, 400);
  assert.equal((await proxy(request([]), "prepare")).status, 400);
  assert.equal(calls, 0);
  for (const gatewayUrl of ["http://runner.example/", "https://runner.example/path", "https://name:secret@runner.example/"]) {
    assert.equal((await createWorkspaceProxy({ gatewayUrl, token: "secret" })(request(), "state")).status, 503);
  }
  assert.equal((await createWorkspaceProxy({ gatewayUrl: "https://runner.example/", token: "secret", fetchImpl: async () => { throw new Error("redirect"); } })(request(), "relay")).status, 503);
});

test("owned workspace proxy preserves admission and async-job states without caching", async () => {
  const proxy = createWorkspaceProxy({ gatewayUrl: "https://runner.example/", token: "secret", fetchImpl: async () => Response.json({ runId: "test", status: "preparing" }, { status: 202 }) });
  const response = await proxy(request(), "prepare");
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { runId: "test", status: "preparing" });
});
