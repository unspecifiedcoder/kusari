// Hosted observation plus wallet-signed, bounded shared sandbox runs. Never expose raw RPC or agent ports.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { validateTradeInput, tradeRequestId, TradeApiError } from "./api-trade.mjs";
import { createSandboxAccess, readSandboxJson, SandboxError } from "./sandbox-access.mjs";

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
  demoApiKey = process.env.KUSARI_DEMO_API_KEY,
  upstreams = { agent: "http://127.0.0.1:8787", bridge: "http://127.0.0.1:8546", proxy: "http://127.0.0.1:8547" },
  requestTimeoutMs = 10_000,
  streamDurationMs = 25_000,
  maxStreams = 24,
  sandboxAccess,
} = {}) {
  if (typeof token !== "string" || token.length < 32) throw new Error("KUSARI_DEMO_GATEWAY_TOKEN must contain at least 32 characters");
  for (const origin of Object.values(upstreams)) {
    const u = new URL(origin);
    if (u.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) || u.username || u.password) {
      throw new Error("Gateway upstreams must be local HTTP services");
    }
  }
  const boundedLimit = (value, fallback, max) => {
    const parsed = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new Error("Sandbox admission limits are outside the safe configured range");
    return parsed;
  };
  const sandbox = sandboxAccess ?? createSandboxAccess({
    maxHourly: boundedLimit(process.env.KUSARI_SANDBOX_MAX_HOURLY, 20, 20),
    maxDaily: boundedLimit(process.env.KUSARI_SANDBOX_MAX_DAILY, 40, 40),
  });
  let streams = 0;
  const server = createServer(async (req, res) => {
    const apiUrl = new URL(req.url ?? "/", "http://gateway.local");
    if (apiUrl.pathname === "/v1/trade" || apiUrl.pathname.startsWith("/v1/trade/")) {
      if (typeof demoApiKey !== "string" || demoApiKey.length < 32 || !sameSecret(req.headers.authorization, demoApiKey)) return send(res, 401, { error: "A valid demo API bearer key is required" });
      if (apiUrl.search) return send(res, 400, { error: "Query parameters are not supported" });
      try {
        if (apiUrl.pathname === "/v1/trade") {
          if (req.method !== "POST") return send(res, 405, { error: "Use POST to request a trade" });
          if (String(req.headers["content-type"] ?? "").toLowerCase().split(";")[0].trim() !== "application/json") return send(res, 415, { error: "Trade requests require application/json" });
          const input = validateTradeInput(await readSandboxJson(req, 2048));
          const accepted = await sandbox.apiRun(async ({ runId }) => {
            const response = await fetch(new URL("/api-trade/run", upstreams.agent), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: runId, ...input }), redirect: "error", signal: AbortSignal.timeout(requestTimeoutMs) });
            const body = await response.json();
            if (response.status !== 202 || body.requestId !== runId || body.status !== "accepted") throw new TradeApiError(response.status === 409 ? 409 : 503, response.status === 409 ? "Shared agent is busy; wait for its current run" : "Shared trade runner is unavailable");
          });
          return send(res, 202, accepted);
        }
        const id = apiUrl.pathname.slice("/v1/trade/".length);
        if (req.method !== "GET") return send(res, 405, { error: "Use GET to inspect a trade request" });
        if (!tradeRequestId(id)) return send(res, 400, { error: "Invalid trade request ID" });
        const response = await fetch(new URL(`/api-trade/${id}`, upstreams.agent), { redirect: "error", signal: AbortSignal.timeout(15_000) });
        const body = await response.text();
        if (body.length > 16_384) throw new Error("Trade status too large");
        return send(res, [200,400,404,410,503].includes(response.status) ? response.status : 503, JSON.parse(body));
      } catch (error) {
        if (error instanceof SandboxError || error instanceof TradeApiError) {
          if (error.retryAfterSeconds) res.setHeader("retry-after", String(error.retryAfterSeconds));
          return send(res, error.status, { error: error.message, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) });
        }
        return send(res, 503, { error: "Demo trade API is unavailable; no completed swap is confirmed" });
      }
    }
    if (!sameSecret(req.headers.authorization, token)) return send(res, 401, { error: "Unauthorized" });
    const url = new URL(req.url ?? "/", "http://gateway.local");
    if (url.search) return send(res, 400, { error: "Query parameters are not supported" });

    if (["/workspace/challenge", "/workspace/prepare", "/workspace/relay", "/workspace/result", "/workspace/status", "/workspace/state"].includes(url.pathname)) {
      if (req.method !== "POST") return send(res, 405, { error: "Workspace requests require POST" });
      if (String(req.headers["content-type"] ?? "").toLowerCase().split(";")[0].trim() !== "application/json") return send(res, 415, { error: "Workspace requests require application/json" });
      try {
        const input = await readSandboxJson(req, 16_384);
        const r = await fetch(new URL(url.pathname, upstreams.agent), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), redirect: "error", signal: AbortSignal.timeout(75_000) });
        const raw = await r.text();
        if (raw.length > 65_536) throw new Error("Workspace response too large");
        const status = [200,202,400,403,408,409,410,413,429,503].includes(r.status) ? r.status : 503;
        return send(res, status, JSON.parse(raw));
      } catch (e) { return send(res, e instanceof SandboxError ? e.status : 503, { error: e instanceof SandboxError ? e.message : "Owned workspace runner is unavailable" }); }
    }
    if (["/sandbox/challenge", "/sandbox/run"].includes(url.pathname)) {
      if (req.method !== "POST") return send(res, 405, { error: "Sandbox requests require POST" });
      if (String(req.headers["content-type"] ?? "").toLowerCase().split(";")[0].trim() !== "application/json") return send(res, 415, { error: "Sandbox requests require application/json" });
      try {
        const input = await readSandboxJson(req);
        if (url.pathname === "/sandbox/challenge") {
          const statusResponse = await fetch(new URL("/status", upstreams.agent), { redirect: "error", signal: AbortSignal.timeout(requestTimeoutMs) });
          if (!statusResponse.ok) { await statusResponse.body?.cancel(); throw new SandboxError(503, "Live sandbox agent is unavailable"); }
          const status = await statusResponse.json();
          if (!status || typeof status.busy !== "boolean" || typeof status.scriptedOnly !== "boolean") throw new SandboxError(503, "Live sandbox readiness could not be verified");
          if (status.busy) throw new SandboxError(409, "Shared sandbox agent is running; wait for it to finish");
          if (status.scriptedOnly) throw new SandboxError(503, "Public sandbox requires live Gemini");
          return send(res, 200, sandbox.challenge(input));
        }
        const result = await sandbox.run(input, async ({ runId, scenario }) => {
          const r = await fetch(new URL("/sandbox/run", upstreams.agent), {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ runId, scenario }), redirect: "error", signal: AbortSignal.timeout(requestTimeoutMs),
          });
          if (!r.ok) {
            await r.body?.cancel();
            throw new SandboxError(r.status === 409 ? 409 : 503, r.status === 409 ? "Shared agent is busy; try again after the cooldown" : "Live Gemini sandbox is unavailable");
          }
          const accepted = await r.json();
          if (accepted.runId !== runId || accepted.started !== true) throw new SandboxError(503, "Sandbox acceptance could not be confirmed");
        });
        return send(res, 202, result);
      } catch (error) {
        if (error instanceof SandboxError && [408, 413].includes(error.status)) res.setHeader("connection", "close");
        if (error instanceof SandboxError && error.retryAfterSeconds) res.setHeader("retry-after", String(error.retryAfterSeconds));
        return send(res, error instanceof SandboxError ? error.status : 503, {
          error: error instanceof SandboxError ? error.message : "Sandbox request could not be completed",
          ...(error instanceof SandboxError && error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
        });
      }
    }
    if (req.method !== "GET") return send(res, 405, { error: "Presenter control routes are not public" });

    if (url.pathname === "/health") {
      const serviceHealth = await Promise.all(Object.entries({ agent: "/status", bridge: "/metrics", proxy: "/log" }).map(async ([name, path]) => {
        try {
          const r = await fetch(new URL(path, upstreams[name]), { signal: AbortSignal.timeout(Math.min(3000, requestTimeoutMs)), redirect: "error" });
          await r.body?.cancel();
          return [name, r.ok];
        } catch { return [name, false]; }
      }));
      return send(res, 200, { configured: true, controls: "signed-shared-testnet-sandbox", services: Object.fromEntries(serviceHealth), checkedAt: Date.now() });
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
  server.listen(port, host, () => console.log(`Judge gateway on port ${port}; shared sandbox requires a wallet signature, presenter controls stay local`));
}
