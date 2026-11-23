import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createAccountsServer} from './accounts.mjs';

async function fixture(t, {admin=true,authFailure=0} = {}) {
  const calls=[];
  const fetcher=async (url,options) => {
    calls.push({url,options});
    if (url==='http://auth/user') {
      if (options.headers.Authorization!=='Bearer real-session') return Response.json({}, {status:401});
      return Response.json({id:'admin-user'});
    }
    if (url.includes('select=is_admin')) return Response.json([{is_admin:admin}]);
    if (url.includes('select=id,username')) return Response.json([{id:'teacher-user',username:'teacher'}]);
    if (url.includes('/rpc/admin_sync_employee_username')) return Response.json('2026-11-23T12:00:00Z');
    if (url==='http://auth/admin/users/teacher-user') return Response.json({}, {status:authFailure || 200});
    throw new Error('Unexpected request '+url);
  };
  const server=createAccountsServer({authUrl:'http://auth',restUrl:'http://rest',serviceKey:'private-service-key',fetcher,allowedOrigins:['https://muzjur.ru']});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const url=`http://127.0.0.1:${server.address().port}/functions/v1/manage-school-user`;
  const reset=(body={},token='real-session')=>fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({currentUsername:'teacher',newUsername:'teacher',newPassword:'Long-password-123',...body})});
  return {calls,reset,url};
}

test('browser preflight permits the school site without changing credentials',async t=>{
  const f=await fixture(t);
  const response=await fetch(f.url,{method:'OPTIONS',headers:{Origin:'https://muzjur.ru','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,apikey,content-type'}});
  assert.equal(response.status,204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://muzjur.ru');
  assert.match(response.headers.get('Access-Control-Allow-Headers'),/authorization/);
  assert.equal(f.calls.length,0);
});

test('browser preflight denies unlisted origins',async t=>{
  const f=await fixture(t);
  const response=await fetch(f.url,{method:'OPTIONS',headers:{Origin:'https://unrelated.example'}});
  assert.equal(response.status,403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
  assert.equal(f.calls.length,0);
});

test('password reset requires a verified admin session',async t=>{
  const f=await fixture(t,{admin:false});
  assert.equal((await f.reset()).status,403);
  assert.equal(f.calls.some(c=>c.url.includes('/admin/users/')),false);
});
test('invalid bearer token cannot change credentials',async t=>{
  const f=await fixture(t);
  assert.equal((await f.reset({},'forged-token')).status,401);
  assert.equal(f.calls.length,1);
});
test('authenticated admin resets a password and secrets stay in server requests',async t=>{
  const f=await fixture(t);
  const result=await f.reset();
  assert.equal(result.status,200);
  const json=await result.json();
  assert.equal(json.ok,true);
  assert.equal(json.passwordChanged,true);
  assert.equal(JSON.stringify(json).includes('Long-password'),false);
  const write=f.calls.find(c=>c.options.method==='PUT');
  assert.equal(write.options.headers.Authorization,'Bearer private-service-key');
  assert.equal(JSON.parse(write.options.body).password,'Long-password-123');
});
test('weak password is rejected before an Auth write',async t=>{
  const f=await fixture(t);
  assert.equal((await f.reset({newPassword:'short'})).status,400);
  assert.equal(f.calls.some(c=>c.options.method==='PUT'),false);
});
test('login rename keeps the existing RPC and Auth update behavior',async t=>{
  const f=await fixture(t);
  const response=await f.reset({newUsername:'teacher.new',newPassword:''});
  assert.equal(response.status,200);
  const write=f.calls.find(c=>c.options.method==='PUT');
  assert.deepEqual(JSON.parse(write.options.body),{email:'teacher.new@journal.local',email_confirm:true});
  assert.equal((await response.json()).passwordChanged,false);
});
test('a rejected Auth rename restores the profile username',async t=>{
  const f=await fixture(t,{authFailure:422});
  assert.equal((await f.reset({newUsername:'teacher.new'})).status,503);
  const renames=f.calls.filter(c=>c.url.endsWith('/rpc/admin_sync_employee_username'));
  assert.equal(renames.length,2);
  assert.equal(JSON.parse(renames[1].options.body).new_username,'teacher');
});
test('an ambiguous server error does not undo a potentially accepted Auth rename',async t=>{
  const f=await fixture(t,{authFailure:503});
  assert.equal((await f.reset({newUsername:'teacher.new'})).status,503);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/rpc/admin_sync_employee_username')).length,1);
});
