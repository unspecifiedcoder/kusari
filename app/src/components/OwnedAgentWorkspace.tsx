"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useConnection, usePublicClient, useSendTransaction, useSignMessage } from "wagmi";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData, encodePacked, formatEther, keccak256, namehash, parseEther, parseUnits, stringToHex, type Address, type Hex } from "viem";
import { deployment, ensDeployment, ownAgentDeployment, sepoliaConfig } from "@/generated/deployment";
import { factoryAbi, policyHookReadAbi, policySourceAbi, tokenAbi, vaultAbi } from "@/lib/abi";
import { assertSepoliaWallet } from "@/lib/wallet-safety";
import { useCanonicalSite } from "@/lib/canonical-site";
import { decryptAgentKey, decryptAgentKeyWithWallet, encryptAgentKeyWithWallet, walletUnlockMessage, type EncryptedAgentKey } from "@/lib/owned-key";
import { atomicCoordinatorAbi, ownedProxyAbi, ownedRegistrarAbi, ownedRegistryAbi, ownedResolverAbi, ownedSourceAbi, signWorkspaceRun, workspaceApi, type WorkspaceRun } from "@/lib/owned-agent";

type Policy = { maxPerSwap: bigint; dailyCap: bigint; maxImpactBps: number; allowedPool: Hex; active: boolean };
type SavedWorkspace = { version: 1; id: string; owner: Address; agent: Address; title: string; key: EncryptedAgentKey; onboarding?: "atomic-v1"; coordinator?: Address; resolver?: Address; label?: string; vault?: Address; perSwap: string; daily: string; impact: string; transactions: { label: string; hash: Hex }[]; runs?: WorkspaceRun[] };
type Snapshot = { resolver: boolean; claimed: boolean; published: boolean; bound: boolean; authorized: boolean; vault?: Address; balance?: bigint; outputBalance?: bigint; agentGas?: bigint; spent?: bigint; policy?: Policy };
const emptySnapshot: Snapshot = { resolver: false, claimed: false, published: false, bound: false, authorized: false };
const ROLE = 1n << 16n;
const explorer = "https://sepolia.etherscan.io";
const config = ownAgentDeployment as { registrar: Address; atomicCoordinator?: Address; personalVaultFactory?: Address } | null;
const ZERO = "0x0000000000000000000000000000000000000000";
const AGENT_GAS = parseEther("0.0001");
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const fmt = (value?: bigint) => value === undefined ? "Not read" : Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 5 });
const storageKey = (owner: string) => `kusari:owned:v1:${owner.toLowerCase()}`;
const dns = (name: string): Hex => stringToHex(name.split(".").map((label) => String.fromCharCode(label.length) + label).join("") + "\0");
const parentName = ensDeployment.name.split(".").slice(1).join(".");
const resolverSalt = (workspace: SavedWorkspace) => BigInt(keccak256(encodePacked(["string", "address", "address"], ["kusari.owned.resolver.v1", workspace.owner, workspace.agent])));
const agentLabel = (owner: Address, agent: Address) => `a-${keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }], [owner, agent])).slice(2, 42)}`;
const steps = ["Deploy your policy resolver", "Claim your ENS agent name", "Publish your spending policy", "Bind your agent to ENS", "Authorize your agent", "Create your vault"];
const details = ["Only your owner wallet receives resolver editing permissions.", "Your wallet owns a unique label in the Kusari ENSv2 namespace.", "Save the per-trade, daily and price-impact limits on ENS.", "Tell the policy hook where your agent’s owner and policy live.", "Grant only the marker role used to permit guarded trades.", "Your wallet is the only owner that can withdraw from this vault."];

function fullName(workspace: SavedWorkspace) { return workspace.label ? `${workspace.label}.${parentName}` : "Name assigned when you claim"; }
function policyFor(workspace: SavedWorkspace): Policy {
  const maxPerSwap = parseEther(workspace.perSwap);
  const dailyCap = parseEther(workspace.daily);
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(workspace.impact)) throw new Error("Use a price impact percentage with at most two decimal places, from 0.01% to 10%.");
  const maxImpactBps = Number(parseUnits(workspace.impact, 2));
  if (maxPerSwap <= 0n || maxPerSwap > parseEther("1000") || dailyCap < maxPerSwap || dailyCap > parseEther("10000") || !Number.isInteger(maxImpactBps) || maxImpactBps < 1 || maxImpactBps > 1000) throw new Error("Set a per-trade cap from 0 to 1,000 kUSD, a daily cap at least that large (up to 10,000), and price impact from 0.01% to 10%.");
  return { maxPerSwap, dailyCap, maxImpactBps, allowedPool: deployment.poolId, active: true };
}
const policyParameters = [{ type: "tuple", components: [{ name: "maxPerSwap", type: "uint128" }, { name: "dailyCap", type: "uint128" }, { name: "maxImpactBps", type: "uint16" }, { name: "allowedPool", type: "bytes32" }, { name: "active", type: "bool" }] }] as const;

