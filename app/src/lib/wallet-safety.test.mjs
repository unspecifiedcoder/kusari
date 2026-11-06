import assert from "node:assert/strict";
import test from "node:test";
import { createConfig, getChainId, getConnection, writeContract } from "@wagmi/core";
import { custom, parseAbi } from "viem";
import { sepolia } from "viem/chains";
import { withSepoliaWallet } from "./wallet-safety.ts";

// All addresses and receipts are fixtures. Every RPC goes to an in-memory stub;
// no wallet extension, private key, HTTP transport or live chain is used.
const OWNER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"a".repeat(64)}`;
const TRANSACTION_METHODS = new Set(["eth_sendTransaction", "wallet_sendTransaction"]);

function stubWallet({ providerChain = sepolia.id, account = OWNER } = {}) {
  const calls = [];
  const provider = {
    async request({ method, params }) {
      calls.push({ method, params });
      if (method === "eth_chainId") return `0x${providerChain.toString(16)}`;
      if (method === "eth_accounts") return [account];
      if (TRANSACTION_METHODS.has(method)) return HASH;
      throw new Error(`Unexpected offline RPC: ${method}`);
    },
  };
  const connector = {
    id: "offline-wallet", uid: "offline-wallet", name: "Offline wallet", type: "injected",
    getChainId: async () => providerChain,
    getAccounts: async () => [account],
    getProvider: async () => provider,
  };
  return { connector, calls };
}

function sdkFixture({ providerChain, connectionChain }) {
  const wallet = stubWallet({ providerChain });
  const config = createConfig({
    chains: [sepolia],
    transports: {
      [sepolia.id]: custom({ request: async () => { throw new Error("Public RPC must not be used by this offline test"); } }),
    },
    storage: null,
    multiInjectedProviderDiscovery: false,
  });
  config.setState((state) => ({
    ...state,
    status: "connected",
    current: wallet.connector.uid,
    connections: new Map([[wallet.connector.uid, {
      accounts: [OWNER], chainId: connectionChain, connector: wallet.connector,
    }]]),
  }));
  return { ...wallet, config };
}

const revoke = {
  chainId: sepolia.id,
  address: OTHER,
  abi: parseAbi(["function revokeRoles(uint256,uint256,address) returns (bool)"]),
  functionName: "revokeRoles",
  args: [1n, 1n, OWNER],
};
const transactionCalls = (calls) => calls.filter(({ method }) => TRANSACTION_METHODS.has(method));

test("explicit Sepolia write rejects mainnet even though configured chain reports Sepolia", async () => {
  const { config, calls } = sdkFixture({ providerChain: 1, connectionChain: 1 });
  assert.equal(getChainId(config), sepolia.id);
  assert.equal(getConnection(config).chainId, 1);
  await assert.rejects(writeContract(config, revoke));
  assert.equal(transactionCalls(calls).length, 0);
  assert.ok(calls.some(({ method }) => method === "eth_chainId"));
});

test("explicit Sepolia write rejects a mainnet provider behind stale Sepolia connection state", async () => {
  const { config, calls } = sdkFixture({ providerChain: 1, connectionChain: sepolia.id });
  assert.equal(getConnection(config).chainId, sepolia.id);
  await assert.rejects(writeContract(config, revoke));
  assert.equal(transactionCalls(calls).length, 0);
});

test("explicit Sepolia write reaches only the Sepolia stub with the expected account", async () => {
  const { config, calls } = sdkFixture({ providerChain: sepolia.id, connectionChain: sepolia.id });
  assert.equal(await writeContract(config, revoke), HASH);
  const transactions = transactionCalls(calls);
  assert.equal(transactions.length, 1);
  // viem validates eth_chainId before requesting a transaction; JSON-RPC wallet
  // transports need not include chainId in the eventual request payload.
  const sendIndex = calls.findIndex(({ method }) => TRANSACTION_METHODS.has(method));
  assert.ok(calls.slice(0, sendIndex).some(({ method }) => method === "eth_chainId"));
  assert.equal(transactions[0].params[0].from.toLowerCase(), OWNER.toLowerCase());
});

test("wallet guard rejects mainnet before invoking its send callback", async () => {
  const { connector, calls } = stubWallet({ providerChain: 1 });
  let sends = 0;
  await assert.rejects(withSepoliaWallet(connector, OWNER, async () => { sends++; return HASH; }));
  assert.equal(sends, 0);
  assert.equal(transactionCalls(calls).length, 0);
});

test("wallet guard rejects an account change before invoking its send callback", async () => {
  const { connector, calls } = stubWallet({ account: OTHER });
  let sends = 0;
  await assert.rejects(withSepoliaWallet(connector, OWNER, async () => { sends++; return HASH; }));
  assert.equal(sends, 0);
  assert.equal(transactionCalls(calls).length, 0);
  assert.ok(calls.some(({ method }) => method === "eth_accounts"));
});

test("wallet guard validates chain and account before invoking its send callback once", async () => {
  const { connector, calls } = stubWallet();
  let sends = 0;
  const result = await withSepoliaWallet(connector, OWNER, async () => {
    assert.deepEqual(calls.map(({ method }) => method), ["eth_chainId", "eth_accounts"]);
    sends++;
    return HASH;
  });
  assert.equal(result, HASH);
  assert.equal(sends, 1);
  assert.equal(transactionCalls(calls).length, 0);
});

test("an unconfigured deployment alias cannot reach the wallet provider or signing callback", async () => {
  const oldWindow = globalThis.window;
  const oldOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN;
  const { connector, calls } = stubWallet();
  let sends = 0;
  try {
    delete process.env.NEXT_PUBLIC_APP_ORIGIN;
    globalThis.window = { location: { origin: "https://kusari-demo.vercel.app" } };
    await assert.rejects(withSepoliaWallet(connector, OWNER, () => { sends++; }), /official Kusari/);
    assert.equal(calls.length, 0);
    assert.equal(sends, 0);
  } finally {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldOrigin === undefined) delete process.env.NEXT_PUBLIC_APP_ORIGIN; else process.env.NEXT_PUBLIC_APP_ORIGIN = oldOrigin;
  }
});
