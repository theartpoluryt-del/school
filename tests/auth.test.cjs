const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('Auth and profile requests bypass browser HTTP caches',async()=>{
  let options;const fetcher=require('../auth-network.js').boundedFetch(async(_,o)=>{options=o;return {ok:true};});
  await fetcher('https://example.invalid/auth/v1/user',{cache:'force-cache'});
  assert.equal(options.cache,'no-store');
});
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function load(name,context) {
  const match=new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  const next=/\n(?:async )?function /.exec(source.slice(match.index+match[0].length));
  const end=next ? match.index+match[0].length+next.index : source.length;
  vm.runInContext(source.slice(match.index,end),context);
}
function fixture({username='admin',profileError=null,missing=false,cloudOk=true}={}) {
  const profile={id:'auth-id',username:'admin',is_admin:true};
  const button={disabled:false};
  const ctx=vm.createContext({
    console:{warn(){}},currentProfile:null,profileLoadError:null,authBusy:false,
    SchoolAuth:require('../auth-network.js'),cloudRequest:r=>Promise.resolve(r),
    state:{employees:[{id:'employee-id',username:'admin'}]},
    document:{querySelector:s=>({value:s==='#loginUsername'?username:'synthetic-password'})},
    supabaseClient:{
      auth:{signInWithPassword:async()=>({data:{user:{id:'auth-id'}}}),signOut:async()=>{ctx.signedOut=true;}},
      from:()=>({select:()=>({eq:()=>({single:async()=>({data:missing||profileError?null:profile,error:profileError})})})})
    },
    loadCloudState:async()=>cloudOk,
    setLoginStatus:message=>{ctx.message=message;},
    setLoginPasswordVisibility(){},render:()=>{ctx.rendered=true;}
  });
  ['login','loadCurrentProfile','normalizeEmployeeUsername','schoolAuthEmail'].forEach(n=>load(n,ctx));
  return {ctx,button,event:{preventDefault(){},submitter:button,target:{reset(){}}}};
}
test('API outage is not misreported as missing profile; access remains closed',async()=>{
  const {ctx,button,event}=fixture({profileError:{code:'PGRST002',message:'schema cache unavailable'}});
  await ctx.login(event);
  assert.match(ctx.message,/сервер временно недоступен/);
  assert.equal(ctx.currentProfile,null);
  assert.equal(ctx.state.sessionEmployeeId,undefined);
  assert.equal(ctx.signedOut,true);
  assert.equal(button.disabled,false);
});
test('genuinely missing employee profile is distinguished from outage',async()=>{
  const {ctx,event}=fixture({missing:true,profileError:{code:'PGRST116'}});
  await ctx.login(event);
  assert.match(ctx.message,/Профиль сотрудника не настроен/);
  assert.equal(ctx.state.sessionEmployeeId,undefined);
});
test('school data failure does not grant a local admin session',async()=>{
  const {ctx,event}=fixture({cloudOk:false});
  await ctx.login(event);
  assert.match(ctx.message,/Не удалось загрузить школьную базу/);
  assert.equal(ctx.currentProfile,null);
  assert.equal(ctx.state.sessionEmployeeId,undefined);
});
test('login casing is normalized and own employee selected after server verification',async()=>{
  const {ctx,event}=fixture({username:' Admin '});
  await ctx.login(event);
  assert.equal(ctx.state.sessionEmployeeId,'employee-id');
  assert.equal(ctx.state.activeEmployeeId,'employee-id');
  assert.equal(ctx.state.employees[0].isAdmin,true);
  assert.equal(ctx.rendered,true);
});

test('network failures and invalid credentials produce different messages and unlock login',async()=>{
  for (const error of [{code:'invalid_credentials'}, {status:503}, {status:429}]) {
    const {ctx,button,event}=fixture();
    ctx.supabaseClient.auth.signInWithPassword=async()=>({data:null,error});
    await ctx.login(event);
    assert.equal(ctx.message.includes('Неверный логин'),error.code==='invalid_credentials');
    assert.equal(button.disabled,false);
    assert.equal(ctx.authBusy,false);
    assert.equal(ctx.state.sessionEmployeeId,undefined);
  }
});

test('hung sign-in and profile requests release the form, never granting access',async()=>{
  for (const stage of ['auth','profile']) {
    const {ctx,button,event}=fixture();
    ctx.cloudRequest=r=>require('../sync-model.js').request(r,10);
    if (stage==='auth') ctx.supabaseClient.auth.signInWithPassword=()=>new Promise(()=>{});
    else ctx.loadCurrentProfile=()=>ctx.cloudRequest(new Promise(()=>{}));
    await ctx.login(event);
    assert.match(ctx.message,/слишком много времени/);
    assert.equal(button.disabled,false);
    assert.equal(ctx.authBusy,false);
    assert.equal(ctx.currentProfile,null);
    assert.equal(ctx.state.sessionEmployeeId,undefined);
  }
});

test('double submission cannot race two account logins',async()=>{
  const {ctx,event}=fixture();let calls=0,release;
  ctx.supabaseClient.auth.signInWithPassword=()=>{calls++;return new Promise(resolve=>release=resolve);};
  const pending=ctx.login(event);
  await ctx.login(event);
  assert.equal(calls,1);
  release({data:null,error:{code:'invalid_credentials'}});
  await pending;
});

test('session recovery removes only the school auth keys',()=>{
  const removed=[];
  require('../auth-network.js').clearSession({removeItem:key=>removed.push(key)},'https://example.supabase.co');
  assert.deepEqual(removed,['sb-example-auth-token','sb-example-auth-token-code-verifier','sb-example-auth-token-user']);
});

test('SDK fetch timeout and caller cancellation abort the actual network request',async()=>{
  const {boundedFetch}=require('../auth-network.js');
  const fetcher=(_url,{signal})=>new Promise((resolve,reject)=>{
    if(signal.aborted) reject(new Error('aborted'));
    else signal.addEventListener('abort',()=>reject(new Error('aborted')));
  });
  await assert.rejects(boundedFetch(fetcher,10)('https://example.test'),/aborted/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(boundedFetch(fetcher)('https://example.test',{signal:controller.signal}),/aborted/);
});
