const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
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
    console:{warn(){}},currentProfile:null,profileLoadError:null,
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
