// E1: a "public RPC provider" stand-in for the leak demo, on :8547.
// Forwards JSON-RPC to a real Sepolia RPC and records exactly what a provider can see about the caller:
// IP address, user agent, method and full params (which reveal the agent's intent before it trades).
//   node server.mjs        then point the agent at http://localhost:8547
//   GET /log      recent entries (JSON)
//   GET /events   live stream (SSE) for the dashboard's left panel
import { createServer } from "node:http";

const PORT = Number(process.env.LOGGING_PROXY_PORT ?? 8547);
const UPSTREAM = process.env.PROXY_UPSTREAM_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";

const log = [];
const clients = new Set();

// Selectors worth labelling so the demo reads like a provider's analytics view.
const KNOWN = {
  "0x70a08231": "balanceOf",
  "0xc815641c": "getSlot0 (StateView)",
  "0x1e2eaeaf": "extsload (PoolManager)",
  "0xfa6793d5": "getLiquidity (StateView)",
  "0xaa9d21cb": "quoteExactInputSingle",
};

function describe(call) {
  const p = call.params?.[0];
  if (call.method === "eth_call" && p?.data) {
    return { to: p.to, fn: KNOWN[p.data.slice(0, 10)] ?? p.data.slice(0, 10), data: p.data };
  }
  return call.params ?? [];
}

function record(entry) {
  log.unshift(entry);
  log.length = Math.min(log.length, 200);
  const line = `data: ${JSON.stringify(entry)}\n\n`;
  for (const c of clients) c.write(line);
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };

createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  if (req.method === "GET" && path === "/log") {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify(log));
  }
  if (req.method === "GET" && path === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", ...cors });
    res.write(`data: ${JSON.stringify({ hello: true, role: "public-provider" })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (req.method !== "POST") return res.writeHead(405, cors).end();

  const raw = await readBody(req);
  let calls;
  try {
    const parsed = JSON.parse(raw);
    calls = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    res.writeHead(400, cors);
    return res.end();
  }

  const ip = req.headers["x-forwarded-for"] ?? req.socket.remoteAddress;
  const ua = req.headers["user-agent"] ?? "";
  for (const c of calls) record({ t: Date.now(), ip, ua, method: c.method, detail: describe(c) });

  const t0 = Date.now();
  try {
    const up = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body: raw });
    const text = await up.text();
    console.log(`${ip}  ${calls.map((c) => c.method).join(",")}  ${Date.now() - t0} ms`);
    res.writeHead(up.status, { "content-type": "application/json", ...cors });
    res.end(text);
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: calls[0]?.id ?? null, error: { code: -32603, message: String(e) } }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`logging "public provider" proxy on http://localhost:${PORT} -> ${UPSTREAM}`));
