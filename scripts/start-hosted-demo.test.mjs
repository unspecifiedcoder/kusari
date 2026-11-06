import test from "node:test";
import assert from "node:assert/strict";
import { hostedChildEnvironment, validateHostedEnvironment } from "./start-hosted-demo.mjs";

const good = { AGENT_PRIVATE_KEY: `0x${"1".repeat(64)}`, GEMINI_API_KEY: "test-only-key", KUSARI_DEMO_GATEWAY_TOKEN: "test-only-token-with-at-least-32-characters" };

test("hosted preflight rejects missing agent/model/gateway configuration without exposing secret values", () => {
  assert.doesNotThrow(() => validateHostedEnvironment(good));
  assert.throws(() => validateHostedEnvironment({ ...good, AGENT_PRIVATE_KEY: "private-value" }), /AGENT_PRIVATE_KEY runtime secret/);
  assert.throws(() => validateHostedEnvironment({ ...good, GEMINI_API_KEY: "" }), /GEMINI_API_KEY/);
  assert.throws(() => validateHostedEnvironment({ ...good, KUSARI_DEMO_GATEWAY_TOKEN: "short" }), /at least 32/);
  assert.throws(() => validateHostedEnvironment({ ...good, FLY_APP_NAME: "demo", OWNER_PRIVATE_KEY: "never-upload-this" }), /Remove owner\/deployer/);
});

test("hosted children never receive owner/deployer authority or an automatic trading loop", () => {
  const env = hostedChildEnvironment({ ...good, OWNER_PRIVATE_KEY: "owner-private", DEPLOYER_PRIVATE_KEY: "deployer-private", AGENT_LOOP_SECONDS: "1", AGENT_READ_RPC_URL: "https://public.invalid/" });
  assert.equal(env.OWNER_PRIVATE_KEY, undefined);
  assert.equal(env.DEPLOYER_PRIVATE_KEY, undefined);
  assert.equal(env.AGENT_LOOP_SECONDS, "0");
  assert.equal(env.AGENT_READ_RPC_URL, "http://127.0.0.1:8546");
  assert.equal(env.AGENT_WRITE_RPC_URL, "http://127.0.0.1:8546");
  assert.equal(env.ANON_RPC_URL, env.AGENT_READ_RPC_URL, "runtime URL classification must recognize its configured bridge as anonymous transport");
  assert.equal(env.ANON_RPC_URL, env.AGENT_WRITE_RPC_URL);
  assert.equal(env.AGENT_EVENTS_PORT, "8787");
  assert.equal(env.ANON_BRIDGE_PORT, "8546");
  assert.equal(env.LOGGING_PROXY_PORT, "8547");
  assert.equal(env.KUSARI_DEMO_GATEWAY_HOST, "127.0.0.1");
  assert.equal(hostedChildEnvironment({ ...good, KUSARI_DEMO_GATEWAY_HOST: "0.0.0.0" }).KUSARI_DEMO_GATEWAY_HOST, "0.0.0.0");
});
