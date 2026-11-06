import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { encodeFunctionData, encodeErrorResult, ContractFunctionRevertedError, BaseError, keccak256 } from 'viem';
import { createWorkspaceService, loadWorkspace, workspaceFactoriesFromManifest } from './workspace.ts';
import { agentVaultAbi, policyHookAbi } from './abi.ts';
import { deployment } from './config.ts';
import { kusariDomain, swapIntentTypes } from '../../shared/types.ts';

const owner = privateKeyToAccount(generatePrivateKey());
const agent = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const vault = '0x1111111111111111111111111111111111111111';
const input = { owner: owner.address, agent: agent.address, vault, scenario: 'normal' };
const state = { agentBalance:'1',vaultToken0:'50',maxPerSwap:'5',remainingToday:'100',price:1,sqrtPriceX96:(2n**96n).toString(),authorized:true };
function fixture(options: any = {}) {
  let calls = 0;
  const rpc = { getTransactionCount: async()=>0, estimateFeesPerGas:async()=>({maxFeePerGas:1000000000n,maxPriorityFeePerGas:1000000n}),getChainId:async()=>11155111,simulateContract:async()=>{},sendRawTransaction:async({serializedTransaction}:any)=>{calls++;return keccak256(serializedTransaction);},getTransactionReceipt:async()=>({status:'success'}), ...options.rpc };
  const service = createWorkspaceService({load:async()=>state,model:async()=>({action:'swap',amountIn:1,reason:'A real test decision',model:'test-double'}),rpc,...options,rpc});
  return {service,rpc,calls:()=>calls};
}
async function prepare(service:any, w:any=input, signer:any=owner) {
  const challenge = await service.handle('challenge',w);
  return service.handle('prepare',{...w,nonce:challenge.nonce,signature:await signer.signMessage({message:challenge.message})});
}
async function ready(service:any, id:string) {
  for(let i=0;i<100;i++){const r=await service.handle('result',{runId:id});if(r.status!=='preparing')return r;await new Promise(r=>setTimeout(r,5));}
  throw Error('test job did not finish');
}
async function signRun(run:any, changes:any={}) {
  const intent = {...run.intent};for(const k of ['amountIn','minAmountOut','nonce','deadline'])intent[k]=BigInt(intent[k]);
  const signature = await agent.signTypedData({domain:kusariDomain(11155111,deployment.policyHook),types:swapIntentTypes,primaryType:'SwapIntent',message:intent});
  const transaction = {...run.transaction,data:encodeFunctionData({abi:agentVaultAbi,functionName:'swap',args:[run.poolKey,intent,signature]}),...changes};
  for(const k of ['gas','value','maxFeePerGas','maxPriorityFeePerGas'])transaction[k]=BigInt(transaction[k]);
  const rawTransaction = await agent.signTransaction(transaction);
  return {runId:run.runId,signature,rawTransaction};
}

test('workspace owner signature cannot be replayed, changed, or forged',async()=>{
  const {service}=fixture();
  const challenge=await service.handle('challenge',input);
  const request={...input,nonce:challenge.nonce,signature:await owner.signMessage({message:challenge.message})};
  const accepted=await service.handle('prepare',request);assert.equal(accepted.status,'preparing');
  await assert.rejects(service.handle('prepare',request),{status:410});
  const challenge2=await service.handle('challenge',input);
  await assert.rejects(service.handle('prepare',{...input,nonce:challenge2.nonce,signature:await stranger.signMessage({message:challenge2.message})}),{status:403});
  const challenge3=await service.handle('challenge',input);
  await assert.rejects(service.handle('prepare',{...input,vault:'0x2222222222222222222222222222222222222222',nonce:challenge3.nonce,signature:await owner.signMessage({message:challenge3.message})}),{status:403});
});

test('workspace produces unsigned independent intent and verifies exact signed transaction',async()=>{
  const f=fixture();const accepted=await prepare(f.service);const run=await ready(f.service,accepted.runId);
  assert.equal(run.status,'ready');assert.equal(run.intent.agent,agent.address);assert.equal(run.intent.vault,vault);assert.equal(run.transaction.chainId,11155111);
  const valid=await signRun(run);const wrongChain=await signRun(run,{chainId:1});
  await assert.rejects(f.service.handle('relay',wrongChain),{status:403});
  await assert.rejects(f.service.handle('relay',await signRun(run,{value:1n})),{status:403});
  await assert.rejects(f.service.handle('relay',await signRun(run,{to:stranger.address})),{status:403});
  await assert.rejects(f.service.handle('relay',await signRun(run,{gas:600001n})),{status:403});
  const submitted=await f.service.handle('relay',valid);assert.equal(submitted.hash,keccak256(valid.rawTransaction));assert.equal(f.calls(),1);
  await f.service.handle('relay',valid);assert.equal(f.calls(),1);
  assert.equal((await f.service.handle('result',{runId:run.runId})).status,'success');
});

