const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const SchoolSync=require('../sync-model.js');

const occurrenceRow=(id,extra={})=>({id,employeeId:'t',scheduleId:'s',date:'2026-10-23',grade:'',...extra});
test('same generated occurrence adopts server UUID instead of retrying an insert forever',()=>{
 const base={records:[]},local={records:[occurrenceRow('local')]},remote={records:[occurrenceRow('server')]};
 const merged=SchoolSync.payload(base,local,remote);
 assert.deepEqual(merged.records,remote.records);
 assert.deepEqual(SchoolSync.changes(remote,merged),[]);
 assert.equal(local.records[0].id,'local');assert.equal(base.records.length,0);
});
test('occurrence reconciliation retains independent fields and asks before replacing marks',()=>{
 const local={records:[occurrenceRow('local',{topic:'Local theme'})]},remote={records:[occurrenceRow('server',{grade:'5',quarterGrades:{p:'4'}})]};
 const conflicts=[];
 const merged=SchoolSync.payload({records:[]},local,remote,c=>{conflicts.push(c);return c.remote;});
 assert.equal(conflicts.length,1);assert.equal(conflicts[0].path,'/records/server/grade');
 assert.equal(merged.records[0].topic,'Local theme');assert.equal(merged.records[0].grade,'5');
 assert.deepEqual(merged.records[0].quarterGrades,{p:'4'});
 assert.equal(SchoolSync.changes(remote,merged)[0].before.id,'server');
});
test('occurrence reconciliation repairs duplicate left by an earlier failed rebase',()=>{
 const server=occurrenceRow('server',{grade:'5'}),remote={records:[server]};
 const merged=SchoolSync.payload(remote,{records:[server,occurrenceRow('local',{topic:'Theme'})]},remote,c=>c.remote);
 assert.equal(merged.records.length,1);assert.equal(merged.records[0].id,'server');
 assert.equal(merged.records[0].grade,'5');assert.equal(merged.records[0].topic,'Theme');
});
test('occurrence matching never joins history, other teachers, or different dates',()=>{
 for(const extra of [{scheduleSuperseded:true},{employeeId:'other'},{date:'2026-10-24'}]){
  const merged=SchoolSync.payload({records:[]},{records:[occurrenceRow('local',extra)]},{records:[occurrenceRow('server')]});
  assert.equal(merged.records.length,2);
 }
});
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
    cloudPatchEnabled:false,cloudPendingPatch:null,cloudConflict:null,cloudAuthRequired:false,state:{records:[],sessionEmployeeId:'t'},createId:()=> 'request-'+Math.random(),
    supabaseConfig:{compactSaves:false},SchoolAuth:require('../auth-network.js'),openCloudSaveLogin(){c.loginRequested=true;},
    supabaseClient:{rpc,auth:{getSession:async()=>({data:{session:{access_token:'synthetic',user:{id:'auth-id'}}}}),signOut:async()=>{c.signedOut=true;}}},cloudPayload:()=>structuredClone(c.state),
    migrateState:x=>structuredClone(x),setSyncStatus:(message,kind)=>{c.message=message;c.kind=kind;},
    currentTimeLabel:()=> '12:00',render(){},renderCloudAcknowledgement(){},alert:m=>{c.alert=m;},createDemoData:()=>({}),
    setLoginPasswordVisibility(){},currentProfile:{id:'auth-id'}});
  const src=fs.readFileSync(require.resolve('../app.js'),'utf8');
  for(const name of ['cloudRequest','flushCloudSave','saveCloudChanges','saveAtomicChanges','ensureCloudSaved','logout']) {
    const start=src.indexOf(`async function ${name}(`),end=src.slice(start+1).search(/\n(?:async )?function /);
    vm.runInContext(src.slice(start,end<0?undefined:start+1+end),c);
  }
  return c;
}

test('expired session never sends a write as anon and retains unsaved edits',async()=>{
  let writes=0;const c=fixture(async()=>{writes++;return {};});
  c.cloudPatchEnabled=true;c.state.records=[{id:'r',grade:'4'}];
  c.supabaseClient.auth.getSession=async()=>({data:{session:null}});
  assert.equal(await c.flushCloudSave(),false);
  assert.equal(writes,0);assert.equal(c.cloudDirty,true);assert.equal(c.loginRequested,true);
  assert.equal(c.state.records[0].grade,'4');assert.match(c.message,/введите пароль ещё раз/);
});

test('restored session retries the original unacknowledged request without losing later edits',async()=>{
  const requests=[];const c=fixture(async(name,args)=>{
    requests.push(structuredClone(args));
    if(requests.length===1)return {error:{message:'lost response'}};
    return {data:{acknowledged_request_id:args.request_id,updated_at:'v2',payload:{records:[{id:'r',grade:args.changes[0].after.grade}]}}};
  });
  c.cloudPatchEnabled=true;c.state.records=[{id:'r',grade:'5'}];
  assert.equal(await c.flushCloudSave(),false);
  c.state.records[0].grade='4';
  c.supabaseClient.auth.getSession=async()=>({data:{session:null}});
  assert.equal(await c.flushCloudSave(),false);assert.equal(requests.length,1);
  c.supabaseClient.auth.getSession=async()=>({data:{session:{access_token:'synthetic',user:{id:'auth-id'}}}});
  assert.equal(await c.flushCloudSave(),true);
  assert.deepEqual(requests[0],requests[1]);assert.equal(requests.length,3);
  assert.equal(c.state.records[0].grade,'4');assert.equal(c.cloudDirty,false);
});

