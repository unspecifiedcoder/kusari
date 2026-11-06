// Fixed same-origin bridge to the persistent owned-agent runner. No browser-supplied RPC URLs.
const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const reply = (status, value) => Response.json(value, { status, headers: HEADERS });
const ACTIONS = new Set(["state", "status", "challenge", "prepare", "relay", "result"]);

async function readBody(request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new Error("json");
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) throw new Error("size");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("json");
  let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel(); }, 5000);
  let bytes = 0;
  const parts = [];
  try {
    while (true) {
      const part = await reader.read();
      if (expired) throw new Error("timeout");
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16_384) { await reader.cancel(); throw new Error("size"); }
      parts.push(part.value);
    }
    const body = JSON.parse(new TextDecoder().decode(Buffer.concat(parts)));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("json");
    return body;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

/** @param {{ gatewayUrl?: string, token?: string, publicOrigin?: string, fetchImpl?: typeof fetch }} [options] */
export function createWorkspaceProxy({ gatewayUrl, token, publicOrigin = "https://kusari.outcomeseal.com", fetchImpl = fetch } = {}) {
  return async function proxy(request, action) {
    if (!ACTIONS.has(action)) return reply(404, { error: "Unknown workspace action" });
    if (request.method !== "POST") return reply(405, { error: "Use POST" });
    let canonical;
    try { canonical = new URL(publicOrigin); } catch { return reply(503, { error: "Workspace origin is not configured" }); }
    if (canonical.protocol !== "https:" || canonical.origin !== publicOrigin || request.headers.get("origin") !== canonical.origin || new URL(request.url).origin !== canonical.origin) {
      return reply(403, { error: "Use the official Kusari website" });
    }
    if (new URL(request.url).search) return reply(400, { error: "Query parameters are not supported" });
    let gateway;
    try {
      gateway = new URL(gatewayUrl);
      if (gateway.protocol !== "https:" || gateway.username || gateway.password || gateway.pathname !== "/" || gateway.search || gateway.hash || !token) throw new Error();
    } catch { return reply(503, { error: "Workspace runner is not configured" }); }
    let body;
    try { body = await readBody(request); }
    catch (error) { return reply(error.message === "size" ? 413 : error.message === "timeout" ? 408 : 400, { error: "Send a valid workspace request under 16 KB" }); }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    request.signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, 75_000);
    try {
      const response = await fetchImpl(new URL(`workspace/${action}`, gateway), {
        method: "POST", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: canonical.origin },
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      if (raw.length > 65_536) throw new Error("response-size");
      const result = JSON.parse(raw);
      const status = [200, 202, 400, 401, 403, 404, 408, 409, 410, 413, 429, 503].includes(response.status) ? response.status : 503;
      return reply(status, result);
    } catch { return reply(503, { error: "Workspace runner unavailable. Check activity before retrying a submitted transaction." }); }
    finally { clearTimeout(timer); request.signal.removeEventListener("abort", cancel); }
  };
}
