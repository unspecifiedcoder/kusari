"use client";

import { keccak256, toHex, parseAbi, type Address } from "viem";
import { useRef, useState } from "react";
import { useConnection, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { deployment, ensDeployment } from "@/generated/deployment";
import { assertSepoliaWallet, WALLET_CHAIN_ID } from "./wallet-safety";
import { useCanonicalSite } from "./canonical-site";

const ROLE_RENEW = 1n << 16n;
const registryAbi = parseAbi([
  "function revokeRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)",
  "function grantRoles(uint256 anyId, uint256 roleBitmap, address account) returns (bool)",
  "function getOwner(uint256 anyId) view returns (address)",
]);
const sourceAbi = parseAbi(["function isAuthorized(address agent) view returns (bool)", "function freeze(address agent)", "function unfreeze(address agent)"]);
const mirrorOwnerAbi = parseAbi(["function ownerOf(address agent) view returns (address)"]);

/** One kill switch for whichever policy source the live deployment uses (ENS on Sepolia, PolicyMirror elsewhere). */
export function useKillSwitch() {
  const { isCanonical, canonicalOrigin } = useCanonicalSite();
  const { address, isConnected, chainId, connector } = useConnection();
  const [preflightError, setPreflightError] = useState<Error | null>(null);
  const [checkingNetwork, setCheckingNetwork] = useState(false);
  const preflightBusy = useRef(false);
  const ens = ensDeployment as { userRegistry: Address; agent: Address; name: string; policySource: Address } | null;
  const kind = (deployment as { policyKind?: string } | null)?.policyKind;
  const useEns = Boolean(ens && kind === "external" && deployment && ens.policySource.toLowerCase() === deployment.policySource.toLowerCase());
  const agent = (ens?.agent ?? undefined) as Address | undefined;
  const labelId = ens ? BigInt(keccak256(toHex(ens.name.split(".")[0]))) : 0n;
  const ensOwner = useReadContract({ chainId: deployment.chainId, address: ens?.userRegistry, abi: registryAbi, functionName: "getOwner", args: [labelId], query: { enabled: useEns, refetchInterval: 12_000 } });
  const mirrorOwner = useReadContract({ chainId: deployment.chainId, address: deployment?.policySource, abi: mirrorOwnerAbi, functionName: "ownerOf", args: agent ? [agent] : undefined, query: { enabled: Boolean(!useEns && agent && deployment), refetchInterval: 12_000 } });
  const owner = (useEns ? ensOwner.data : mirrorOwner.data) as Address | undefined;
  const ownerError = useEns ? ensOwner.error : mirrorOwner.error;
  const isOwner = Boolean(isConnected && owner && address?.toLowerCase() === owner.toLowerCase());
  const correctChain = chainId === WALLET_CHAIN_ID && deployment.chainId === WALLET_CHAIN_ID;
  const canManage = isOwner && correctChain && isCanonical;

  const status = useReadContract({
    chainId: deployment.chainId,
    address: deployment?.policySource,
    abi: sourceAbi,
    functionName: "isAuthorized",
    args: agent ? [agent] : undefined,
    query: { enabled: Boolean(agent && deployment), refetchInterval: 4000 },
  });
  const { writeContractAsync, data: hash, isPending, error, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: WALLET_CHAIN_ID });

  const changeAuthorization = async (grant: boolean) => {
    if (!agent || !deployment || !canManage || status.data === undefined || preflightBusy.current || isPending || receipt.isLoading) return;
    preflightBusy.current = true;
    setCheckingNetwork(true);
    setPreflightError(null);
    reset();
    try {
      await assertSepoliaWallet(connector, address);
      if (useEns) await writeContractAsync({ chainId: WALLET_CHAIN_ID, account: address, connector, address: ens!.userRegistry, abi: registryAbi, functionName: grant ? "grantRoles" : "revokeRoles", args: [labelId, ROLE_RENEW, agent] });
      else await writeContractAsync({ chainId: WALLET_CHAIN_ID, account: address, connector, address: deployment.policySource, abi: sourceAbi, functionName: grant ? "unfreeze" : "freeze", args: [agent] });
    } catch (cause) {
      setPreflightError(cause instanceof Error ? cause : new Error("Wallet request failed. No authorization change was confirmed."));
    } finally {
      preflightBusy.current = false;
      setCheckingNetwork(false);
    }
  };
  const freeze = () => void changeAuthorization(false);
  const unfreeze = () => void changeAuthorization(true);

  return {
    agent,
    name: ens?.name,
    via: useEns ? "ENS role revoke" : "PolicyMirror.freeze",
    authorized: status.data as boolean | undefined,
    owner,
    isOwner,
    correctChain,
    canManage,
    isCanonical,
    canonicalOrigin,
    ownerError,
    statusError: status.error,
    freeze,
    unfreeze,
    isPending: checkingNetwork || isPending || receipt.isLoading,
    hash,
    confirmed: receipt.data?.status === "success",
    transactionFailed: receipt.data?.status === "reverted",
    error: preflightError ?? error,
    refetch: status.refetch,
  };
}