test('UI repaint failure after acknowledged write is not reported as unsaved',async()=>{
  const c=fixture(async(name,args)=>({data:{acknowledged_request_id:args.request_id,updated_at:'v2',payload:{records:[{id:'r',grade:'5'}]}}}));
  c.cloudPatchEnabled=true;c.state.records=[{id:'r',grade:'5'}];
  c.renderCloudAcknowledgement=()=>{throw new Error('paint failed');};
  assert.equal(await c.flushCloudSave(),true);assert.equal(c.cloudDirty,false);assert.equal(c.kind,'saved');
});

test('retry with no remaining edits clears a stale error without a write',async()=>{
  let writes=0;const c=fixture(async()=>{writes++;});c.cloudDirty=false;c.kind='error';
  assert.equal(await c.flushCloudSave(),true);assert.equal(writes,0);assert.equal(c.kind,'saved');
});

test('compact acknowledgments apply only touched rows and reject incomplete receipts',()=>{
  const raw={records:[{id:'r',grade:'4',unknown:7},{id:'other',grade:'5'}],academicPlanVersion:1};
  const expected=[{collection:'records',id:'r'},{collection:'records',id:'new'},{collection:'academicPlanVersion'}];
  const applied=[{collection:'records',id:'r',after:null},{collection:'records',id:'new',after:{id:'new',grade:'5'}},
    {collection:'academicPlanVersion',id:null,after:2}];
  const out=SchoolSync.acknowledge(raw,applied,expected);
  assert.deepEqual(out,{records:[{id:'other',grade:'5'},{id:'new',grade:'5'}],academicPlanVersion:2});
  assert.equal(raw.records[0].unknown,7);
  assert.throws(()=>SchoolSync.acknowledge(raw,applied.slice(0,2),expected));
  assert.throws(()=>SchoolSync.acknowledge(raw,[...applied,applied[0]],expected));
  assert.throws(()=>SchoolSync.acknowledge(raw,[{collection:'records',id:'r',after:{id:'spoof'}}],[expected[0]]));
});

test('compact save keeps edits made in flight and preserves authoritative server fields',async()=>{
  let calls=0;const c=fixture(async(name,args)=>{
    assert.equal(name,'save_school_changes_compact');calls++;
    if(calls===1)c.state.records[0].topic='New topic';
    else {assert.equal(args.changes[0].before.serverField,7);assert.equal(args.changes[0].after.topic,'New topic');}
    return {data:{acknowledged_request_id:args.request_id,updated_at:'v'+calls,applied_changes:
      args.changes.map(op=>({collection:op.collection,id:op.id,after:{...op.after,serverField:7}}))}};
  });
  c.supabaseConfig.compactSaves=true;c.cloudPatchEnabled=true;c.state.records=[{id:'r',grade:'5',topic:''}];
  assert.equal(await c.flushCloudSave(),true);assert.equal(calls,2);assert.equal(c.cloudDirty,false);
  assert.equal(c.state.records[0].topic,'New topic');assert.equal(c.state.records[0].serverField,7);
});

test('atomic save rebases a generated duplicate once and updates the canonical lesson',async()=>{
  let saves=0,loads=0;
  const server=occurrenceRow('server');
  const c=fixture(async(name,args)=>{
    if(name==='get_school_context') {loads++;return {data:{updated_at:'v2',payload:{records:[server]}}};}
    saves++;
    if(saves===1)return {error:{code:'PT409',message:'Lesson occurrence already exists'}};
    assert.equal(args.changes.length,1);assert.equal(args.changes[0].id,'server');
    assert.equal(args.changes[0].before.id,'server');assert.equal(args.changes[0].after.topic,'New');
    return {data:{acknowledged_request_id:args.request_id,updated_at:'v3',payload:{records:[args.changes[0].after]}}};
  });
  c.cloudPatchEnabled=true;c.state.records=[occurrenceRow('local',{topic:'New'})];
  assert.equal(await c.flushCloudSave(),true);assert.equal(saves,2);assert.equal(loads,1);
  assert.equal(c.cloudConflict,null);assert.equal(c.cloudDirty,false);
  assert.equal(c.state.records[0].id,'server');assert.equal(c.state.records[0].topic,'New');
});

test('atomic save finishes after a duplicate rebase with identical generated values',async()=>{
  let saves=0;
  const c=fixture(async name=>name==='get_school_context'?
    {data:{updated_at:'v2',payload:{records:[occurrenceRow('server')]}}}:
    (++saves,{error:{code:'PT409',message:'Lesson occurrence already exists'}}));
  c.cloudPatchEnabled=true;c.state.records=[occurrenceRow('local')];
  assert.equal(await c.flushCloudSave(),true);assert.equal(saves,1);
  assert.equal(c.cloudDirty,false);assert.equal(c.state.records.length,1);assert.equal(c.state.records[0].id,'server');
});
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
  let release,started;const sent=new Promise(r=>started=r);const c=fixture(()=>new Promise(r=>{release=r;started();}));
  const out=c.logout();assert.equal(c.signedOut,undefined);
  await sent;
  release({data:{updated_at:'v2'}});await out;assert.equal(c.signedOut,true);
});
test('edit during in-flight save is saved in a second request',async()=>{
  let release,started,calls=0;const sent=new Promise(r=>started=r);const c=fixture(async()=>{calls++;if(calls===1)return new Promise(r=>{release=r;started();});return {data:{updated_at:'v3'}};});
  const out=c.flushCloudSave();await sent;c.state.records.push({id:'new'});c.cloudRevision++;
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
  assert.match(html,/src="\/vendor\/supabase\.js\?v=[a-f0-9]{16}"/);
  assert.ok(fs.readFileSync(require.resolve('../vendor/supabase.js'),'utf8').includes('2.116.0'));
});
