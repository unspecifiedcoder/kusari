// C2: a plain JSON-RPC endpoint on :8546 whose every call goes out through Anon-RPC (Nox).
// The agent, cast, or viem just point their RPC URL here; no special client code needed.
//   npm run bridge      then   cast block-number --rpc-url http://localhost:8546
import { createServer } from "node:http";
import { startAnonBrowser } from "./browser.mjs";

const PORT = Number(process.env.ANON_BRIDGE_PORT ?? 8546);

console.log("booting Anon-RPC worker (Nox)...");
const ab = await startAnonBrowser();
if (!ab.ready.ok) {
  console.error("worker failed to boot:", ab.ready.error, "\n" + ab.logs.slice(-20).join("\n"));
  process.exit(1);
}
console.log(`worker ready in ${ab.bootMs} ms`);

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
  if (req.method !== "POST") return send(res, 405, { error: "POST JSON-RPC only" });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
  }

  const out = await ab.anon(body); // single request or batch array, forwarded as-is
  if (!out.ok) {
    const id = Array.isArray(body) ? null : (body.id ?? null);
    return send(res, 502, { jsonrpc: "2.0", id, error: { code: -32603, message: `anon-rpc: ${out.error}` } });
  }
  const methods = Array.isArray(body) ? body.map((b) => b.method).join(",") : body.method;
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