test('model failures never create scripted trades; funding and fee ceilings fail before signing',async()=>{
  for(const opts of [ {model:async()=>{throw Error('Gemini offline');}}, {load:async()=>({...state,agentBalance:'0'})}, {rpc:{estimateFeesPerGas:async()=>({maxFeePerGas:100000000000n,maxPriorityFeePerGas:1000000n})}} ]){
    const {service}=fixture(opts);const job=await prepare(service);const run=await ready(service,job.runId);assert.equal(run.status,'error');assert.equal(run.intent,undefined);
  }
});

test('two independent owners isolate admission, keys, intents and ENS freeze result',async()=>{
  const ownerB=privateKeyToAccount(generatePrivateKey());const agentB=privateKeyToAccount(generatePrivateKey());
  let frozenA=false;
  const {service}=fixture({load:async(w:any)=>({...state,authorized:w.agent===agent.address?!frozenA:true}),maxHourly:20});
  const a=await ready(service,(await prepare(service)).runId);frozenA=true;
  const wB={owner:ownerB.address,agent:agentB.address,vault:'0x2222222222222222222222222222222222222222',scenario:'normal'};
  const b=await ready(service,(await prepare(service,wB,ownerB)).runId);
  assert.notEqual(a.intent.agent,b.intent.agent);assert.notEqual(a.intent.vault,b.intent.vault);assert.notEqual(a.intent.nonce,b.intent.nonce);
  assert.equal((await service.handle('status',{owner:owner.address,agent:agent.address,vault})).state.authorized,false);
  assert.equal((await service.handle('status',{owner:ownerB.address,agent:agentB.address,vault:wB.vault})).state.authorized,true);
});

test('ambiguous broadcast can retry the identical raw transaction without accepting a replacement',async()=>{
  let attempts=0;const {service}=fixture({rpc:{sendRawTransaction:async()=>{attempts++;if(attempts===1)throw Error('connection lost');}}});
  const run=await ready(service,(await prepare(service)).runId);const signed=await signRun(run);
  assert.equal((await service.handle('relay',signed)).broadcast,'unconfirmed');
  assert.equal((await service.handle('relay',signed)).broadcast,'accepted');assert.equal(attempts,2);
});


test('on-chain workspace admission rejects a foreign vault, agent, hook and ENS owner and fails closed on direct mode',async()=>{
  const values:any={vaultsOf:[vault],owner:owner.address,agent:agent.address,hook:deployment.policyHook,bindingOf:{label:'personal-agent'},registry:'0x3333333333333333333333333333333333333333',getOwner:owner.address,getSlot0:[2n**96n,0,0,0],balanceOf:50n*10n**18n,policyOf:{maxPerSwap:5n*10n**18n,dailyCap:100n*10n**18n,maxImpactBps:200,allowedPool:deployment.poolId,active:true},isAuthorized:true,spentOn:0n};
  const rpc:any={getChainId:async()=>11155111,readContract:async(c:any)=>values[c.functionName],getBalance:async()=>10n**18n};
  const fetchImpl=async()=>({json:async()=>({mode:'anon'})});
  const w={owner:owner.address,agent:agent.address,vault};
  assert.equal((await loadWorkspace(w,{rpc,fetchImpl})).authorized,true);
  for(const [key,bad] of [['vaultsOf',[]],['owner',stranger.address],['agent',stranger.address],['hook',stranger.address],['getOwner',stranger.address]]){
    const original=values[key as string];values[key as string]=bad;
    await assert.rejects(loadWorkspace(w,{rpc,fetchImpl}),{status:403});values[key as string]=original;
  }
  await assert.rejects(loadWorkspace(w,{rpc,fetchImpl:async()=>({json:async()=>({mode:'direct'})})}),{status:503});
  await assert.rejects(loadWorkspace(w,{rpc:{...rpc,getChainId:async()=>1},fetchImpl}),{status:503});
});


