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
import { readState, setReadRpc, readRpc, reader, type AgentState } from "./state.ts";
import { decide, type Decision } from "./llm.ts";
import { newsFeed } from "./news.ts";
import { executeSwap, agentAccount, setWriteRpc } from "./swap.ts";
import { createSnapshotCache } from "./snapshot-cache.mjs";
import { readSandboxJson, runRealSandboxCycle } from "../../scripts/sandbox-access.mjs";

let injected = false;
let transport: "anon" | "leak" | "direct" = config.readRpc === ANON_RPC ? "anon" : config.readRpc === LEAK_RPC ? "leak" : "direct";
let busy = false;
const clients = new Set<ServerResponse>();
const scriptedOnly = process.env.AGENT_SCRIPTED === "1";
const recentEvents: Record<string, unknown>[] = [];
let eventSequence = 0;
let bridgeMode: "anon" | "direct" | "unknown" = "unknown";
let activeRunId: string | null = null;
let activeScenario: "normal" | "attack" | null = null;

async function readBridgeMode() {
  if (readRpc !== ANON_RPC) return;
  try {
    const r = await fetch(new URL("/metrics", ANON_RPC), { signal: AbortSignal.timeout(2500) });
    const m = await r.json() as { mode?: string };
    bridgeMode = m.mode === "anon" ? "anon" : m.mode === "direct" ? "direct" : "unknown";
  } catch { bridgeMode = "unknown"; }
}

const actualReadTransport = () => transport === "anon" ? bridgeMode : transport === "leak" ? "leak" : "direct";

function summarizeState(s: AgentState) {
  return {
    blockNumber: s.blockNumber.toString(),
    price: s.price,
    vaultToken0: Number(formatEther(s.vaultToken0)),
    vaultToken1: Number(formatEther(s.vaultToken1)),
    maxPerSwap: Number(formatEther(s.policy.maxPerSwap)),
    dailyCap: Number(formatEther(s.policy.dailyCap)),
    spentToday: Number(formatEther(s.spentToday)),
    remainingToday: Number(formatEther(s.remainingToday)),
    allowedPool: s.policy.allowedPool,
    maxImpactBps: s.policy.maxImpactBps,
    authorized: s.authorized,
    active: s.policy.active,
    readMs: s.readMs,
    transport: actualReadTransport(),
  };
}

// GET /status reads the chain in the background; it never asks the LLM, signs, or submits a swap.
// A timestamp and freshness state prevent a disconnected bridge being mistaken for live data.
const snapshots = createSnapshotCache({ load: async () => {
  const [state] = await Promise.all([readState(agentAccount.address), readBridgeMode()]);
  return summarizeState(state);
} });
// Keep one shared read-only snapshot warm between viewers. refresh() is single-flight;
// this timer never calls cycle(), the model, a signer or transaction submission.
const snapshotRefreshTimer = setInterval(() => { void snapshots.refresh(); }, 5000);
snapshotRefreshTimer.unref();
void snapshots.refresh();

