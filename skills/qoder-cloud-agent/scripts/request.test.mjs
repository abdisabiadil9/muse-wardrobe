import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRequest,performRequest,main,BASE} from './request.mjs';
test('Preview needs no secrets and makes no network call',async()=>{
  let result;await main(['request','--method','POST','--path','/sessions'],{env:{},fetchImpl:()=>assert.fail('network'),output:r=>result=r});
  assert.equal(result.mode,'preview');assert.equal(result.url,BASE+'/sessions');
});
test('Reject absolute, traversal, unsupported family and GET body',()=>{
  for(const path of ['https://evil.example/agents','//evil.example','/sessions/../agents','/sessions/%2e%2e/agents','/api/v1/forward/identities','/agents#fragment'])assert.throws(()=>prepareRequest({path}));
  assert.throws(()=>prepareRequest({path:'/agents',body:{}}));
});
test('Only fixed CN origin receives auth; redirects rejected',async()=>{
  let seen;const result=await performRequest(prepareRequest({path:'/agents?limit=1'}),{token:'test-secret',fetchImpl:async(url,init)=>{seen={url,init};return new Response('{"data":[]}');}});
  assert.deepEqual(result,{data:[]});assert.equal(seen.url,BASE+'/agents?limit=1');assert.equal(seen.init.redirect,'error');
  await assert.rejects(()=>performRequest({method:'GET',url:'https://evil.example'},{token:'test-secret',fetchImpl:()=>assert.fail('network')}));
});
test('Lost POST response is uncertain and never auto retried',async()=>{
  let n=0;await assert.rejects(()=>performRequest(prepareRequest({method:'POST',path:'/sessions',body:{}}),{token:'test',fetchImpl:async()=>{n++;throw new Error('internal secret');}}),e=>e.uncertain&&!e.message.includes('secret'));
  assert.equal(n,1);
});
test('204 deletion does not require a JSON response',async()=>{
  assert.equal((await performRequest(prepareRequest({method:'DELETE',path:'/memory_stores/memstore_test/memories/mem_test'}),{token:'test',fetchImpl:async()=>new Response(null,{status:204})})).status,204);
});
