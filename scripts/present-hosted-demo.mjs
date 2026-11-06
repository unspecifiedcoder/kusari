// Run through authenticated `fly ssh console`, never an internet-facing control endpoint.
import { pathToFileURL } from "node:url";

const AGENT = "http://127.0.0.1:8787";

function publicStatus(status) {
  return {
    agent: status.agent,
    vault: status.vault,
    busy: status.busy,
    injected: status.injected,
    stateStatus: status.stateStatus,
    lastStateAt: status.lastStateAt,
    readTransport: status.readTransport,
  };
}

export async function presentHostedDemo(args, {
  fetchImpl = fetch,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  timeoutMs = 180_000,
} = {}) {
  if (args.length !== 1 || !["normal", "attack", "status"].includes(args[0])) throw new Error("Usage: node scripts/present-hosted-demo.mjs normal|attack|status");
  async function request(path, method = "GET") {
    const r = await fetchImpl(`${AGENT}${path}`, { method, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`Local agent request failed (${r.status}); no further action was sent`);
    return r.json();
  }
  const before = await request("/status");
  if (args[0] === "status") return publicStatus(before);
  if (before.busy) throw new Error("Agent is already running; wait for it to finish before presenting another scenario");
  const sequence = Math.max(0, ...(before.recentEvents ?? []).map((entry) => Number(entry.id) || 0));
  await request(`/inject?on=${args[0] === "attack" ? "1" : "0"}`, "POST");
  await request("/tick", "POST");
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const status = await request("/status");
    const events = (status.recentEvents ?? []).filter((entry) => Number(entry.id) > sequence);
    if (!status.busy && events.some((entry) => entry.type === "idle")) {
      return {
        scenario: args[0],
        ...publicStatus(status),
        events: events.reverse().filter((entry) => ["decision", "swap", "error", "idle"].includes(entry.type)).map((entry) => {
          if (entry.type === "error") return { type: "error", t: entry.t, message: "Agent reported an error; inspect its private logs." };
          const result = {};
          for (const key of ["type", "t", "action", "amountIn", "status", "hash", "reason", "source"]) {
            if (entry[key] !== undefined) result[key] = entry[key];
          }
          return result;
        }),
      };
    }
    await delay(1500);
  }
  throw new Error("Scenario is still pending; inspect status before sending another command");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  presentHostedDemo(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
