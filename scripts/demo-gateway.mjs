// Read-only gateway for a hosted judge view. Tunnel this port, never the raw RPC bridge or agent port.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const ROUTES = new Map([
  ["/agent/status", { service: "agent", path: "/status", json: true }],
  ["/agent/events", { service: "agent", path: "/events", stream: true }],
  ["/bridge/metrics", { service: "bridge", path: "/metrics", json: true }],
  ["/bridge/events", { service: "bridge", path: "/events", stream: true }],
  ["/proxy/log", { service: "proxy", path: "/log", json: true }],
  ["/proxy/events", { service: "proxy", path: "/events", stream: true }],
]);

const headers = {
  "cache-control": "no-store, no-transform",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function sameSecret(actual, expected) {
  const a = Buffer.from(actual ?? "");
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicEntry(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(publicEntry);
  // RPC endpoints may contain API credentials; the public view needs only the transport label.
  const entry = {};
  for (const [key, item] of Object.entries(value)) {
    if (["readRpc", "via", "ua"].includes(key)) continue;
    entry[key] = key === "ip" ? "demo client (IP redacted)" : publicEntry(item);
  }
  if (entry.type === "error") entry.message = "Agent cycle reported an error; the presenter can inspect local logs.";
  if ("canControl" in entry) entry.canControl = false;
  return entry;
}

const send = (res, status, value) => {
  res.writeHead(status, { ...headers, "content-type": "application/json" });
  res.end(JSON.stringify(value));
};

/** Exported so the auth/routing/streaming boundary can be tested without wallets or real RPC calls. */
export function createDemoGateway({
  token,
  upstreams = { agent: "http://127.0.0.1:8787", bridge: "http://127.0.0.1:8546", proxy: "http://127.0.0.1:8547" },
  requestTimeoutMs = 10_000,
  streamDurationMs = 25_000,
  maxStreams = 24,
} = {}) {
  if (typeof token !== "string" || token.length < 32) throw new Error("KUSARI_DEMO_GATEWAY_TOKEN must contain at least 32 characters");
  for (const origin of Object.values(upstreams)) {
    const u = new URL(origin);
    if (u.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) || u.username || u.password) {
      throw new Error("Gateway upstreams must be local HTTP services");
    }
  }
  let streams = 0;
  const server = createServer(async (req, res) => {
    if (!sameSecret(req.headers.authorization, token)) return send(res, 401, { error: "Unauthorized" });
    if (req.method !== "GET") return send(res, 405, { error: "Read-only demo gateway" });
    const url = new URL(req.url ?? "/", "http://gateway.local");
    if (url.search) return send(res, 400, { error: "Query parameters are not supported" });

    if (url.pathname === "/health") {
      const serviceHealth = await Promise.all(Object.entries({ agent: "/status", bridge: "/metrics", proxy: "/log" }).map(async ([name, path]) => {
        try {
          const r = await fetch(new URL(path, upstreams[name]), { signal: AbortSignal.timeout(Math.min(3000, requestTimeoutMs)), redirect: "error" });
          await r.body?.cancel();
          return [name, r.ok];
        } catch { return [name, false]; }
      }));
      return send(res, 200, { configured: true, controls: "local-presenter-only", services: Object.fromEntries(serviceHealth), checkedAt: Date.now() });
    }

    const route = ROUTES.get(url.pathname);
    if (!route) return send(res, 404, { error: "Unknown demo route" });
    if (route.stream && streams >= maxStreams) return send(res, 429, { error: "Demo viewer capacity reached; retry shortly" });
    // Reserve synchronously, before fetching headers, so concurrent connections cannot overbook.
    const reservedStream = Boolean(route.stream);
    if (reservedStream) streams++;

    const abort = new AbortController();
    const onClose = () => abort.abort();
    res.on("close", onClose);
    const deadline = setTimeout(() => abort.abort(), requestTimeoutMs);
    let upstream;
    try {
      upstream = await fetch(new URL(route.path, upstreams[route.service]), {
        signal: abort.signal,
        redirect: "error",
        headers: { accept: route.stream ? "text/event-stream" : "application/json" },
      });
      clearTimeout(deadline);
      if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel();
        return send(res, 503, { error: `${route.service} is unavailable`, service: route.service });
      }
      if (!route.stream) {
        const bodyDeadline = setTimeout(() => abort.abort(), requestTimeoutMs);
        try {
          const raw = await upstream.text();
          if (raw.length > 512_000) throw new Error("Upstream response too large");
          return send(res, 200, publicEntry(JSON.parse(raw)));
        } finally { clearTimeout(bodyDeadline); }
      }

      res.writeHead(200, { ...headers, "content-type": "text/event-stream", "x-accel-buffering": "no" });
      res.flushHeaders();
      const endStream = setTimeout(() => abort.abort(), streamDurationMs);
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(": keepalive\n\n"); }, 10_000);
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      try {
        while (!abort.signal.aborted) {
          const next = await reader.read();
          if (next.done) break;
          pending += decoder.decode(next.value, { stream: true }).replace(/\r\n/g, "\n");
          if (pending.length > 256_000) throw new Error("Upstream event too large");
          let end;
          while ((end = pending.indexOf("\n\n")) !== -1) {
            const event = pending.slice(0, end);
            pending = pending.slice(end + 2);
            const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
            if (!data) continue;
            try { res.write(`data: ${JSON.stringify(publicEntry(JSON.parse(data)))}\n\n`); } catch { /* Drop malformed upstream events. */ }
          }
        }
      } finally {
        clearTimeout(endStream);
        clearInterval(heartbeat);
        await reader.cancel().catch(() => {});
      }
    } catch {
      if (!res.headersSent && !res.destroyed) send(res, 503, { error: `${route.service} is unavailable`, service: route.service });
    } finally {
      if (reservedStream) streams--;
      clearTimeout(deadline);
      abort.abort();
      res.off("close", onClose);
      if (!res.writableEnded) res.end();
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const envFile = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const port = Number(process.env.KUSARI_DEMO_GATEWAY_PORT ?? 8788);
  const host = process.env.KUSARI_DEMO_GATEWAY_HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0", "::1"].includes(host)) throw new Error("Unsupported gateway bind host");
  const server = createDemoGateway({ token: process.env.KUSARI_DEMO_GATEWAY_TOKEN });
  server.listen(port, host, () => console.log(`Read-only judge gateway on port ${port}; presenter controls stay local`));
}
