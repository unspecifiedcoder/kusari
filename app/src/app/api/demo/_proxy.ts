import "server-only";

const NO_STORE = { "cache-control": "no-store, no-transform", "x-content-type-options": "nosniff" };

/** Only these public observation paths can cross the server-side credential boundary. */
export const DEMO_PATHS = new Set([
  "agent/status", "agent/events", "bridge/metrics", "bridge/events", "proxy/log", "proxy/events", "health",
]);

export async function proxyDemo(request: Request, path: string) {
  if (!DEMO_PATHS.has(path)) return Response.json({ error: "Unknown demo route" }, { status: 404, headers: NO_STORE });
  if (new URL(request.url).search) return Response.json({ error: "Query parameters are not supported" }, { status: 400, headers: NO_STORE });
  const base = process.env.KUSARI_DEMO_GATEWAY_URL;
  const token = process.env.KUSARI_DEMO_GATEWAY_TOKEN;
  if (!base || !token) return Response.json({ configured: false, error: "Live presenter is not connected" }, { status: 503, headers: NO_STORE });
  let origin: URL;
  try {
    origin = new URL(base);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Invalid gateway origin");
  } catch { return Response.json({ configured: false, error: "Live presenter configuration is unavailable" }, { status: 503, headers: NO_STORE }); }

  const abort = new AbortController();
  const cancel = () => abort.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  const deadline = setTimeout(cancel, 8000);
  try {
    const upstream = await fetch(new URL(path, origin), {
      headers: { authorization: `Bearer ${token}`, accept: path.endsWith("/events") ? "text/event-stream" : "application/json" },
      signal: abort.signal,
      cache: "no-store",
      redirect: "error",
    });
    clearTimeout(deadline);
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      abort.abort();
      request.signal.removeEventListener("abort", cancel);
      return Response.json({ error: "Live presenter is unavailable" }, { status: 503, headers: NO_STORE });
    }
    const reader = upstream.body.getReader();
    const streamDeadline = setTimeout(cancel, path.endsWith("/events") ? 30_000 : 10_000);
    const cleanup = () => {
      clearTimeout(streamDeadline);
      abort.abort();
      request.signal.removeEventListener("abort", cancel);
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const part = await reader.read();
          if (part.done) { cleanup(); controller.close(); }
          else controller.enqueue(part.value);
        } catch { cleanup(); controller.close(); }
      },
      async cancel() { cleanup(); await reader.cancel().catch(() => {}); },
    });
    return new Response(body, {
      headers: { ...NO_STORE, "content-type": path.endsWith("/events") ? "text/event-stream" : "application/json", "x-accel-buffering": "no" },
    });
  } catch {
    clearTimeout(deadline);
    abort.abort();
    request.signal.removeEventListener("abort", cancel);
    return Response.json({ error: "Live presenter is unavailable" }, { status: 503, headers: NO_STORE });
  }
}
