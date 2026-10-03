const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../account-passwords.js'),'utf8');
function fixture({admin=false,authError=null,rpcError=null,claim=true}={}) {
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id)) nodes.set(id,{textContent:'',classList:{hidden:true,add(){this.hidden=true;},remove(){this.hidden=false;}},setAttribute(){}});
    return nodes.get(id);
  };
  const fields={newPassword:{value:'Test-only-123456',type:'password'},confirmation:{value:'Test-only-123456',type:'password'}};
  const form={elements:fields,reset(){this.cleared=true;},querySelectorAll(){return Object.values(fields);}};
  nodes.set('accountPasswordForm',form);
  const calls=[];
  const ctx={window:{},document:{getElementById:node,addEventListener(){}},currentProfile:{id:'own',username:'own-login'},
    state:{employees:[{id:'other',name:'Other teacher',username:'other-login'}]},isAdmin:()=>admin,
    escapeHtml:x=>x,escapeAttr:x=>x,createTemporaryPassword:()=> 'Random-Test-123456',cloudRequest:async p=>p,
    openModal:(title,body)=>{calls.push(['modal',title,body]);},closeModal:()=>{calls.push(['close']);},
    openCredentialResult:(...args)=>calls.push(['credentials',...args]),
    invokeCredentialUpdate:async(...args)=>{calls.push(['reset',...args]);return {ok:true};},
    supabaseClient:{auth:{updateUser:async args=>{calls.push(['update',args]);return {data:{user:{id:'own'}},error:authError};}},
      rpc:async name=>{calls.push(['rpc',name]);return {data:claim,error:rpcError};}}
  };
  vm.runInNewContext(source,ctx);
  return {api:ctx.window.SchoolPasswords,ctx,fields,form,node,calls,submit:()=>form.onsubmit({preventDefault(){}})};
}
test('own password is sent only to Auth, never to school save; success confirmed by own user ID',async()=>{
  const f=fixture();f.api.open();await f.submit();
  assert.equal(f.calls.filter(c=>c[0]==='update').length,1);
  assert.equal(f.calls.find(c=>c[0]==='update')[1].password,'Test-only-123456');
  assert.equal(f.calls.some(c=>c[0]==='reset'),false);
  assert.equal(f.form.cleared,true);
  assert.equal(f.calls.at(-1)[1],'Пароль изменён');
});
test('mismatch and short password never call the server',async()=>{
  const f=fixture();f.api.open();f.fields.confirmation.value='different';await f.submit();
  assert.match(f.node('accountPasswordStatus').textContent,/не совпадают/);
  f.fields.newPassword.value='short';await f.submit();assert.match(f.node('accountPasswordStatus').textContent,/12/);
  assert.equal(f.calls.some(c=>c[0]==='update'),false);
});
test('server failure keeps fields and never claims password was saved',async()=>{
  const f=fixture({authError:{status:503}});f.api.open();await f.submit();
  assert.equal(f.form.cleared,undefined);assert.equal(f.api.isBusy(),false);
  assert.equal(f.fields.newPassword.disabled,false);
  assert.match(f.node('accountPasswordStatus').textContent,/мог уже измениться/);
  assert.equal(f.calls.some(c=>c[1]==='Пароль изменён'),false);
});
test('teachers cannot open reset form; admin reset uses existing server-authorized endpoint',async()=>{
  const teacher=fixture();teacher.api.open('other');assert.equal(teacher.calls.length,0);
  const f=fixture({admin:true});f.api.open('other');await f.submit();
  assert.deepEqual(f.calls.find(c=>c[0]==='reset'),['reset','other-login','other-login','Test-only-123456']);
  assert.equal(f.calls.some(c=>c[0]==='update'),false);
  assert.equal(f.calls.at(-1)[0],'credentials');
});
test('double submit only sends once and account changes cannot submit old form',async()=>{
  const f=fixture();f.api.open();await Promise.all([f.submit(),f.submit()]);
  assert.equal(f.calls.filter(c=>c[0]==='update').length,1);
  const g=fixture();g.api.open();g.ctx.currentProfile={id:'different'};await g.submit();
  assert.equal(g.calls.some(c=>c[0]==='update'),false);
});
test('invitation is claimed once, can be skipped and never blocks login',async()=>{
  const f=fixture();await f.api.offer();await f.api.offer();
  assert.equal(f.calls.filter(c=>c[0]==='rpc').length,1);
  assert.equal(f.node('passwordSuggestion').classList.hidden,false);
  f.node('passwordSuggestionSkip').onclick();assert.equal(f.node('passwordSuggestion').classList.hidden,true);
  await f.api.offer();assert.equal(f.node('passwordSuggestion').classList.hidden,true);
  const no=fixture({claim:false});await no.api.offer();assert.equal(no.node('passwordSuggestion').classList.hidden,true);
  const error=fixture({rpcError:{status:503}});await error.api.offer();assert.equal(error.node('passwordSuggestion').classList.hidden,true);
});
test('server invitations cannot be claimed for someone else and anonymous execution is revoked',()=>{
  const sql=fs.readFileSync(require.resolve('../supabase/password_prompt.sql'),'utf8');
  assert.match(sql,/claim_password_change_prompt\(\)/);assert.match(sql,/values\(auth.uid\(\)\) on conflict do nothing/);
  assert.match(sql,/from public,anon;/);assert.match(sql,/enable row level security/);
  const edge=fs.readFileSync(require.resolve('../supabase/functions/manage-school-user/index.ts'),'utf8');
  assert.match(edge,/auth.getUser/);assert.match(edge,/is_admin/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|persistAndRender/);
});
