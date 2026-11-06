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
import { formatEther, parseEther } from "viem";
import { config, deployment, ANON_RPC, LEAK_RPC } from "./config.ts";
import { readState, setReadRpc, readRpc, reader, type AgentState } from "./state.ts";
import { decide, type Decision } from "./llm.ts";
import { newsFeed } from "./news.ts";
import { executeSwap, agentAccount, setWriteRpc, writeRpc } from "./swap.ts";
import { createOwnerPolicyJobs, OwnerPolicyError } from "../../scripts/owner-policy-check.mjs";
import { readOwnerPolicyContext } from "./owner-policy-context.ts";
import { createSharedTradeJobs, TradeApiError, tradeRequestId } from "../../scripts/api-trade.mjs";
import { createWorkspaceService, WorkspaceError } from "./workspace.ts";
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

const apiTradeJobs = createSharedTradeJobs({
  execute: async (input: { amountIn: string; reason?: string; minAmountOut?: string }, onSubmitted: (hash: `0x${string}`) => void) => {
    activeRunId = null; activeScenario = null;
    try {
      if (deployment.chainId !== 11155111 || readRpc !== ANON_RPC || writeRpc !== ANON_RPC) throw new Error("External-agent API requires Sepolia and pinned Anon-RPC");
      await readBridgeMode();
      if (bridgeMode !== "anon" || await reader.getChainId() !== 11155111) throw new Error("External-agent API requires an observed Nox anonymous route on Sepolia");
      if (await reader.getBalance({ address: agentAccount.address }) < 500_000_000_000_000n) throw new Error("Shared agent gas reserve is low");
      emit("reading", { transport: "anon", api: true });
      const state = await readState(agentAccount.address);
      emit("state", summarizeState(state));
      emit("decision", { action: "swap", amountIn: Number(input.amountIn), reason: input.reason ?? "Requested by an external agent through the bounded demo API", source: "external-agent", injected: false, api: true });
      emit("swapping", { amountIn: Number(input.amountIn), api: true });
      const result = await executeSwap(Number(input.amountIn), { sendEvenIfBlocked: true, sqrtPriceX96: state.sqrtPriceX96, amountInWei: parseEther(input.amountIn), ...(input.minAmountOut === undefined ? {} : { minAmountOut: BigInt(input.minAmountOut) }), onSubmitted });
      emit("swap", { ...result, api: true });
      return result;
    } finally {
      busy = false; snapshots.invalidate(); void snapshots.refresh(); emit("idle");
    }
  },
  readReceipt: async (hash: `0x${string}`) => {
    if (readRpc !== ANON_RPC) throw new Error("API receipt reads require Anon-RPC");
    await readBridgeMode();
    if (bridgeMode !== "anon" || await reader.getChainId() !== 11155111) throw new Error("API receipt route is unavailable");
    return reader.getTransactionReceipt({ hash });
  },
});

const ownerPolicyJobs = createOwnerPolicyJobs({
  execute: async (owner: string, callbacks: { onState: (state: unknown) => void; onSubmitted: (hash: `0x${string}`) => void }) => {
    activeScenario = null;
    try {
      if (readRpc !== ANON_RPC || writeRpc !== ANON_RPC) throw new OwnerPolicyError(503, "Fixed owner checks require pinned Anon-RPC");
      const context = await readOwnerPolicyContext(agentAccount.address);
      if (context.owner.toLowerCase() !== owner.toLowerCase()) throw new OwnerPolicyError(403, "ENS ownership changed before execution");
      if (await reader.getBalance({ address: agentAccount.address }) < 500_000_000_000_000n) throw new OwnerPolicyError(503, "Shared agent gas reserve is low");
      emit("reading", { transport: "anon", ownerPolicyCheck: true });
      const state = await readState(agentAccount.address);
      callbacks.onState({ limit: formatEther(state.policy.maxPerSwap), observedAt: Date.now() });
      emit("state", summarizeState(state));
      emit("decision", { action: "swap", amountIn: 2, reason: "Fixed owner-authorized policy check. Deterministic request; no Gemini call.", source: "owner-policy-check", deterministic: true, ownerPolicyCheck: true, injected: false });
      emit("swapping", { amountIn: 2, ownerPolicyCheck: true });
      const result = await executeSwap(2, { sendEvenIfBlocked: true, sqrtPriceX96: state.sqrtPriceX96, amountInWei: parseEther("2"), onSubmitted: callbacks.onSubmitted });
      emit("swap", { ...result, ownerPolicyCheck: true });
      return result;
    } finally {
      busy = false; snapshots.invalidate(); void snapshots.refresh(); emit("idle"); activeRunId = null;
    }
  },
  readReceipt: async (hash: `0x${string}`) => {
    if (readRpc !== ANON_RPC) throw new Error("Policy check receipt reads require Anon-RPC");
    await readBridgeMode();
    if (bridgeMode !== "anon" || await reader.getChainId() !== 11155111) throw new Error("Policy check receipt route is unavailable");
    return reader.getTransactionReceipt({ hash });
  },
});

