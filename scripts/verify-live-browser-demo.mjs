import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(repo+'agent/package.json');
const {createPublicClient,http,parseAbi,decodeFunctionData,decodeAbiParameters,parseEther,keccak256,toBytes}=require('viem');
const {sepolia}=require('viem/chains');
const dep=JSON.parse(readFileSync(repo+'deployments/11155111.json'));
const ens=JSON.parse(readFileSync(repo+'deployments/11155111-ens.json'));
const chain=JSON.parse(readFileSync(repo+'config/chains.json'))['11155111'];
const client=createPublicClient({chain:sepolia,transport:http(chain.rpc,{timeout:30000,retryCount:2})});
const assert=(v,m)=>{if(!v)throw new Error(m);};
const eq=(a,b)=>a.toLowerCase()===b.toLowerCase();
const policyType='(uint128 maxPerSwap,uint128 dailyCap,uint16 maxImpactBps,bytes32 allowedPool,bool active)';
const abi=parseAbi(['function setData(bytes name,string key,bytes value)','function revokeRoles(uint256 anyId,uint256 roleBitmap,address account) returns(bool)','function grantRoles(uint256 anyId,uint256 roleBitmap,address account) returns(bool)',`function policyOf(address agent) view returns(${policyType})`,'function isAuthorized(address agent) view returns(bool)']);
const swapAbi=parseAbi(['function swap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(address agent,address vault,bytes32 poolId,bool zeroForOne,uint256 amountIn,uint256 minAmountOut,uint256 nonce,uint256 deadline) intent,bytes signature) returns(int256)']);
const cases=[
 ['baseline-fixed-two','0x2e71d3552d16f6602302eec2de490736cb8fbd75b37dfed3fda2fd4399376e76','success','swap','2'],
 ['ens-cap-one','0x678590d997ac7d2912fa366eb5e66c724b7e96b143faf3dabc805bf5e0a4317f','success','setData','1'],
 ['same-two-over-cap','0xb8bb08ad97eda13dbe3d7557ffc16a973f6de4a519d4dd0b6f143347b0fad481','reverted','swap','2'],
 ['ens-cap-five-restored','0x4f7f2701adbe1f9f87559a0ad40db1288980fa638dba4830d76baefb16529088','success','setData','5'],
 ['ens-freeze','0x0fee035ea61dd213600478c5835832eadc2ed516eb960aa60c0399eb2b295ce2','success','revokeRoles'],
 ['two-while-frozen','0xe0e22b73d30b97550d02b73701603adef23274c5ffd63cdbe88d98e14b60391c','reverted','swap','2'],
 ['ens-role-restored','0xa20c5fd8254761cb2f5ce197f83185b24b02a3e0516ad5fb22fb2ecd6194701a','success','grantRoles'],
 ['gemini-resumed-one','0x4576e47890febaad4b7d5904df89bde0ac4c12362cceb2f82f6ba5a3b778938e','success','swap','1'],
];
assert(await client.getChainId()===11155111,'Wrong chain');
const transactions=[];let previousBlock=0n;
for(const [step,hash,status,method,amount] of cases){
 const [receipt,tx]=await Promise.all([client.getTransactionReceipt({hash}),client.getTransaction({hash})]);
 assert(receipt.status===status&&receipt.blockNumber>previousBlock,'Receipt outcome or chronology mismatch: '+step);previousBlock=receipt.blockNumber;
 assert(tx.value===0n,'Unexpected native value');
 const decoded=decodeFunctionData({abi:method==='swap'?swapAbi:abi,data:tx.input});assert(decoded.functionName===method,'Wrong method');
 let details={};
 if(method==='swap'){
  const [key,intent]=decoded.args;
  assert(eq(tx.from,ens.agent)&&eq(tx.to,dep.demoVault)&&eq(intent.agent,ens.agent)&&eq(intent.vault,dep.demoVault)&&eq(intent.poolId,dep.poolId)&&intent.amountIn===parseEther(amount)&&intent.zeroForOne&&eq(key.hooks,dep.policyHook)&&eq(key.currency0,dep.token0)&&eq(key.currency1,dep.token1),'Wrong fixed trade calldata');
  details={requestedKUSD:amount,agent:tx.from,vault:tx.to};
 }else{
  assert(eq(tx.from,ens.owner),'Wrong owner');
  if(method==='setData'){
   assert(eq(tx.to,ens.resolver)&&eq(decoded.args[0],ens.dnsName)&&decoded.args[1]==='kusari.policy','Wrong ENS policy target');
   const [p]=decodeAbiParameters([{type:'tuple',components:[{name:'maxPerSwap',type:'uint128'},{name:'dailyCap',type:'uint128'},{name:'maxImpactBps',type:'uint16'},{name:'allowedPool',type:'bytes32'},{name:'active',type:'bool'}]}],decoded.args[2]);
   assert(p.maxPerSwap===parseEther(amount)&&p.dailyCap===parseEther('100')&&p.maxImpactBps===200&&eq(p.allowedPool,dep.poolId)&&p.active,'Unrelated policy field changed');details={capKUSD:amount,otherPolicyFieldsPreserved:true};
  }else{
   assert(eq(tx.to,ens.userRegistry)&&decoded.args[0]===BigInt(keccak256(toBytes(ens.name.split('.')[0])))&&decoded.args[1]===65536n&&eq(decoded.args[2],ens.agent),'Wrong ENS role edit');details={roleBitmap:'65536',agent:ens.agent};
  }
 }
 transactions.push({step,hash,status,blockNumber:receipt.blockNumber.toString(),method,...details});console.log(step+': '+status+' '+hash);
}
const [policy,authorized]=await Promise.all([client.readContract({address:dep.policySource,abi,functionName:'policyOf',args:[ens.agent]}),client.readContract({address:dep.policySource,abi,functionName:'isAuthorized',args:[ens.agent]})]);
assert(policy.maxPerSwap===parseEther('5')&&policy.dailyCap===parseEther('100')&&policy.maxImpactBps===200&&eq(policy.allowedPool,dep.poolId)&&policy.active&&authorized,'Final shared demo not restored');
const result={status:'passed',verifiedAt:new Date().toISOString(),chainId:11155111,origin:'https://kusari.outcomeseal.com',name:ens.name,owner:ens.owner,agent:ens.agent,vault:dep.demoVault,transactions,finalState:{capKUSD:'5',dailyCapKUSD:'100',maxImpactBps:200,authorized:true},notes:['New browser walkthrough with human MetaMask signatures and confirmations; wallet popup is outside recorded page.','Fixed 2 kUSD cases are deterministic and do not call Gemini. The last 1 kUSD trade follows the real Gemini decision observed in the browser.','Receipts confirm status, not decoded revert reasons. ExceedsPerSwap and NotAuthorized were separately observed in simulation.','Independent receipt/calldata verification uses public RPC and no signing keys. Video edits shorten waits and label reading holds.']};
writeFileSync(repo+'docs/evidence/live-browser-demo.json',JSON.stringify(result,null,2)+'\n');
console.log('All eight new browser receipts/calldata verified; cap5 and authorization restored.');
