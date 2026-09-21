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
  for(const name of ['cloudRequest','flushCloudSave','saveCloudChanges','ensureCloudSaved','logout']) {
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

test('hung request is bounded and aborts fetch even if SDK does not settle',async()=>{
  let signal;
  const builder={abortSignal(s){signal=s;return new Promise(()=>{});}};
  await assert.rejects(SchoolSync.request(builder,10),{code:'CLIENT_TIMEOUT'});
  assert.equal(signal.aborted,true);
});

test('timed out save stays dirty, releases the queue and can be retried',async()=>{
  let calls=0,late;
  const c=fixture(()=> ++calls===1 ? new Promise(r=>late=r) : Promise.resolve({data:{updated_at:'v3'}}));
  c.cloudRequest=request=>SchoolSync.request(request,10);
  assert.equal(await c.flushCloudSave(),false);
  assert.equal(c.cloudSavePromise,null);assert.equal(c.cloudSaveInFlight,false);
  assert.equal(c.cloudDirty,true);assert.equal(c.cloudStateVersion,'v1');
  assert.equal(await c.flushCloudSave(),true);
  late({data:{updated_at:'v2'}});await new Promise(r=>setImmediate(r));
  assert.equal(c.cloudStateVersion,'v3');assert.equal(c.cloudDirty,false);
});

test('version conflict is rebased before retry, preserving both edits',async()=>{
  let calls=0;
  const c=fixture(async(name,args)=>{
    if(name==='get_school_context') return {data:{updated_at:'v2',payload:{records:[{id:'remote'}]}}};
    if(++calls===1) return {error:{code:'PT409',message:'conflict'}};
    assert.equal(args.expected_updated_at,'v2');
    assert.deepEqual(Array.from(args.new_payload.records,x=>x.id),['remote','local']);
    return {data:{updated_at:'v3'}};
  });
  c.state.records.push({id:'local'});
  assert.equal(await c.flushCloudSave(),true);assert.equal(calls,2);
});

test('repeated conflicts stop and retain local changes, never loop forever',async()=>{
  let saves=0;
  const c=fixture(async name=>name==='get_school_context'
    ? {data:{updated_at:'v'+saves,payload:{records:[]}}}
    : (++saves,{error:{code:'PT409',message:'conflict'}}));
  c.state.records.push({id:'local'});
  assert.equal(await c.flushCloudSave(),false);assert.equal(saves,3);
  assert.equal(c.cloudDirty,true);assert.equal(c.state.records[0].id,'local');
});

test('SDK retries disabled and version pinned to avoid changes outside deployment',()=>{
  const src=fs.readFileSync(require.resolve('../app.js'),'utf8');
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  assert.match(src,/createClient\([^\n]+retry: false/);
  assert.match(html,/@supabase\/supabase-js@2\.116\.0/);
});
