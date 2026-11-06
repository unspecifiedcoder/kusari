const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const reply = (status, body) => Response.json(body, { status, headers: HEADERS });

async function boundedJson(request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("content-type");
  if (Number(request.headers.get("content-length") ?? 0) > 4096) throw new Error("size");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("body");
  let expired = false;
  const timeout = setTimeout(() => { expired = true; void reader.cancel(); }, 5000);
  let bytes = 0;
  let body = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read();
      if (expired) throw new Error("timeout");
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 4096) { await reader.cancel(); throw new Error("size"); }
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
    const value = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("body");
    return value;
  } finally { clearTimeout(timeout); reader.releaseLock(); }
}

/**
 * Stateless serverless proxy. All nonce/admission state lives in the persistent Fly gateway.
 * @param {{ gatewayUrl?: string, token?: string, publicOrigin?: string, fetchImpl?: typeof fetch }} [options]
 */
export function createSandboxProxy({ gatewayUrl, token, publicOrigin = "https://kusari.outcomeseal.com", fetchImpl = fetch } = {}) {
  return async function proxy(request, action) {
    if (!["challenge", "run"].includes(action)) return reply(404, { error: "Unknown sandbox action" });
    if (request.method !== "POST") return reply(405, { error: "Use POST" });
    let expected;
    try { expected = new URL(publicOrigin); } catch { return reply(503, { error: "Sandbox origin is not configured" }); }
    if (expected.protocol !== "https:" || expected.origin !== publicOrigin || request.headers.get("origin") !== expected.origin || new URL(request.url).origin !== expected.origin) {
      return reply(403, { error: "Use the official Kusari sandbox website" });
    }
    if (new URL(request.url).search) return reply(400, { error: "Query parameters are not supported" });
    let gateway;
    try {
      gateway = new URL(gatewayUrl);
      if (gateway.protocol !== "https:" || gateway.username || gateway.password || gateway.pathname !== "/" || gateway.search || gateway.hash || !token) throw new Error();
    } catch { return reply(503, { error: "Sandbox is not connected" }); }
    let body;
    try { body = await boundedJson(request); }
    catch (error) { return reply(error.message === "size" ? 413 : error.message === "timeout" ? 408 : 400, { error: "Send a valid sandbox request under 4 KB" }); }
    const abort = new AbortController();
    const cancel = () => abort.abort();
    request.signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, 12_000);
    try {
      const response = await fetchImpl(new URL(`sandbox/${action}`, gateway), {
        method: "POST", redirect: "error", cache: "no-store", signal: abort.signal,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: expected.origin },
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      if (raw.length > 16_384) throw new Error("response-size");
      const result = JSON.parse(raw);
      const status = [200, 202, 400, 401, 403, 408, 409, 410, 413, 429, 503].includes(response.status) ? response.status : 503;
      return reply(status, result);
    } catch { return reply(503, { error: "The sandbox runner is unavailable. No completed trade is confirmed." }); }
    finally { clearTimeout(timer); request.signal.removeEventListener("abort", cancel); }
  };
}
