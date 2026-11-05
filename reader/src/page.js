// Runs inside headless Chromium. Boots one Anon-RPC worker (Nox) and exposes
// window.anonRpc(body) / window.directRpc(body) for the Node side to call.
import { AnonRpcWorker } from "@anon-rpc/browser-harness";

const params = new URLSearchParams(location.search);
const UPSTREAM = params.get("upstream"); // the RPC the anonymized request is delivered to
const BOOTSTRAP = params.get("bootstrap"); // reads the worker specifier once (not anonymized; disclosed)
const SPECIFIER = params.get("specifier");

const post = (url, body) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const rpcProvider = {
  request: async ({ method, params }) => {
    const res = await (await post(BOOTSTRAP, { jsonrpc: "2.0", id: 1, method, params })).json();
    if (res.error) throw new Error(res.error.message);
    return res.result;
  },
};

const worker = new AnonRpcWorker({ address: SPECIFIER, preExisting: { rpcProvider } });

window.anonReady = worker.ready.then(
  () => ({ ok: true }),
  (e) => ({ ok: false, error: String(e?.message ?? e) }),
);

async function timed(fn) {
  const t0 = performance.now();
  try {
    const res = await fn();
    return { ok: true, ms: Math.round(performance.now() - t0), body: await res.json() };
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - t0), error: String(e?.message ?? e) };
  }
}

window.anonRpc = (body) =>
  timed(() => worker.fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
window.directRpc = (body) => timed(() => post(UPSTREAM, body));
