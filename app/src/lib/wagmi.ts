import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

import { APP_READ_RPC } from "./endpoints";

// Reads: the Anon-RPC bridge when served from the demo machine/LAN, the public RPC on a public host
// (see endpoints.ts). Transactions you sign are sent by your wallet (MetaMask etc.) through its own RPC.
const rpc = APP_READ_RPC;
export const appReadRpc = rpc;
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
