import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(new URL("../agent/package.json", import.meta.url));
const { getAddress, isAddress, verifyMessage } = require("viem");
export const SANDBOX_CHAIN_ID = 11155111;
export const DEFAULT_SANDBOX_ORIGIN = "https://kusari.outcomeseal.com";

export class SandboxError extends Error {
  constructor(status, message, retryAfterSeconds) {
    super(message);
    this.status = status;
    if (Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0) this.retryAfterSeconds = retryAfterSeconds;
  }
}

const cooldownError = (message, remainingMs) => new SandboxError(429, message, Math.max(1, Math.ceil(remainingMs / 1000)));

export function readSandboxJson(req, maxBytes = 4096, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let size = 0;
    const chunks = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new SandboxError(408, "Sandbox request body timed out")), timeoutMs);
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) return finish(new SandboxError(413, "Sandbox request body is too large"));
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { finish(new SandboxError(400, "Invalid sandbox JSON")); }
    });
    req.on("error", () => finish(new SandboxError(400, "Sandbox request was interrupted")));
    req.on("aborted", () => finish(new SandboxError(400, "Sandbox request was interrupted")));
  });
}

function exactObject(value, fields) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}
function addressOf(value) {
  if (typeof value !== "string" || !isAddress(value)) throw new SandboxError(400, "A valid Ethereum wallet address is required");
  return getAddress(value);
}
function canonicalOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("KUSARI_DEMO_PUBLIC_ORIGIN must be an HTTPS origin without a path");
  return url.origin;
}

/** In-memory limits apply to the single running backend; a backend restart resets them. */
export function createSandboxAccess({
  origin = process.env.KUSARI_DEMO_PUBLIC_ORIGIN ?? DEFAULT_SANDBOX_ORIGIN,
  now = Date.now,
  verifySignature = ({ address, message, signature }) => verifyMessage({ address, message, signature }),
  nonceTtlMs = 120_000,
  maxNonces = 200,
  walletCooldownMs = 30_000,
  globalCooldownMs = 10_000,
  maxHourly = 20,
  maxDaily = 40,
} = {}) {
  const publicOrigin = canonicalOrigin(origin);
  const nonces = new Map();
  const walletLastRun = new Map();
  let globalLastRun = -Infinity;
  let hourlyRuns = [];
  let day = Math.floor(now() / 86_400_000);
  let dailyRuns = 0;
  let reserved = false;

  function prune() {
    const t = now();
    for (const [nonce, item] of nonces) if (item.expiresAt <= t) nonces.delete(nonce);
    for (const [wallet, last] of walletLastRun) if (t - last >= walletCooldownMs) walletLastRun.delete(wallet);
    hourlyRuns = hourlyRuns.filter((time) => t - time < 3_600_000);
    const currentDay = Math.floor(t / 86_400_000);
    if (day !== currentDay) { day = currentDay; dailyRuns = 0; }
  }
  function admit(address) {
    prune();
    if (reserved) throw new SandboxError(409, "Another sandbox admission is pending; retry shortly");
    const walletElapsed = now() - (walletLastRun.get(address) ?? -Infinity);
    if (walletElapsed < walletCooldownMs) throw cooldownError("This wallet must wait between sandbox attempts", walletCooldownMs - walletElapsed);
    if (now() - globalLastRun < globalCooldownMs) throw cooldownError("Shared sandbox cooldown; retry shortly", globalCooldownMs - (now() - globalLastRun));
    if (hourlyRuns.length >= maxHourly) throw cooldownError("Shared sandbox hourly budget reached", hourlyRuns[0] + 3_600_000 - now());
    if (dailyRuns >= maxDaily) throw cooldownError("Shared sandbox daily budget reached", (day + 1) * 86_400_000 - now());
  }
  return {
    challenge(input) {
      if (!exactObject(input, ["address", "scenario"]) || !["normal", "attack"].includes(input.scenario)) throw new SandboxError(400, "Expected address and scenario (normal or attack) only");
      const address = addressOf(input.address);
      // Reject exhausted budgets before asking a visitor to sign; run() still rechecks atomically.
      admit(address);
      if (nonces.size >= maxNonces) throw cooldownError("Too many pending challenges; retry shortly", Math.min(...[...nonces.values()].map((entry) => entry.expiresAt)) - now());
      const pendingForWallet = [...nonces.values()].filter((entry) => entry.address === address);
      if (pendingForWallet.length >= 3) throw cooldownError("This wallet already has pending challenges", Math.min(...pendingForWallet.map((entry) => entry.expiresAt)) - now());
      const nonce = `0x${randomBytes(32).toString("hex")}`;
      const expiresAt = now() + nonceTtlMs;
      const scenario = input.scenario;
      const message = [
        "Kusari shared funded testnet sandbox",
        `Origin: ${publicOrigin}`,
        `Chain ID: ${SANDBOX_CHAIN_ID} (Ethereum Sepolia)`,
        `Wallet: ${address}`,
        `Scenario: ${scenario}`,
        `Nonce: ${nonce}`,
        `Expires at: ${new Date(expiresAt).toISOString()}`,
        "Authorize one real Gemini decision cycle using Kusari's shared funded Sepolia demo vault.",
        "This signature grants no authority over your wallet funds and requests no token approval or transfer from your wallet.",
      ].join("\n");
      const entry = { nonce, message, expiresAt, address, scenario, origin: publicOrigin };
      nonces.set(nonce, entry);
      return entry;
    },
    // Same reservations and counters as browser sandbox runs; the API cannot add a second spending budget.
    async apiRun(start) {
      const address = "external-agent-api";
      admit(address); reserved = true;
      try {
        const acceptedAt = now(); prune(); walletLastRun.set(address, acceptedAt); globalLastRun = acceptedAt;
        hourlyRuns.push(acceptedAt); dailyRuns++;
        const runId = randomUUID();
        await start({ runId });
        return { requestId: runId, status: "accepted" };
      } finally { reserved = false; }
    },
    async run(input, start) {
      if (!exactObject(input, ["nonce", "address", "signature"])) throw new SandboxError(400, "Expected nonce, address and signature only");
      const address = addressOf(input.address);
      if (typeof input.nonce !== "string" || !/^0x[0-9a-f]{64}$/.test(input.nonce) || typeof input.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(input.signature)) throw new SandboxError(400, "Invalid challenge or wallet signature format");
      const entry = nonces.get(input.nonce);
      if (!entry) throw new SandboxError(409, "Challenge is missing, expired or already used; request a new one");
      // Consume before the first await: a repeated signed request cannot start a second run.
      nonces.delete(input.nonce);
      if (entry.expiresAt <= now()) throw new SandboxError(410, "Challenge expired; request a new one");
      if (entry.address !== address) throw new SandboxError(401, "Challenge belongs to another wallet");
      admit(address);
      reserved = true;
      try {
        let valid = false;
        try { valid = await verifySignature({ address, message: entry.message, signature: input.signature }); } catch { /* Invalid EIP-191 signature. */ }
        if (!valid) throw new SandboxError(401, "Wallet signature does not authorize this exact sandbox challenge");
        // A valid signed admission consumes budget even if the agent/model/transaction later fails.
        const acceptedAt = now();
        prune();
        walletLastRun.set(address, acceptedAt);
        globalLastRun = acceptedAt;
        hourlyRuns.push(acceptedAt);
        dailyRuns++;
        const runId = randomUUID();
        await start({ runId, scenario: entry.scenario });
        return { runId, started: true };
      } finally { reserved = false; }
    },
  };
}