export function OwnedAgentWorkspace() {
  const { address, connector, chainId, isConnected } = useConnection();
  const { isCanonical } = useCanonicalSite();
  const publicClient = usePublicClient({ chainId: deployment.chainId });
  const { sendTransactionAsync } = useSendTransaction();
  const { signMessageAsync } = useSignMessage();
  const [workspaces, setWorkspaces] = useState<SavedWorkspace[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [loadedOwner, setLoadedOwner] = useState<string>();
  const [privateKey, setPrivateKey] = useState<Hex>();
  const [passphrase, setPassphrase] = useState("");
  const [title, setTitle] = useState("My trading agent");
  const [creating, setCreating] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastRead, setLastRead] = useState("");
  const [deposit, setDeposit] = useState("25");
  const [gasAmount, setGasAmount] = useState("0.0001");
  const [scenario, setScenario] = useState<"normal" | "attack">("normal");
  const [run, setRun] = useState<WorkspaceRun>();
  const [newPerSwap, setNewPerSwap] = useState("5");
  const [newDaily, setNewDaily] = useState("100");
  const [newImpact, setNewImpact] = useState("2");
  const [ownerFunding, setOwnerFunding] = useState<{ balance: bigint; feeBudget: bigint; required: bigint; gasBudget: bigint; checkedAt: string }>();
  const [fundingError, setFundingError] = useState("");
  const [ownerBalance, setOwnerBalance] = useState<bigint>();
  const pendingAgentKey = useRef<{ owner: Address; key: Hex } | undefined>(undefined);
  const current = workspaces.find((workspace) => workspace.id === selectedId);
  const ownerMatches = Boolean(current && address?.toLowerCase() === current.owner.toLowerCase());
  const canWrite = Boolean(isConnected && chainId === deployment.chainId && isCanonical && ownerMatches);
  const activeTask = useRef(false);
  const refreshGeneration = useRef(0);
  const currentRef = useRef(current);
  const connectedOwner = useRef(address);
  const connectedChain = useRef(chainId);
  const contextEpoch = useRef(0);
  useLayoutEffect(() => {
    currentRef.current = current;
    connectedOwner.current = address;
    connectedChain.current = chainId;
  }, [current, address, chainId]);
  useLayoutEffect(() => {
    contextEpoch.current += 1;
  }, [address, chainId, selectedId, connector?.uid]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Account changes synchronize encrypted browser storage and immediately clear the previous owner's unlocked key.
    setPrivateKey(undefined); setPassphrase(""); setSnapshot(emptySnapshot); setRun(undefined); setError(""); setMessage(""); setCreating(false);
    if (!address) { setWorkspaces([]); setSelectedId(undefined); setLoadedOwner(undefined); return; }
    try {
      const records = JSON.parse(localStorage.getItem(storageKey(address)) ?? "[]") as SavedWorkspace[];
      const valid = Array.isArray(records) ? records.filter((record) => record.version === 1 && record.owner?.toLowerCase() === address.toLowerCase() && record.agent === record.key?.address) : [];
      setWorkspaces(valid); setSelectedId(valid[0]?.id); setLoadedOwner(address.toLowerCase());
    } catch { setWorkspaces([]); setSelectedId(undefined); setLoadedOwner(address.toLowerCase()); setError("Your browser’s workspace record could not be read. Import a saved recovery backup to recover it."); }
  }, [address]);

  function draftKey(owner: Address) {
    if (!pendingAgentKey.current || pendingAgentKey.current.owner.toLowerCase() !== owner.toLowerCase()) pendingAgentKey.current = { owner, key: generatePrivateKey() };
    return pendingAgentKey.current.key;
  }

  async function readOwnerFunding(owner: Address, agent?: Address, policy?: Policy) {
    if (!publicClient) throw new Error("The Sepolia reader is unavailable.");
    const balance = await publicClient.getBalance({ address: owner });
    if (connectedOwner.current?.toLowerCase() === owner.toLowerCase()) setOwnerBalance(balance);
    if (!config?.atomicCoordinator) throw new Error("The simplified onboarding contract is not configured yet.");
    const chosenAgent = agent ?? privateKeyToAccount(draftKey(owner)).address;
    const chosenPolicy = policy ?? policyFor({ perSwap: newPerSwap, daily: newDaily, impact: newImpact } as SavedWorkspace);
    const fees = await publicClient.estimateFeesPerGas();
    const price = fees.maxFeePerGas ?? fees.gasPrice;
    if (price === undefined || price <= 0n) throw new Error("Sepolia fee data is unavailable. Refresh funding before creating an agent.");
    const call = { account: owner, address: config.atomicCoordinator, abi: atomicCoordinatorAbi, functionName: "create", args: [chosenAgent, chosenPolicy.maxPerSwap, chosenPolicy.dailyCap, chosenPolicy.maxImpactBps], value: AGENT_GAS } as const;
    let estimate: bigint;
    try { estimate = await publicClient.estimateContractGas(call); }
    catch {
      // Estimate hypothetical funded execution where supported; the real balance is still checked separately.
      try { estimate = await publicClient.estimateContractGas({ ...call, stateOverride: [{ address: owner, balance: parseEther("1") }] }); }
      catch { throw new Error(balance < AGENT_GAS ? "Add Sepolia ETH using the faucet, then refresh funding. Your wallet cannot cover the agent's 0.0001 ETH gas balance yet; no signature was requested." : "Sepolia could not estimate this setup transaction. Refresh funding to retry before signing."); }
    }
    const gasBudget = (estimate * 120n + 99n) / 100n;
    if (gasBudget > 16_000_000n) throw new Error("The estimated setup gas is unusually high. No signature was requested; retry once the network is stable.");
    const feeBudget = gasBudget * price;
    return { balance, feeBudget, required: AGENT_GAS + feeBudget, gasBudget, checkedAt: new Date().toLocaleTimeString() };
  }

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A changed wallet invalidates the external balance/fee observation before any signature is enabled.
    setOwnerFunding(undefined); setOwnerBalance(undefined); setFundingError("");
    if (!address || !publicClient) return;
    const check = async () => {
      try { const funding = await readOwnerFunding(address); if (!cancelled) { setOwnerFunding(funding); setFundingError(""); } }
      catch (cause) { if (!cancelled) { setOwnerFunding(undefined); setFundingError(explain(cause)); } }
    };
    void check();
    const interval = setInterval(() => void check(), 20_000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only owner and draft limits change the externally observed setup call; renders and fee observations do not restart its polling.
  }, [address, publicClient, newPerSwap, newDaily, newImpact]);

  async function checkOwnerFunding(owner: Address, agent?: Address, policy?: Policy) {
    const funding = await readOwnerFunding(owner, agent, policy);
    if (connectedOwner.current?.toLowerCase() !== owner.toLowerCase()) throw new Error("The connected wallet changed. Refresh funding for the intended wallet.");
    setOwnerFunding(funding);
    if (funding.balance < funding.required) throw new Error("Your owner wallet needs Sepolia ETH before setup. Use the ETHGlobal testnet faucet below, then refresh funding; or try the funded shared demo.");
  }

  function save(workspace: SavedWorkspace) {
    if (loadedOwner !== workspace.owner.toLowerCase() || connectedOwner.current?.toLowerCase() !== workspace.owner.toLowerCase()) throw new Error("The connected owner changed. Reconnect the workspace owner.");
    const records = JSON.parse(localStorage.getItem(storageKey(workspace.owner)) ?? "[]") as SavedWorkspace[];
    const next = [...records.filter((item) => item.id !== workspace.id), workspace];
    localStorage.setItem(storageKey(workspace.owner), JSON.stringify(next));
    setWorkspaces(next); setSelectedId(workspace.id); currentRef.current = workspace;
  }
  function assertCurrent(workspace: SavedWorkspace) {
    if (currentRef.current?.id !== workspace.id || connectedOwner.current?.toLowerCase() !== workspace.owner.toLowerCase()) throw new Error("The owner or workspace changed. No further agent action will be signed.");
    if (connectedChain.current !== deployment.chainId) throw new Error("The wallet network changed. Switch back to Sepolia before continuing.");
  }
  function rememberRun(workspace: SavedWorkspace, result: WorkspaceRun) {
    assertCurrent(workspace);
    const latest = currentRef.current!;
    save({ ...latest, runs: [...(latest.runs ?? []).filter((item) => item.runId !== result.runId), result].slice(-10) });
    setRun(result);
  }

  async function onchainIdentity(workspace: SavedWorkspace) {
    if (!publicClient) throw new Error("The Sepolia reader is unavailable.");
    if (workspace.onboarding === "atomic-v1") {
      if (!config?.atomicCoordinator || !config.personalVaultFactory || workspace.coordinator?.toLowerCase() !== config.atomicCoordinator.toLowerCase()) throw new Error("This workspace does not match the configured onboarding contract.");
      const [vault, resolver, label] = await publicClient.readContract({ address: config.atomicCoordinator, abi: atomicCoordinatorAbi, functionName: "workspaceOf", args: [workspace.owner, workspace.agent] });
      const expectedLabel = agentLabel(workspace.owner, workspace.agent);
      if (label && label !== expectedLabel) throw new Error("The onboarding contract returned an unexpected ENS name.");
      return { resolver: resolver === ZERO ? undefined : resolver, label: expectedLabel, factory: config.personalVaultFactory, vault: vault === ZERO ? undefined : vault };
    }
    const resolver = await publicClient.readContract({ address: sepoliaConfig.ens.verifiableFactory, abi: ownedProxyAbi, functionName: "predictProxyAddress", args: [workspace.owner, resolverSalt(workspace)] });
    return { resolver, label: agentLabel(workspace.owner, workspace.agent), factory: deployment.vaultFactory, vault: undefined };
  }

  async function refresh(workspace = currentRef.current) {
    if (!workspace || !publicClient) return;
    const generation = ++refreshGeneration.current;
    const next: Snapshot = { ...emptySnapshot };
    const identity = await onchainIdentity(workspace);
    const predictedResolver = identity.resolver;
    workspace = { ...workspace, resolver: predictedResolver, label: identity.label };
    const code = predictedResolver ? await publicClient.getCode({ address: predictedResolver }) : undefined;
    if (code && code !== "0x") {
      const implementation = await publicClient.readContract({ address: sepoliaConfig.ens.verifiableFactory, abi: ownedProxyAbi, functionName: "verifyContract", args: [predictedResolver!] });
      next.resolver = implementation.toLowerCase() === sepoliaConfig.ens.permissionedResolverImpl.toLowerCase();
    }
    if (workspace.label) {
      const [owner, resolver, binding, policy, authorized, vaults] = await Promise.all([
        publicClient.readContract({ address: ensDeployment.userRegistry, abi: ownedRegistryAbi, functionName: "getOwner", args: [BigInt(keccak256(stringToHex(workspace.label)))] }).catch(() => undefined),
        publicClient.readContract({ address: ensDeployment.userRegistry, abi: ownedRegistryAbi, functionName: "getResolver", args: [workspace.label] }).catch(() => undefined),
        publicClient.readContract({ address: deployment.policySource, abi: ownedSourceAbi, functionName: "bindingOf", args: [workspace.agent] }),
        publicClient.readContract({ address: deployment.policySource, abi: policySourceAbi, functionName: "policyOf", args: [workspace.agent] }),
        publicClient.readContract({ address: deployment.policySource, abi: policySourceAbi, functionName: "isAuthorized", args: [workspace.agent] }),
        publicClient.readContract({ address: identity.factory, abi: factoryAbi, functionName: "vaultsOf", args: [workspace.owner] }),
      ]);
      next.claimed = owner?.toLowerCase() === workspace.owner.toLowerCase() && resolver?.toLowerCase() === workspace.resolver?.toLowerCase();
      next.bound = binding.label === workspace.label && binding.node === namehash(fullName(workspace)) && binding.dnsName === dns(fullName(workspace));
      next.policy = policy;
      const expected = policyFor(workspace);
      next.published = next.bound && policy.active && policy.maxPerSwap === expected.maxPerSwap && policy.dailyCap === expected.dailyCap && policy.maxImpactBps === expected.maxImpactBps && policy.allowedPool === expected.allowedPool;
      next.authorized = authorized;
      // Before binding, read the actual ENSIP-10 record. Saved transaction hashes are never completion flags.
      if (!next.bound && workspace.resolver && next.claimed) {
        const resolved = await publicClient.readContract({ address: workspace.resolver, abi: ownedResolverAbi, functionName: "resolve", args: [dns(fullName(workspace)), encodeFunctionData({ abi: ownedResolverAbi, functionName: "data", args: [namehash(fullName(workspace)), "kusari.policy"] })] }).catch(() => undefined);
        if (resolved) {
          try { const raw = decodeAbiParameters([{ type: "bytes" }], resolved)[0]; next.published = raw === encodeAbiParameters(policyParameters, [expected]); } catch { next.published = false; }
        }
      }
      for (const vault of [...vaults].reverse()) {
        const agent = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "agent" });
        if (agent.toLowerCase() === workspace.agent.toLowerCase()) { next.vault = vault; break; }
      }
    }
    if (next.vault) {
      const [balance, outputBalance, agentGas, spent] = await Promise.all([
        publicClient.readContract({ address: deployment.token0, abi: tokenAbi, functionName: "balanceOf", args: [next.vault] }),
        publicClient.readContract({ address: deployment.token1, abi: tokenAbi, functionName: "balanceOf", args: [next.vault] }),
        publicClient.getBalance({ address: workspace.agent }),
        publicClient.readContract({ address: deployment.policyHook, abi: policyHookReadAbi, functionName: "spentOn", args: [workspace.agent, BigInt(Math.floor(Date.now() / 86_400_000))] }),
      ]);
      next.balance = balance; next.outputBalance = outputBalance; next.agentGas = agentGas; next.spent = spent;
    }
    if (generation === refreshGeneration.current && currentRef.current?.id === workspace.id && connectedOwner.current?.toLowerCase() === workspace.owner.toLowerCase()) {
      setSnapshot(next); setLastRead(new Date().toLocaleTimeString());
      const latest = currentRef.current;
      if (connectedOwner.current?.toLowerCase() === workspace.owner.toLowerCase() && latest && (latest.resolver !== workspace.resolver || latest.label !== workspace.label || (next.vault && latest.vault !== next.vault))) save({ ...latest, resolver: workspace.resolver, label: workspace.label, vault: next.vault ?? latest.vault });
    }
    return next;
  }

  useEffect(() => {
    const savedRuns = currentRef.current?.runs ?? [];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Selection changes synchronize the external saved workspace and clear its predecessor's key and chain snapshot.
    setSnapshot(emptySnapshot); setRun(savedRuns[savedRuns.length - 1]); setPrivateKey(undefined); setPassphrase("");
    if (!selectedId) return;
    void refresh().catch((cause) => setError(`Chain state could not be refreshed: ${explain(cause)}`));
    // A selection is the boundary for this agent's key, chain snapshot and result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function perform(task: () => Promise<void>) {
    if (activeTask.current) return;
    activeTask.current = true; setBusy(true); setError(""); setMessage("");
    try { await task(); } catch (cause) { setError(explain(cause)); } finally { activeTask.current = false; setBusy(false); }
  }

  async function sendOwner(workspace: SavedWorkspace, to: Address, data?: Hex, value = 0n, label = "Owner transaction") {
    if (!publicClient || currentRef.current?.id !== workspace.id || !ownerMatches) throw new Error("Select the workspace owner’s wallet before continuing.");
    await assertSepoliaWallet(connector, workspace.owner);
    setMessage(`Confirm “${label}” in your wallet on Sepolia.`);
    const hash = await sendTransactionAsync({ chainId: deployment.chainId, account: workspace.owner, connector, to, data, value });
    // A wallet/account switch during confirmation must never attach this transaction to another workspace.
    const records = JSON.parse(localStorage.getItem(storageKey(workspace.owner)) ?? "[]") as SavedWorkspace[];
    const original = records.find((item) => item.id === workspace.id) ?? workspace;
    const checkpoint = { ...original, transactions: [...original.transactions, { label, hash }] };
    localStorage.setItem(storageKey(workspace.owner), JSON.stringify([...records.filter((item) => item.id !== workspace.id), checkpoint]));
    if (currentRef.current?.id !== workspace.id || connectedOwner.current?.toLowerCase() !== workspace.owner.toLowerCase()) throw new Error(`The owner account changed after submission. The transaction is saved in the original owner’s workspace: ${hash}`);
    setWorkspaces((previous) => previous.map((item) => item.id === workspace.id ? checkpoint : item)); currentRef.current = checkpoint;
    setMessage(`Waiting for Sepolia to confirm “${label}”…`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`“${label}” reverted on Sepolia. Open the transaction below to inspect it, then retry.`);
    if (currentRef.current?.id !== workspace.id || connectedOwner.current?.toLowerCase() !== workspace.owner.toLowerCase()) throw new Error("The owner account changed. Reconnect the original owner and refresh the saved transaction’s chain state.");
    setMessage(`Confirmed: ${label}.`);
    return hash;
  }

  async function createAgent() {
    const epoch = contextEpoch.current;
    if (!address || !isCanonical || chainId !== deployment.chainId || !config?.atomicCoordinator || !config.personalVaultFactory) throw new Error("Connect your wallet on Sepolia before creating an agent.");
    if (!title.trim()) throw new Error("Give your agent a workspace name.");
    const candidate = draftKey(address);
    const account = privateKeyToAccount(candidate);
    const owner = address;
    const policyDraft = { perSwap: newPerSwap, daily: newDaily, impact: newImpact } as SavedWorkspace;
    policyFor(policyDraft);
    await checkOwnerFunding(owner, account.address, policyFor(policyDraft));
    if (contextEpoch.current !== epoch) throw new Error("The connected wallet changed. Start again with the intended owner.");
    await assertSepoliaWallet(connector, owner);
    setMessage("First, sign a local key-protection message in your wallet. It stays in this browser and does not authorize a transfer.");
    const signature = await signMessageAsync({ connector, account: owner, message: walletUnlockMessage(owner, account.address) });
    if (contextEpoch.current !== epoch || connectedOwner.current?.toLowerCase() !== owner.toLowerCase()) throw new Error("The wallet changed. Start again with the intended owner.");
    const key = await encryptAgentKeyWithWallet(candidate, owner, signature);
    if (contextEpoch.current !== epoch) throw new Error("The owner context changed while protecting this key. Start again.");
    const workspace: SavedWorkspace = { version: 1, id: account.address.toLowerCase(), owner, agent: account.address, title: title.trim().slice(0, 60), key, onboarding: "atomic-v1", coordinator: config.atomicCoordinator, label: agentLabel(owner, account.address), perSwap: newPerSwap, daily: newDaily, impact: newImpact, transactions: [] };
    save(workspace); setCreating(false); pendingAgentKey.current = undefined;
    await finishAtomicSetup(workspace);
    assertCurrent(workspace);
    setPrivateKey(candidate);
    setMessage("Your agent is ready. Your wallet owns its ENS policy and vault, and the vault has 25 test kUSD. Choose a request below.");
  }

  async function finishAtomicSetup(workspace = currentRef.current) {
    if (!workspace || workspace.onboarding !== "atomic-v1" || !config?.atomicCoordinator || workspace.coordinator?.toLowerCase() !== config.atomicCoordinator.toLowerCase()) throw new Error("This workspace is not configured for the simplified setup.");
    const identity = await onchainIdentity(workspace);
    assertCurrent(workspace);
    if (identity.vault) { await refresh(); setMessage("Your agent's setup is already confirmed. Unlock it with your wallet to run a request."); return; }
    await checkOwnerFunding(workspace.owner, workspace.agent, policyFor(workspace));
    const policy = policyFor(workspace);
    setMessage("Confirm one Sepolia transaction to create your agent's ENS policy and vault, add 25 test kUSD, and send 0.0001 Sepolia ETH to its gas balance.");
    await sendOwner(workspace, config.atomicCoordinator, encodeFunctionData({ abi: atomicCoordinatorAbi, functionName: "create", args: [workspace.agent, policy.maxPerSwap, policy.dailyCap, policy.maxImpactBps] }), parseEther("0.0001"), "Create my agent");
    await refresh();
  }

  const completed = [snapshot.resolver, snapshot.claimed, snapshot.published, snapshot.bound, snapshot.authorized, Boolean(snapshot.vault)];
  // A revoked completed agent is managed in owner controls, not sent through onboarding again.
  const onboardingComplete = Boolean(snapshot.vault && snapshot.claimed && snapshot.bound && snapshot.policy?.active);
  const nextStep = completed.findIndex((done) => !done);

  async function continueSetup() {
    const workspace = currentRef.current;
    if (!workspace || !publicClient || !config) throw new Error("The owned-agent registrar is not configured. The shared demo remains available.");
    if (!canWrite) throw new Error("Connect the workspace owner on Sepolia before continuing.");
    const step = nextStep;
    if (step === 0) {
      const data = encodeFunctionData({ abi: ownedResolverAbi, functionName: "initialize", args: [[{ account: workspace.owner, roleBitmap: BigInt(`0x${"1".repeat(64)}`) }], []] });
      const salt = resolverSalt(workspace);
      const resolver = await publicClient.readContract({ address: sepoliaConfig.ens.verifiableFactory, abi: ownedProxyAbi, functionName: "predictProxyAddress", args: [workspace.owner, salt] });
      save({ ...workspace, resolver });
      await sendOwner(currentRef.current!, sepoliaConfig.ens.verifiableFactory, encodeFunctionData({ abi: ownedProxyAbi, functionName: "deployProxy", args: [sepoliaConfig.ens.permissionedResolverImpl, salt, data] }), 0n, steps[0]);
    } else if (step === 1) {
      const label = await publicClient.readContract({ address: config.registrar, abi: ownedRegistrarAbi, functionName: "labelFor", args: [workspace.owner, workspace.agent] });
      save({ ...workspace, label });
      await sendOwner(currentRef.current!, config.registrar, encodeFunctionData({ abi: ownedRegistrarAbi, functionName: "claim", args: [workspace.agent, workspace.resolver!] }), 0n, steps[1]);
    } else if (step === 2) {
      await publishPolicy(workspace);
    } else if (step === 3) {
      await sendOwner(workspace, deployment.policySource, encodeFunctionData({ abi: ownedSourceAbi, functionName: "bind", args: [workspace.agent, workspace.label!, dns(fullName(workspace)), namehash(fullName(workspace))] }), 0n, steps[3]);
    } else if (step === 4) {
      await changeRole(true);
    } else if (step === 5) {
      await sendOwner(workspace, deployment.vaultFactory, encodeFunctionData({ abi: factoryAbi, functionName: "create", args: [workspace.agent] }), 0n, steps[5]);
    }
    await refresh();
  }

  async function publishPolicy(workspace = currentRef.current) {
    if (!workspace?.resolver || !workspace.label) throw new Error("Claim your name before publishing its policy.");
    await verifyName(workspace);
    const encoded = encodeAbiParameters(policyParameters, [policyFor(workspace)]);
    await sendOwner(workspace, workspace.resolver, encodeFunctionData({ abi: ownedResolverAbi, functionName: "setData", args: [dns(fullName(workspace)), "kusari.policy", encoded] }), 0n, steps[2]);
  }
  async function changeRole(grant: boolean) {
    const workspace = currentRef.current;
    if (!workspace?.label) throw new Error("No agent name is selected.");
    await verifyName(workspace);
    await sendOwner(workspace, ensDeployment.userRegistry, encodeFunctionData({ abi: ownedRegistryAbi, functionName: grant ? "grantRoles" : "revokeRoles", args: [BigInt(keccak256(stringToHex(workspace.label))), ROLE, workspace.agent] }), 0n, grant ? steps[4] : "Freeze this agent");
    await refresh();
  }
  async function verifyName(workspace: SavedWorkspace) {
    if (!publicClient) throw new Error("The Sepolia reader is unavailable.");
    const label = agentLabel(workspace.owner, workspace.agent);
    const resolver = (await onchainIdentity(workspace)).resolver;
    if (!resolver) throw new Error("Create this agent before changing its policy.");
    const [owner, currentResolver, implementation] = await Promise.all([
      publicClient.readContract({ address: ensDeployment.userRegistry, abi: ownedRegistryAbi, functionName: "getOwner", args: [BigInt(keccak256(stringToHex(label)))] }),
      publicClient.readContract({ address: ensDeployment.userRegistry, abi: ownedRegistryAbi, functionName: "getResolver", args: [label] }),
      publicClient.readContract({ address: sepoliaConfig.ens.verifiableFactory, abi: ownedProxyAbi, functionName: "verifyContract", args: [resolver] }),
    ]);
    assertCurrent(workspace);
    if (workspace.label !== label || workspace.resolver?.toLowerCase() !== resolver.toLowerCase() || owner.toLowerCase() !== workspace.owner.toLowerCase() || currentResolver.toLowerCase() !== resolver.toLowerCase() || implementation.toLowerCase() !== sepoliaConfig.ens.permissionedResolverImpl.toLowerCase()) throw new Error("This name or resolver no longer matches your owned agent. Refresh chain state before continuing.");
  }
  async function fund(action: "tokens" | "gas" | "withdraw" | "withdrawOutput") {
    const workspace = currentRef.current;
    const vault = snapshot.vault;
    if (!workspace || !vault) throw new Error("Create your vault first.");
    const amount = parseEther(action === "gas" ? gasAmount : deposit);
    if (amount <= 0n || amount > (action === "gas" ? parseEther("0.01") : parseEther("1000"))) throw new Error("Use an amount greater than zero and at most 1,000 test tokens or 0.01 Sepolia ETH.");
    if (action === "gas") await sendOwner(workspace, workspace.agent, undefined, amount, "Fund agent gas");
    else if (action === "tokens") await sendOwner(workspace, deployment.token0, encodeFunctionData({ abi: tokenAbi, functionName: "mint", args: [vault, amount] }), 0n, "Mint test kUSD to your vault");
    else await sendOwner(workspace, vault, encodeFunctionData({ abi: vaultAbi, functionName: "withdraw", args: [action === "withdrawOutput" ? deployment.token1 : deployment.token0, workspace.owner, amount] }), 0n, action === "withdrawOutput" ? "Withdraw test kETH to owner" : "Withdraw test kUSD to owner");
    await refresh();
  }

  async function runAgent() {
    const workspace = currentRef.current;
    if (!workspace || !snapshot.vault || !privateKey || !canWrite) throw new Error("Unlock this agent and connect its owner on Sepolia before running it.");
    const epoch = contextEpoch.current;
    const assertRunContext = () => {
      assertCurrent(workspace);
      if (contextEpoch.current !== epoch) throw new Error("The wallet or workspace changed during this request. Unlock the intended agent and start a new request; this one will not be signed or relayed.");
    };
    const identity = { owner: workspace.owner, agent: workspace.agent, vault: snapshot.vault };
    const expectedId = workspace.id;
    setRun(undefined); setMessage("Preparing your owner’s gas-free permission for one Gemini request…");
    const challenge = await workspaceApi<{ nonce: string; message: string }>("challenge", { ...identity, scenario });
    assertRunContext();
    await assertSepoliaWallet(connector, workspace.owner);
    const signature = await signMessageAsync({ connector, account: workspace.owner, message: challenge.message });
    assertRunContext();
    setMessage("Gemini is reading your agent’s policy and deciding what to request. This can take up to a few minutes.");
    const accepted = await workspaceApi<{ runId: string }>("prepare", { ...identity, scenario, nonce: challenge.nonce, signature });
    assertRunContext();
    rememberRun(workspace, { runId: accepted.runId, status: "preparing" });
    let result: WorkspaceRun | undefined;
    const until = Date.now() + 300_000;
    while (Date.now() < until) {
      if (currentRef.current?.id !== expectedId) throw new Error("Workspace changed. No new agent transaction will be signed from this page.");
      result = await workspaceApi<WorkspaceRun>("result", { runId: accepted.runId });
      assertRunContext();
      rememberRun(workspace, result);
      if (result.status !== "preparing") break;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    if (!result || result.status === "preparing") throw new Error("The agent is still preparing. Keep the run ID to inspect its status; no agent transaction was signed here.");
    if (result.status === "hold") { setMessage("Gemini chose not to submit a trade. No swap was sent."); return; }
    if (result.status !== "ready") throw new Error(result.error ?? result.message ?? result.reason ?? "The agent could not prepare a trade.");
    if (currentRef.current?.id !== expectedId || connectedOwner.current?.toLowerCase() !== workspace.owner.toLowerCase()) throw new Error("The selected owner or workspace changed. No agent transaction will be signed.");
    await assertSepoliaWallet(connector, workspace.owner);
    assertRunContext();
    setMessage("The restricted agent is signing its swap locally. Its private key stays in this browser.");
    const signed = await signWorkspaceRun(result, identity, privateKey);
    await assertSepoliaWallet(connector, workspace.owner);
    assertRunContext();
    if (currentRef.current?.id !== expectedId || connectedOwner.current?.toLowerCase() !== workspace.owner.toLowerCase()) throw new Error("The selected owner or workspace changed. The transaction will not be relayed.");
    const relayed = await workspaceApi<{ hash: Hex }>("relay", { runId: accepted.runId, ...signed });
    assertRunContext();
    rememberRun(workspace, { ...result, status: "pending", hash: relayed.hash });
    setMessage("Your signed transaction was submitted through Anon-RPC/Nox. Waiting for its public Sepolia receipt…");
    const receiptDeadline = Date.now() + 240_000;
    while (Date.now() < receiptDeadline) {
      const receipt = await workspaceApi<WorkspaceRun>("result", { runId: accepted.runId });
      if (currentRef.current?.id !== expectedId) return;
      assertRunContext();
      rememberRun(workspace, receipt);
      if (receipt.status === "success" || receipt.status === "reverted" || receipt.status === "error") {
        setMessage(receipt.status === "success" ? "Your agent’s swap confirmed on Sepolia." : receipt.message ?? "The transaction did not complete a swap. See the result below.");
        await refresh(); return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    setMessage("The transaction was submitted, but its receipt has not arrived yet. Open the transaction link to inspect it.");
  }

  function downloadBackup() {
    if (!current) return;
    const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `kusari-agent-${current.agent.slice(2, 10)}.json`; link.click(); URL.revokeObjectURL(url);
  }
  async function unlockAgent(workspace: SavedWorkspace) {
    const epoch = contextEpoch.current;
    let unlocked: Hex;
    if (workspace.key.version === 2) {
      await assertSepoliaWallet(connector, workspace.owner);
      setMessage("Sign the local unlock message in your wallet. The signature never leaves this browser.");
      const signature = await signMessageAsync({ connector, account: workspace.owner, message: walletUnlockMessage(workspace.owner, workspace.agent) });
      assertCurrent(workspace);
      unlocked = await decryptAgentKeyWithWallet(workspace.key, workspace.owner, signature);
    } else unlocked = await decryptAgentKey(workspace.key, passphrase);
    assertCurrent(workspace);
    if (epoch !== contextEpoch.current) throw new Error("The wallet context changed while unlocking. Select the agent and unlock it again.");
    setPrivateKey(unlocked); setPassphrase(""); setMessage("Agent unlocked in this page. Its private key has not left your browser.");
  }

  async function importBackup(file: File) {
    if (!address || file.size > 100_000) throw new Error("Connect the backup’s owner wallet and choose a backup under 100 KB.");
    const record = JSON.parse(await file.text()) as SavedWorkspace;
    if (record.version !== 1 || record.owner?.toLowerCase() !== address.toLowerCase() || record.agent !== record.key?.address || record.id !== record.agent.toLowerCase() || !Array.isArray(record.transactions)) throw new Error("This backup does not match the connected owner wallet.");
    if (record.agent.toLowerCase() === address.toLowerCase() || record.agent.toLowerCase() === ensDeployment.agent.toLowerCase()) throw new Error("This must be a separate restricted agent key, not the owner or shared demo key.");
    // Decryption authenticates the key and the address before imported metadata can become active.
    if (record.key.version === 2) {
      await assertSepoliaWallet(connector, record.owner);
      const signature = await signMessageAsync({ connector, account: record.owner, message: walletUnlockMessage(record.owner, record.agent) });
      await decryptAgentKeyWithWallet(record.key, record.owner, signature);
    } else await decryptAgentKey(record.key, passphrase);
    policyFor(record); save(record); setCreating(false); setPassphrase(""); setMessage("Backup imported. Unlock the key to trade; contract ownership and policy are checked on chain.");
    await refresh(record);
  }

  return <div className="workspace-page owned-page">
    <div className="workspace-heading"><div><h1>Your agents · Beta</h1><p>Give each agent its own key, ENS policy and trading vault. Your wallet owns the workspace; Gemini proposes the trade.</p></div><Link href="/demo" className="product-primary-link">Try the demo <span aria-hidden="true">↗</span></Link></div>
    <p className="owned-notice">Personal onboarding is beta and its streamlined flow is still being verified. Sepolia testnet only. Your wallet supplies setup and agent gas; the funded shared demo is available above.</p>
    <div role="status" aria-live="polite" aria-atomic="true" className="owned-progress">{message}</div>{error && <p role="alert" className="owned-error">{error}</p>}
    {address && (creating || !current || !onboardingComplete) && <section className="owned-funding-check" aria-labelledby="owner-funding-title"><h2 id="owner-funding-title">Your Sepolia setup balance</h2>{ownerFunding ? <><p>Wallet balance: <strong>{fmt(ownerFunding.balance)} Sepolia ETH</strong></p><p>Budget before signing: <strong>{fmt(ownerFunding.required)} Sepolia ETH</strong> — includes 0.0001 for agent gas and up to {fmt(ownerFunding.feeBudget)} for setup, using an actual setup estimate plus 20% gas margin ({ownerFunding.gasBudget.toLocaleString()} gas) at the observed maximum fee. The actual network charge depends on gas used.</p>{ownerFunding.balance < ownerFunding.required && <p className="owned-funding-shortfall">Add testnet ETH before creating an agent. No wallet signature or transaction will be requested while this balance is too low.</p>}<p className="owned-field-help">Balance and fee checked at {ownerFunding.checkedAt}.</p></> : <><p>Wallet balance: <strong>{ownerBalance === undefined ? "Checking…" : `${fmt(ownerBalance)} Sepolia ETH`}</strong></p><p>{fundingError || "Estimating your setup transaction and network fee before enabling creation…"}</p></>}<div className="owned-actions"><a className="owned-text-link" target="_blank" rel="noreferrer" href="https://ethglobal.com/faucet">Get Sepolia ETH from ETHGlobal ↗</a><button className="owned-text-link" disabled={busy} onClick={() => void perform(async () => { await checkOwnerFunding(address); setMessage("Sepolia funding checked. You can create your agent."); })}>Refresh funding</button><Link className="owned-text-link" href="/demo">Use the funded demo instead</Link></div></section>}
    {!address ? <section className="owned-empty"><h2>Start with your owner wallet</h2><p>Connect your wallet using the button above, then switch to Sepolia. This wallet will own your ENS label, edit your limits, freeze your agent and withdraw your vault’s funds.</p><p>The agent gets a different key. Never paste your owner wallet’s recovery phrase or private key here.</p></section> : <>
      <div className="owned-selector"><label htmlFor="owned-workspace">Workspace</label><select id="owned-workspace" value={selectedId ?? ""} disabled={busy || creating || workspaces.length === 0} onChange={(event) => { setSelectedId(event.target.value); setError(""); setMessage(""); }}><option value="" disabled>{workspaces.length ? "Choose an agent" : "No agents in this browser"}</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.title} · {short(workspace.agent)}</option>)}</select><button className="owned-secondary" disabled={busy || creating} onClick={() => { setCreating(true); setError(""); setPassphrase(""); }}>Create an agent</button></div>
      {(creating || !current) ? <section className="workspace-composer owned-create">
        <header className="composer-header"><h2>Create your agent</h2><p className="composer-description">Give it a name. We’ll create its key, ENS policy and funded test vault. Your wallet stays the owner.</p></header>
        <div className="owned-fields"><label>Agent name<input value={title} maxLength={60} disabled={busy} onChange={(event) => setTitle(event.target.value)} placeholder="My trading agent" /></label></div>
        <div className="owned-setup-summary"><p><strong>Ready to try:</strong> 25 test kUSD in your vault</p><p><strong>Safety limits:</strong> {newPerSwap} kUSD per trade · {newDaily} kUSD per day · {newImpact}% max pool price impact</p><p><strong>Wallet requests:</strong> one local key-protection signature, then one Sepolia setup transaction. Setup sends 0.0001 Sepolia ETH to your agent for gas, plus the transaction fee.</p></div>
        <details className="owned-details"><summary>Customize safety limits</summary><div className="owned-fields owned-policy-fields"><label>Per-trade cap (kUSD)<input inputMode="decimal" disabled={busy} value={newPerSwap} onChange={(event) => setNewPerSwap(event.target.value)} /></label><label>Daily cap (kUSD)<input inputMode="decimal" disabled={busy} value={newDaily} onChange={(event) => setNewDaily(event.target.value)} /></label><label>Max pool price impact (%)<input inputMode="decimal" disabled={busy} value={newImpact} onChange={(event) => setNewImpact(event.target.value)} /></label></div></details>
        <div className="owned-actions"><button className="request-action" disabled={busy || !title.trim() || chainId !== deployment.chainId || !isCanonical || !config?.atomicCoordinator || !ownerFunding || ownerFunding.balance < ownerFunding.required} onClick={() => void perform(createAgent)}>{busy ? "Creating your agent…" : "Create my agent"}</button>{creating && current && <button className="owned-secondary" disabled={busy} onClick={() => { setCreating(false); setPassphrase(""); }}>Cancel</button>}</div>
        <details className="owned-details"><summary>Where your key and agent live</summary><p>The restricted key is generated and encrypted in this browser. Unlocking happens locally with your wallet; your key and unlock signature are never uploaded. The hosted Fly.io service runs Gemini and relays your signed swaps through Anon-RPC/Nox. Keep this page open during a request; this is not an unattended background runner.</p><p>Your generated ENS subname belongs to your wallet under {parentName}. The parent registry remains a trust dependency. Your vault stays owner-controlled even if you lose this browser’s agent key.</p></details><p className="composer-footnote">Your restricted agent key is encrypted in this browser and unlocked with your wallet. No password or backup is required to get started. Use the same MetaMask EOA for wallet unlocking; encrypted export is available later. Clearing browser storage without an export loses the agent key, while your owner wallet keeps its withdrawal permissions. Testnet only.</p>
        <details className="owned-details"><summary>Recover an existing workspace</summary><p>Import your encrypted workspace file and unlock it with the same wallet. Older passphrase-protected backups use the passphrase below.</p><label className="owned-upload">Legacy backup passphrase (if needed)<input type="password" autoComplete="current-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label><label className="owned-upload">Encrypted recovery file<input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void perform(() => importBackup(file)); event.target.value = ""; }} /></label></details>
      </section> : <>
        <div className="workspace-agent owned-identity"><div><h2>{current.title}</h2><p>{fullName(current)}</p></div><span className="workspace-status">{onboardingComplete ? snapshot.authorized ? "Authorized" : "Frozen — future trades will fail" : "Setup in progress"}</span><button disabled={busy} className="owned-text-link" onClick={() => void perform(async () => { await refresh(); setMessage("Contract state refreshed."); })}>Refresh chain state</button></div>
        <div className="owned-grid"><div className="owned-main">
          {!onboardingComplete ? <section className="workspace-composer">
            {current.onboarding === "atomic-v1" ? <><header className="composer-header"><h2>{busy ? "Creating your agent" : "Finish creating your agent"}</h2><p className="composer-description">Your encrypted identity is saved. One Sepolia transaction sets up its ENS policy, owned vault, 25 test kUSD and agent gas together.</p></header><button className="request-action" disabled={busy || !canWrite || !config?.atomicCoordinator || !ownerFunding || ownerFunding.balance < ownerFunding.required} onClick={() => void perform(() => finishAtomicSetup())}>{busy ? "Waiting for wallet or Sepolia…" : "Finish agent setup"}</button><p className="composer-footnote">If you cancelled the wallet request, nothing was lost. Continue here with the same owner wallet.</p></> : <><header className="composer-header"><h2>Finish your earlier workspace</h2><p className="composer-description">This workspace started with the earlier setup flow. Its confirmed progress is saved. New agents use one setup transaction.</p></header><details className="owned-details" open><summary>Earlier setup steps</summary><ol className="owned-checklist">{steps.map((step, index) => <li key={step} data-current={nextStep === index}><span className="owned-step" aria-hidden="true">{completed[index] ? "✓" : index + 1}</span><div><strong>{step}</strong><p>{details[index]}</p></div><span className="owned-step-status">{completed[index] ? "Confirmed" : nextStep === index ? "Next" : "Waiting"}</span></li>)}</ol>{nextStep === 2 && <PolicyFields workspace={current} disabled={busy} onChange={save} />}<button className="request-action" disabled={busy || !canWrite || !config || nextStep < 0} onClick={() => void perform(continueSetup)}>{busy ? "Working on your setup…" : nextStep < 0 ? "Setup confirmed" : steps[nextStep]}</button></details></>}
          </section> : <>
            <section className="workspace-composer"><header className="composer-header"><h2>Run your agent</h2><p className="composer-description">Gemini reads this agent’s state, requests a trade, and your local agent key signs it. The server relays the signed transaction through Anon-RPC/Nox.</p></header>
              {!snapshot.authorized && <p className="owned-notice">Your agent is frozen. You can run a request to verify rejection on chain, or restore its role in owner controls.</p>}
              {!privateKey ? <div className="owned-unlock">{current.key.version === 2 ? <p>Unlock your agent with a local wallet signature. No password or transaction is needed.</p> : <label>Unlock this older agent<input type="password" autoComplete="current-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="Your encryption passphrase" /></label>}<button className="owned-secondary" disabled={busy || (current.key.version === 1 && !passphrase) || !canWrite} onClick={() => void perform(() => unlockAgent(current))}>Unlock with {current.key.version === 2 ? "wallet" : "passphrase"}</button></div> : <div className="owned-key-status"><span>Agent ready in this page</span><button disabled={busy} className="owned-text-link" onClick={() => { setPrivateKey(undefined); setMessage("Agent key locked. Unlock it to sign another swap."); }}>Lock agent</button></div>}
              <fieldset className="scenario-options owned-scenarios" disabled={busy}><legend>Choose the request</legend><label className="scenario-option" data-selected={scenario === "normal"}><input type="radio" name="owned-scenario" checked={scenario === "normal"} onChange={() => setScenario("normal")} /><span><strong className="scenario-title">Trade within limits</strong><span className="scenario-detail">Clean news. Gemini decides whether to request up to 1 kUSD.</span></span></label><label className="scenario-option" data-selected={scenario === "attack"}><input type="radio" name="owned-scenario" checked={scenario === "attack"} onChange={() => setScenario("attack")} /><span><strong className="scenario-title">Test an over-limit request</strong><span className="scenario-detail">Poisoned news tries to persuade Gemini to exceed this agent’s policy. Model refusal is a valid outcome.</span></span></label></fieldset>
              <div className="request-readiness"><p>The owner signs one gas-free admission message. Your restricted agent pays Sepolia gas from its own balance, including for a reverted transaction.</p><button className="request-action" disabled={busy || !privateKey || !canWrite || (snapshot.balance ?? 0n) <= 0n || (snapshot.agentGas ?? 0n) <= 0n} onClick={() => void perform(runAgent)}>{busy ? "Running your request…" : "Sign request & run my agent"}</button></div>
              {run && <><OwnedRunResult run={run} policy={snapshot.policy} /><button className="owned-text-link" disabled={busy} onClick={() => void perform(async () => { const latest = await workspaceApi<WorkspaceRun>("result", { runId: run.runId }); rememberRun(current, latest); setMessage(latest.status === "ready" ? "This saved request is prepared but has not been signed. Start a new request to sign a fresh transaction." : "Saved run status refreshed."); await refresh(); })}>Refresh saved run status</button></>}
            </section>
            <section className="owned-funding"><h2>Fund or withdraw test tokens</h2><p>Mint valueless test kUSD directly to your vault. Fund the agent’s own gas balance from your owner wallet. Only the owner can withdraw vault tokens.</p><div className="owned-funding-row"><label>Test token amount<input inputMode="decimal" value={deposit} onChange={(event) => setDeposit(event.target.value)} /></label><button className="owned-secondary" disabled={busy || !canWrite} onClick={() => void perform(() => fund("tokens"))}>Mint kUSD to vault</button><button className="owned-secondary" disabled={busy || !canWrite} onClick={() => void perform(() => fund("withdraw"))}>Withdraw kUSD</button><button className="owned-secondary" disabled={busy || !canWrite} onClick={() => void perform(() => fund("withdrawOutput"))}>Withdraw kETH</button></div><div className="owned-funding-row"><label>Agent gas (Sepolia ETH)<input inputMode="decimal" value={gasAmount} onChange={(event) => setGasAmount(event.target.value)} /></label><button className="owned-secondary" disabled={busy || !canWrite} onClick={() => void perform(() => fund("gas"))}>Fund agent gas</button></div></section>
          </>}
          <details className="owned-details"><summary>Setup transactions & recovery</summary><p>This encrypted browser record belongs to owner {short(current.owner)}. {current.key.version === 2 ? "Use the same MetaMask EOA and local unlock message to open it. Wallet signatures must be stable; changing signing methods can prevent unlocking." : "Keep its passphrase separately."} Export is optional for trying the agent and useful before moving browsers or clearing storage. Losing the agent key does not remove the owner’s withdrawal permissions.</p><button className="owned-secondary" onClick={downloadBackup}>Download encrypted recovery backup</button><ul className="owned-transactions">{current.transactions.map((tx) => <li key={tx.hash}><a target="_blank" rel="noreferrer" href={`${explorer}/tx/${tx.hash}`}>{tx.label} <span className="font-mono">{short(tx.hash)}</span> ↗</a></li>)}</ul></details>
        </div><aside className="owned-policy"><h2>Your authority boundary</h2><dl><Identity label="Owner wallet" value={current.owner} /><Identity label="Restricted agent" value={current.agent} />{snapshot.vault && <Identity label="Your vault" value={snapshot.vault} />}<div><dt>Vault balance</dt><dd>{fmt(snapshot.balance)} kUSD · {fmt(snapshot.outputBalance)} kETH</dd></div><div><dt>Agent gas</dt><dd>{fmt(snapshot.agentGas)} Sepolia ETH</dd></div><div><dt>Per-trade limit</dt><dd>{snapshot.policy ? `${fmt(snapshot.policy.maxPerSwap)} kUSD` : "Not published"}</dd></div><div><dt>Remaining today (UTC)</dt><dd>{snapshot.policy && snapshot.spent !== undefined ? `${fmt(snapshot.policy.dailyCap > snapshot.spent ? snapshot.policy.dailyCap - snapshot.spent : 0n)} kUSD` : "Not read"}</dd></div><div><dt>Maximum pool price impact</dt><dd>{snapshot.policy ? `${snapshot.policy.maxImpactBps / 100}%` : "Not published"}</dd></div></dl>
          {onboardingComplete && <><div className="owned-owner-controls"><h3>Owner controls</h3><p>{snapshot.authorized ? "Freeze only this agent. Other users’ roles, vaults and budgets stay separate." : "Restore this agent’s authorization when you are ready."}</p><button className="owned-freeze" disabled={busy || !canWrite} onClick={() => void perform(() => changeRole(!snapshot.authorized))}>{busy ? "Waiting for confirmation…" : snapshot.authorized ? "Freeze my agent" : "Restore my agent"}</button></div><details className="owned-details"><summary>Edit this agent’s policy</summary><PolicyFields workspace={current} disabled={busy} onChange={save} /><button className="owned-secondary" disabled={busy || !canWrite} onClick={() => void perform(async () => { await publishPolicy(); await refresh(); })}>Save policy to ENS</button></details></>}
          <p className="owned-trust">Your name is a subname of {parentName}. The parent registry remains a trust dependency. Your label and resolver belong to your wallet; your vault has an immutable owner and agent. Agent rotation requires a new vault.</p><p className="owned-trust">Agent traffic uses Anon-RPC/Nox. Transactions remain public. Your browser wallet’s setup and owner transactions use its own RPC provider.</p>{lastRead && <p className="owned-trust">Chain snapshot: {lastRead}. Refresh before relying on these values.</p>}
        </aside></div>
      </>}
      {chainId !== deployment.chainId && <p className="owned-notice">Switch your wallet to Sepolia in the header. No owner transaction can be requested until its network is verified.</p>}
    </>}
  </div>;
}

function PolicyFields({ workspace, disabled, onChange }: { workspace: SavedWorkspace; disabled: boolean; onChange: (workspace: SavedWorkspace) => void }) {
  return <div className="owned-fields owned-policy-fields"><label>Per-trade cap (kUSD)<input inputMode="decimal" value={workspace.perSwap} disabled={disabled} onChange={(event) => onChange({ ...workspace, perSwap: event.target.value })} /></label><label>Daily cap (kUSD)<input inputMode="decimal" value={workspace.daily} disabled={disabled} onChange={(event) => onChange({ ...workspace, daily: event.target.value })} /></label><label>Max pool price impact (%)<input inputMode="decimal" value={workspace.impact} disabled={disabled} onChange={(event) => onChange({ ...workspace, impact: event.target.value })} /></label><p className="owned-field-help">Allowed pool: <span className="font-mono">{short(deployment.poolId)}</span>. All input amounts use test kUSD (18 decimals). Editing these fields takes effect only after Save policy confirms.</p></div>;
}
function Identity({ label, value }: { label: string; value: Address }) { return <div><dt>{label}</dt><dd><a target="_blank" rel="noreferrer" href={`${explorer}/address/${value}`} className="font-mono" title={value}>{short(value)} ↗</a></dd></div>; }
function explain(cause: unknown) { const message = cause instanceof Error ? cause.message.split("\n")[0] : "The request failed. Please retry."; return /reject|denied|cancel/i.test(message) ? "The wallet request was cancelled. Your confirmed setup is saved; retry when ready." : message; }
function OwnedRunResult({ run, policy }: { run: WorkspaceRun; policy?: Policy }) {
  const result = run.status === "success" ? "Swap confirmed on Sepolia" : run.status === "reverted" ? "Reverted on Sepolia" : run.status === "hold" ? "No trade submitted" : run.status === "ready" ? "Prepared; not yet submitted" : run.status === "pending" ? "Submitted; waiting for receipt" : run.status === "error" ? "Request failed" : "Gemini is deciding";
  const reason = run.status === "reverted" ? "The receipt confirms a revert. The exact failure reason is not contained in the receipt." : run.error ?? run.message ?? run.reason ?? run.decision?.reason ?? "The result has not arrived yet.";
  return <section className="owned-result" aria-labelledby="owned-result-title">
    <h3 id="owned-result-title">Your request result</h3>
    <dl>
      <div><dt>Agent requested</dt><dd>{run.intent ? `${fmt(BigInt(run.intent.amountIn))} kUSD swap` : run.decision?.amountIn ? `${run.decision.amountIn} kUSD swap` : run.decision?.action === "hold" ? "Hold — no trade" : "Waiting for Gemini"}</dd></div>
      <div><dt>Owner’s limit</dt><dd>{policy ? `${fmt(policy.maxPerSwap)} kUSD per trade` : "Not read"}</dd></div>
      <div><dt>Result</dt><dd>{result}</dd></div>
      <div><dt>Reason</dt><dd>{reason}</dd></div>
      <div><dt>Tx</dt><dd>{run.hash ? <a href={`${explorer}/tx/${run.hash}`} target="_blank" rel="noreferrer" className="font-mono">{short(run.hash)} ↗</a> : run.status === "hold" ? "No transaction submitted" : "No transaction hash received"}</dd></div>
    </dl>
    {run.preflightReason && <p className="owned-field-help">Simulation before submission predicted: {run.preflightReason}. This is separate from the confirmed receipt.</p>}
    {run.decision?.reason && <p className="owned-field-help">Gemini: {run.decision.reason}</p>}
    {run.routing && <p className="owned-field-help">Route: {run.routing.route}. Observed RPC requests: {run.routing.rpcRequests}; submission requests: {run.routing.submissionRequests}; HTTP failures: {run.routing.httpFailures}. {run.routing.meaning}</p>}
    <p className="owned-field-help">Run ID: <span className="font-mono">{run.runId}</span>. The last 10 results are saved in this browser.</p>
  </section>;
}
