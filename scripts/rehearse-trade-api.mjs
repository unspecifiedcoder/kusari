// One real capped trade against the canonical public API. Run only after production promotion.
// node scripts/rehearse-trade-api.mjs --execute
// The dedicated demo bearer key is read from ignored .env and passed to curl over stdin, never argv.
import { createRequire } from 'node:module';
import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

if (!process.argv.includes('--execute')) throw new Error('This rehearsal sends one real Sepolia trade. Run with --execute after production promotion.');
const root=fileURLToPath(new URL('../',import.meta.url));
if(existsSync(root+'.env'))process.loadEnvFile(root+'.env');
const key=process.env.KUSARI_DEMO_API_KEY;
if(typeof key!=='string'||!/^[A-Za-z0-9_-]{32,160}$/.test(key))throw new Error('Dedicated demo API key is not configured in ignored .env.');
const require=createRequire(new URL('../agent/package.json',import.meta.url));
const {createPublicClient,http,parseAbi,decodeFunctionData,parseEther}=require('viem');
const {sepolia}=require('viem/chains');
const deployment=JSON.parse(readFileSync(root+'deployments/11155111.json','utf8'));
const ens=JSON.parse(readFileSync(root+'deployments/11155111-ens.json','utf8'));
const chain=JSON.parse(readFileSync(root+'config/chains.json','utf8'))['11155111'];
const origin='https://kusari.outcomeseal.com';
const output=root+'docs/evidence/trade-api.json';
const evidence={version:1,origin,chainId:11155111,startedAt:new Date().toISOString(),status:'running',checks:{},privacyNote:'Route/source values are service observations, not cryptographic anonymity proof. The independent receipt check uses a public RPC only in this CLI rehearsal; product trade routing must remain Anon-RPC/Nox.'};
const save=()=>{mkdirSync(root+'docs/evidence',{recursive:true});writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');};
class RehearsalCheckError extends Error {}
const ensure=(condition,message)=>{if(!condition)throw new RehearsalCheckError(message);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function request(path,{method='GET',body,authentication='correct'}={}){
  ensure(path.startsWith('/')&&!path.includes('?')&&!path.includes('#'),'Rehearsal path must be fixed and same-origin.');
  const headers=[];
  if(authentication!=='none')headers.push('Authorization: Bearer '+(authentication==='wrong'?'invalid_demo_key_for_test_0000000000000000':key));
  if(body!==undefined)headers.push('Content-Type: application/json');
  const config=[`url = ${JSON.stringify(origin+path)}`,`request = ${JSON.stringify(method)}`,...headers.map(header=>`header = ${JSON.stringify(header)}`),...(body===undefined?[]:[`data = ${JSON.stringify(JSON.stringify(body))}`])].join('\n')+'\n';
  let raw;
  try{raw=execFileSync('curl.exe',['--silent','--show-error','--max-time','30','--resolve','kusari.outcomeseal.com:443:76.76.21.21','--config','-','--write-out','\n%{http_code}'],{input:config,encoding:'utf8',maxBuffer:128*1024,timeout:35_000,windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP},stdio:['pipe','pipe','pipe']});}
  catch{throw new RehearsalCheckError('Canonical HTTPS request failed; no completed trade can be inferred.');}
  const split=raw.lastIndexOf('\n');
  let value;try{value=JSON.parse(raw.slice(0,split));}catch{throw new RehearsalCheckError('Public API returned non-JSON; confirm the intended deployment is promoted.');}
  return {status:Number(raw.slice(split+1)),value};
}

try{
 save();
 const unauth=request('/v1/trade',{method:'POST',body:{amountIn:'1'},authentication:'wrong'});
 ensure(unauth.status===401,'Wrong bearer key did not return 401.');evidence.checks.wrongKey={httpStatus:unauth.status,requestAccepted:Boolean(unauth.value.requestId)};save();
 const tooLarge=request('/v1/trade',{method:'POST',body:{amountIn:'1.000000000000000001'}});
 ensure(tooLarge.status===400&&!tooLarge.value.requestId,'Above-one trade was not rejected before acceptance.');evidence.checks.overOneCap={httpStatus:tooLarge.status,requestAccepted:false};save();
 const foreign=request('/v1/trade',{method:'POST',body:{amountIn:'1',vault:'0x1111111111111111111111111111111111111111'}});
 ensure(foreign.status===400&&!foreign.value.requestId,'Caller-selected vault was not rejected.');evidence.checks.unknownField={httpStatus:foreign.status,requestAccepted:false};save();
 let accepted;const admissionDeadline=Date.now()+60_000;
 do{
  accepted=request('/v1/trade',{method:'POST',body:{amountIn:'1',reason:'Rehearsal: an external agent requests one capped Sepolia trade.'}});
  if(![409,429].includes(accepted.status)||accepted.value.requestId)break;
  const retrySeconds=Number(accepted.value.retryAfterSeconds??5);
  if(!Number.isFinite(retrySeconds)||retrySeconds>30||Date.now()+retrySeconds*1000>=admissionDeadline)break;
  evidence.checks.beforeAcceptanceRetries=[...(evidence.checks.beforeAcceptanceRetries??[]),{httpStatus:accepted.status,retryAfterSeconds:retrySeconds}];save();await wait(Math.max(1000,retrySeconds*1000));
 }while(Date.now()<admissionDeadline);
 ensure(accepted.status===202&&accepted.value.status==='accepted'&&/^[0-9a-f-]{36}$/.test(accepted.value.requestId),'The one capped trade was not accepted; inspect shared busy/quota state before retrying.');
 const requestId=accepted.value.requestId;evidence.checks.accepted={httpStatus:202,requestId,amountIn:'1',status:'accepted'};save();console.log('Accepted capped trade '+requestId);
 // The next request must never gain a second admission. A busy running agent may also reject with409,
 // but the shared gateway cooldown is checked first and should return429 immediately after acceptance.
 const cooldown=request('/v1/trade',{method:'POST',body:{amountIn:'1'}});
 ensure(cooldown.status===429&&!cooldown.value.requestId,'Immediate duplicate request was not rejected by shared cooldown.');evidence.checks.cooldown={httpStatus:429,requestAccepted:false,retryAfterSeconds:cooldown.value.retryAfterSeconds};save();
 let result;const deadline=Date.now()+240_000;
 while(Date.now()<deadline){
  const response=request('/v1/trade/'+requestId);
  if([408,503].includes(response.status)){evidence.checks.statusTransientFailures=(evidence.checks.statusTransientFailures??0)+1;save();await wait(3000);continue;}
  ensure(response.status===200,'Accepted request status could not be read.');result=response.value;
  evidence.checks.trade={requestId,status:result.status,amountIn:result.amountIn,hash:result.hash,route:result.route,source:result.source,chainId:result.chainId,preflightReason:result.preflightReason};save();
  if(['success','reverted','error'].includes(result.status))break;
  await wait(3000);
 }
 ensure(result?.status==='success'&&/^0x[0-9a-fA-F]{64}$/.test(result.hash),'The trade has no confirmed successful receipt; inspect its known request ID/hash instead of resubmitting.');
 ensure(result.route==='Anon-RPC / Nox'&&result.source==='external-agent'&&result.chainId===11155111,'Trade route/source/chain differs from the bounded external-agent contract.');
 const publicClient=createPublicClient({chain:sepolia,transport:http(chain.rpc,{timeout:20_000,retryCount:1})});
 ensure(await publicClient.getChainId()===11155111,'Independent receipt reader is not Sepolia.');
 const [receipt,transaction]=await Promise.all([publicClient.getTransactionReceipt({hash:result.hash}),publicClient.getTransaction({hash:result.hash})]);
 ensure(receipt.status==='success'&&transaction.from.toLowerCase()===ens.agent.toLowerCase()&&transaction.to?.toLowerCase()===deployment.demoVault.toLowerCase(),'Independent receipt does not match the configured shared agent and vault.');
 const abi=parseAbi(['function swap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(address agent,address vault,bytes32 poolId,bool zeroForOne,uint256 amountIn,uint256 minAmountOut,uint256 nonce,uint256 deadline) intent,bytes signature) returns(int256)']);
 const decoded=decodeFunctionData({abi,data:transaction.input});const intent=decoded.args[1];
 ensure(intent.amountIn===parseEther('1')&&intent.poolId.toLowerCase()===deployment.poolId.toLowerCase()&&intent.vault.toLowerCase()===deployment.demoVault.toLowerCase(),'On-chain intent does not match the accepted exact one-kUSD trade.');
 evidence.checks.independentReceipt={status:receipt.status,hash:receipt.transactionHash,blockNumber:receipt.blockNumber.toString(),from:transaction.from,to:transaction.to,amountInWei:intent.amountIn.toString(),minAmountOutWei:intent.minAmountOut.toString(),explorer:'https://sepolia.etherscan.io/tx/'+receipt.transactionHash};save();
 let status;const statusDeadline=Date.now()+60_000;
 while(Date.now()<statusDeadline){const response=request('/api/demo/agent/status',{authentication:'none'});if(response.status===200&&response.value.stateStatus==='fresh'&&response.value.busy===false){status=response.value;break;}await wait(3000);}
 ensure(status?.stateStatus==='fresh'&&status.readTransport==='anon'&&status.bridgeMode==='anon','Shared demo did not recover a fresh Nox-backed snapshot.');
 evidence.checks.sharedDemo={stateStatus:status.stateStatus,busy:status.busy,readTransport:status.readTransport,bridgeMode:status.bridgeMode,agent:status.agent,vault:status.vault,lastStateAt:status.lastStateAt,authorized:status.lastState?.authorized,active:status.lastState?.active};
 evidence.status='passed';evidence.completedAt=new Date().toISOString();save();console.log('Passed public trade API rehearsal: '+receipt.transactionHash);
}catch(cause){
 evidence.status='failed';evidence.completedAt=new Date().toISOString();evidence.failure=cause instanceof RehearsalCheckError?cause.message:'Rehearsal failed. Inspect the last completed public check and any known request ID/hash before retrying.';save();
 console.error(evidence.failure);process.exitCode=1;
}
