// Low-privilege external-agent entrypoint. No private keys, arbitrary contracts or RPC parameters.
export class TradeApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const exactFields = (value, required, optional=[]) => value && typeof value==='object' && !Array.isArray(value) && required.every(k=>Object.hasOwn(value,k)) && Object.keys(value).every(k=>required.includes(k)||optional.includes(k));
export const tradeRequestId = value => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export function validateTradeInput(input) {
  if (!exactFields(input,['amountIn'],['reason','minAmountOut'])) throw new TradeApiError(400,'Expected amountIn and optional reason/minAmountOut only');
  if (typeof input.amountIn!=='string'||!/^(?:0|1)(?:\.\d{1,18})?$/.test(input.amountIn)) throw new TradeApiError(400,'amountIn must be a decimal string greater than zero and at most 1 kUSD, with up to 18 decimals');
  const [whole,fraction='']=input.amountIn.split('.');
  const amountInWei=BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0'));
  if(amountInWei<=0n||amountInWei>10n**18n)throw new TradeApiError(400,'Demo API trades may spend greater than zero and at most 1 kUSD');
  if(input.reason!==undefined&&(typeof input.reason!=='string'||input.reason.length>280))throw new TradeApiError(400,'reason must be at most 280 characters');
  if(input.minAmountOut!==undefined&&(typeof input.minAmountOut!=='string'||!/^(?:0|[1-9]\d{0,38})$/.test(input.minAmountOut)||BigInt(input.minAmountOut)>2n**128n-1n))throw new TradeApiError(400,'minAmountOut must be a uint128 decimal string in token1 base units');
  return {amountIn:input.amountIn,...(input.reason===undefined?{}:{reason:input.reason}),...(input.minAmountOut===undefined?{}:{minAmountOut:input.minAmountOut})};
}

/** A caller may tighten the signed output floor, never loosen the server's quote protection. */
export function sharedTradeMinimum(amountInWei, sqrtPriceX96, slippageBps, requestedMinimum) {
  if (amountInWei <= 0n || sqrtPriceX96 <= 0n || slippageBps < 0n || slippageBps >= 9970n || (requestedMinimum !== undefined && requestedMinimum < 0n)) throw new TradeApiError(400, 'Invalid signed quote bounds');
  const q96 = 2n ** 96n;
  const quote = ((amountInWei * sqrtPriceX96) / q96 * sqrtPriceX96) / q96;
  const floor = quote * (10000n - 30n - slippageBps) / 10000n;
  return requestedMinimum !== undefined && requestedMinimum > floor ? requestedMinimum : floor;
}

/** Async result storage is bounded and in memory; restarting the demo service clears it. */
export function createSharedTradeJobs({execute,readReceipt,now=Date.now,maxJobs=100,ttlMs=3_600_000}={}) {
  const jobs=new Map();
  const prune=()=>{for(const[id,job]of jobs)if(job.expiresAt<=now()&&!job.working)jobs.delete(id);};
  const view=job=>({requestId:job.requestId,status:job.status,amountIn:job.input.amountIn,...(job.input.reason!==undefined?{callerReason:job.input.reason}:{}),...(job.hash?{hash:job.hash}:{}),...(job.preflightReason?{preflightReason:job.preflightReason}:{}),...(job.message?{message:job.message}:{}),route:'Anon-RPC / Nox',chainId:11155111,source:'external-agent'});
  return {
    accept(input) {
      prune();
      if(!exactFields(input,['requestId','amountIn'],['reason','minAmountOut'])||!tradeRequestId(input.requestId))throw new TradeApiError(400,'Invalid API trade request');
      const validated=validateTradeInput(Object.fromEntries(Object.entries(input).filter(([k])=>k!=='requestId')));
      if(jobs.has(input.requestId))throw new TradeApiError(409,'This request ID was already accepted');
      if(jobs.size>=maxJobs)throw new TradeApiError(429,'Trade result capacity reached; retry later');
      const job={requestId:input.requestId,input:validated,status:'accepted',working:true,expiresAt:now()+ttlMs,lastPoll:0};jobs.set(job.requestId,job);
      Promise.resolve().then(async()=>{
        job.status='running';
        try {
          const result=await execute(validated,hash=>{job.hash=hash;job.status='pending';});
          if(result.hash)job.hash=result.hash;
          if(result.status==='success'&&job.hash)job.status='success';
          else if(result.status==='blocked'&&job.hash){job.status='reverted';job.preflightReason=result.reason;job.message='The Sepolia receipt confirms a revert. Preflight information is separate from the receipt.';}
          else if(job.hash){job.status='pending';job.message='Transaction hash is known; its receipt is not confirmed yet.';}
          else{job.status='error';job.message='The trade did not return a transaction hash; no completed swap is confirmed.';}
        } catch {job.status=job.hash?'pending':'error';job.message=job.hash?'Transaction receipt is unconfirmed. Inspect the known hash.':'Trade execution could not complete. No completed swap is confirmed.';}
        finally{job.working=false;}
      });
      return {requestId:job.requestId,status:'accepted'};
    },
    async status(requestId) {
      prune();
      if(!tradeRequestId(requestId))throw new TradeApiError(400,'Invalid request ID');
      const job=jobs.get(requestId);if(!job)throw new TradeApiError(404,'Trade request not found or expired');
      if(job.status==='pending'&&!job.working&&!job.polling&&now()-job.lastPoll>=3000){
        job.polling=true;job.lastPoll=now();
        try{const receipt=await readReceipt(job.hash);job.status=receipt.status==='success'?'success':'reverted';job.message=receipt.status==='success'?'Swap confirmed on Sepolia.':'The Sepolia receipt confirms a revert; it does not contain a decoded reason.';}
        catch{/* A missing or unavailable receipt remains pending. */}finally{job.polling=false;}
      }
      return view(job);
    },
  };
}
