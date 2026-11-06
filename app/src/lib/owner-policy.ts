import { encodeAbiParameters, parseAbi, parseEther, type Address, type Hex } from "viem";
import { buildOwnerPolicyMessage, OWNER_POLICY_PURPOSE } from "../generated/owner-policy-message.mjs";

export const sharedOwnerRegistryAbi = parseAbi([
  "function getOwner(uint256 id) view returns(address)",
  "function getResolver(string label) view returns(address)",
]);
export const sharedOwnerResolverAbi = parseAbi(["function setData(bytes name,string key,bytes value)"]);
export const sharedOwnerIdentityAbi = parseAbi([
  "function registry() view returns(address)",
  "function bindingOf(address agent) view returns((string label,bytes dnsName,bytes32 node))",
]);
export function assertSharedENSIdentity(registry: Address, binding: { label: string; dnsName: Hex; node: Hex }, expected: { registry: Address; label: string; dnsName: Hex; node: Hex }) {
  if (registry.toLowerCase() !== expected.registry.toLowerCase() || binding.label !== expected.label || binding.dnsName.toLowerCase() !== expected.dnsName.toLowerCase() || binding.node.toLowerCase() !== expected.node.toLowerCase()) throw new Error("The agent’s ENS binding or registry changed. These shared controls cannot edit a different identity.");
}
export type SharedPolicy = { maxPerSwap: bigint; dailyCap: bigint; maxImpactBps: number; allowedPool: Hex; active: boolean };
const policyParameters = [{ type: "tuple", components: [
  { name: "maxPerSwap", type: "uint128" }, { name: "dailyCap", type: "uint128" },
  { name: "maxImpactBps", type: "uint16" }, { name: "allowedPool", type: "bytes32" }, { name: "active", type: "bool" },
] }] as const;

/** Change this one field only; preserve the actual daily limit, impact, pool and active flag. */
export function encodeSharedCapPolicy(policy: SharedPolicy, cap: "1" | "5", poolId: Hex) {
  if (cap !== "1" && cap !== "5") throw new Error("This demonstration changes the cap only to 1 or 5 kUSD.");
  if (policy.allowedPool.toLowerCase() !== poolId.toLowerCase() || policy.dailyCap <= 0n || policy.dailyCap >= 2n ** 128n || !Number.isInteger(policy.maxImpactBps) || policy.maxImpactBps < 1 || policy.maxImpactBps > 10000) throw new Error("The live ENS policy could not be verified. Refresh before editing it.");
  const maxPerSwap = parseEther(cap);
  if (maxPerSwap > policy.dailyCap) throw new Error("The daily allowance is smaller than the selected per-trade cap.");
  return encodeAbiParameters(policyParameters, [{ ...policy, maxPerSwap }]);
}

export type OwnerPolicyChallenge = { address: Address; origin: string; agent: Address; vault: Address; chainId: number; amountIn: string; purpose: string; nonce: Hex; expiresAt: number; message: string };
export function validateOwnerPolicyChallenge(value: unknown, expected: { owner: Address; agent: Address; vault: Address; origin: string }, now = Date.now()): asserts value is OwnerPolicyChallenge {
  if (!value || typeof value !== "object") throw new Error("No valid owner policy-check challenge was returned.");
  const c = value as OwnerPolicyChallenge;
  if (c.address?.toLowerCase() !== expected.owner.toLowerCase() || c.agent?.toLowerCase() !== expected.agent.toLowerCase() || c.vault?.toLowerCase() !== expected.vault.toLowerCase() || c.origin !== expected.origin || c.chainId !== 11155111 || c.amountIn !== "2" || c.purpose !== OWNER_POLICY_PURPOSE || typeof c.nonce !== "string" || !/^0x[0-9a-f]{64}$/.test(c.nonce) || !Number.isSafeInteger(c.expiresAt) || c.expiresAt <= now || c.expiresAt > now + 180_000 || c.message !== buildOwnerPolicyMessage(c)) throw new Error("The fixed test's owner, site, chain, vault, amount or exact signing message does not match. No signature was requested.");
}
