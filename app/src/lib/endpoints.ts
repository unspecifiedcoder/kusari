// Where the app finds the chain and the local demo services, depending on where the page is served from.
//
// - On the demo machine (localhost) or a phone on the same Wi-Fi (private IP): reads go through the
//   Anon-RPC bridge on that machine (:8546), and /demo talks to the local agent, bridge and proxy.
// - On a public host (e.g. Vercel): there is no bridge, so reads use the public RPC (disclosed in the UI),
//   and /demo shows a notice instead of live panels. The live demo runs on the team's machine.
// Every URL can be overridden with NEXT_PUBLIC_* env vars.

export const PUBLIC_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

const isPrivateHost = (h: string) =>
  h === "localhost" ||
  h === "127.0.0.1" ||
  h === "[::1]" ||
  /^10\./.test(h) ||
  /^192\.168\./.test(h) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
  h.endsWith(".local");

const browser = typeof window !== "undefined";
const host = browser ? window.location.hostname : "";

/** True when the page is served from the demo machine or the LAN, so the local services are reachable. */
export const isLocalDemo = browser && isPrivateHost(host);

const local = (port: number) => `http://${host}:${port}`;

export const ANON_BRIDGE = process.env.NEXT_PUBLIC_BRIDGE_URL ?? (isLocalDemo ? local(8546) : "");
export const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? (isLocalDemo ? local(8787) : "");
export const PROXY_URL = process.env.NEXT_PUBLIC_PROXY_URL ?? (isLocalDemo ? local(8547) : "");

/** RPC for the app's reads. Writes you sign go through your wallet's own RPC. */
export const APP_READ_RPC = process.env.NEXT_PUBLIC_RPC_URL ?? (ANON_BRIDGE || PUBLIC_RPC);
export const readsViaAnonRpc = APP_READ_RPC === ANON_BRIDGE && ANON_BRIDGE !== "";
