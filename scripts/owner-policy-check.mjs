import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildOwnerPolicyMessage,OWNER_POLICY_PURPOSE,OWNER_POLICY_CHAIN_ID,OWNER_POLICY_AMOUNT,OWNER_POLICY_ORIGIN} from '../shared/owner-policy-message.mjs';
import {tradeRequestId} from './api-trade.mjs';
const require=createRequire(new URL('../agent/package.json',import.meta.url));
const {getAddress,isAddress,verifyMessage}=require('viem');
export class OwnerPolicyError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new OwnerPolicyError(status,message);};
const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(k=>Object.hasOwn(value,k));
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const address=value=>typeof value==='string'&&isAddress(value)?getAddress(value):fail(400,'A valid owner address is required');

/** The signing key remains in the owner's wallet; only a one-use fixed-purpose signature is accepted. */
export function createOwnerPolicyAccess({readContext,admission,agent,vault,origin=OWNER_POLICY_ORIGIN,now=Date.now,verifySignature=verifyMessage,nonceTtlMs=120000,maxNonces=20,maxOwnerReadsPerMinute=30}={}){
 if(origin!==OWNER_POLICY_ORIGIN)throw new Error('Owner policy checks require the canonical Kusari origin');
 const fixedAgent=address(agent),fixedVault=address(vault),nonces=new Map();let reading=false;let reads=[];
 const prune=()=>{for(const[k,v]of nonces)if(v.expiresAt<=now())nonces.delete(k);reads=reads.filter(t=>now()-t<60000);};
 async function context(){
  prune();if(reading)fail(409,'An owner verification is already pending');if(reads.length>=maxOwnerReadsPerMinute)fail(429,'Owner verification capacity reached; retry in a minute');
  reading=true;reads.push(now());
  try{const value=await readContext();if(value?.chainId!==OWNER_POLICY_CHAIN_ID||!equal(value.agent,fixedAgent)||!equal(value.vault,fixedVault)||value.readTransport!=='anon'||value.bridgeMode!=='anon'||!isAddress(value.owner))fail(503,'Live owner identity or Nox route could not be verified');if(value.busy)fail(409,'The shared agent is busy; wait for its current request');return value;}finally{reading=false;}
 }
 return{
  async challenge(input){
   if(!exact(input,['address']))fail(400,'Expected the owner address only');const owner=address(input.address);prune();
   if(nonces.size>=maxNonces||[...nonces.values()].filter(v=>equal(v.address,owner)).length>=3)fail(429,'Too many pending owner messages; wait two minutes');
   const live=await context();if(!equal(live.owner,owner))fail(403,'Only the live ENS name owner may request this fixed policy check');
   const entry={address:owner,origin,agent:fixedAgent,vault:fixedVault,chainId:OWNER_POLICY_CHAIN_ID,amountIn:OWNER_POLICY_AMOUNT,purpose:OWNER_POLICY_PURPOSE,nonce:'0x'+randomBytes(32).toString('hex'),expiresAt:now()+nonceTtlMs};
   entry.message=buildOwnerPolicyMessage(entry);nonces.set(entry.nonce,entry);return entry;
  },
  async run(input,start){
   if(!exact(input,['address','nonce','signature']))fail(400,'Expected owner address, nonce and signature only');const owner=address(input.address);
   if(typeof input.nonce!=='string'||!/^0x[0-9a-f]{64}$/.test(input.nonce)||typeof input.signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(input.signature))fail(400,'Invalid owner policy signature encoding');
   const entry=nonces.get(input.nonce);if(!entry)fail(409,'Owner message is missing or already used');nonces.delete(input.nonce);
   if(entry.expiresAt<=now())fail(410,'Owner message expired; request another');if(!equal(entry.address,owner))fail(403,'Owner message belongs to another account');
   const live=await context();if(!equal(live.owner,owner))fail(403,'ENS name ownership changed; this signature cannot start a check');
   let valid=false;try{valid=await verifySignature({address:owner,message:entry.message,signature:input.signature});}catch{}
   if(!valid)fail(401,'Signature does not authorize this exact fixed owner policy check');
   if(entry.expiresAt<=now())fail(410,'Owner message expired during verification; request another');
   return admission.apiRun(async({runId})=>start({requestId:runId,owner}),owner);
  },
 };
}

