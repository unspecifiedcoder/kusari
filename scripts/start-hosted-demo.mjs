// One backend Machine, four supervised local services. No automatic trading loop.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const NODE = process.execPath;

export function validateHostedEnvironment(env) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(env.AGENT_PRIVATE_KEY ?? "")) throw new Error("Set a valid AGENT_PRIVATE_KEY runtime secret");
  if (!env.GEMINI_API_KEY && env.AGENT_SCRIPTED !== "1") throw new Error("Set GEMINI_API_KEY, or explicitly select the labelled scripted demo");
  if ((env.KUSARI_DEMO_GATEWAY_TOKEN ?? "").length < 32) throw new Error("Set a KUSARI_DEMO_GATEWAY_TOKEN runtime secret of at least 32 characters");
  if (env.FLY_APP_NAME && (env.OWNER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY)) {
    throw new Error("Remove owner/deployer secrets from Fly; the hosted observer needs only agent authority");
  }
}

export function hostedChildEnvironment(env) {
  // Even local startup with a full project .env never delegates owner/deployer keys to child services.
  const next = { ...env };
  delete next.OWNER_PRIVATE_KEY;
  delete next.DEPLOYER_PRIVATE_KEY;
  return {
    ...next,
    ANON_BRIDGE_HOST: "127.0.0.1",
    ANON_BRIDGE_PORT: "8546",
    ANON_RPC_URL: "http://127.0.0.1:8546",
    AGENT_READ_RPC_URL: "http://127.0.0.1:8546",
    AGENT_WRITE_RPC_URL: "http://127.0.0.1:8546",
    AGENT_EVENTS_PORT: "8787",
    LEAK_RPC_URL: "http://127.0.0.1:8547",
    LOGGING_PROXY_PORT: "8547",
    AGENT_LOOP_SECONDS: "0",
    KUSARI_DEMO_GATEWAY_PORT: "8788",
    // Fly sets this to 0.0.0.0; local startup stays private by default.
    KUSARI_DEMO_GATEWAY_HOST: env.KUSARI_DEMO_GATEWAY_HOST ?? "127.0.0.1",
  };
}

async function main() {
  const envFile = new URL("../.env", import.meta.url);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  validateHostedEnvironment(process.env);
  if (!existsSync(new URL("../reader/dist/page.js", import.meta.url))) {
    throw new Error("Reader bundle is missing; run npm run build in reader/ before starting the hosted stack");
  }
  const env = hostedChildEnvironment(process.env);
  const children = [];
  let stopping = false;
  let failed = false;

  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    console.log("Stopping hosted demo services...");
    const active = [...children].reverse().filter((child) => child.exitCode === null);
    for (const child of active) {
      try {
        if (process.platform === "win32") child.kill("SIGTERM");
        else process.kill(-child.pid, "SIGTERM");
      } catch { /* Service already exited. */ }
    }
    let shutdownTimer;
    await Promise.race([
      Promise.all(active.map((child) => new Promise((resolve) => { if (child.exitCode !== null) resolve(); else child.once("exit", resolve); }))),
      new Promise((resolve) => { shutdownTimer = setTimeout(resolve, 8000); }),
    ]);
    clearTimeout(shutdownTimer);
    for (const child of active.filter((item) => item.exitCode === null)) {
      try {
        if (process.platform === "win32") spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        else process.kill(-child.pid, "SIGKILL");
      } catch { /* Service already exited. */ }
    }
  }

  const launch = (name, script) => {
    console.log(`Starting ${name}...`);
    const child = spawn(NODE, [script], { cwd: ROOT, env, stdio: "inherit", detached: process.platform !== "win32" });
    children.push(child);
    child.on("error", () => { failed = true; console.error(`${name} could not start`); void stop(1); });
    child.on("exit", (code, signal) => {
      if (!stopping) {
        failed = true;
        console.error(`${name} exited unexpectedly (${signal ?? code})`);
        void stop(1);
      }
    });
  };

  async function ready(name, url, seconds, headers = {}) {
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline && !stopping && !failed) {
      try {
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(2500) });
        await r.body?.cancel();
        if (r.ok) { console.log(`${name} ready`); return; }
      } catch { /* Service is still starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`${name} did not become ready before the startup deadline`);
  }

  process.once("SIGTERM", () => { void stop(); });
  process.once("SIGINT", () => { void stop(); });
  try {
    launch("Anon-RPC bridge", "reader/src/bridge.mjs");
    launch("logging demo proxy", "proxy/server.mjs");
    await ready("Anon-RPC bridge", "http://127.0.0.1:8546/metrics", 120);
    await ready("logging demo proxy", "http://127.0.0.1:8547/log", 15);
    launch("agent", "agent/src/runtime.ts");
    await ready("agent", "http://127.0.0.1:8787/status", 30);
    launch("read-only judge gateway", "scripts/demo-gateway.mjs");
    await ready("read-only judge gateway", "http://127.0.0.1:8788/health", 15, { authorization: `Bearer ${env.KUSARI_DEMO_GATEWAY_TOKEN}` });
    console.log("Hosted observer ready. Trade controls remain local; automatic trading is disabled.");
  } catch (error) {
    console.error(error.message);
    await stop(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
