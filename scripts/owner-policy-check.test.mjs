import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createOwnerPolicyAccess,createOwnerPolicyJobs} from './owner-policy-check.mjs';
import {createSandboxAccess} from './sandbox-access.mjs';
import {buildOwnerPolicyMessage} from '../shared/owner-policy-message.mjs';
const require=createRequire(new URL('../agent/package.json',import.meta.url));
const {generatePrivateKey,privateKeyToAccount}=require('viem/accounts');
const owner=privateKeyToAccount(generatePrivateKey()),foreign=privateKeyToAccount(generatePrivateKey());
const agent='0x1111111111111111111111111111111111111111',vault='0x2222222222222222222222222222222222222222';
const hash='0x'+'a'.repeat(64);
const context={owner:owner.address,agent,vault,chainId:11155111,readTransport:'anon',bridgeMode:'anon',busy:false,limit:'1'};
function fixture(options={}) {
  let reads=0;
  const sandbox=createSandboxAccess({maxHourly:1,maxDaily:1,walletCooldownMs:0,globalCooldownMs:0});
  const access=createOwnerPolicyAccess({readContext:async()=>{reads++;return context;},admission:sandbox,agent,vault,...options});
  return {access,sandbox,reads:()=>reads};
}
async function signed(access,signer=owner) {
  const c=await access.challenge({address:owner.address});
  return {address:owner.address,nonce:c.nonce,signature:await signer.signMessage({message:c.message}),challenge:c};
}
const request=r=>({address:r.address,nonce:r.nonce,signature:r.signature});
const tick=()=>new Promise(r=>setImmediate(r));

test('fixed challenge reconstruction and fresh ENS owner verification precede run',async()=>{
  const f=fixture(),s=await signed(f.access);
  assert.equal(s.challenge.message,buildOwnerPolicyMessage(s.challenge));
  assert.equal(s.challenge.amountIn,'2');assert.equal(s.challenge.chainId,11155111);
  assert.equal(s.challenge.origin,'https://kusari.outcomeseal.com');
  assert.match(s.challenge.message,/does not call Gemini/);assert.match(s.challenge.message,/no funds/);
  let starts=0;
  const accepted=await f.access.run(request(s),async input=>{starts++;assert.equal(input.owner,owner.address);assert.equal(Object.hasOwn(input,'amountIn'),false);});
  assert.equal(accepted.status,'accepted');assert.equal(starts,1);assert.equal(f.reads(),2);
  await assert.rejects(f.access.run(request(s),async()=>{}),{status:409});
  assert.throws(()=>f.sandbox.challenge({address:owner.address,scenario:'normal'}),{status:429});
});

test('foreign signer, owner transfer and altered fixed-purpose message cannot start a check',async()=>{
  const f=fixture();await assert.rejects(f.access.challenge({address:foreign.address}),{status:403});
  const s=await signed(f.access,foreign);let starts=0;
  await assert.rejects(f.access.run(request(s),async()=>{starts++;}),{status:401});
  let liveOwner=owner.address;
  const changed=fixture({readContext:async()=>({...context,owner:liveOwner})});
  const old=await signed(changed.access);liveOwner=foreign.address;
  await assert.rejects(changed.access.run(request(old),async()=>{starts++;}),{status:403});
  const altered=fixture(),c=await altered.access.challenge({address:owner.address});
  const signature=await owner.signMessage({message:c.message.replace('Fixed request: 2','Fixed request: 1')});
  await assert.rejects(altered.access.run({address:owner.address,nonce:c.nonce,signature},async()=>{starts++;}),{status:401});
  assert.equal(starts,0);
});

test('caller amount or vault, expired nonce, unsafe route and excess nonce capacity fail closed',async()=>{
  const f=fixture();await assert.rejects(f.access.challenge({address:owner.address,amountIn:'2'}),{status:400});
  const s=await signed(f.access);
  await assert.rejects(f.access.run({...request(s),amountIn:'2'},async()=>{}),{status:400});
  await assert.rejects(f.access.run({...request(s),vault},async()=>{}),{status:400});
  let time=1000;const expired=fixture({now:()=>time}),e=await signed(expired.access);time+=120001;
  await assert.rejects(expired.access.run(request(e),async()=>{}),{status:410});
  for(const bad of [{...context,chainId:1},{...context,bridgeMode:'direct'},{...context,readTransport:'leak'},{...context,agent:foreign.address}]) {
    const x=fixture({readContext:async()=>bad});
    await assert.rejects(x.access.challenge({address:owner.address}),{status:503});
  }
  const bounded=fixture();for(let i=0;i<3;i++)await bounded.access.challenge({address:owner.address});
  await assert.rejects(bounded.access.challenge({address:owner.address}),{status:429});
});

test('nonce consumption precedes asynchronous verification and prevents concurrent replay',async()=>{
  let block=false,release;
  const f=fixture({readContext:async()=>{if(block)await new Promise(r=>{release=r;});return context;}});
  const s=await signed(f.access);block=true;let starts=0;
  const first=f.access.run(request(s),async()=>{starts++;});
  await assert.rejects(f.access.run(request(s),async()=>{starts++;}),{status:409});
  release();await first;assert.equal(starts,1);
});

test('a challenge that expires during a slow owner lookup cannot gain admission',async()=>{
  let time=1000,slow=false,starts=0;
  const f=fixture({now:()=>time,readContext:async()=>{if(slow)time+=120001;return context;}});
  const s=await signed(f.access);slow=true;
  await assert.rejects(f.access.run(request(s),async()=>{starts++;}),{status:410});
  assert.equal(starts,0);
  const busy=fixture({readContext:async()=>({...context,busy:true})});
  await assert.rejects(busy.access.challenge({address:owner.address}),{status:409});
});

test('fixed result separates observed policy, confirmed receipt and simulation prediction',async()=>{
  const jobs=createOwnerPolicyJobs({execute:async(signer,cb)=>{
    assert.equal(signer,owner.address);cb.onState({limit:'1',observedAt:123});cb.onSubmitted(hash);
    return {status:'blocked',hash,reason:'ExceedsPerSwap'};
  },readReceipt:async()=>({status:'reverted'})});
  const id=randomUUID();assert.equal(jobs.accept({requestId:id,owner:owner.address}).status,'accepted');await tick();
  const result=await jobs.result({requestId:id});
  assert.equal(result.requested,'2');assert.equal(result.limit,'1');assert.equal(result.limitObservedAt,123);
  assert.equal(result.status,'reverted');assert.equal(result.preflightReason,'ExceedsPerSwap');
  assert.match(result.reason,/does not contain a decoded/);assert.equal(result.hash,hash);
  assert.equal(result.source,'owner-policy-check');assert.equal(result.deterministic,true);
  assert.throws(()=>jobs.accept({requestId:randomUUID(),owner:owner.address,amountIn:'3'}),{status:400});
});

test('unconfirmed receipt polling is nonblocking and never fabricates a policy cause',async()=>{
  let release,polls=0;
  const jobs=createOwnerPolicyJobs({execute:async(_,cb)=>{cb.onSubmitted(hash);throw Error('private diagnostic');},readReceipt:()=>{polls++;return new Promise(r=>{release=r;});}});
  const id=randomUUID();jobs.accept({requestId:id,owner:owner.address});await tick();
  assert.equal((await jobs.result({requestId:id})).status,'pending');await tick();
  const b=await jobs.result({requestId:id});assert.equal(b.preflightReason,undefined);assert.equal(polls,1);
  assert.doesNotMatch(JSON.stringify(b),/private diagnostic/);
  release({status:'success'});await tick();assert.equal((await jobs.result({requestId:id})).status,'success');
});
