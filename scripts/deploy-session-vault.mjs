// Separate Session-v1 deployment. Preview by default; --execute broadcasts Sepolia transactions.
// Owner key remains local. No existing deployment manifest, ENS role or main vault is changed.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../agent/package.json',import.meta.url));
const {createPublicClient,http,encodeDeployData,encodeFunctionData,decodeEventLog,parseEther,keccak256}=require('viem');
const {privateKeyToAccount,nonceManager}=require('viem/accounts');const {sepolia}=require('viem/chains');
class SessionDeploymentCheckError extends Error {}
async function main(){
const root=fileURLToPath(new URL('../',import.meta.url));if(existsSync(root+'.env'))process.loadEnvFile(root+'.env');
const main=JSON.parse(readFileSync(root+'deployments/11155111.json','utf8'));
const ens=JSON.parse(readFileSync(root+'deployments/11155111-ens.json','utf8'));
const chain=JSON.parse(readFileSync(root+'config/chains.json','utf8'))['11155111'];
const artifact=JSON.parse(readFileSync(root+'contracts/out/SessionVaultFactory.sol/SessionVaultFactory.json','utf8'));
const file=root+'deployments/11155111-session.json';
const manifest=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{version:'session-v1',chainId:11155111,owner:ens.owner,agent:ens.agent,hook:main.policyHook,policySource:main.policySource,poolManager:chain.uniswap.poolManager,token0:main.token0,token1:main.token1,allowedPool:main.poolId,ensName:ens.name,policyCoupling:'This rehearsal reuses the shared agent and ENS binding. Its ENS daily cap and role apply across all vaults of that agent; session allowances are per vault.',transactions:[]};
const equal=(a,b)=>a.toLowerCase()===b.toLowerCase();
function check(value,message){if(!value)throw new SessionDeploymentCheckError(message);}
for(const field of ['owner','agent'])check(equal(manifest[field],ens[field]),'Session owner/agent pins differ from the verified ENS manifest');
for(const[field,expected]of Object.entries({hook:main.policyHook,policySource:main.policySource,poolManager:chain.uniswap.poolManager,token0:main.token0,token1:main.token1,allowedPool:main.poolId}))check(equal(manifest[field],expected),'Session pool/contract pins differ from the verified demo');
check(main.chainId===11155111&&manifest.chainId===11155111,'Sepolia only');
if(!process.argv.includes('--execute')){console.log(JSON.stringify({mode:'preview',newManifest:'deployments/11155111-session.json',owner:manifest.owner,agent:manifest.agent,steps:['Deploy separate SessionVaultFactory if absent','Create one owner-held SessionAgentVault if absent','Mint up to 2 valueless test kUSD to this new vault'],gasCeiling:16500000,maxFeeReservationETHPerTransaction:'0.001',policyCoupling:manifest.policyCoupling},null,2));process.exit(0);}
check(process.env.OWNER_PRIVATE_KEY,'Local OWNER_PRIVATE_KEY is required');
const account=privateKeyToAccount(process.env.OWNER_PRIVATE_KEY,{nonceManager});check(equal(account.address,manifest.owner),'Local owner key does not match pinned owner');
const pub=createPublicClient({chain:sepolia,transport:http(process.env.SEPOLIA_RPC_URL||chain.rpc,{timeout:45_000,retryCount:1})});
check(await pub.getChainId()===11155111,'Deployment RPC is not Sepolia');
manifest.transactions ??= [];
const save=()=>{Object.assign(manifest,{sessionVaultFactory:manifest.factory,sessionVault:manifest.vault,policyHook:manifest.hook,poolId:manifest.allowedPool});writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');};
function acceptReceipt(label,receipt){
 check(receipt.status==='success',label+' reverted; inspect the recorded hash before retrying');
 if(label==='Deploy separate SessionVaultFactory'){check(receipt.contractAddress,'Factory deployment address missing');manifest.factory=receipt.contractAddress;}
 if(label==='Create separate owner-held SessionAgentVault'){
  for(const log of receipt.logs){if(!equal(log.address,manifest.factory))continue;try{const decoded=decodeEventLog({abi:artifact.abi,data:log.data,topics:log.topics});if(decoded.eventName==='VaultCreated')manifest.vault=decoded.args.vault;}catch{}}
  check(manifest.vault,'VaultCreated event missing');manifest.sessionVaultDeploymentBlock=receipt.blockNumber.toString();
 }
 if(label==='Mint 2 test kUSD to new session vault'){manifest.fundingTx=receipt.transactionHash;manifest.initialTestFunding='2';}
 if(!manifest.transactions.some(t=>t.hash===receipt.transactionHash))manifest.transactions.push({step:label,hash:receipt.transactionHash,status:receipt.status,gasUsed:receipt.gasUsed.toString(),effectiveGasPrice:receipt.effectiveGasPrice.toString()});
 delete manifest.pendingTransaction;save();
}
if(manifest.pendingTransaction){
 let receipt;try{receipt=await pub.getTransactionReceipt({hash:manifest.pendingTransaction.hash});}catch{throw new SessionDeploymentCheckError('A recorded deployment transaction is still unconfirmed: '+manifest.pendingTransaction.hash+'. No transaction was resent.');}
 acceptReceipt(manifest.pendingTransaction.label,receipt);
}

async function send(label,request){
 const gas=(await pub.estimateGas({account,...request}))*12n/10n;
 const fees=await pub.estimateFeesPerGas();check(gas<=16_500_000n&&fees.maxFeePerGas&&fees.maxPriorityFeePerGas!==undefined&&fees.maxPriorityFeePerGas<=fees.maxFeePerGas&&gas*fees.maxFeePerGas<=parseEther('0.001'),'Deployment gas/fee estimate exceeds the preapproved ceiling');
 check(await pub.getBalance({address:account.address})>=gas*fees.maxFeePerGas,'Owner needs more Sepolia gas before deployment');
 const [pendingNonce,latestNonce]=await Promise.all([pub.getTransactionCount({address:account.address,blockTag:'pending'}),pub.getTransactionCount({address:account.address,blockTag:'latest'})]);
 check(pendingNonce===latestNonce,'Owner has a pending transaction; finish it before session deployment');
 const raw=await account.signTransaction({...request,value:0n,chainId:11155111,type:'eip1559',nonce:pendingNonce,gas,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas});
 const hash=keccak256(raw);manifest.pendingTransaction={label,hash};save();console.log(label+' signed hash: '+hash);
 try{check(await pub.sendRawTransaction({serializedTransaction:raw})===hash,'RPC returned an unexpected transaction hash');}catch{throw new SessionDeploymentCheckError('Broadcast is unconfirmed for '+hash+'. Inspect the recorded hash; this helper will not blindly resend.');}
 let receipt;try{receipt=await pub.waitForTransactionReceipt({hash,timeout:180_000});}catch{throw new SessionDeploymentCheckError('Receipt is unconfirmed for '+hash+'. The recorded hash must be inspected before retrying.');}
 acceptReceipt(label,receipt);return receipt;
}
if(!manifest.factory){const data=encodeDeployData({abi:artifact.abi,bytecode:artifact.bytecode.object,args:[manifest.poolManager,manifest.hook,manifest.token0,manifest.token1,manifest.allowedPool]});const receipt=await send('Deploy separate SessionVaultFactory',{data});check(receipt.contractAddress,'Factory deployment address missing');manifest.factory=receipt.contractAddress;save();}
const factoryCode=await pub.getCode({address:manifest.factory});check(factoryCode&&factoryCode!=='0x','Session factory code missing');manifest.factoryCodeHash=keccak256(factoryCode);
for(const field of ['poolManager','hook','token0','token1','allowedPool'])check(equal(await pub.readContract({address:manifest.factory,abi:artifact.abi,functionName:field}),manifest[field]),'Deployed session factory pin mismatch');
if(!manifest.vault){const receipt=await send('Create separate owner-held SessionAgentVault',{to:manifest.factory,data:encodeFunctionData({abi:artifact.abi,functionName:'create',args:[manifest.agent]})});for(const log of receipt.logs){if(!equal(log.address,manifest.factory))continue;try{const decoded=decodeEventLog({abi:artifact.abi,data:log.data,topics:log.topics});if(decoded.eventName==='VaultCreated')manifest.vault=decoded.args.vault;}catch{}}check(manifest.vault,'Factory VaultCreated event missing');save();}
const vaultArtifact=JSON.parse(readFileSync(root+'contracts/out/SessionAgentVault.sol/SessionAgentVault.json','utf8'));
for(const field of ['owner','agent','poolManager','hook','token0','token1','allowedPool'])check(equal(await pub.readContract({address:manifest.vault,abi:vaultArtifact.abi,functionName:field}),manifest[field]),'Deployed session vault pin mismatch');
const {parseAbi}=require('viem');const tokenAbi=parseAbi(['function mint(address to,uint256 amount)','function balanceOf(address owner) view returns(uint256)']);
if(!manifest.fundingTx){const amount=parseEther('2');const receipt=await send('Mint 2 test kUSD to new session vault',{to:manifest.token0,data:encodeFunctionData({abi:tokenAbi,functionName:'mint',args:[manifest.vault,amount]})});manifest.fundingTx=receipt.transactionHash;manifest.initialTestFunding='2';save();}
manifest.vaultCodeHash=keccak256(await pub.getCode({address:manifest.vault}));manifest.deployedAt=new Date().toISOString();save();
console.log('Verified separate session factory '+manifest.factory+'; vault '+manifest.vault+'. Original demo configuration and ENS roles remain unchanged.');

}
main().catch(cause=>{console.error(cause instanceof SessionDeploymentCheckError?cause.message:'Session deployment could not finish. Inspect deployments/11155111-session.json and any recorded pending hash before retrying.');process.exitCode=1;});