test('ABI-aware preflight unwraps the hook rejection but preserves independent receipt outcome',async()=>{
  const inner=encodeErrorResult({abi:policyHookAbi,errorName:'NotAuthorized'});
  const wrapped=encodeErrorResult({abi:agentVaultAbi,errorName:'WrappedError',args:[deployment.policyHook,'0x12345678',inner,'0x']});
  const revert=new ContractFunctionRevertedError({abi:agentVaultAbi,data:wrapped,functionName:'swap'});
  let observed:any;
  const {service}=fixture({rpc:{simulateContract:async(call:any)=>{observed=call;throw new BaseError('contract simulation failed',{cause:revert});},getTransactionReceipt:async()=>({status:'reverted'})}});
  const run=await ready(service,(await prepare(service)).runId);
  await service.handle('relay',await signRun(run));
  const result=await service.handle('result',{runId:run.runId});
  assert.equal(observed.functionName,'swap');assert.equal(observed.address,vault);assert.deepEqual(observed.abi,agentVaultAbi);
  assert.equal(result.status,'reverted');assert.equal(result.preflightReason,'NotAuthorized');
  assert.equal(result.reason,undefined); // simulation is not represented as a decoded receipt error
});

test('unknown simulation failures never claim a known policy rejection or prevent receipt-based success',async()=>{
  const {service}=fixture({rpc:{simulateContract:async()=>{throw Error('RPC disconnected');}}});
  const run=await ready(service,(await prepare(service)).runId);
  await service.handle('relay',await signRun(run));
  const result=await service.handle('result',{runId:run.runId});
  assert.equal(result.status,'success');assert.equal(result.preflightReason,'Simulation unavailable or reverted; the receipt determines the on-chain result.');
  assert.notEqual(result.preflightReason,'NotAuthorized');
});


test('deployment-owned factory allowlist accepts atomic onboarding but rejects unlisted factories and mismatched deployment',async()=>{
  const personal='0x4444444444444444444444444444444444444444';
  const unlisted='0x5555555555555555555555555555555555555555';
  const trustedFactories=workspaceFactoriesFromManifest({chainId:11155111,policySource:deployment.policySource,personalVaultFactory:personal});
  assert.equal(trustedFactories.length,2);assert.equal(trustedFactories[0].toLowerCase(),deployment.vaultFactory.toLowerCase());assert.equal(trustedFactories[1],personal);
  assert.deepEqual(workspaceFactoriesFromManifest(),[deployment.vaultFactory]);
  assert.throws(()=>workspaceFactoriesFromManifest({chainId:1,personalVaultFactory:personal}));
  assert.throws(()=>workspaceFactoriesFromManifest({chainId:11155111,personalVaultFactory:'0x0000000000000000000000000000000000000000'}));
  assert.throws(()=>workspaceFactoriesFromManifest({chainId:11155111,personalVaultFactory:personal,policySource:unlisted}));
  let provenance=personal;
  const rpc:any={getChainId:async()=>11155111,getBalance:async()=>10n**18n,readContract:async(c:any)=>{
    if(c.functionName==='vaultsOf')return c.address.toLowerCase()===provenance.toLowerCase()?[vault]:[];
    return ({owner:owner.address,agent:agent.address,hook:deployment.policyHook,bindingOf:{label:'atomic-agent'},registry:unlisted,getOwner:owner.address,getSlot0:[2n**96n,0,0,0],balanceOf:25n*10n**18n,policyOf:{maxPerSwap:5n*10n**18n,dailyCap:100n*10n**18n,maxImpactBps:200,allowedPool:deployment.poolId,active:true},isAuthorized:true,spentOn:0n} as any)[c.functionName];
  }};
  const fetchImpl=async()=>({json:async()=>({mode:'anon'})});
  const w={owner:owner.address,agent:agent.address,vault};
  assert.equal((await loadWorkspace(w,{rpc,fetchImpl,trustedFactories})).authorized,true);
  provenance=deployment.vaultFactory;assert.equal((await loadWorkspace(w,{rpc,fetchImpl,trustedFactories})).authorized,true);
  provenance=unlisted;await assert.rejects(loadWorkspace(w,{rpc,fetchImpl,trustedFactories}),{status:403});
  const service=createWorkspaceService({load:async()=>state});
  await assert.rejects(service.handle('status',{...w,factory:unlisted}),{status:400});
});
