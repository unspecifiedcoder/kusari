import test from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decryptAgentKey, encryptAgentKey, decryptAgentKeyWithWallet, encryptAgentKeyWithWallet, walletUnlockMessage } from "./owned-key.ts";

test("agent backup encrypts with fresh randomness and restores only with its passphrase", async () => {
  const secret = generatePrivateKey();
  const passphrase = "test-only passphrase for browser key";
  const a = await encryptAgentKey(secret, passphrase);
  const b = await encryptAgentKey(secret, passphrase);
  assert.equal(a.address, privateKeyToAccount(secret).address);
  assert.equal(JSON.stringify(a).includes(secret.slice(2)), false);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(await decryptAgentKey(a, passphrase), secret);
  await assert.rejects(decryptAgentKey(a, "incorrect passphrase"), /did not unlock/);
  await assert.rejects(encryptAgentKey(secret, "too short"), /at least 12/);
});

test("wallet-protected agent key restores with the same owner signature without storing that signature", async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const secret = generatePrivateKey();
  const agent = privateKeyToAccount(secret).address;
  const signature = await owner.signMessage({ message: walletUnlockMessage(owner.address, agent) });
  const envelope = await encryptAgentKeyWithWallet(secret, owner.address, signature);
  assert.equal(envelope.version, 2);
  assert.equal(JSON.stringify(envelope).includes(signature.slice(2)), false);
  assert.equal(JSON.stringify(envelope).includes(secret.slice(2)), false);
  assert.equal(await decryptAgentKeyWithWallet(envelope, owner.address, signature), secret);
  const parity = signature.endsWith("1b") ? "00" : "01";
  assert.equal(await decryptAgentKeyWithWallet(envelope, owner.address, `${signature.slice(0, -2)}${parity}`), secret);
});

test("wallet key protection rejects a foreign owner, changed purpose, high-s signatures and context tampering", async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const stranger = privateKeyToAccount(generatePrivateKey());
  const secret = generatePrivateKey();
  const agent = privateKeyToAccount(secret).address;
  const message = walletUnlockMessage(owner.address, agent);
  const signature = await owner.signMessage({ message });
  const envelope = await encryptAgentKeyWithWallet(secret, owner.address, signature);
  await assert.rejects(encryptAgentKeyWithWallet(secret, owner.address, await stranger.signMessage({ message })), /does not belong/);
  await assert.rejects(encryptAgentKeyWithWallet(secret, owner.address, await owner.signMessage({ message: `${message}\nDifferent purpose` })), /does not belong/);
  await assert.rejects(decryptAgentKeyWithWallet({ ...envelope, owner: stranger.address }, owner.address, signature), /does not match/);
  await assert.rejects(decryptAgentKeyWithWallet({ ...envelope, chainId: 1 }, owner.address, signature), /does not match/);
  await assert.rejects(decryptAgentKeyWithWallet({ ...envelope, origin: "https://attacker.example" }, owner.address, signature), /does not match/);
  const tampered = `${envelope.ciphertext[0] === "0" ? "1" : "0"}${envelope.ciphertext.slice(1)}`;
  await assert.rejects(decryptAgentKeyWithWallet({ ...envelope, ciphertext: tampered }, owner.address, signature), /could not unlock/);
  const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = (n - BigInt(`0x${signature.slice(66, 130)}`)).toString(16).padStart(64, "0");
  const malleated = `${signature.slice(0, 66)}${highS}${signature.endsWith("1b") ? "1c" : "1b"}`;
  await assert.rejects(encryptAgentKeyWithWallet(secret, owner.address, malleated), /non-canonical/);
});

test("agent backup authenticates ciphertext, address and version before use", async () => {
  const encrypted = await encryptAgentKey(generatePrivateKey(), "test-only passphrase for browser key");
  const altered = (encrypted.ciphertext[0] === "0" ? "1" : "0") + encrypted.ciphertext.slice(1);
  await assert.rejects(decryptAgentKey({ ...encrypted, ciphertext: altered }, "test-only passphrase for browser key"), /did not unlock/);
  await assert.rejects(decryptAgentKey({ ...encrypted, address: privateKeyToAccount(generatePrivateKey()).address }, "test-only passphrase for browser key"), /did not unlock/);
  await assert.rejects(decryptAgentKey({ ...encrypted, version: 2 }, "test-only passphrase for browser key"), /not valid/);
});