/** Separate fixed-amount result store. It cannot broaden the public trade API's one-kUSD limit. */
export function createOwnerPolicyJobs({execute,readReceipt,now=Date.now,maxJobs=50,ttlMs=3600000}={}){
 const jobs=new Map();const prune=()=>{for(const[id,job]of jobs)if(job.expiresAt<=now()&&!job.working&&!job.polling)jobs.delete(id);};
 function view(job){
  const outcome={accepted:'Accepted',running:'Reading policy',pending:'Receipt unconfirmed',success:'Swap confirmed on Sepolia',reverted:'Reverted on Sepolia',error:'Check failed before a confirmed result'}[job.status];
  return{requestId:job.requestId,status:job.status,requested:'2',limit:job.limit??null,limitObservedAt:job.limitObservedAt??null,outcome,reason:job.reason??'This fixed deterministic test does not call Gemini.',...(job.hash?{hash:job.hash}:{}),...(job.preflightReason?{preflightReason:job.preflightReason}:{}),source:OWNER_POLICY_PURPOSE,deterministic:true,chainId:11155111,route:'Anon-RPC / Nox'};
 }
 const receiptOutcome=(job,status)=>{if(!['success','reverted'].includes(status))return;job.status=status;job.reason=job.status==='success'?'The Sepolia receipt confirms a completed swap.':'The receipt confirms a revert; it does not contain a decoded failure reason.';};
 return{
  accept(input){
   prune();if(!exact(input,['requestId','owner'])||!tradeRequestId(input.requestId))fail(400,'Invalid fixed policy check request');const owner=address(input.owner);
   if(jobs.has(input.requestId))fail(409,'This policy check ID was already accepted');if(jobs.size>=maxJobs)fail(429,'Owner policy result capacity reached');
   const job={requestId:input.requestId,owner,status:'accepted',working:true,expiresAt:now()+ttlMs,lastPoll:0};jobs.set(job.requestId,job);
   Promise.resolve().then(async()=>{job.status='running';try{
    const result=await execute(owner,{onState:state=>{job.limit=String(state.limit);job.limitObservedAt=state.observedAt??now();},onSubmitted:hash=>{job.hash=hash;job.status='pending';}});
    if(result.hash)job.hash=result.hash;
    if(result.status==='success'&&job.hash)receiptOutcome(job,'success');
    else if(result.status==='blocked'&&job.hash){receiptOutcome(job,'reverted');if(typeof result.reason==='string'&&/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(result.reason))job.preflightReason=result.reason;}
    else{job.status=job.hash?'pending':'error';job.reason=job.hash?'A hash is known; its receipt is still unconfirmed.':'The fixed test did not produce a confirmed transaction result.';}
   }catch{job.status=job.hash?'pending':'error';job.reason=job.hash?'A hash is known; inspect its receipt before retrying.':'Owner identity, chain route or execution could not be verified. No completed swap is confirmed.';}finally{job.working=false;}});
   return{requestId:job.requestId,status:'accepted'};
  },
  async result(input){
   prune();if(!exact(input,['requestId'])||!tradeRequestId(input.requestId))fail(400,'Expected one policy check request ID');const job=jobs.get(input.requestId);if(!job)fail(404,'Policy check result is missing or expired');
   // Refresh in the background: slow Nox receipts never turn polling into a serverless timeout.
   if(job.status==='pending'&&!job.working&&!job.polling&&now()-job.lastPoll>=3000){job.polling=true;job.lastPoll=now();Promise.resolve().then(()=>readReceipt(job.hash)).then(receipt=>receiptOutcome(job,receipt.status)).catch(()=>{}).finally(()=>{job.polling=false;});}
   return view(job);
  },
 };
}
