const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const reply = (status, value, extra = {}) => Response.json(value, { status, headers: { ...headers, ...extra } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function readJson(request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new Error("json");
  if (Number(request.headers.get("content-length") ?? 0) > 4096) throw new Error("size");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("json");
  const parts = [];
  let bytes = 0;
  let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel(); }, 5000);
  try {
    while (true) {
      const part = await reader.read();
      if (expired) throw new Error("timeout");
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 4096) { await reader.cancel(); throw new Error("size"); }
      parts.push(part.value);
    }
    const value = JSON.parse(new TextDecoder().decode(Buffer.concat(parts)));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("json");
    return value;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

/**
 * External agents authenticate to the dedicated demo API, never with the private gateway credential.
 * No browser Origin header is needed. Requests still target only the canonical application hostname.
 * @param {{gatewayUrl?: string, publicOrigin?: string, fetchImpl?: typeof fetch}} [options]
 */
export function createTradeApiProxy({ gatewayUrl, publicOrigin = "https://kusari.outcomeseal.com", fetchImpl = fetch } = {}) {
  return async (request, requestId) => {
    if (requestId !== undefined && (typeof requestId !== "string" || !UUID.test(requestId))) return reply(404, { error: "Unknown trade request" });
    if (request.method !== (requestId ? "GET" : "POST")) return reply(405, { error: requestId ? "Use GET" : "Use POST" });
    const authorization = request.headers.get("authorization");
    if (!authorization || !/^Bearer [A-Za-z0-9_-]{32,160}$/.test(authorization)) return reply(401, { error: "A demo API bearer key is required" });
    let origin;
    try { origin = new URL(publicOrigin); } catch { return reply(503, { error: "Trade API origin is not configured" }); }
    const url = new URL(request.url);
    if (origin.protocol !== "https:" || origin.origin !== publicOrigin || url.origin !== origin.origin) return reply(403, { error: "Use the canonical Kusari API hostname" });
    if (url.search) return reply(400, { error: "Query parameters are not supported" });
    let gateway;
    try {
      gateway = new URL(gatewayUrl);
      if (gateway.protocol !== "https:" || gateway.username || gateway.password || gateway.pathname !== "/" || gateway.search || gateway.hash) throw new Error();
    } catch { return reply(503, { error: "Trade API runner is not configured" }); }
    let body;
    if (!requestId) {
      try { body = await readJson(request); }
      catch (error) { return reply(error.message === "size" ? 413 : error.message === "timeout" ? 408 : 400, { error: "Send a JSON trade request under 4 KB" }); }
    }
    const abort = new AbortController();
    const cancel = () => abort.abort();
    request.signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, 20_000);
    try {
      const response = await fetchImpl(new URL(`v1/trade${requestId ? `/${requestId}` : ""}`, gateway), {
        method: request.method, headers: { authorization, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", redirect: "error", signal: abort.signal,
      });
      const raw = await response.text();
      if (raw.length > 32_768) throw new Error("response-size");
      const result = JSON.parse(raw);
      const status = [200, 202, 400, 401, 403, 404, 408, 409, 410, 413, 429, 503].includes(response.status) ? response.status : 503;
      const retry = response.headers.get("retry-after");
      return reply(status, result, retry && /^\d{1,6}$/.test(retry) ? { "retry-after": retry } : {});
    } catch { return reply(503, { error: "Trade API unavailable. Check any known request ID or transaction hash before retrying." }); }
    finally { clearTimeout(timer); request.signal.removeEventListener("abort", cancel); }
  };
}
