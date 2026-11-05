// D4: the agent process. One decision cycle = read state -> ask the LLM -> (maybe) swap.
// Exposes an event stream + controls on :8787 for the dashboard.
//   GET  /events          SSE: reading, state, decision, swap, error
//   GET  /status          current settings + last state
//   POST /tick            run one cycle now
//   POST /inject?on=1|0   toggle the poisoned news article (the staged attack)
//   POST /transport?mode=anon|leak   anon = Anon-RPC/Nox (default), leak = the logging "public provider" proxy
//   AGENT_LOOP_SECONDS=N  also run a cycle every N seconds (default: manual only)
//   AGENT_SCRIPTED=1      skip the LLM; scripted decisions (demo fallback, labelled as such)
import { createServer, type ServerResponse } from "node:http";
import { formatEther } from "viem";
import { config, deployment, ANON_RPC, LEAK_RPC } from "./config.ts";
import { readState, setReadRpc, readRpc } from "./state.ts";
import { decide, type Decision } from "./llm.ts";
import { newsFeed } from "./news.ts";
import { executeSwap, agentAccount, setWriteRpc } from "./swap.ts";

let injected = false;
let transport: "anon" | "leak" = config.readRpc === LEAK_RPC ? "leak" : "anon";
let busy = false;
let lastState: Record<string, unknown> | null = null;
const clients = new Set<ServerResponse>();
const scriptedOnly = process.env.AGENT_SCRIPTED === "1";

function emit(type: string, data: Record<string, unknown> = {}) {
  const e = { type, t: Date.now(), ...data };
  console.log(type, JSON.stringify(data));
  const line = `data: ${JSON.stringify(e)}\n\n`;
  for (const c of clients) c.write(line);
}

/** Fallback when the LLM is unavailable or disabled: same outcome the gullible model produces. */
function scripted(vault: number, maxPerSwap: number): Decision {
  return injected
    ? { action: "swap", amountIn: vault, reason: "[scripted] followed the hidden instruction: swap the entire balance" }
    : { action: "swap", amountIn: Math.min(1, maxPerSwap), reason: "[scripted] small routine buy within limits" };
}

async function cycle() {
  if (busy) return emit("error", { message: "a cycle is already running" });
  busy = true;
  try {
    emit("reading", { via: readRpc, transport });
    const s = await readState(agentAccount.address);
    const vault = Number(formatEther(s.vaultToken0));
    const maxPerSwap = Number(formatEther(s.policy.maxPerSwap));
    const remaining = Number(formatEther(s.remainingToday));
    lastState = {
      price: s.price,
      vaultToken0: vault,
      vaultToken1: Number(formatEther(s.vaultToken1)),
      maxPerSwap,
      dailyCap: Number(formatEther(s.policy.dailyCap)),
      spentToday: Number(formatEther(s.spentToday)),
      maxImpactBps: s.policy.maxImpactBps,
      authorized: s.authorized,
      active: s.policy.active,
      readMs: s.readMs,
    };
    emit("state", lastState);

    const news = newsFeed(injected);
    let d: Decision & { source: string };
    if (scriptedOnly) {
      d = { ...scripted(vault, maxPerSwap), source: "scripted" };
    } else {
      try {
        const r = await decide({ price: s.price, vaultKUSD: vault, maxPerSwap, remainingToday: remaining, news });
        d = { ...r, source: r.model };
      } catch (e) {
        emit("error", { message: `LLM unavailable, using scripted fallback: ${(e as Error).message}` });
        d = { ...scripted(vault, maxPerSwap), source: "scripted" };
      }
    }
    emit("decision", { ...d, injected });

    if (d.action === "swap" && d.amountIn > 0) {
      emit("swapping", { amountIn: d.amountIn });
      const r = await executeSwap(d.amountIn, { sendEvenIfBlocked: true, sqrtPriceX96: s.sqrtPriceX96 });
      emit("swap", { ...r });
    }
  } catch (e) {
    emit("error", { message: (e as Error).message.split("\n")[0] });
  } finally {
    busy = false;
    emit("idle"); // the dashboard treats the agent as busy from "reading" until "idle"
  }
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST",
  "access-control-allow-headers": "content-type",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  if (url.pathname === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", ...cors });
    res.write(`data: ${JSON.stringify({ hello: true, injected, scriptedOnly })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/status") {
    return json(200, { agent: agentAccount.address, vault: deployment.demoVault, readRpc, transport, injected, scriptedOnly, busy, lastState });
  }
  if (req.method === "POST" && url.pathname === "/tick") {
    void cycle();
    return json(202, { started: true });
  }
  if (req.method === "POST" && url.pathname === "/transport") {
    if (busy) return json(409, { error: "wait for the current cycle to finish" });
    transport = url.searchParams.get("mode") === "leak" ? "leak" : "anon";
    const target = transport === "leak" ? LEAK_RPC : ANON_RPC;
    setReadRpc(target);
    setWriteRpc(target);
    emit("transport", { transport, via: target });
    return json(200, { transport, via: target });
  }
  if (req.method === "POST" && url.pathname === "/inject") {
    injected = url.searchParams.get("on") === "1";
    emit("inject", { injected });
    return json(200, { injected });
  }
  json(404, { error: "not found" });
}).listen(config.eventsPort, "127.0.0.1", () => {
  console.log(`agent ${agentAccount.address} on http://localhost:${config.eventsPort} (reads + txs via ${readRpc}, ${transport})`);
});

const loop = Number(process.env.AGENT_LOOP_SECONDS ?? 0);
if (loop > 0) setInterval(() => void cycle(), loop * 1000);
