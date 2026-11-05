import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

// The app's reads go through the Anon-RPC bridge (reader/, :8546) on the machine serving the page, so the
// RPC provider never sees which wallet, vault or agent this browser is looking at. Phones on the same Wi-Fi
// reach the laptop's bridge (run it with ANON_BRIDGE_HOST=0.0.0.0). Server-side rendering has no browser,
// so it uses the public RPC. Override with NEXT_PUBLIC_RPC_URL (e.g. http://localhost:8545 for the fork).
// Transactions you sign are sent by your wallet (MetaMask etc.) through the wallet's own RPC.
const PUBLIC_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const rpc =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:8546` : PUBLIC_RPC);
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
