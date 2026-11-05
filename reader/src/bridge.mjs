// C2: a plain JSON-RPC endpoint on :8546 whose every call goes out through Anon-RPC (Nox).
// The agent, cast, or viem just point their RPC URL here; no special client code needed.
//   npm run bridge      then   cast block-number --rpc-url http://localhost:8546
import { createServer } from "node:http";
import { startAnonBrowser } from "./browser.mjs";

const PORT = Number(process.env.ANON_BRIDGE_PORT ?? 8546);
// "direct" is an emergency fallback for demos. It is NOT anonymous and is labelled that way everywhere.
const MODE = process.env.ANON_MODE === "direct" ? "direct" : "anon";
if (MODE === "direct") console.warn("WARNING: ANON_MODE=direct. Reads are NOT anonymized.");

// ---- C3: metrics + live event stream (what the dashboard's right-hand panel shows) ----
const metrics = { mode: MODE, transport: MODE === "anon" ? "nox-mixnet" : "direct (NOT anonymous)", requests: 0, failures: 0, bootMs: 0, recent: [] };
const sseClients = new Set();
function record(entry) {
  metrics.requests++;
  if (!entry.ok) metrics.failures++;
  metrics.recent.unshift(entry);
  metrics.recent.length = Math.min(metrics.recent.length, 50);
  const line = `data: ${JSON.stringify(entry)}\n\n`;
  for (const c of sseClients) c.write(line);
}
function latencyStats() {
  const xs = metrics.recent.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
  if (!xs.length) return null;
  return { count: xs.length, median: xs[Math.floor(xs.length / 2)], p90: xs[Math.floor(xs.length * 0.9)], max: xs.at(-1) };
}

console.log("booting Anon-RPC worker (Nox)...");
const ab = await startAnonBrowser();
if (!ab.ready.ok) {
  console.error("worker failed to boot:", ab.ready.error, "\n" + ab.logs.slice(-20).join("\n"));
  process.exit(1);
}
console.log(`worker ready in ${ab.bootMs} ms`);
metrics.bootMs = ab.bootMs;
const forward = MODE === "anon" ? ab.anon : ab.direct;

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

const send = (res, status, obj) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(obj));
};

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, GET",
      "access-control-allow-headers": "content-type",
    });
    return res.end();
  }
  const path = new URL(req.url, "http://x").pathname;
  if (req.method === "GET" && path === "/metrics") return send(res, 200, { ...metrics, latency: latencyStats() });
  if (req.method === "GET" && path === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "access-control-allow-origin": "*" });
    res.write(`data: ${JSON.stringify({ hello: true, mode: MODE, transport: metrics.transport })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }
  if (req.method !== "POST") return send(res, 405, { error: "POST JSON-RPC, GET /metrics or GET /events" });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
  }

  const out = await forward(body); // single request or batch array, forwarded as-is
  const methods = Array.isArray(body) ? body.map((b) => b.method).join(",") : body.method;
  // The provider-side view: only the mixnet exit is visible. We log method + timing, never the caller.
  record({ t: Date.now(), method: methods, ms: out.ms, ok: out.ok, transport: metrics.transport });
  if (!out.ok) {
    const id = Array.isArray(body) ? null : (body.id ?? null);
    return send(res, 502, { jsonrpc: "2.0", id, error: { code: -32603, message: `anon-rpc: ${out.error}` } });
  }
  console.log(`${methods}  ${out.ms} ms`);
  send(res, 200, out.body);
});

server.listen(PORT, "127.0.0.1", () => console.log(`Anon-RPC bridge on http://localhost:${PORT}`));

const shutdown = async () => {
  server.close();
  await ab.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
