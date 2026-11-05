// Checks .env without ever printing a full secret.
// Shows first 3 + last 3 characters, length, and a format check.
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

const mask = (v) => (v.length <= 8 ? "*".repeat(v.length) : `${v.slice(0, 3)}…${v.slice(-3)}`);
const isPk = (v) => /^0x[0-9a-fA-F]{64}$/.test(v);

const CHECKS = [
  ["OWNER_PRIVATE_KEY", "wallet", isPk, "0x + 64 hex chars"],
  ["AGENT_PRIVATE_KEY", "wallet", isPk, "0x + 64 hex chars"],
  ["DEPLOYER_PRIVATE_KEY", "wallet", isPk, "0x + 64 hex chars"],
  ["ANTHROPIC_API_KEY", "secret", (v) => v.startsWith("sk-ant-") && v.length > 40, 'starts with "sk-ant-"'],
  ["NEXT_PUBLIC_REOWN_PROJECT_ID", "optional", (v) => /^[0-9a-f]{32}$/.test(v), "32 hex chars"],
  ["ETHERSCAN_API_KEY", "optional", (v) => /^[A-Z0-9]{34}$/.test(v), "34 chars, A-Z 0-9"],
  ["SEPOLIA_RPC_URL", "optional", (v) => /^https?:\/\//.test(v), "starts with https://"],
];

const addresses = {};
let problems = 0;
for (const [name, kind, valid, hint] of CHECKS) {
  const v = (process.env[name] ?? "").trim();
  if (!v) {
    console.log(`${kind === "optional" ? "·" : "✗"} ${name.padEnd(29)} empty${kind === "optional" ? " (optional)" : ""}`);
    if (kind !== "optional") problems++;
    continue;
  }
  const ok = valid(v);
  if (!ok) problems++;
  let extra = "";
  if (kind === "wallet" && ok && privateKeyToAccount) {
    addresses[name] = privateKeyToAccount(v).address;
    extra = `  -> address ${addresses[name]}`;
  }
  const shown = name === "SEPOLIA_RPC_URL" ? v.replace(/\/[^/]{12,}$/, "/…") : mask(v);
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(29)} ${shown.padEnd(10)} len ${String(v.length).padEnd(4)}${ok ? "" : ` expected ${hint}`}${extra}`);
}

const uniq = new Set(Object.values(addresses));
if (uniq.size < Object.keys(addresses).length) {
  console.log("✗ Two wallet keys are the same. Owner, agent and deployer should be different wallets.");
  problems++;
}
console.log(problems ? `\n${problems} thing(s) to fix.` : "\nAll set.");
