import {readFileSync} from 'node:fs';
import {createPublicClient,http,parseAbi,keccak256,toBytes,formatEther,type Address} from 'viem';
import {sepolia} from 'viem/chains';
import {deployment,ANON_RPC} from './config.ts';
import {OwnerPolicyError} from '../../scripts/owner-policy-check.mjs';
const ens=JSON.parse(readFileSync(new URL('../../'+(process.env.ENS_OUT??'deployments/11155111-ens.json'),import.meta.url),'utf8'));
const rpc=createPublicClient({chain:sepolia,transport:http(ANON_RPC,{timeout:45000,retryCount:1}),batch:{multicall:false}});
const abi=parseAbi([
 'function registry() view returns(address)',
 'function bindingOf(address agent) view returns((string label,bytes dnsName,bytes32 node))',
 'function agent() view returns(address)','function hook() view returns(address)',
 'function getOwner(uint256 id) view returns(address)',
 'function policyOf(address agent) view returns((uint128 maxPerSwap,uint128 dailyCap,uint16 maxImpactBps,bytes32 allowedPool,bool active))',
]);
const equal=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
/** A fresh registry-owner lookup on every authorization boundary; no private keys or owner signing. */
export async function readOwnerPolicyContext(agent:Address,{client=rpc,fetchImpl=fetch}:any={}){
 if(deployment.chainId!==11155111||!equal(agent,ens.agent)||await client.getChainId()!==11155111)throw new OwnerPolicyError(503,'Fixed policy check is not pinned to the configured Sepolia agent');
 const bridge=await fetchImpl(new URL('/metrics',ANON_RPC),{signal:AbortSignal.timeout(3000)}).then((r:any)=>r.json());if(bridge.mode!=='anon')throw new OwnerPolicyError(503,'Owner checks require Nox anonymous routing');
 const[registry,binding,vaultAgent,vaultHook]=await client.multicall({allowFailure:false,contracts:[
  {address:deployment.policySource,abi,functionName:'registry'},
  {address:deployment.policySource,abi,functionName:'bindingOf',args:[agent]},
  {address:deployment.demoVault,abi,functionName:'agent'},
  {address:deployment.demoVault,abi,functionName:'hook'},
 ]});
 if(!equal(registry,ens.userRegistry)||binding.label!==ens.name.split('.')[0]||!equal(binding.node,ens.node)||!equal(binding.dnsName,ens.dnsName)||!equal(vaultAgent,agent)||!equal(vaultHook,deployment.policyHook))throw new OwnerPolicyError(503,'Shared vault or ENS binding does not match the pinned demonstration');
 const[owner,policy]=await client.multicall({allowFailure:false,contracts:[
  {address:registry,abi,functionName:'getOwner',args:[BigInt(keccak256(toBytes(binding.label)))]},
  {address:deployment.policySource,abi,functionName:'policyOf',args:[agent]},
 ]});
 return{owner,agent,vault:deployment.demoVault,chainId:11155111,limit:formatEther(policy.maxPerSwap),readTransport:'anon',bridgeMode:'anon',observedAt:Date.now()};
}
