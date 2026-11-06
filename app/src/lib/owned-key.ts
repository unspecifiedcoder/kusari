import { isHex, parseSignature, recoverMessageAddress, serializeSignature, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

type EncryptedFields = { salt: string; iv: string; ciphertext: string; address: Address };
export type PassphraseAgentKey = EncryptedFields & { version: 1 };
export type WalletAgentKey = EncryptedFields & { version: 2; unlock: "wallet-signature-v1"; owner: Address; origin: "https://kusari.outcomeseal.com"; chainId: 11155111 };
export type EncryptedAgentKey = PassphraseAgentKey | WalletAgentKey;
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const bytes = (value: string) => Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));

async function derive(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as BufferSource, iterations: 310_000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptAgentKey(privateKey: Hex, passphrase: string): Promise<PassphraseAgentKey> {
  if (passphrase.length < 12) throw new Error("Use a passphrase of at least 12 characters.");
  const address = privateKeyToAccount(privateKey).address;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(address.toLowerCase()) }, key, new TextEncoder().encode(privateKey));
  return { version: 1, salt: hex(salt), iv: hex(iv), ciphertext: hex(new Uint8Array(ciphertext)), address };
}

export async function decryptAgentKey(encrypted: EncryptedAgentKey, passphrase: string): Promise<Hex> {
  if (encrypted.version !== 1 || !/^[0-9a-f]{32}$/.test(encrypted.salt) || !/^[0-9a-f]{24}$/.test(encrypted.iv) || !/^[0-9a-f]+$/.test(encrypted.ciphertext)) throw new Error("This agent-key backup is not valid.");
  try {
    const key = await derive(passphrase, bytes(encrypted.salt));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(encrypted.iv) as BufferSource, additionalData: new TextEncoder().encode(encrypted.address.toLowerCase()) }, key, bytes(encrypted.ciphertext) as BufferSource);
    const privateKey = new TextDecoder().decode(plain);
    if (!isHex(privateKey) || privateKey.length !== 66 || privateKeyToAccount(privateKey).address.toLowerCase() !== encrypted.address.toLowerCase()) throw new Error("Address mismatch");
    return privateKey;
  } catch {
    throw new Error("The passphrase did not unlock this agent. Check it and try again.");
  }
}

const WALLET_KEY_ORIGIN = "https://kusari.outcomeseal.com";
const CURVE_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** Constructed locally, never received from the relay and never used as run authorization. */
export function walletUnlockMessage(owner: Address, agent: Address) {
  return ["Kusari — unlock my local testnet agent", `Origin: ${WALLET_KEY_ORIGIN}`, "Chain ID: 11155111 (Sepolia)", `Owner: ${owner.toLowerCase()}`, `Agent: ${agent.toLowerCase()}`, "Purpose: derive an encryption key for this browser's restricted agent key.", "This is not a trade, transfer, token approval or run authorization.", "This signature stays in this browser. Never share it or send it to a server."].join("\n");
}

function walletContext(owner: Address, agent: Address) {
  return JSON.stringify({ version: 2, purpose: "kusari-local-agent-key", origin: WALLET_KEY_ORIGIN, chainId: 11155111, owner: owner.toLowerCase(), agent: agent.toLowerCase() });
}

async function walletEncryptionKey(signature: Hex, owner: Address, agent: Address, salt: Uint8Array) {
  if (!isHex(signature) || signature.length !== 132) throw new Error("This wallet did not return a supported EOA message signature.");
  const parsed = parseSignature(signature);
  if (BigInt(parsed.s) > CURVE_N / 2n) throw new Error("This wallet returned a non-canonical signature. Use the same EOA wallet that created this agent.");
  const normalized = serializeSignature({ r: parsed.r, s: parsed.s, yParity: parsed.yParity });
  const signer = await recoverMessageAddress({ message: walletUnlockMessage(owner, agent), signature: normalized });
  if (signer.toLowerCase() !== owner.toLowerCase()) throw new Error("The wallet signature does not belong to this agent's owner.");
  const material = await crypto.subtle.importKey("raw", bytes(normalized.slice(2)) as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", salt: salt as BufferSource, hash: "SHA-256", info: new TextEncoder().encode(walletContext(owner, agent)) }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptAgentKeyWithWallet(privateKey: Hex, owner: Address, signature: Hex): Promise<WalletAgentKey> {
  const address = privateKeyToAccount(privateKey).address;
  if (address.toLowerCase() === owner.toLowerCase()) throw new Error("The restricted agent must have a separate key from the owner.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await walletEncryptionKey(signature, owner, address, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(walletContext(owner, address)) }, key, new TextEncoder().encode(privateKey));
  return { version: 2, unlock: "wallet-signature-v1", owner, address, origin: WALLET_KEY_ORIGIN, chainId: 11155111, salt: hex(salt), iv: hex(iv), ciphertext: hex(new Uint8Array(ciphertext)) };
}

export async function decryptAgentKeyWithWallet(encrypted: WalletAgentKey, owner: Address, signature: Hex): Promise<Hex> {
  if (encrypted.version !== 2 || encrypted.unlock !== "wallet-signature-v1" || encrypted.origin !== WALLET_KEY_ORIGIN || encrypted.chainId !== 11155111 || encrypted.owner.toLowerCase() !== owner.toLowerCase() || !/^[0-9a-f]{32}$/.test(encrypted.salt) || !/^[0-9a-f]{24}$/.test(encrypted.iv) || !/^[0-9a-f]+$/.test(encrypted.ciphertext)) throw new Error("The encrypted agent record does not match this wallet, origin and Sepolia.");
  const key = await walletEncryptionKey(signature, owner, encrypted.address, bytes(encrypted.salt));
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(encrypted.iv) as BufferSource, additionalData: new TextEncoder().encode(walletContext(owner, encrypted.address)) }, key, bytes(encrypted.ciphertext) as BufferSource);
    const privateKey = new TextDecoder().decode(plain);
    if (!isHex(privateKey) || privateKey.length !== 66 || privateKeyToAccount(privateKey).address.toLowerCase() !== encrypted.address.toLowerCase()) throw new Error("Address mismatch");
    return privateKey;
  } catch {
    throw new Error("This signature could not unlock the agent. Use the same EOA wallet and signing method used at creation. Some wallets do not reproduce stable signatures; your owner wallet can still withdraw vault funds.");
  }
}
