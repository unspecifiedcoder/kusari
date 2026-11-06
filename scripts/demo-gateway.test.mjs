import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createDemoGateway } from "./demo-gateway.mjs";
import { createSnapshotCache } from "../agent/src/snapshot-cache.mjs";
import { createSandboxAccess } from "./sandbox-access.mjs";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(new URL("../agent/package.json", import.meta.url));
const { privateKeyToAccount } = require("viem/accounts");

const TOKEN = "test-only-secret-with-more-than-32-characters";
const listen = async (server) => { server.listen(0, "127.0.0.1"); await once(server, "listening"); return `http://127.0.0.1:${server.address().port}`; };
const close = async (server) => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); };

test("fixed owner-only two-kUSD route verifies the live ENS signer and shares sandbox allowance", async (t) => {
  const account = privateKeyToAccount(`0x${"4".repeat(64)}`);
  const outsider = privateKeyToAccount(`0x${"5".repeat(64)}`);
  const ens = JSON.parse(readFileSync(new URL("../deployments/11155111-ens.json", import.meta.url), "utf8"));
  const deployment = JSON.parse(readFileSync(new URL("../deployments/11155111.json", import.meta.url), "utf8"));
  let starts = 0;
  const source = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/policy-check/owner") {
      res.end(JSON.stringify({ owner: account.address, agent: ens.agent, vault: deployment.demoVault, chainId: 11155111, readTransport: "anon", bridgeMode: "anon", busy: false }));
      return;
    }
    let raw = ""; for await (const part of req) raw += part;
    const input = JSON.parse(raw);
    if (req.url === "/policy-check/run") {
      starts++;
      assert.deepEqual(Object.keys(input).sort(), ["owner", "requestId"]);
      assert.equal(input.owner, account.address);
      res.writeHead(202); res.end(JSON.stringify({ requestId: input.requestId, status: "accepted" }));
      return;
    }
    res.end(JSON.stringify({ requestId: input.requestId, status: "reverted", requested: "2", limit: "1", source: "owner-policy-check", preflightReason: "ExceedsPerSwap", hash: `0x${"a".repeat(64)}` }));
  });
  const sourceUrl = await listen(source);
  const sandbox = createSandboxAccess({ maxDaily: 1, maxHourly: 1, globalCooldownMs: 0, walletCooldownMs: 0 });
  const gateway = createDemoGateway({ token: TOKEN, sandboxAccess: sandbox, upstreams: { agent: sourceUrl, bridge: sourceUrl, proxy: sourceUrl } });
  const base = await listen(gateway);
  t.after(async () => { await close(gateway); await close(source); });
  const post = (path, value, bearer = TOKEN) => fetch(base + path, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify(value) });
  assert.equal((await post("/policy-check/challenge", { address: account.address }, "invalid")).status, 401);
  assert.equal((await post("/policy-check/challenge", { address: outsider.address })).status, 403);
  assert.equal((await post("/policy-check/challenge", { address: account.address, amountIn: "3" })).status, 400);
  const challenge = await (await post("/policy-check/challenge", { address: account.address })).json();
  const request = { address: account.address, nonce: challenge.nonce, signature: await account.signMessage({ message: challenge.message }) };
  const response = await post("/policy-check/run", request);
  assert.equal(response.status, 202);
  const accepted = await response.json();
  assert.equal(starts, 1);
  assert.equal((await post("/policy-check/run", request)).status, 409);
  assert.throws(() => sandbox.challenge({ address: account.address, scenario: "normal" }), { status: 429 });
  const result = await (await post("/policy-check/result", { requestId: accepted.requestId })).json();
  assert.equal(result.requested, "2"); assert.equal(result.limit, "1"); assert.equal(result.preflightReason, "ExceedsPerSwap");
  assert.equal((await post("/policy-check/withdraw", {})).status, 405);
});

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

