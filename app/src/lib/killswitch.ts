"use client";

import { keccak256, toHex, parseAbi, type Address } from "viem";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { deployment, ensDeployment } from "@/generated/deployment";

const ROLE_RENEW = 1n << 16n;
const registryAbi = parseAbi([
  "function revokeRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)",
  "function grantRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)",
]);
const sourceAbi = parseAbi(["function isAuthorized(address agent) view returns (bool)", "function freeze(address agent)", "function unfreeze(address agent)"]);

/** One kill switch for whichever policy source the live deployment uses (ENS on Sepolia, PolicyMirror elsewhere). */
export function useKillSwitch() {
  const ens = ensDeployment as { userRegistry: Address; agent: Address; name: string; policySource: Address } | null;
  const kind = (deployment as { policyKind?: string } | null)?.policyKind;
  const useEns = Boolean(ens && kind === "external" && deployment && ens.policySource.toLowerCase() === deployment.policySource.toLowerCase());
  const agent = (ens?.agent ?? undefined) as Address | undefined;

  const status = useReadContract({
    address: deployment?.policySource,
    abi: sourceAbi,
    functionName: "isAuthorized",
    args: agent ? [agent] : undefined,
    query: { enabled: Boolean(agent && deployment), refetchInterval: 4000 },
  });
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  const labelId = ens ? BigInt(keccak256(toHex(ens.name.split(".")[0]))) : 0n;
  const freeze = () => {
    if (!agent || !deployment) return;
    reset();
    if (useEns) writeContract({ address: ens!.userRegistry, abi: registryAbi, functionName: "revokeRoles", args: [labelId, ROLE_RENEW, agent] });
    else writeContract({ address: deployment.policySource, abi: sourceAbi, functionName: "freeze", args: [agent] });
  };
  const unfreeze = () => {
    if (!agent || !deployment) return;
    reset();
    if (useEns) writeContract({ address: ens!.userRegistry, abi: registryAbi, functionName: "grantRoles", args: [labelId, ROLE_RENEW, agent] });
    else writeContract({ address: deployment.policySource, abi: sourceAbi, functionName: "unfreeze", args: [agent] });
  };

  return {
    agent,
    name: ens?.name,
    via: useEns ? "ENS role revoke" : "PolicyMirror.freeze",
    authorized: status.data as boolean | undefined,
    freeze,
    unfreeze,
    isPending: isPending || receipt.isLoading,
    hash,
    confirmed: receipt.isSuccess,
    error,
    refetch: status.refetch,
  };
}
