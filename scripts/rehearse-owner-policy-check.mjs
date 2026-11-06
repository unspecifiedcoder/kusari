// Preview by default. --execute performs the reviewed 2@5, cap1, 2@1, restore5 Sepolia proof.
// Owner signing stays local; canonical HTTPS sends only the fixed-purpose EIP-191 signature.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {buildOwnerPolicyMessage,OWNER_POLICY_PURPOSE,OWNER_POLICY_ORIGIN} from '../shared/owner-policy-message.mjs';
const require=createRequire(new URL('../agent/package.json',import.meta.url));
const {createPublicClient,http,parseAbi,parseEther,formatEther,encodeAbiParameters,encodeFunctionData,decodeFunctionData,keccak256,toBytes}=require('viem');
const {privateKeyToAccount}=require('viem/accounts');const {sepolia}=require('viem/chains');
class CheckError extends Error {}
const check=(ok,message)=>{if(!ok)throw new CheckError(message);};
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const serial=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
async function main(){
 const root=fileURLToPath(new URL('../',import.meta.url)),origin=OWNER_POLICY_ORIGIN;
 const deployment=JSON.parse(readFileSync(root+'deployments/11155111.json','utf8')),ens=JSON.parse(readFileSync(root+'deployments/11155111-ens.json','utf8')),chain=JSON.parse(readFileSync(root+'config/chains.json','utf8'))['11155111'];
 if(!process.argv.includes('--execute')){console.log(JSON.stringify({mode:'preview',origin,owner:ens.owner,agent:ens.agent,vault:deployment.demoVault,plan:['Verify live owner, registry, binding, resolver and complete 5/100/2% policy','Wrong owner rejected; public API still rejects amount2 if demo key is configured','Owner-authorized fixed2 check succeeds under cap5','Owner locally sets cap1 preserving all other policy fields','Fixed2 check confirms a reverted receipt','Restore cap5 in finally and verify authorization remains active'],maxSuccessfulTestInput:'2 kUSD',ownerPolicyTransactions:2,maxFeeETHPerPolicyTransaction:'0.0001',noGemini:true,noRoleChanges:true},null,2));return;}
 if(existsSync(root+'.env'))process.loadEnvFile(root+'.env');check(process.env.OWNER_PRIVATE_KEY,'Local owner key is required');
 const owner=privateKeyToAccount(process.env.OWNER_PRIVATE_KEY);check(equal(owner.address,ens.owner),'Local owner key does not match pinned ENS owner');
 const output=root+'docs/evidence/owner-policy-check.json';check(!existsSync(output),'Evidence already exists. Inspect its known hashes before a manual repeat; no blind restart is allowed');
 const pub=createPublicClient({chain:sepolia,transport:http(process.env.SEPOLIA_RPC_URL||chain.rpc,{timeout:30000,retryCount:1})});
 const tuple='(uint128 maxPerSwap,uint128 dailyCap,uint16 maxImpactBps,bytes32 allowedPool,bool active)';
 const abi=parseAbi(['function registry() view returns(address)','function bindingOf(address agent) view returns((string label,bytes dnsName,bytes32 node))',`function policyOf(address agent) view returns(${tuple})`,'function isAuthorized(address agent) view returns(bool)','function getOwner(uint256 id) view returns(address)','function getResolver(string label) view returns(address)','function owner() view returns(address)','function agent() view returns(address)','function hook() view returns(address)','function setData(bytes name,string key,bytes value)']);
 const swapAbi=parseAbi(['function swap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(address agent,address vault,bytes32 poolId,bool zeroForOne,uint256 amountIn,uint256 minAmountOut,uint256 nonce,uint256 deadline) intent,bytes signature) returns(int256)']);
 const policyParams=[{type:'tuple',components:[{name:'maxPerSwap',type:'uint128'},{name:'dailyCap',type:'uint128'},{name:'maxImpactBps',type:'uint16'},{name:'allowedPool',type:'bytes32'},{name:'active',type:'bool'}]}];
 const read=(address,functionName,args=[])=>pub.readContract({address,abi,functionName,args});
 const policy=()=>read(deployment.policySource,'policyOf',[ens.agent]);
 const evidence={status:'running',startedAt:new Date().toISOString(),chainId:11155111,origin,owner:owner.address,agent:ens.agent,vault:deployment.demoVault,checks:{},trades:[],policyTransactions:[],notes:['Fixed deterministic owner check; Gemini is not called.','Onchain receipt status is separate from preflight rejection prediction.','The owner key remains local; owner policy transactions use direct RPC. Agent execution uses hosted Anon-RPC/Nox.']};
 const save=()=>{mkdirSync(root+'docs/evidence',{recursive:true});writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');};
 function request(action,body,{apiKey}={}){
  const path=action.startsWith('/')?action:'/api/policy-check/'+action;
  const headers=['Content-Type: application/json','Origin: '+origin,...(apiKey?['Authorization: Bearer '+apiKey]:[])];
  const config=[`url = ${JSON.stringify(origin+path)}`,'request = "POST"',...headers.map(h=>`header = ${JSON.stringify(h)}`),`data = ${JSON.stringify(JSON.stringify(body))}`].join('\n')+'\n';let raw;
  try{raw=execFileSync('curl.exe',['--silent','--show-error','--max-time','80','--resolve','kusari.outcomeseal.com:443:76.76.21.21','--config','-','--write-out','\n%{http_code}'],{input:config,encoding:'utf8',maxBuffer:100000,windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP},stdio:['pipe','pipe','pipe']});}catch{throw new CheckError('Canonical HTTPS request failed. Inspect known request IDs/hashes before retrying');}
  const split=raw.lastIndexOf('\n');try{return{status:Number(raw.slice(split+1)),body:JSON.parse(raw.slice(0,split))};}catch{throw new CheckError('Canonical endpoint did not return JSON');}
 }
 async function pins(){
  check(deployment.chainId===11155111&&await pub.getChainId()===11155111,'Sepolia chain pin failed');
  const [registry,binding,vaultOwner,vaultAgent,vaultHook,resolver,liveOwner]=await Promise.all([read(deployment.policySource,'registry'),read(deployment.policySource,'bindingOf',[ens.agent]),read(deployment.demoVault,'owner'),read(deployment.demoVault,'agent'),read(deployment.demoVault,'hook'),read(ens.userRegistry,'getResolver',[ens.name.split('.')[0]]),read(ens.userRegistry,'getOwner',[BigInt(keccak256(toBytes(ens.name.split('.')[0])))])]);
  check(equal(registry,ens.userRegistry)&&binding.label===ens.name.split('.')[0]&&equal(binding.node,ens.node)&&equal(binding.dnsName,ens.dnsName)&&equal(vaultOwner,owner.address)&&equal(vaultAgent,ens.agent)&&equal(vaultHook,deployment.policyHook)&&equal(resolver,ens.resolver)&&equal(liveOwner,owner.address),'Shared owner/registry/binding/resolver/vault identity pin failed');
  check(await read(deployment.policySource,'isAuthorized',[ens.agent]),'Agent must remain authorized; this rehearsal never freezes it');
 }
 let original,changed=false,firstAcceptedAt=0;
 async function setCap(cap,expected){
  await pins();const current=await policy();check(JSON.stringify(serial(current))===JSON.stringify(serial(expected)),'Concurrent policy edit detected; refusing to overwrite unrelated fields');
  const next={...current,maxPerSwap:parseEther(cap)};const value=encodeAbiParameters(policyParams,[next]);
  const data=encodeFunctionData({abi,functionName:'setData',args:[ens.dnsName,'kusari.policy',value]});const gas=(await pub.estimateGas({account:owner,to:ens.resolver,data}))*12n/10n,fees=await pub.estimateFeesPerGas();
  check(fees.maxFeePerGas&&fees.maxPriorityFeePerGas!==undefined&&fees.maxPriorityFeePerGas<=fees.maxFeePerGas&&gas*fees.maxFeePerGas<=parseEther('0.0001'),'Policy transaction fee exceeds 0.0001 ETH ceiling');
  const [nonce,latest]=await Promise.all([pub.getTransactionCount({address:owner.address,blockTag:'pending'}),pub.getTransactionCount({address:owner.address,blockTag:'latest'})]);check(nonce===latest,'Owner has a pending transaction; no policy transaction was signed');
  const raw=await owner.signTransaction({chainId:11155111,type:'eip1559',to:ens.resolver,value:0n,data,nonce,gas,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas});const hash=keccak256(raw);const entry={capKUSD:cap,hash,status:'signed'};evidence.policyTransactions.push(entry);evidence.pendingOwnerTransaction={hash,capKUSD:cap};save();console.log('Policy cap '+cap+' signed hash: '+hash);
  try{check(await pub.sendRawTransaction({serializedTransaction:raw})===hash,'Unexpected policy broadcast hash');}catch{throw new CheckError('Policy broadcast is unconfirmed: '+hash+'. No blind resubmission is allowed');}
  let receipt;try{receipt=await pub.waitForTransactionReceipt({hash,timeout:160000});}catch{throw new CheckError('Policy receipt unconfirmed: '+hash+'. Inspect this hash before further writes');}
  check(receipt.status==='success','Policy edit reverted: '+hash);entry.status='success';entry.blockNumber=receipt.blockNumber.toString();delete evidence.pendingOwnerTransaction;if(cap==='1')changed=true;if(cap==='5')changed=false;save();
  for(let i=0;i<10;i++){const after=await policy();if(JSON.stringify(serial(after))===JSON.stringify(serial(next)))return next;await sleep(2000);}throw new CheckError('Policy receipt succeeded but fresh resolver data has not converged');
 }
 async function fixedCheck(label,expectedStatus,expectedLimit){
  if(firstAcceptedAt&&Date.now()<firstAcceptedAt+31000)await sleep(firstAcceptedAt+31000-Date.now());
  const c=request('challenge',{address:owner.address});check(c.status===200,'Owner challenge failed; inspect busy/cooldown state before retrying');const entry=c.body;
  check(equal(entry.address,owner.address)&&equal(entry.agent,ens.agent)&&equal(entry.vault,deployment.demoVault)&&entry.origin===origin&&entry.chainId===11155111&&entry.amountIn==='2'&&entry.purpose===OWNER_POLICY_PURPOSE&&/^0x[0-9a-f]{64}$/.test(entry.nonce)&&Number.isSafeInteger(entry.expiresAt)&&entry.expiresAt>Date.now()&&entry.expiresAt<=Date.now()+121000&&entry.message===buildOwnerPolicyMessage(entry),'Owner challenge did not match the exact canonical fixed-2 purpose');
  const signature=await owner.signMessage({message:entry.message});const record={case:label,status:'acceptance-unconfirmed',nonce:entry.nonce};evidence.trades.push(record);save();
  const accepted=request('run',{address:owner.address,nonce:entry.nonce,signature});check(accepted.status===202&&accepted.body.status==='accepted'&&/^[0-9a-f-]{36}$/.test(accepted.body.requestId),'Owner run was not confirmed accepted. Do not blindly request another');
  record.requestId=accepted.body.requestId;record.status='accepted';firstAcceptedAt=Date.now();save();console.log(label+' accepted '+record.requestId);
  const deadline=Date.now()+160000;let result;
  while(Date.now()<deadline){const poll=request('result',{requestId:record.requestId});if([408,503].includes(poll.status)){await sleep(2000);continue;}check(poll.status===200,'Known owner-check result could not be read');result=poll.body;record.status=result.status;if(result.hash)record.hash=result.hash;record.result=result;save();if(['success','reverted','error'].includes(result.status))break;await sleep(2000);}
  check(result?.status===expectedStatus&&result.requested==='2'&&result.limit===expectedLimit&&result.source==='owner-policy-check'&&result.route==='Anon-RPC / Nox'&&/^0x[0-9a-fA-F]{64}$/.test(result.hash),'Fixed check receipt, amount, observed limit or source did not match the required case');
  const [receipt,transaction]=await Promise.all([pub.getTransactionReceipt({hash:result.hash}),pub.getTransaction({hash:result.hash})]);const decoded=decodeFunctionData({abi:swapAbi,data:transaction.input}),intent=decoded.args[1];
  check(receipt.status===expectedStatus&&equal(transaction.from,ens.agent)&&equal(transaction.to,deployment.demoVault)&&intent.amountIn===parseEther('2')&&equal(intent.agent,ens.agent)&&equal(intent.vault,deployment.demoVault)&&equal(intent.poolId,deployment.poolId),'Independent Sepolia receipt/calldata did not match the fixed shared-agent trade');
  record.independentReceipt={status:receipt.status,hash:receipt.transactionHash,blockNumber:receipt.blockNumber.toString(),amountInWei:intent.amountIn.toString(),from:transaction.from,to:transaction.to};save();return result;
 }
 try{
  await pins();original=await policy();check(original.maxPerSwap===parseEther('5')&&original.dailyCap===parseEther('100')&&original.maxImpactBps===200&&equal(original.allowedPool,deployment.poolId)&&original.active===true,'Baseline must be active cap5/daily100/impact2% in the pinned pool');evidence.originalPolicy=serial(original);save();
  const wrong=request('challenge',{address:'0x000000000000000000000000000000000000dEaD'});check([401,403].includes(wrong.status),'Wrong owner was not rejected');evidence.checks.wrongOwner={httpStatus:wrong.status};
  if(process.env.KUSARI_DEMO_API_KEY){const capped=request('/v1/trade',{amountIn:'2'},{apiKey:process.env.KUSARI_DEMO_API_KEY});check(capped.status===400&&!capped.body.requestId,'Public trade API no longer rejects amount2');evidence.checks.publicAPIAmountTwo={httpStatus:capped.status,requestAccepted:false};}save();
  await fixedCheck('2 kUSD under cap5','success','5');const lower=await setCap('1',original);await fixedCheck('2 kUSD under cap1','reverted','1');check(evidence.trades.at(-1).result.preflightReason==='ExceedsPerSwap','Simulation did not independently predict ExceedsPerSwap');
  evidence.status='passed';
 }catch(cause){evidence.status='failed';evidence.failure=cause instanceof CheckError?cause.message:'Rehearsal failed. Inspect known request IDs and hashes before retrying';}
 finally{
  if(evidence.pendingOwnerTransaction){try{const receipt=await pub.getTransactionReceipt({hash:evidence.pendingOwnerTransaction.hash});if(receipt.status==='success'&&evidence.pendingOwnerTransaction.capKUSD==='1'){changed=true;delete evidence.pendingOwnerTransaction;}}catch{}save();}
  if(changed&&!evidence.pendingOwnerTransaction){try{const current=await policy();check(current.maxPerSwap===parseEther('1')&&current.dailyCap===original.dailyCap&&current.maxImpactBps===original.maxImpactBps&&equal(current.allowedPool,original.allowedPool)&&current.active===original.active,'Concurrent policy change prevents automatic restoration');await setCap('5',current);evidence.restoredPolicy=serial(await policy());evidence.restoreConfirmed=true;}catch{evidence.restoreConfirmed=false;evidence.status='failed';evidence.restoreMessage='Automatic restoration could not be confirmed. Inspect the recorded policy hash before any retry';}}
  if(!changed&&!evidence.pendingOwnerTransaction&&original){try{evidence.restoreConfirmed=JSON.stringify(serial(await policy()))===JSON.stringify(serial(original));await pins();evidence.agentAuthorizedAfter=true;}catch{evidence.restoreConfirmed=false;}}
  if(!evidence.restoreConfirmed)evidence.status='failed';evidence.completedAt=new Date().toISOString();save();
 }
 check(evidence.status==='passed','Owner policy rehearsal failed or restoration is unconfirmed. Inspect docs/evidence/owner-policy-check.json and known hashes');console.log('Passed owner-authorized fixed2 proof; original cap5 policy restored, authorization remains active.');
}
main().catch(cause=>{console.error(cause instanceof CheckError?cause.message:'Owner policy rehearsal failed. Inspect public evidence and known hashes; no blind repeat is safe.');process.exitCode=1;});
