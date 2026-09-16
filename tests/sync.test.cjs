const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const SchoolSync=require('../sync-model.js');
test('concurrent teachers and different fields merge without lost edits',()=>{
  const b={records:[{id:'1',grade:'',type:'Специальность'},{id:'2',grade:''}]};
  const l=structuredClone(b),r=structuredClone(b);
  l.records[0].type='Сценическая речь';r.records[1].grade='5';
  const out=SchoolSync.payload(b,l,r);
  assert.equal(out.records[0].type,'Сценическая речь');assert.equal(out.records[1].grade,'5');
});
test('same-field conflicts and delete/edit conflicts never silently overwrite',()=>{
  assert.throws(()=>SchoolSync.merge({grade:''},{grade:'4'},{grade:'5'}));
  assert.throws(()=>SchoolSync.merge([{id:'1',grade:''}],[],[{id:'1',grade:'5'}]));
});
function fixture(rpc) {
  const c=vm.createContext({structuredClone,SchoolSync,console:{warn(){}},window:{clearTimeout(){},setTimeout(){return 1;}},
    cloudSaveTimer:null,cloudSavePromise:null,cloudSaveInFlight:false,cloudDirty:true,cloudRevision:1,secureCloudMode:true,
    cloudReady:true,cloudStateId:'s',cloudStateVersion:'v1',cloudBaseline:{records:[]},state:{records:[],sessionEmployeeId:'t'},
    supabaseClient:{rpc,auth:{signOut:async()=>{c.signedOut=true;}}},cloudPayload:()=>structuredClone(c.state),
    migrateState:x=>structuredClone(x),setSyncStatus:(message,kind)=>{c.message=message;c.kind=kind;},
    currentTimeLabel:()=> '12:00',render(){},alert:m=>{c.alert=m;},createDemoData:()=>({}),
    setLoginPasswordVisibility(){},currentProfile:null});
  const src=fs.readFileSync(require.resolve('../app.js'),'utf8');
  for(const name of ['flushCloudSave','saveCloudChanges','ensureCloudSaved','logout']) {
    const start=src.indexOf(`async function ${name}(`),end=src.slice(start+1).search(/\n(?:async )?function /);
    vm.runInContext(src.slice(start,end<0?undefined:start+1+end),c);
  }
  return c;
}
test('failed save remains dirty and prevents logout',async()=>{
  const c=fixture(async()=>({error:{code:'503',message:'offline'}}));
  await c.logout();assert.equal(c.signedOut,undefined);assert.equal(c.cloudDirty,true);assert.equal(c.kind,'error');
});
test('logout waits for server acknowledgement',async()=>{
  let release;const c=fixture(()=>new Promise(r=>{release=r;}));
  const out=c.logout();assert.equal(c.signedOut,undefined);
  release({data:{updated_at:'v2'}});await out;assert.equal(c.signedOut,true);
});
test('edit during in-flight save is saved in a second request',async()=>{
  let release,calls=0;const c=fixture(async()=>{calls++;if(calls===1)return new Promise(r=>release=r);return {data:{updated_at:'v3'}};});
  const out=c.flushCloudSave();c.state.records.push({id:'new'});c.cloudRevision++;
  release({data:{updated_at:'v2'}});assert.equal(await out,true);assert.equal(calls,2);assert.equal(c.cloudDirty,false);
});