test("HTTP sandbox accepts a signed fixed scenario once, rejects oversized/malformed bodies and preserves private controls", async (t) => {
  const wallet = privateKeyToAccount(`0x${"33".repeat(32)}`);
  let clock = 1000;
  let busy = false;
  let scriptedOnly = false;
  const starts = [];
  const source = createServer(async (req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ busy, scriptedOnly }));
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.equal(req.url, "/sandbox/run");
    const input = JSON.parse(body);
    assert.deepEqual(Object.keys(input).sort(), ["runId", "scenario"]);
    starts.push(input);
    res.writeHead(busy ? 409 : 202, { "content-type": "application/json" });
    res.end(JSON.stringify(busy ? { error: "busy" } : { runId: input.runId, started: true }));
  });
  const sourceUrl = await listen(source);
  const gateway = createDemoGateway({ token: TOKEN, upstreams: { agent: sourceUrl, bridge: sourceUrl, proxy: sourceUrl }, sandboxAccess: createSandboxAccess({ now: () => clock }) });
  const base = await listen(gateway);
  t.after(async () => { await close(gateway); await close(source); });
  const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
  const post = (path, value) => fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(value) });
  const challenge = await (await post("/sandbox/challenge", { address: wallet.address, scenario: "normal" })).json();
  const input = { nonce: challenge.nonce, address: wallet.address, signature: await wallet.signMessage({ message: challenge.message }) };
  const run = await post("/sandbox/run", input);
  assert.equal(run.status, 202);
  const result = await run.json();
  assert.equal(result.started, true);
  assert.equal(starts[0].runId, result.runId);
  assert.equal(starts[0].scenario, "normal");
  assert.equal((await post("/sandbox/run", input)).status, 409);
  assert.equal(starts.length, 1);
  clock += 20_000;
  const cooldown = await post("/sandbox/challenge", { address: wallet.address, scenario: "attack" });
  assert.equal(cooldown.status, 429);
  assert.equal(cooldown.headers.get("retry-after"), "10");
  assert.equal((await cooldown.json()).retryAfterSeconds, 10);
  assert.equal((await post("/agent/tick", {})).status, 405);
  assert.equal((await post("/sandbox/challenge", { address: wallet.address, scenario: "normal", amount: 10 })).status, 400);
  assert.equal((await fetch(`${base}/sandbox/challenge`, { method: "POST", headers, body: "{" })).status, 400);
  assert.equal((await post("/sandbox/challenge", { address: wallet.address, scenario: "normal", padding: "x".repeat(5000) })).status, 413);
  clock += 31_000;
  busy = true;
  assert.equal((await post("/sandbox/challenge", { address: wallet.address, scenario: "attack" })).status, 409, "agent busy must be detected before requesting a signature");
  busy = false;
  const next = await (await post("/sandbox/challenge", { address: wallet.address, scenario: "attack" })).json();
  busy = true;
  assert.equal((await post("/sandbox/run", { nonce: next.nonce, address: wallet.address, signature: await wallet.signMessage({ message: next.message }) })).status, 409);
  assert.equal(starts.length, 2);
  busy = false;
  scriptedOnly = true;
  assert.equal((await post("/sandbox/challenge", { address: wallet.address, scenario: "attack" })).status, 503, "scripted-only backend must fail before requesting a signature");
});

test("owned workspace gateway fixes routes, requires auth and bounds raw transaction requests", async (t) => {
  const source = createServer(async (req, res) => {
    let body=''; for await (const part of req) body+=part;
    res.writeHead(req.url === '/workspace/prepare' ? 202 : 200, {'content-type':'application/json'});
    res.end(JSON.stringify({path:req.url, input:JSON.parse(body)}));
  });
  const sourceUrl=await listen(source);
  const gateway=createDemoGateway({token:TOKEN,upstreams:{agent:sourceUrl,bridge:sourceUrl,proxy:sourceUrl}});
  const base=await listen(gateway);t.after(async()=>{await close(gateway);await close(source);});
  const options={method:'POST',headers:{authorization:`Bearer ${TOKEN}`,'content-type':'application/json'},body:JSON.stringify({runId:'id'})};
  assert.equal((await fetch(`${base}/workspace/prepare`,options)).status,202);
  const relay=await fetch(`${base}/workspace/relay`,{...options,body:JSON.stringify({rawTransaction:'0x'+'ab'.repeat(6000)})});
  assert.equal(relay.status,200);assert.equal((await relay.json()).path,'/workspace/relay');
  assert.equal((await fetch(`${base}/workspace/relay`,{...options,headers:{'content-type':'application/json'}})).status,401);
  assert.equal((await fetch(`${base}/workspace/anything`,options)).status,405);
  assert.equal((await fetch(`${base}/workspace/relay`,{...options,body:JSON.stringify({rawTransaction:'a'.repeat(17000)})})).status,413);
});

