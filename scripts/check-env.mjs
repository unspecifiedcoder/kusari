// Checks .env without printing secret material, including key prefixes/suffixes.
// For wallet keys it also shows the address the key controls (public info, safe to share).
//   node scripts/check-env.mjs
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../", import.meta.url));
if (!existsSync(root + ".env")) {
  console.log("No .env file found at the project root.");
  process.exit(1);
}
process.loadEnvFile(root + ".env");

// viem is installed in agent/; borrow it to derive addresses from private keys.
const require = createRequire(root + "agent/package.json");
let privateKeyToAccount;
try {
  ({ privateKeyToAccount } = require("viem/accounts"));
} catch {
  privateKeyToAccount = null;
}

const isPk = (v) => /^0x[0-9a-fA-F]{64}$/.test(v);
const scripted = process.env.AGENT_SCRIPTED === "1";

const CHECKS = [
  ["OWNER_PRIVATE_KEY", "wallet", isPk, "0x + 64 hex chars"],
  ["AGENT_PRIVATE_KEY", "wallet", isPk, "0x + 64 hex chars"],
  ["DEPLOYER_PRIVATE_KEY", "optional-wallet", isPk, "0x + 64 hex chars"],
  ["GEMINI_API_KEY", scripted ? "optional" : "llm", (v) => /^AIza[0-9A-Za-z_-]{35}$/.test(v), "Google Gemini API key format"],
  ["NEXT_PUBLIC_REOWN_PROJECT_ID", "optional", (v) => /^[0-9a-f]{32}$/.test(v), "32 hex chars"],
  ["ETHERSCAN_API_KEY", "optional", (v) => /^[A-Z0-9]{34}$/.test(v), "34 chars, A-Z 0-9"],
  ["SEPOLIA_RPC_URL", "optional", (v) => /^https?:\/\//.test(v), "starts with https://"],
];

const addresses = {};
let problems = 0;
if (scripted) console.log("Mode: explicitly SCRIPTED demo (not live LLM decisions).");
for (const [name, kind, valid, hint] of CHECKS) {
  const v = (process.env[name] ?? "").trim();
  if (!v) {
    const optional = kind.startsWith("optional");
    console.log(`${optional ? "·" : "✗"} ${name.padEnd(29)} empty${optional ? " (optional)" : ""}`);
    if (!optional) problems++;
    continue;
  }
  const ok = valid(v);
  if (!ok) problems++;
  let extra = "";
  if (kind.includes("wallet") && ok && privateKeyToAccount) {
    addresses[name] = privateKeyToAccount(v).address;
    extra = `  -> address ${addresses[name]}`;
  }
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(29)} present, format ${ok ? "valid" : "invalid"}${ok ? "" : `; expected ${hint}`}${extra}`);
}

// Unknown variable names can reveal typos; never show their values.
const { parseEnv } = await import("node:util");
const { readFileSync } = await import("node:fs");
const known = new Set([...CHECKS.map((c) => c[0]), "AGENT_MODEL", "AGENT_SCRIPTED", "AGENT_SLIPPAGE_BPS", "AGENT_LOOP_SECONDS", "AGENT_EVENTS_PORT", "AGENT_ADDRESS", "ENS_PARENT_NAME", "ENS_PARENT_LABEL", "ENS_AGENT_LABEL", "ENS_OUT", "DEPLOYMENT_FILE", "AGENT_READ_RPC_URL", "AGENT_WRITE_RPC_URL", "ANON_RPC_URL", "LEAK_RPC_URL", "ANON_MODE", "ANON_BRIDGE_HOST", "ANON_BRIDGE_PORT", "ANON_REQUEST_TIMEOUT_MS", "AGENT_UPSTREAM_RPC", "LOGGING_PROXY_PORT", "PROXY_UPSTREAM_RPC", "KUSARI_DEMO_GATEWAY_TOKEN", "KUSARI_DEMO_GATEWAY_URL", "KUSARI_DEMO_GATEWAY_PORT", "NEXT_PUBLIC_RPC_URL", "NEXT_PUBLIC_BRIDGE_URL", "NEXT_PUBLIC_AGENT_URL", "NEXT_PUBLIC_PROXY_URL"]);
for (const [name, value] of Object.entries(parseEnv(readFileSync(root + ".env", "utf8")))) {
  if (known.has(name)) continue;
  console.log(`? ${name.padEnd(29)} ${value ? "present" : "empty"}  (not a variable Kusari reads; typo?)`);
}

if (addresses.OWNER_PRIVATE_KEY && addresses.OWNER_PRIVATE_KEY === addresses.AGENT_PRIVATE_KEY) {
  console.log("✗ Owner and agent wallets must be different for the delegated-access demo.");
  problems++;
}
console.log(problems ? `\n${problems} thing(s) to fix.` : "\nAll set.");
process.exitCode = problems ? 1 : 0;