const workspaceService = createWorkspaceService();

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
  if (req.method === "GET" && url.pathname === "/policy-check/owner") {
    try {
      if (readRpc !== ANON_RPC || writeRpc !== ANON_RPC) throw new OwnerPolicyError(503, "Fixed owner checks require pinned Anon-RPC");
      return json(200, { ...await readOwnerPolicyContext(agentAccount.address), busy });
    } catch (error) { return json(error instanceof OwnerPolicyError ? error.status : 503, { error: error instanceof OwnerPolicyError ? error.message : "Live ENS owner could not be verified" }); }
  }
  if (req.method === "POST" && url.pathname === "/policy-check/run") {
    if (busy) return json(409, { error: "Shared agent is busy; wait for its current run" });
    busy = true;
    try {
      const input = await readSandboxJson(req, 1024) as { requestId: string; owner: string };
      if (!input || typeof input.owner !== "string" || !tradeRequestId(input.requestId) || Object.keys(input).length !== 2) throw new OwnerPolicyError(400, "Invalid fixed owner check request");
      if (readRpc !== ANON_RPC || writeRpc !== ANON_RPC) throw new OwnerPolicyError(503, "Fixed owner checks require pinned Anon-RPC");
      const context = await readOwnerPolicyContext(agentAccount.address);
      if (context.owner.toLowerCase() !== input.owner.toLowerCase()) throw new OwnerPolicyError(403, "The signer is no longer the ENS owner");
      activeRunId = input.requestId;
      return json(202, ownerPolicyJobs.accept(input));
    } catch (error) { busy = false; activeRunId = null; return json(error instanceof OwnerPolicyError ? error.status : 503, { error: error instanceof OwnerPolicyError ? error.message : "Owner policy check could not be verified" }); }
  }
  if (req.method === "POST" && url.pathname === "/policy-check/result") {
    try { return json(200, await ownerPolicyJobs.result(await readSandboxJson(req, 1024))); }
    catch (error) { return json(error instanceof OwnerPolicyError ? error.status : 503, { error: error instanceof OwnerPolicyError ? error.message : "Owner policy check result unavailable" }); }
  }
  if (req.method === "POST" && url.pathname === "/api-trade/run") {
    if (busy) return json(409, { error: "Shared agent is busy; retry after its current run" });
    busy = true;
    try {
      const input = await readSandboxJson(req, 2048);
      return json(202, apiTradeJobs.accept(input));
    } catch (error) {
      busy = false;
      return json(error instanceof TradeApiError ? error.status : 400, { error: error instanceof TradeApiError ? error.message : "Invalid external-agent trade request" });
    }
  }
  if (req.method === "GET" && url.pathname.startsWith("/api-trade/")) {
    const id = url.pathname.slice("/api-trade/".length);
    if (!tradeRequestId(id)) return json(400, { error: "Invalid trade request ID" });
    try { return json(200, await apiTradeJobs.status(id)); }
    catch (error) { return json(error instanceof TradeApiError ? error.status : 503, { error: error instanceof TradeApiError ? error.message : "Trade status is unavailable" }); }
  }
  if (req.method === "POST" && url.pathname.startsWith("/workspace/")) {
    try {
      const input = await readSandboxJson(req, 16_384);
      const action = url.pathname.slice("/workspace/".length);
      const result = await workspaceService.handle(action, input);
      return json(action === "prepare" ? 202 : 200, result);
    } catch (error) {
      return json(error instanceof WorkspaceError ? error.status : 503, { error: error instanceof WorkspaceError ? error.message : "Owned workspace service is unavailable; no completed trade is confirmed." });
    }
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
