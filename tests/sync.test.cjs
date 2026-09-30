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

test('JSONB key order does not turn a schedule deletion into an edit conflict',()=>{
  const base={schedule:[{id:'lesson',type:'Специальность',participantIds:['a','b'],meta:{className:'6',term:8}}]};
  const remote={schedule:[{meta:{term:8,className:'6'},participantIds:['a','b'],type:'Специальность',id:'lesson'}]};
  assert.deepEqual(SchoolSync.merge(base,{schedule:[]},remote),{schedule:[]});
  assert.deepEqual(SchoolSync.merge(base,remote,{schedule:[]}),{schedule:[]});
});

test('a committed insertion with reordered keys is accepted on save retry',()=>{
  const local={schedule:[{id:'lesson',type:'Сольфеджио',participantIds:['a','b']}]};
  const remote={schedule:[{participantIds:['a','b'],type:'Сольфеджио',id:'lesson'}]};
  assert.deepEqual(SchoolSync.merge({schedule:[]},local,remote),local);
});

test('JSONB key order never hides real field, array-order or delete/edit conflicts',()=>{
  const base={schedule:[{id:'lesson',type:'Сольфеджио',participantIds:['a','b']}]};
  const remote={schedule:[{participantIds:['a','b'],type:'Литература',id:'lesson'}]};
  assert.throws(()=>SchoolSync.merge(base,{schedule:[]},remote));
  assert.throws(()=>SchoolSync.merge(base,{schedule:[{...base.schedule[0],type:'Хор'}]},remote));
  assert.throws(()=>SchoolSync.merge(['a','b'],['b','a'],['a']));
  assert.throws(()=>SchoolSync.merge({value:0},{value:'0'},{value:null}));
});

test('schedule deletion saves after a JSONB-reordered server refresh',async()=>{
  let saves=0;
  const c=fixture(async(name,args)=>{
    if(name==='get_school_context') return {data:{updated_at:'v2',payload:{records:[],schedule:[{type:'Сольфеджио',id:'lesson'}]}}};
    if(++saves===1) return {error:{code:'PT409',message:'conflict'}};
    assert.equal(args.expected_updated_at,'v2');
    assert.equal(args.new_payload.schedule.length,0);
    return {data:{updated_at:'v3'}};
  });
  c.cloudBaseline={records:[],schedule:[{id:'lesson',type:'Сольфеджио'}]};
  c.state.schedule=[];
  assert.equal(await c.flushCloudSave(),true);
  assert.equal(saves,2);assert.equal(c.cloudDirty,false);
});
function fixture(rpc) {
  const c=vm.createContext({structuredClone,SchoolSync,console:{warn(){}},window:{clearTimeout(){},setTimeout(){return 1;}},
    cloudSaveTimer:null,cloudSavePromise:null,cloudSaveInFlight:false,cloudDirty:true,cloudRevision:1,secureCloudMode:true,
    cloudReady:true,cloudStateId:'s',cloudStateVersion:'v1',cloudBaseline:{records:[]},cloudRawBaseline:{records:[]},
    cloudPatchEnabled:false,cloudPendingPatch:null,cloudConflict:null,state:{records:[],sessionEmployeeId:'t'},createId:()=> 'request-'+Math.random(),
    supabaseClient:{rpc,auth:{signOut:async()=>{c.signedOut=true;}}},cloudPayload:()=>structuredClone(c.state),
    migrateState:x=>structuredClone(x),setSyncStatus:(message,kind)=>{c.message=message;c.kind=kind;},
    currentTimeLabel:()=> '12:00',render(){},renderCloudAcknowledgement(){},alert:m=>{c.alert=m;},createDemoData:()=>({}),
    setLoginPasswordVisibility(){},currentProfile:null});
  const src=fs.readFileSync(require.resolve('../app.js'),'utf8');
  for(const name of ['cloudRequest','flushCloudSave','saveCloudChanges','saveAtomicChanges','ensureCloudSaved','logout']) {
    const start=src.indexOf(`async function ${name}(`),end=src.slice(start+1).search(/\n(?:async )?function /);
    vm.runInContext(src.slice(start,end<0?undefined:start+1+end),c);
  }
  return c;
}
test('failed save remains dirty and prevents logout',async()=>{
  const c=fixture(async()=>({error:{code:'503',message:'offline'}}));
  await c.logout();assert.equal(c.signedOut,undefined);assert.equal(c.cloudDirty,true);assert.equal(c.kind,'error');
});