test("dedicated external-agent key admits only bounded trade API and shares browser quotas", async(t)=>{
 let upstreamCalls=0;let acceptedId;
 const source=createServer(async(req,res)=>{upstreamCalls++;let input='';for await(const part of req)input+=part;res.setHeader('content-type','application/json');if(req.method==='POST'){const body=JSON.parse(input);acceptedId=body.requestId;res.writeHead(202);res.end(JSON.stringify({requestId:body.requestId,status:'accepted'}));}else{res.end(JSON.stringify({requestId:acceptedId,status:'success',hash:'0x'+'a'.repeat(64)}));}});
 const sourceUrl=await listen(source);const apiKey='D'.repeat(40);
 const sandbox=createSandboxAccess({maxDaily:1,maxHourly:1,globalCooldownMs:0,walletCooldownMs:0});
 const gateway=createDemoGateway({token:TOKEN,demoApiKey:apiKey,sandboxAccess:sandbox,upstreams:{agent:sourceUrl,bridge:sourceUrl,proxy:sourceUrl}});const base=await listen(gateway);t.after(async()=>{await close(gateway);await close(source);});
 const options={method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify({amountIn:'0.5',minAmountOut:'1'})};
 assert.equal((await fetch(`${base}/v1/trade`,{...options,headers:{...options.headers,authorization:`Bearer ${TOKEN}`}})).status,401);
 assert.equal((await fetch(`${base}/v1/trade`,{...options,body:JSON.stringify({amountIn:'2'})})).status,400);
 assert.equal((await fetch(`${base}/v1/trade`,{...options,body:JSON.stringify({amountIn:'1',reason:'a'.repeat(3000)})})).status,413);
 assert.equal(upstreamCalls,0);
 const response=await fetch(`${base}/v1/trade`,options);assert.equal(response.status,202);const result=await response.json();assert.equal(result.requestId,acceptedId);assert.equal(upstreamCalls,1);
 assert.equal((await fetch(`${base}/v1/trade`,options)).status,429);assert.equal(upstreamCalls,1);
 assert.throws(()=>sandbox.challenge({address:'0x1111111111111111111111111111111111111111',scenario:'normal'}),{status:429});
 const status=await fetch(`${base}/v1/trade/${acceptedId}`,{headers:{authorization:`Bearer ${apiKey}`}});assert.equal(status.status,200);assert.equal((await status.json()).status,'success');
 assert.equal((await fetch(`${base}/agent/status`,{headers:{authorization:`Bearer ${apiKey}`}})).status,401);
 assert.equal((await fetch(`${base}/v1/trade/${acceptedId}/withdraw`,{headers:{authorization:`Bearer ${apiKey}`}})).status,400);
});

test("external trade API reports shared runtime busy without claiming acceptance",async(t)=>{
 let attempts=0;
 const source=createServer((req,res)=>{attempts++;res.writeHead(409,{'content-type':'application/json'});res.end(JSON.stringify({error:'busy'}));});const sourceUrl=await listen(source);
 const apiKey='B'.repeat(40);const gateway=createDemoGateway({token:TOKEN,demoApiKey:apiKey,upstreams:{agent:sourceUrl,bridge:sourceUrl,proxy:sourceUrl}});const base=await listen(gateway);t.after(async()=>{await close(gateway);await close(source);});
 const response=await fetch(`${base}/v1/trade`,{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify({amountIn:'0.1'})});
 assert.equal(response.status,409);const result=await response.json();assert.match(result.error,/busy/);assert.equal(result.requestId,undefined);assert.equal(attempts,1);
});
