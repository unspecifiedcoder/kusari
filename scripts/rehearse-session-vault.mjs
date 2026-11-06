// Separate live Session-v1 proof. Preview by default; --execute runs the reviewed finite test plan.
// Owner transactions sign locally; restricted-agent transactions use the existing Fly Nox bridge.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
const require=createRequire(new URL('../agent/package.json',import.meta.url));
const {createPublicClient,http,parseAbi,parseEther,encodeFunctionData,keccak256}=require('viem');
const {privateKeyToAccount}=require('viem/accounts');const {sepolia}=require('viem/chains');
class SessionRehearsalCheckError extends Error {}
const check=(condition,message)=>{if(!condition)throw new SessionRehearsalCheckError(message);};
const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const equal=(a,b)=>a.toLowerCase()===b.toLowerCase();
async function mainExecute(){
 const root=fileURLToPath(new URL('../',import.meta.url));if(existsSync(root+'.env'))process.loadEnvFile(root+'.env');
 const manifestFile=root+'deployments/11155111-session.json';check(existsSync(manifestFile),'Deploy the separate session factory and vault first');
 const session=JSON.parse(readFileSync(manifestFile,'utf8'));
 const main=JSON.parse(readFileSync(root+'deployments/11155111.json','utf8'));const ens=JSON.parse(readFileSync(root+'deployments/11155111-ens.json','utf8'));const chain=JSON.parse(readFileSync(root+'config/chains.json','utf8'))['11155111'];
 check(session.chainId===11155111&&main.chainId===11155111&&session.factory&&session.vault&&session.factoryCodeHash&&session.vaultCodeHash,'Session deployment must be complete and Sepolia-pinned');
 for(const[field,value]of Object.entries({owner:ens.owner,agent:ens.agent,hook:main.policyHook,policySource:main.policySource,token0:main.token0,token1:main.token1,allowedPool:main.poolId,poolManager:chain.uniswap.poolManager}))check(equal(session[field],value),'Session deployment identity/pool differs from the verified demo');
 if(!process.argv.includes('--execute')){console.log(JSON.stringify({mode:'preview',factory:session.factory,vault:session.vault,plan:['Agent owner-only operation simulations reject (no transactions)','Owner opens .5 kUSD / ten-minute session at 90% reference rate','Two .25 kUSD Nox swaps succeed with agent minAmountOut=0','Third .25 swap reverts finite budget','Owner opens strict 2x reference-rate session; minAmountOut=0 trade reverts owner floor','Owner opens 45-second session; trade after chain expiry reverts','Owner closes only the new session'],maxActualTokenInput:'0.5 kUSD',policyCoupling:session.policyCoupling,sameAgentNonceScope:'Must run while hosted agent is idle. No atomic cross-process nonce isolation is claimed.'},null,2));return;}
 const output=root+'docs/evidence/session-vault.json';check(!existsSync(output),'Session evidence already exists. Inspect its known hashes before any manual repeat; this helper never blindly restarts a rehearsal');
 check(process.env.OWNER_PRIVATE_KEY,'Local owner key required');const owner=privateKeyToAccount(process.env.OWNER_PRIVATE_KEY);check(equal(owner.address,session.owner),'Local owner key does not match the session owner');
 const pub=createPublicClient({chain:sepolia,transport:http(process.env.SEPOLIA_RPC_URL||chain.rpc,{timeout:45_000,retryCount:1})});check(await pub.getChainId()===11155111,'Owner/read-only RPC is not Sepolia');
 const vaultAbi=JSON.parse(readFileSync(root+'contracts/out/SessionAgentVault.sol/SessionAgentVault.json','utf8')).abi;
 const tokenAbi=parseAbi(['function balanceOf(address owner) view returns(uint256)']);const stateAbi=parseAbi(['function getSlot0(bytes32 poolId) view returns(uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)']);const sourceAbi=parseAbi(['function isAuthorized(address agent) view returns(bool)']);
 const evidence={version:'session-v1',status:'running',startedAt:new Date().toISOString(),chainId:11155111,factory:session.factory,vault:session.vault,owner:session.owner,agent:session.agent,mainVault:main.demoVault,policyCoupling:session.policyCoupling,nonceScope:'Existing shared agent reused. Hosted-idle and pending-nonce checks are best effort, not an atomic cross-process nonce lock.',ownerTransport:'Owner setup and independent checks use direct public RPC in this CLI only; owner key never leaves this machine.',agentTransport:'Existing restricted agent signs inside its Fly VM and routes reads/submissions through loopback Anon-RPC/Nox; no new public signer endpoint or service configuration.',ownerTransactions:[],trades:[]};
 const save=()=>{mkdirSync(root+'docs/evidence',{recursive:true});writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');};save();
 const directSnapshot=async()=>({mainToken0:(await pub.readContract({address:main.token0,abi:tokenAbi,functionName:'balanceOf',args:[main.demoVault]})).toString(),mainToken1:(await pub.readContract({address:main.token1,abi:tokenAbi,functionName:'balanceOf',args:[main.demoVault]})).toString(),agentAuthorized:await pub.readContract({address:main.policySource,abi:sourceAbi,functionName:'isAuthorized',args:[session.agent]})});
 const baseline=await directSnapshot();evidence.mainBefore=baseline;save();
 const childEnv=Object.fromEntries(['PATH','SystemRoot','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 const fly=process.env.USERPROFILE+'\\.fly\\bin\\fly.exe';const app='kusari-demo-backend';const machine='83dd392c6dd998';const remote='/tmp/kusari-session-agent-'+Date.now()+'.mjs';
 try{execFileSync(fly,['ssh','sftp','put',root+'scripts/session-agent-execute.mjs',remote,'-a',app,'--machine',machine],{env:childEnv,encoding:'utf8',windowsHide:true,timeout:60000,stdio:['ignore','pipe','pipe']});}catch{throw new SessionRehearsalCheckError('Operator-only Nox helper upload failed; no agent trade was attempted');}
 async function remoteAction(action,extra={},caseName=action){
  const payload=Buffer.from(JSON.stringify({action,factory:session.factory,vault:session.vault,owner:session.owner,agent:session.agent,factoryCodeHash:session.factoryCodeHash,vaultCodeHash:session.vaultCodeHash,...extra})).toString('base64');
  return new Promise((resolve,reject)=>{
   const child=spawn(fly,['ssh','console','-a',app,'--machine',machine,'--command','node '+remote+' '+payload+' --execute'],{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
   let stdout='',buffer='';const timer=setTimeout(()=>{child.kill();reject(new SessionRehearsalCheckError('Operator CLI timed out. Inspect any known hash before retrying.'));},240000);
   child.stdout.on('data',part=>{stdout+=part.toString();buffer+=part.toString();let end;while((end=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);const found=/^KUSARI_SESSION_TX (0x[0-9a-f]{64})$/.exec(line);if(found){evidence.pendingAgentTrade={case:caseName,hash:found[1],status:'receipt-unconfirmed'};save();console.log(caseName+' signed hash: '+found[1]);}}});
   child.on('error',()=>{clearTimeout(timer);reject(new SessionRehearsalCheckError('Operator CLI could not start'));});
   child.on('close',()=>{clearTimeout(timer);const lines=stdout.split(/\r?\n/).filter(line=>line.startsWith('KUSARI_SESSION_RESULT '));if(!lines.length)return reject(new SessionRehearsalCheckError('Operator CLI did not return a public result; inspect any known hash'));try{const result=JSON.parse(lines.at(-1).slice('KUSARI_SESSION_RESULT '.length));if(result.status==='failed')return reject(new SessionRehearsalCheckError(result.message));resolve(result);}catch{return reject(new SessionRehearsalCheckError('Operator CLI result could not be read'));}});
  });
 }
 async function ownerSend(label,functionName,args){
  const request={to:session.vault,data:encodeFunctionData({abi:vaultAbi,functionName,args})};const gas=(await pub.estimateGas({account:owner,...request}))*12n/10n;const fees=await pub.estimateFeesPerGas();
  check(gas<=1_000_000n&&fees.maxFeePerGas&&fees.maxPriorityFeePerGas!==undefined&&fees.maxPriorityFeePerGas<=fees.maxFeePerGas&&gas*fees.maxFeePerGas<=parseEther('0.001'),'Owner session-operation gas exceeds ceiling');
  const [pending,latest]=await Promise.all([pub.getTransactionCount({address:owner.address,blockTag:'pending'}),pub.getTransactionCount({address:owner.address,blockTag:'latest'})]);check(pending===latest,'Owner has a pending transaction; no new owner operation was signed');
  const raw=await owner.signTransaction({...request,chainId:11155111,type:'eip1559',value:0n,nonce:pending,gas,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas});const hash=keccak256(raw);evidence.pendingOwnerTransaction={label,hash};save();console.log(label+' signed hash: '+hash);
  try{check(await pub.sendRawTransaction({serializedTransaction:raw})===hash,'Unexpected owner broadcast hash');}catch{throw new SessionRehearsalCheckError('Owner broadcast is unconfirmed. Inspect '+hash+'; no resend will occur.');}
  let receipt;try{receipt=await pub.waitForTransactionReceipt({hash,timeout:180000});}catch{throw new SessionRehearsalCheckError('Owner receipt is unconfirmed. Inspect '+hash+'; no resend will occur.');}
  check(receipt.status==='success','Owner operation reverted: '+hash);evidence.ownerTransactions.push({step:label,hash,status:receipt.status,blockNumber:receipt.blockNumber.toString()});delete evidence.pendingOwnerTransaction;save();return receipt;
 }
 async function rateWad(){const slot=await pub.readContract({address:chain.uniswap.stateView,abi:stateAbi,functionName:'getSlot0',args:[main.poolId]});return slot[0]*slot[0]*10n**18n/(2n**192n);}
 async function open(budget,rate,seconds,label){const block=await pub.getBlock();const expiresAt=block.timestamp+BigInt(seconds);await ownerSend(label,'openSession',[parseEther(budget),expiresAt,rate]);return expiresAt;}
 async function trade(caseName,amount,expected,expectedReason){
  const result=await remoteAction('swap',{amountIn:amount,minAmountOut:'0'},caseName);evidence.trades.push({case:caseName,...result});if(result.hash)delete evidence.pendingAgentTrade;save();
  check(result.status===expected,caseName+' did not produce the required receipt outcome; inspect its known hash');
  check(result.route==='Anon-RPC / Nox','Session agent trade did not observe the required Nox route');
  const before=result.before,after=result.after;check(before&&after,'Session before/after proof missing');
  if(expected==='success'){
   check(BigInt(after.remainingBudget)===BigInt(before.remainingBudget)-parseEther(amount),'Session allowance did not consume the full requested amount');
   check(after.nonceUsed===true&&BigInt(after.spentToday)===BigInt(before.spentToday)+parseEther(amount),'Hook nonce/daily budget proof differs; concurrent same-agent activity must be reviewed');
   check(result.event&&BigInt(result.event.actualInput)>0n&&BigInt(result.event.actualInput)<=parseEther(amount),'Actual session input event is invalid');
   const required=(BigInt(result.event.actualInput)*BigInt(before.minRateWad)+10n**18n-1n)/10n**18n;check(BigInt(result.event.actualOutput)>=required,'Actual session output missed the owner floor');
  }else{
   check(result.preflightReason===expectedReason,'Preflight did not independently predict the expected session rejection; receipt reason is not encoded');
   for(const field of ['remainingBudget','token0Balance','token1Balance','spentToday','nonceUsed'])check(json(before[field])===json(after[field]),caseName+' did not preserve reverted '+field+'; concurrent shared-agent activity must be reviewed');
   check(json(before.poolSlot0)===json(after.poolSlot0),caseName+' pool state differs after revert; concurrent pool activity must be reviewed');
  }
  console.log(caseName+': '+result.status+' '+result.hash);return result;
 }
 try{
  evidence.agentOwnerOperations=await remoteAction('owner-ops');save();
  const loose=await rateWad()*90n/100n;await open('0.5',loose,600,'Owner opens finite .5 kUSD session');
  await trade('finite budget: first .25','0.25','success');await trade('finite budget: second .25','0.25','success');await trade('finite budget: third request rejected','0.25','reverted','SessionBudgetExceeded');
  await open('0.25',(await rateWad())*2n,600,'Owner sets stricter independent exchange floor');await trade('owner floor rejects agent minAmountOut=0','0.25','reverted','OwnerOutputFloorNotMet');
  const expiry=await open('0.25',await rateWad()*90n/100n,45,'Owner opens expiring session');console.log('Waiting for actual chain expiry (up to one minute)…');const until=Date.now()+75000;let expired=false;
  while(Date.now()<until){if((await pub.getBlock()).timestamp>=expiry+12n){expired=true;break;}await sleep(5000);}check(expired,'Actual chain expiry did not arrive within the bounded wait');
  await trade('expired session rejects next request','0.01','reverted','SessionExpired');await ownerSend('Owner closes only the new session','closeSession',[]);
  check(await pub.readContract({address:session.vault,abi:vaultAbi,functionName:'remainingBudget'})===0n,'Session cleanup did not revoke remaining allowance');
  evidence.mainAfter=await directSnapshot();check(json(evidence.mainAfter)===json(baseline),'Main demo token balances or ENS role changed during the session rehearsal');
  evidence.status='passed';evidence.completedAt=new Date().toISOString();evidence.actualSuccessfulTokenInput='0.5 kUSD';save();console.log('Passed separate Session-v1 live proof. Main demo vault and ENS role unchanged.');
 }catch(cause){evidence.status='failed';evidence.completedAt=new Date().toISOString();evidence.failure=cause instanceof SessionRehearsalCheckError?cause.message:'Session proof could not finish. Inspect recorded hashes before any retry.';save();throw new SessionRehearsalCheckError(evidence.failure);}
}
mainExecute().catch(cause=>{console.error(cause instanceof SessionRehearsalCheckError?cause.message:'Session rehearsal could not finish. Inspect public evidence and known hashes before retrying.');process.exitCode=1;});
