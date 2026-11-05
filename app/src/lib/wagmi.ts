import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

// In local dev this points at the anvil Sepolia fork (same chain id 11155111).
const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8545";
const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [
    injected(), // MetaMask, Rabby, Brave, Coinbase extension...
    // Mobile wallets via QR. Enabled once a (free) Reown project id is set.
    ...(projectId ? [walletConnect({ projectId, showQrModal: true })] : []),
  ],
  transports: { [sepolia.id]: http(rpc) },
  ssr: true,
});

export const walletConnectEnabled = Boolean(projectId);

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