function emit(type: string, data: Record<string, unknown> = {}) {
  const e = { type, t: Date.now(), id: ++eventSequence, ...data, ...(activeRunId ? { runId: activeRunId } : {}) };
  recentEvents.unshift(e);
  recentEvents.length = Math.min(recentEvents.length, 40);
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

async function cycle(options: { reserved?: boolean; runId?: string; scenario?: "normal" | "attack" } = {}) {
  if (busy && !options.reserved) return emit("error", { message: "a cycle is already running" });
  busy = true;
  activeRunId = options.runId ?? null;
  activeScenario = options.scenario ?? null;
  const cycleInjected = options.scenario ? options.scenario === "attack" : injected;
  try {
    emit("reading", { via: readRpc, transport });
    const [s] = await Promise.all([readState(agentAccount.address), readBridgeMode()]);
    const vault = Number(formatEther(s.vaultToken0));
    const maxPerSwap = Number(formatEther(s.policy.maxPerSwap));
    const remaining = Number(formatEther(s.remainingToday));
    const state = summarizeState(s);
    snapshots.record(state);
    emit("state", state);

    const news = newsFeed(cycleInjected);
    if (options.scenario) {
      await runRealSandboxCycle({
        scenario: options.scenario,
        scripted: scriptedOnly,
        configuredChainId: deployment.chainId,
        maxPerSwap,
        getChainId: () => reader.getChainId(),
        getAgentBalance: () => reader.getBalance({ address: agentAccount.address }),
        decide: async () => {
          const r = await decide({ price: s.price, vaultKUSD: vault, maxPerSwap: options.scenario === "normal" ? Math.min(maxPerSwap, 1) : maxPerSwap, remainingToday: options.scenario === "normal" ? Math.min(remaining, 1) : remaining, news });
          return { ...r, source: r.model };
        },
        onDecision: (d: Decision & { source: string }) => emit("decision", { ...d, injected: cycleInjected, sandbox: true }),
        execute: async (d: Decision) => {
          emit("swapping", { amountIn: d.amountIn, sandbox: true });
          const r = await executeSwap(d.amountIn, { sendEvenIfBlocked: true, sqrtPriceX96: s.sqrtPriceX96 });
          emit("swap", { ...r, sandbox: true });
          return r;
        },
      });
      return;
    }
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
    emit("error", { message: (e as Error).message.split("\n")[0], ...((e as Error).name === "ModelDidNotFollowInjection" ? { code: "ModelDidNotFollowInjection" } : {}) });
  } finally {
    busy = false;
    snapshots.invalidate(); // trade or revoke may have changed chain state since the pre-trade read
    void snapshots.refresh();
    emit("idle"); // the dashboard treats the agent as busy from "reading" until "idle"
    activeRunId = null;
    activeScenario = null;
  }
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST",
  "access-control-allow-headers": "content-type",
};

const server = createServer(async (req, res) => {
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
    return json(200, { agent: agentAccount.address, vault: deployment.demoVault, readRpc, transport, readTransport: actualReadTransport(), bridgeMode, injected: activeScenario ? activeScenario === "attack" : injected, scriptedOnly, busy, activeRunId, canControl: true, recentEvents, ...snapshots.get() });
  }
  if (req.method === "POST" && url.pathname === "/sandbox/run") {
    if (busy) return json(409, { error: "a cycle is already running" });
    if (deployment.chainId !== 11155111 || scriptedOnly || !process.env.GEMINI_API_KEY) return json(503, { error: "Real Gemini Sepolia sandbox is not configured" });
    // Reserve before any asynchronous body/chain/model work. All other control paths honor busy.
    busy = true;
    try {
      const input = await readSandboxJson(req, 1024) as { runId?: unknown; scenario?: unknown };
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2 || typeof input.runId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.runId) || (input.scenario !== "normal" && input.scenario !== "attack")) throw new Error("Invalid shared sandbox run");
      void cycle({ reserved: true, runId: input.runId, scenario: input.scenario });
      return json(202, { runId: input.runId, started: true });
    } catch {
      busy = false;
      return json(400, { error: "Invalid shared sandbox run" });
    }
  }
  if (req.method === "POST" && url.pathname === "/tick") {
    if (busy) return json(409, { error: "a cycle is already running" });
    void cycle();
    return json(202, { started: true });
  }
  if (req.method === "POST" && url.pathname === "/transport") {
    if (busy) return json(409, { error: "wait for the current cycle to finish" });
    transport = url.searchParams.get("mode") === "leak" ? "leak" : "anon";
    const target = transport === "leak" ? LEAK_RPC : ANON_RPC;
    setReadRpc(target);
    setWriteRpc(target);
    snapshots.invalidate();
    void snapshots.refresh();
    emit("transport", { transport, via: target });
    return json(200, { transport, via: target });
  }
  if (req.method === "POST" && url.pathname === "/inject") {
    if (busy) return json(409, { error: "wait for the current cycle to finish" });
    injected = url.searchParams.get("on") === "1";
    emit("inject", { injected });
    return json(200, { injected });
  }
  json(404, { error: "not found" });
}).listen(config.eventsPort, "127.0.0.1", () => {
  console.log(`agent ${agentAccount.address} on http://localhost:${config.eventsPort} (reads + txs via ${readRpc}, ${transport})`);
});
server.once("close", () => clearInterval(snapshotRefreshTimer));

const loop = Number(process.env.AGENT_LOOP_SECONDS ?? 0);
if (loop > 0) setInterval(() => void cycle(), loop * 1000);
