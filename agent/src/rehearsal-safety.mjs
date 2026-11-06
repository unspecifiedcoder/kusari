// Pure rehearsal guards: no keys, RPC clients or transaction submission live here.
export class RehearsalSafetyError extends Error {}

const sameAddress = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

export function assertDeploymentAccounts({ agent, owner, expectedAgent, expectedOwner, vaultAgent, vaultOwner, nameOwner, chainId, readerChainId, policySource, expectedPolicySource }) {
  if (chainId !== 11155111 || readerChainId !== 11155111) throw new RehearsalSafetyError("Rehearsal requires Sepolia for both owner and agent RPCs; no transaction was sent.");
  if (!sameAddress(agent, expectedAgent) || !sameAddress(agent, vaultAgent)) throw new RehearsalSafetyError("AGENT_PRIVATE_KEY does not control the original deployed demo agent; no transaction was sent.");
  if (!sameAddress(owner, expectedOwner) || !sameAddress(owner, vaultOwner) || !sameAddress(owner, nameOwner)) throw new RehearsalSafetyError("OWNER_PRIVATE_KEY does not control the original demo vault and current ENS name; no transaction was sent.");
  if (!sameAddress(policySource, expectedPolicySource)) throw new RehearsalSafetyError("Deployment and ENS policy source do not match; no transaction was sent.");
}

/** Mark immediately before attempting a role transaction, so an ambiguous receipt still triggers recovery. */
export async function withAuthorizationRestoration({ initiallyAuthorized, readAuthorized, restoreAuthorization }, run) {
  let mutationAttempted = false;
  let restorationConfirmed = false;
  const markMutationAttempt = () => {
    if (!initiallyAuthorized) throw new RehearsalSafetyError("The agent was not initially authorized; rehearsal will not grant it new access.");
    mutationAttempted = true;
    restorationConfirmed = false;
  };
  // Only the caller's confirmed recovery receipt plus successful state verification may set this.
  const markRestorationConfirmed = () => {
    if (!mutationAttempted) throw new RehearsalSafetyError("Authorization recovery was marked without a preceding mutation attempt.");
    restorationConfirmed = true;
  };
  try {
    return await run(markMutationAttempt, markRestorationConfirmed);
  } finally {
    if (mutationAttempted && !restorationConfirmed) {
      // A read may still show the original state while a submitted revoke is pending. Always
      // enqueue recovery after an unconfirmed mutation; a stale read cannot prove it unnecessary.
      try {
        await restoreAuthorization(initiallyAuthorized);
        if ((await readAuthorized()) !== initiallyAuthorized) throw new Error("Authorization did not recover");
      } catch {
        throw new RehearsalSafetyError("Authorization recovery could not be verified. Check the agent's ENS authorization before another run.");
      }
    }
  }
}
