import { deployment, deploymentFile, sepoliaConfig } from "@/generated/deployment";

const REPO = "https://github.com/unspecifiedcoder/kusari";
const explorer = (sepoliaConfig as { explorer?: string }).explorer ?? "https://sepolia.etherscan.io";

export function SiteFooter() {
  const contracts = deployment
    ? [
        { label: "Policy hook", addr: deployment.policyHook },
        { label: "Vault factory", addr: deployment.vaultFactory },
        { label: "Policy source", addr: deployment.policySource },
      ]
    : [];
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 text-xs text-faint sm:px-6 md:flex-row md:items-center md:justify-between">
        <p>
          Kusari 鎖 · on Sepolia testnet · test tokens only
          {deployment ? <span className="hidden sm:inline"> · contracts from <span className="font-mono">{deploymentFile}</span></span> : " · not deployed yet"}
        </p>
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          {contracts.map((c) => (
            <li key={c.label}>
              <a href={`${explorer}/address/${c.addr}`} target="_blank" rel="noreferrer" className="hover:text-fg" title={c.addr}>
                {c.label} <span className="font-mono">{c.addr.slice(0, 6)}…</span>
              </a>
            </li>
          ))}
          <li>
            <a href={REPO} target="_blank" rel="noreferrer" className="hover:text-fg">
              Source on GitHub
            </a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
