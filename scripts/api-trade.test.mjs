import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateTradeInput,createSharedTradeJobs,sharedTradeMinimum } from './api-trade.mjs';
import { createSandboxAccess } from './sandbox-access.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
const hash='0x'+'a'.repeat(64);

test('trade API validates exact decimal amount, optional stricter minOut and bounded untrusted reason',()=>{
 assert.deepEqual(validateTradeInput({amountIn:'0.123456789012345678',reason:'external model chose',minAmountOut:'100'}),{amountIn:'0.123456789012345678',reason:'external model chose',minAmountOut:'100'});
 for(const value of [{amountIn:'0'},{amountIn:'1.000000000000000001'},{amountIn:1},{amountIn:'1e-3'},{amountIn:'-1'},{amountIn:'0.0000000000000000001'},{amountIn:'0.1',vault:'foreign'},{amountIn:'1',reason:'x'.repeat(281)},{amountIn:'1',minAmountOut:'-1'},{amountIn:'1',minAmountOut:(2n**128n).toString()}])assert.throws(()=>validateTradeInput(value),{status:400});
});

test('API trade jobs expose accepted, known pending hash and independent receipt outcomes',async()=>{
 let finish;
 const jobs=createSharedTradeJobs({execute:async(input,onSubmitted)=>{assert.equal(input.amountIn,'0.2');onSubmitted(hash);return new Promise(r=>{finish=r;});},readReceipt:async()=>({status:'success'})});
 const requestId=randomUUID();assert.deepEqual(jobs.accept({requestId,amountIn:'0.2'}),{requestId,status:'accepted'});
 await tick();const pending=await jobs.status(requestId);assert.equal(pending.status,'pending');assert.equal(pending.hash,hash);
 finish({status:'blocked',hash,reason:'NotAuthorized'});await tick();const result=await jobs.status(requestId);assert.equal(result.status,'reverted');assert.equal(result.preflightReason,'NotAuthorized');assert.equal(result.source,'external-agent');
 await assert.rejects(jobs.status(randomUUID()),{status:404});
});

test('ambiguous receipt remains pending and errors never expose private runtime details',async()=>{
 let time=10000;let confirmed=false;
 const jobs=createSharedTradeJobs({now:()=>time,execute:async(_,onSubmitted)=>{onSubmitted(hash);throw Error('PRIVATE_KEY=secret RPC=https://credential.invalid');},readReceipt:async()=>{if(!confirmed)throw Error('no receipt');return {status:'success'};}});
 const id=randomUUID();jobs.accept({requestId:id,amountIn:'1'});await tick();assert.equal((await jobs.status(id)).status,'pending');
 time+=4000;confirmed=true;const result=await jobs.status(id);assert.equal(result.status,'success');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_KEY|credential/);
});

test('browser and external API share the same daily allowance and reservation lock',async()=>{
 const sandbox=createSandboxAccess({maxDaily:1,maxHourly:1,walletCooldownMs:0,globalCooldownMs:0});
 await sandbox.apiRun(async()=>{});
 assert.throws(()=>sandbox.challenge({address:'0x1111111111111111111111111111111111111111',scenario:'normal'}),{status:429});
 await assert.rejects(sandbox.apiRun(async()=>{}),{status:429});
 const other=createSandboxAccess({walletCooldownMs:0,globalCooldownMs:0});let release;
 const blocked=other.apiRun(()=>new Promise(r=>{release=r;}));
 assert.throws(()=>other.challenge({address:'0x1111111111111111111111111111111111111111',scenario:'normal'}),{status:409});release();await blocked;
});


test('caller output floor can only tighten server slippage protection without rounding input wei',()=>{
 const amount=123456789012345678n;const sqrt=2n**96n;const floor=amount*9670n/10000n;
 assert.equal(sharedTradeMinimum(amount,sqrt,300n,undefined),floor);
 assert.equal(sharedTradeMinimum(amount,sqrt,300n,0n),floor);
 assert.equal(sharedTradeMinimum(amount,sqrt,300n,floor+1n),floor+1n);
 assert.throws(()=>sharedTradeMinimum(amount,sqrt,10000n,undefined));
});