/** Public runs fail closed: a real decision is required before any execution callback is reachable. */
export async function runRealSandboxCycle({ scenario, scripted, configuredChainId, maxPerSwap, getChainId, getAgentBalance, decide, execute, onDecision = (_decision) => {} }) {
  if (!["normal", "attack"].includes(scenario)) throw new Error("Unknown sandbox scenario");
  if (scripted) throw new Error("Public sandbox requires live Gemini; scripted mode is unavailable");
  if (configuredChainId !== SANDBOX_CHAIN_ID || await getChainId() !== SANDBOX_CHAIN_ID) throw new Error("Public sandbox is available only on Ethereum Sepolia");
  if (await getAgentBalance() < 500_000_000_000_000n) throw new Error("Sandbox agent gas reserve is low; the team must refill it");
  const decision = await decide();
  if (!decision || !["swap", "hold"].includes(decision.action) || typeof decision.amountIn !== "number" || !Number.isFinite(decision.amountIn) || decision.amountIn < 0) throw new Error("Gemini returned an invalid sandbox decision");
  if (scenario === "normal" && decision.amountIn > 1) throw new Error("Normal sandbox decisions may spend at most 1 kUSD");
  if (scenario === "attack" && decision.action === "swap" && (!Number.isFinite(maxPerSwap) || decision.amountIn <= maxPerSwap)) {
    const error = new Error("The model did not request an over-cap swap; no attack transaction was signed");
    error.name = "ModelDidNotFollowInjection";
    throw error;
  }
  onDecision(decision);
  if (decision.action === "swap" && decision.amountIn > 0) return execute(decision);
  return null;
}
