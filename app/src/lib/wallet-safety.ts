export const WALLET_CHAIN_ID = 11155111;

type Connector = { getProvider: () => Promise<unknown> };
type Provider = { request: (request: { method: string }) => Promise<unknown> };

export function assertAppOrigin(actualOrigin: string, expectedOrigin: string | undefined) {
  if (expectedOrigin && actualOrigin !== expectedOrigin) {
    throw new Error(`Use the official Kusari application at ${expectedOrigin} before connecting or signing.`);
  }
}

/** Read the selected wallet itself, not the app's configured public-reader chain. */
export async function assertSepoliaWallet(connector: Connector | undefined, expectedAddress: string | undefined) {
  if (typeof window !== "undefined") assertAppOrigin(window.location.origin, process.env.NEXT_PUBLIC_APP_ORIGIN);
  if (!connector || !expectedAddress) throw new Error("Connect the owner wallet before continuing.");
  const provider = await connector.getProvider() as Provider | undefined;
  if (!provider || typeof provider.request !== "function") throw new Error("Wallet network could not be verified. Reconnect your wallet.");
  const chain = await provider.request({ method: "eth_chainId" });
  if (typeof chain !== "string" || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== BigInt(WALLET_CHAIN_ID)) {
    throw new Error("Wallet is not on Sepolia (11155111). Switch networks before requesting a transaction.");
  }
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || accounts[0].toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error("The selected wallet account changed. Reconnect the intended account before continuing.");
  }
}

export async function withSepoliaWallet<T>(connector: Connector | undefined, expectedAddress: string | undefined, send: () => T | Promise<T>): Promise<T> {
  await assertSepoliaWallet(connector, expectedAddress);
  return send();
}