test('incremental changes ignore display defaults and preserve unknown server fields',()=>{
  const raw={schedule:[{id:'s',type:'Хор',room:'',serverField:7}]};
  const base={schedule:[{...raw.schedule[0],effectiveFrom:'2026-09-01',groupId:''}]};
  const local=structuredClone(base);local.schedule[0].type='Сценическая речь';
  const changes=SchoolSync.changes(base,local,raw);
  assert.deepEqual(changes,[{collection:'schedule',id:'s',before:raw.schedule[0],after:{...raw.schedule[0],type:'Сценическая речь'}}]);
  assert.deepEqual(SchoolSync.changes(base,base,raw),[]);
});

test('incremental save acknowledges exact request and adopts concurrent remote edits',async()=>{
  const c=fixture(async(name,args)=>{
    assert.equal(name,'save_school_changes');assert.equal(args.changes.length,1);
    return {data:{acknowledged_request_id:args.request_id,updated_at:'v2',payload:{records:[{id:'mine',grade:'5'},{id:'other',grade:'4'}]}}};
  });
  c.cloudPatchEnabled=true;c.state.records=[{id:'mine',grade:'5'}];
  assert.equal(await c.flushCloudSave(),true);assert.equal(c.cloudDirty,false);
  assert.deepEqual(Array.from(c.state.records,x=>x.id),['mine','other']);
});

test('lost acknowledgement reuses the exact request while keeping subsequent edits',async()=>{
  const requests=[];
  const c=fixture(async(name,args)=>{
    requests.push(structuredClone(args));
    if(requests.length===1) return {error:{code:'503',message:'lost response'}};
    return {data:{acknowledged_request_id:args.request_id,updated_at:'v'+requests.length,
      payload:{records:requests.length===2?[{id:'mine',grade:'5'}]:[{id:'mine',grade:'4'}]}}};
  });
  c.cloudPatchEnabled=true;c.state.records=[{id:'mine',grade:'5'}];
  assert.equal(await c.flushCloudSave(),false);
  c.state.records[0].grade='4';c.cloudRevision++;
  assert.equal(await c.flushCloudSave(),true);
  assert.deepEqual(requests[0],requests[1]);assert.notEqual(requests[1].request_id,requests[2].request_id);
  assert.equal(c.state.records[0].grade,'4');assert.equal(c.cloudDirty,false);
});

test('real incremental conflict stops for explicit choice without losing local edits',async()=>{
  const c=fixture(async name=>name==='save_school_changes'?{error:{code:'PT409',message:'conflict'}}:
    {data:{updated_at:'v2',payload:{records:[{id:'r',grade:'5'}]}}});
  c.cloudPatchEnabled=true;c.cloudBaseline={records:[{id:'r',grade:''}]};c.cloudRawBaseline=structuredClone(c.cloudBaseline);
  c.state.records=[{id:'r',grade:'4'}];
  assert.equal(await c.flushCloudSave(),false);assert.equal(c.state.records[0].grade,'4');
  assert.ok(c.cloudConflict);assert.equal(c.cloudDirty,true);
  assert.match(c.message,/Разобрать конфликт/);
});

test('definitive rejection allows corrected input instead of replaying an invalid request forever',async()=>{
  const requests=[];const c=fixture(async(name,args)=>{
    requests.push(structuredClone(args));
    if(requests.length===1)return {error:{code:'22023',message:'Invalid grade'}};
    return {data:{updated_at:'v2',acknowledged_request_id:args.request_id,payload:{records:[{id:'r',grade:'5'}]}}};
  });
  c.cloudPatchEnabled=true;c.state.records=[{id:'r',grade:'bad'}];
  assert.equal(await c.flushCloudSave(),false);assert.equal(c.cloudPendingPatch,null);
  c.state.records[0].grade='5';
  assert.equal(await c.flushCloudSave(),true);assert.equal(requests[1].changes[0].after.grade,'5');
  assert.notEqual(requests[0].request_id,requests[1].request_id);
});

test('conflict resolver only selects conflicting values and keeps unrelated changes',()=>{
  const base={records:[{id:'r',grade:'',topic:''}]},local={records:[{id:'r',grade:'4',topic:'Local topic'}]},remote={records:[{id:'r',grade:'5',topic:''}]};
  const paths=[];const result=SchoolSync.payload(base,local,remote,c=>{paths.push(c.path);return c.local;});
  assert.deepEqual(paths,['/records/r/grade']);assert.equal(result.records[0].grade,'4');assert.equal(result.records[0].topic,'Local topic');
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
