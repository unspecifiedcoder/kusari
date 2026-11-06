// Shared browser/server formatter. This exact message authorizes only one fixed 2-kUSD test.
export const OWNER_POLICY_PURPOSE = 'owner-policy-check';
export const OWNER_POLICY_CHAIN_ID = 11155111;
export const OWNER_POLICY_AMOUNT = '2';
export const OWNER_POLICY_ORIGIN = 'https://kusari.outcomeseal.com';
export function buildOwnerPolicyMessage(entry) {
  return [
    'Kusari owner-authorized policy check',
    `Purpose: ${OWNER_POLICY_PURPOSE}`,
    `Origin: ${entry.origin}`,
    `Chain ID: ${OWNER_POLICY_CHAIN_ID} (Ethereum Sepolia)`,
    `Owner: ${entry.address}`,
    `Agent: ${entry.agent}`,
    `Vault: ${entry.vault}`,
    `Fixed request: ${OWNER_POLICY_AMOUNT} kUSD token0 for token1`,
    `Nonce: ${entry.nonce}`,
    `Expires at: ${new Date(entry.expiresAt).toISOString()}`,
    'Authorize exactly one deterministic 2-kUSD policy check using Kusari\'s shared funded Sepolia vault.',
    'This test does not call Gemini and is not an AI-generated decision.',
    'Your wallet sends no funds and grants no token approval. The shared agent supplies test tokens and gas.',
    'The shared agent will submit this fixed test, including a reverted transaction when the onchain policy blocks it.',
  ].join('\n');
}
