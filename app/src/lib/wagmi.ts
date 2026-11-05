import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

// Live Sepolia by default. For the local anvil fork set NEXT_PUBLIC_RPC_URL=http://localhost:8545.
const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
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
