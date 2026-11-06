import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerPolicyProxy} from './owner-policy-http.mjs';
const origin='https://kusari.outcomeseal.com',token='s'.repeat(40);
function req(action,body={},from=origin) {
  return new Request(origin+'/api/policy-check/'+action,{method:'POST',headers:{origin:from,'content-type':'application/json'},body:JSON.stringify(body)});
}
test('canonical POST proxy fixes upstream path and keeps gateway credential server-side',async()=>{
  let calls=0;
  const proxy=createOwnerPolicyProxy({gatewayUrl:'https://kusari-demo-backend.fly.dev',token,fetchImpl:async(url,options)=>{
    calls++;assert.equal(url.href,'https://kusari-demo-backend.fly.dev/policy-check/challenge');
    assert.equal(options.headers.authorization,'Bearer '+token);assert.equal(JSON.parse(options.body).address,'owner');
    return Response.json({nonce:'public',message:'fixed'});
  }});
  assert.equal((await proxy(req('challenge',{address:'owner'}),'challenge')).status,200);assert.equal(calls,1);
  assert.equal((await proxy(req('challenge',{},'https://evil.example'),'challenge')).status,403);
  assert.equal((await proxy(req('withdraw'),'withdraw')).status,404);
  assert.equal((await proxy(req('run',{data:'x'.repeat(5000)}),'run')).status,413);assert.equal(calls,1);
});
test('network errors never expose diagnostic or gateway credential',async()=>{
  const proxy=createOwnerPolicyProxy({gatewayUrl:'https://kusari-demo-backend.fly.dev',token,fetchImpl:async()=>{throw Error('private diagnostic');}});
  const response=await proxy(req('result',{requestId:'id'}),'result');assert.equal(response.status,503);
  const text=await response.text();assert.doesNotMatch(text,new RegExp(token));assert.doesNotMatch(text,/private diagnostic/);
});
