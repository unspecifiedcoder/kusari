import test from 'node:test';
import assert from 'node:assert/strict';
import {readOwnerPolicyContext} from './owner-policy-context.ts';
import {deployment} from './config.ts';
import {readFileSync} from 'node:fs';
const ens=JSON.parse(readFileSync(new URL('../../deployments/11155111-ens.json',import.meta.url),'utf8'));
const owner='0x1111111111111111111111111111111111111111';
function fixture() {
  const values:any={registry:ens.userRegistry,bindingOf:{label:ens.name.split('.')[0],dnsName:ens.dnsName,node:ens.node},agent:ens.agent,hook:deployment.policyHook,getOwner:owner,policyOf:{maxPerSwap:10n**18n}};
  const client={getChainId:async()=>11155111,multicall:async({contracts}:any)=>contracts.map((c:any)=>values[c.functionName])};
  const fetchImpl=async()=>({json:async()=>({mode:'anon'})});
  return {values,client,fetchImpl};
}
test('fresh registry owner lookup pins shared vault and ENS binding',async()=>{
  const f=fixture(),first=await readOwnerPolicyContext(ens.agent,f);
  assert.equal(first.owner,owner);assert.equal(first.limit,'1');assert.equal(first.vault,deployment.demoVault);
  f.values.getOwner='0x2222222222222222222222222222222222222222';
  assert.notEqual((await readOwnerPolicyContext(ens.agent,f)).owner,first.owner);
  for(const[key,bad]of [['registry',owner],['agent',owner],['hook',owner]]) {
    const original=f.values[key as string];f.values[key as string]=bad;
    await assert.rejects(readOwnerPolicyContext(ens.agent,f),{status:503});f.values[key as string]=original;
  }
  f.values.bindingOf={...f.values.bindingOf,label:'foreign'};
  await assert.rejects(readOwnerPolicyContext(ens.agent,f),{status:503});
});
test('mainnet, wrong agent and direct routing cannot authorize a fixed check',async()=>{
  const f=fixture();
  await assert.rejects(readOwnerPolicyContext(ens.agent,{...f,client:{...f.client,getChainId:async()=>1}}),{status:503});
  await assert.rejects(readOwnerPolicyContext(ens.agent,{...f,fetchImpl:async()=>({json:async()=>({mode:'direct'})})}),{status:503});
  await assert.rejects(readOwnerPolicyContext(owner,f),{status:503});
});
