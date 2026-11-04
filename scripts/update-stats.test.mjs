import test from 'node:test';
import assert from 'node:assert/strict';
import { API, countCommits, replaceStats, collect } from './update-stats.mjs';

test('paginates beyond 100 entries', async () => {
  const api = new API('test');
  const calls = [];
  api.request = async path => { calls.push(path); return path.endsWith('page=1') ? Array(100).fill({}) : [{}]; };
  assert.equal((await api.pages('/commits?author=example')).length, 101);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /per_page=100&page=2/);
});
test('deduplicates branches, commits, repositories and checks account ID', async () => {
  const unique = new Set(); let scanned = 0;
  const api = { pages: async path => {
    if (path.endsWith('/branches')) return [{commit:{sha:'a'}},{commit:{sha:'a'}},{commit:{sha:'b'}}];
    assert.match(path, /author=example&sha=/); scanned++;
    return [{sha:'one',author:{id:1}},{sha:'two',author:{id:2}}, {sha:'three',author:null}];
  }};
  await countCommits(api,{full_name:'example/one'},1,'example',unique);
  await countCommits(api,{full_name:'example/two'},1,'example',unique);
  assert.equal(scanned,4); assert.equal(unique.size,1);
});
test('empty repositories succeed; inaccessible repositories fail', async () => {
  const api = { pages: async () => { throw Object.assign(new Error(),{status:409,apiMessage:'Git Repository is empty.'}); }};
  await countCommits(api,{full_name:'x/y'},1,'x',new Set());
  api.pages = async () => { throw Object.assign(new Error('inaccessible'),{status:404}); };
  await assert.rejects(countCommits(api,{full_name:'x/y'},1,'x',new Set()),/inaccessible/);
});
test('retries rate limits and server errors', async () => {
  let calls = 0; const waits=[];
  const api = new API('test', async () => {
    calls++;
    return new Response(JSON.stringify(calls < 3 ? {message:'rate limit'} : {ok:true}),
      {status:calls===1?429:calls===2?503:200});
  }, async ms => waits.push(ms));
  assert.deepEqual(await api.request('/user'),{ok:true});
  assert.equal(waits.length,2); assert.ok(waits[0]>=60000);
});
test('GraphQL partial errors fail instead of publishing partial totals', async () => {
  const api = new API('test',async()=>new Response(JSON.stringify({data:{},errors:[{message:'denied'}]})));
  await assert.rejects(api.graphql('query{}',{}),/GraphQL/);
});
test('incomplete private coverage is rejected', async () => {
  const api = { request:async()=>({login:'ukaninirmik65-hash',id:1,owned_private_repos:2,public_repos:0}), pages:async()=>[] };
  await assert.rejects(collect(api),/coverage mismatch/);
});
test('README replacement preserves surrounding content and validates markers', () => {
  const input='before<!-- LIVE-STATS:START -->old<!-- LIVE-STATS:END -->after';
  assert.equal(replaceStats(input,'new'),'before<!-- LIVE-STATS:START -->\n\nnew\n<!-- LIVE-STATS:END -->after');
  assert.throws(()=>replaceStats('missing','new'));
});
