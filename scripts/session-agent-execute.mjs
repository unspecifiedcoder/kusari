// Trusted operator-only CLI; copied to /tmp on the existing Fly VM. It exposes no HTTP service.
// Uses ONLY the already-installed restricted agent key and its loopback Nox bridge. Never an owner key.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const require=createRequire('/app/agent/package.json');
const {createPublicClient,http,parseAbi,parseEther,encodeFunctionData,decodeEventLog,keccak256,decodeErrorResult,BaseError,ContractFunctionRevertedError}=require('viem');
const {privateKeyToAccount}=require('viem/accounts');const {sepolia}=require('viem/chains');
const main=JSON.parse(readFileSync('/app/deployments/11155111.json','utf8'));
const ens=JSON.parse(readFileSync('/app/deployments/11155111-ens.json','utf8'));
const chain=JSON.parse(readFileSync('/app/config/chains.json','utf8'))['11155111'];
const rpc='http://127.0.0.1:8546';
const client=createPublicClient({chain:sepolia,transport:http(rpc,{timeout:45_000,retryCount:1}),batch:{multicall:false}});
const vaultAbi=parseAbi([
 'function owner() view returns(address)','function agent() view returns(address)','function poolManager() view returns(address)','function hook() view returns(address)','function token0() view returns(address)','function token1() view returns(address)','function allowedPool() view returns(bytes32)',
 'function remainingBudget() view returns(uint256)','function sessionExpiresAt() view returns(uint64)','function minRateWad() view returns(uint256)','function sessionId() view returns(uint256)',
 'function openSession(uint256 totalBudget,uint64 expiresAt,uint256 ownerMinRateWad)','function closeSession()','function withdraw(address currency,address to,uint256 amount)',
 'function swap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(address agent,address vault,bytes32 poolId,bool zeroForOne,uint256 amountIn,uint256 minAmountOut,uint256 nonce,uint256 deadline) intent,bytes signature) returns(int256)',
 'event SessionSwap(uint256 indexed sessionId,uint256 requestedInput,uint256 actualInput,uint256 actualOutput,uint256 remainingBudget)',
 'error OnlyOwner()','error OnlyAgent()','error InvalidPool()','error SessionExpired()','error SessionBudgetExceeded()','error OwnerOutputFloorNotMet(uint256 actualOutput,uint256 requiredOutput)','error InvalidInput()','error ReentrantCall()',
 'error WrappedError(address target,bytes4 selector,bytes reason,bytes details)',
]);
const factoryAbi=parseAbi(['function vaultsOf(address owner) view returns(address[])']);
const tokenAbi=parseAbi(['function balanceOf(address owner) view returns(uint256)']);
const hookAbi=parseAbi(['function spentOn(address agent,uint256 day) view returns(uint256)','function nonceUsed(address agent,uint256 nonce) view returns(bool)','error NotAuthorized()','error ExceedsPerSwap()','error ExceedsDaily()','error InsufficientOutput()']);
const sourceAbi=parseAbi(['function isAuthorized(address agent) view returns(bool)','function bindingOf(address agent) view returns((string label,bytes dnsName,bytes32 node))']);
const stateAbi=parseAbi(['function getSlot0(bytes32 poolId) view returns(uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)']);
const registryAbi=parseAbi(['function getOwner(uint256 id) view returns(address)']);
const equal=(a,b)=>a.toLowerCase()===b.toLowerCase();
const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
class SessionCLICheckError extends Error {}
function check(condition,message){if(!condition)throw new SessionCLICheckError(message);}
function reason(error){if(error instanceof BaseError){const reverted=error.walk(e=>e instanceof ContractFunctionRevertedError);if(reverted instanceof ContractFunctionRevertedError&&reverted.data){let name=reverted.data.errorName;if(name==='WrappedError'){try{name=decodeErrorResult({abi:hookAbi,data:reverted.data.args[2]}).errorName;}catch{name='Unknown';}}return name;}}return 'Unknown';}
async function snapshot(input,nonce){
 const block=await client.getBlock();const day=block.timestamp/86400n;
 const values=await client.multicall({allowFailure:false,contracts:[
  ...['remainingBudget','sessionExpiresAt','minRateWad','sessionId'].map(functionName=>({address:input.vault,abi:vaultAbi,functionName})),
  {address:main.token0,abi:tokenAbi,functionName:'balanceOf',args:[input.vault]},
  {address:main.token1,abi:tokenAbi,functionName:'balanceOf',args:[input.vault]},
  {address:main.policyHook,abi:hookAbi,functionName:'spentOn',args:[input.agent,day]},
  {address:chain.uniswap.stateView,abi:stateAbi,functionName:'getSlot0',args:[main.poolId]},
  ...(nonce===undefined?[]:[{address:main.policyHook,abi:hookAbi,functionName:'nonceUsed',args:[input.agent,nonce]}]),
 ]});
 return {chainTime:block.timestamp,remainingBudget:values[0],expiresAt:values[1],minRateWad:values[2],sessionId:values[3],token0Balance:values[4],token1Balance:values[5],spentToday:values[6],poolSlot0:values[7],...(nonce===undefined?{}:{nonceUsed:values[8]})};
}
async function mainExecute(){
 check(process.argv.includes('--execute'),'Explicit CLI execution flag required');
 check(!process.env.OWNER_PRIVATE_KEY,'Owner key must never be present in hosted CLI environment');
 const input=JSON.parse(Buffer.from(process.argv[2]??'','base64').toString('utf8'));
 check(input&&['swap','owner-ops'].includes(input.action),'Unknown session CLI action');
 const account=privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
 check(equal(input.owner,ens.owner)&&equal(input.agent,ens.agent)&&equal(account.address,input.agent),'Restricted agent/owner pins mismatch');
 check(await client.getChainId()===11155111&&main.chainId===11155111,'Session CLI requires Sepolia');
 const bridge=await fetch(rpc+'/metrics',{signal:AbortSignal.timeout(3000)}).then(r=>r.json());check(bridge.mode==='anon','Nox anonymous route is required; direct fallback is forbidden');
 const hosted=await fetch('http://127.0.0.1:8787/status',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());check(hosted.busy===false&&hosted.readTransport==='anon','Shared hosted runner must be idle and Nox-backed before this same-agent CLI rehearsal');
 const [factoryCode,vaultCode]=await Promise.all([client.getCode({address:input.factory}),client.getCode({address:input.vault})]);
 check(factoryCode&&keccak256(factoryCode)===input.factoryCodeHash&&vaultCode&&keccak256(vaultCode)===input.vaultCodeHash,'Session deployment code pins mismatch');
 const fields=['owner','agent','poolManager','hook','token0','token1','allowedPool'];
 const values=await client.multicall({allowFailure:false,contracts:[...fields.map(functionName=>({address:input.vault,abi:vaultAbi,functionName})),{address:input.factory,abi:factoryAbi,functionName:'vaultsOf',args:[input.owner]},{address:main.policySource,abi:sourceAbi,functionName:'isAuthorized',args:[input.agent]}]});
 const expected=[input.owner,input.agent,chain.uniswap.poolManager,main.policyHook,main.token0,main.token1,main.poolId];
 fields.forEach((_,i)=>check(equal(values[i],expected[i]),'Session immutable identity/pool mismatch'));
 check(values[7].some(v=>equal(v,input.vault))&&values[8]===true,'Session vault provenance or existing ENS authorization failed');
 const binding=await client.readContract({address:main.policySource,abi:sourceAbi,functionName:'bindingOf',args:[input.agent]});
 const {toBytes}=require('viem');const nameOwner=await client.readContract({address:ens.userRegistry,abi:registryAbi,functionName:'getOwner',args:[BigInt(keccak256(toBytes(binding.label)))]});check(equal(nameOwner,input.owner),'Session and ENS policy must have the same owner');
 if(input.action==='owner-ops'){
  const results={};const block=await client.getBlock();
  for(const[functionName,args]of [['openSession',[1n,block.timestamp+300n,1n]],['closeSession',[]],['withdraw',[main.token0,input.agent,1n]]]){
   try{await client.simulateContract({account,address:input.vault,abi:vaultAbi,functionName,args});results[functionName]='UnexpectedSuccess';}catch(error){results[functionName]=reason(error);}
  }
  check(Object.values(results).every(v=>v==='OnlyOwner'),'Restricted agent unexpectedly passed an owner operation');
  console.log('KUSARI_SESSION_RESULT '+json({action:'owner-ops',status:'passed',checks:results,transactionsSent:0,route:'Anon-RPC / Nox'}));return;
 }
 check(typeof input.amountIn==='string'&&/^0(?:\.\d{1,18})?$/.test(input.amountIn),'Only small decimal session rehearsal inputs are supported');
 const amount=parseEther(input.amountIn);check(amount>0n&&amount<=parseEther('0.25')&&['0','1'].includes(input.minAmountOut),'Session CLI input exceeds fixed rehearsal limits');
 const nonce=BigInt('0x'+randomBytes(32).toString('hex'));const before=await snapshot(input,nonce);
 const intent={agent:input.agent,vault:input.vault,poolId:main.poolId,zeroForOne:true,amountIn:amount,minAmountOut:BigInt(input.minAmountOut),nonce,deadline:before.chainTime+300n};
 const types={SwapIntent:[{name:'agent',type:'address'},{name:'vault',type:'address'},{name:'poolId',type:'bytes32'},{name:'zeroForOne',type:'bool'},{name:'amountIn',type:'uint256'},{name:'minAmountOut',type:'uint256'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]};
 const signature=await account.signTypedData({domain:{name:'Kusari',version:'1',chainId:11155111,verifyingContract:main.policyHook},types,primaryType:'SwapIntent',message:intent});
 const key={currency0:main.token0,currency1:main.token1,fee:3000,tickSpacing:60,hooks:main.policyHook};
 let preflightReason;try{await client.simulateContract({account,address:input.vault,abi:vaultAbi,functionName:'swap',args:[key,intent,signature],gas:600000n});}catch(error){preflightReason=reason(error);}
 const [pending,latest,fees]=await Promise.all([client.getTransactionCount({address:account.address,blockTag:'pending'}),client.getTransactionCount({address:account.address,blockTag:'latest'}),client.estimateFeesPerGas()]);
 check(pending===latest,'The shared agent has a pending transaction; no session transaction was signed');
 const ready=await fetch('http://127.0.0.1:8787/status',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());check(ready.busy===false,'Shared agent became busy; no session transaction was signed');
 check(fees.maxFeePerGas&&fees.maxPriorityFeePerGas!==undefined&&fees.maxPriorityFeePerGas<=fees.maxFeePerGas&&fees.maxFeePerGas*600000n<=parseEther('0.003')&&await client.getBalance({address:account.address})>=fees.maxFeePerGas*600000n,'Agent gas reserve or fee ceiling is insufficient');
 const raw=await account.signTransaction({chainId:11155111,type:'eip1559',to:input.vault,value:0n,nonce:pending,gas:600000n,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas,data:encodeFunctionData({abi:vaultAbi,functionName:'swap',args:[key,intent,signature]})});
 const hash=keccak256(raw);console.log('KUSARI_SESSION_TX '+hash);
 let broadcast='accepted';try{check(await client.sendRawTransaction({serializedTransaction:raw})===hash,'Unexpected broadcast hash');}catch{broadcast='unconfirmed';}
 let receipt;try{receipt=await client.waitForTransactionReceipt({hash,timeout:120000});}catch{console.log('KUSARI_SESSION_RESULT '+json({status:'unconfirmed',hash,broadcast,preflightReason,before,nonce,route:'Anon-RPC / Nox'}));return;}
 const after=await snapshot(input,nonce);let event;
 for(const log of receipt.logs){if(!equal(log.address,input.vault))continue;try{const parsed=decodeEventLog({abi:vaultAbi,data:log.data,topics:log.topics});if(parsed.eventName==='SessionSwap')event=parsed.args;}catch{}}
 console.log('KUSARI_SESSION_RESULT '+json({status:receipt.status,hash,broadcast,blockNumber:receipt.blockNumber,preflightReason,before,after,nonce,amountInWei:amount,agentMinAmountOut:intent.minAmountOut,event,route:'Anon-RPC / Nox',sharedAgentNonceScope:'Same agent as the main demo; hosted-idle and pending-nonce checks reduce races, but this CLI does not provide an atomic cross-process nonce lock.'}));
}
mainExecute().catch(cause=>{console.log('KUSARI_SESSION_RESULT '+json({status:'failed',message:cause instanceof SessionCLICheckError?cause.message:'Session CLI guard or RPC operation failed. Inspect any known transaction hash before retrying.'}));process.exitCode=1;});
