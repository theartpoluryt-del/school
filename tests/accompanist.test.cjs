const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=require('../accompanist-model.js');
const lesson=(id,hours,students=[{id:'a',name:'Аня'}])=>({id,hours,students,subject:'Хор',lesson_date:'2026-09-01'});
test('KC counts a joint lesson once, not once per pupil, and excludes deleted lessons',()=>{
  const lessons=[lesson('one',1.5,[{id:'a',name:'Аня'},{id:'b',name:'Борис'}]),lesson('two',2),{...lesson('old',10),deleted:true}];
  assert.equal(model.total(lessons),3.5);
  assert.equal(model.rows(lessons).length,2);
});
test('KC accepts only positive half-hour units through 24, including decimal comma',()=>{
  for(const h of [0.5,1,1.5,2,2.5,24,'1,5']) assert.equal(model.validHours(h),true);
  for(const h of ['',null,0,-1,0.25,2.13,25,NaN,Infinity,'abc']) assert.equal(model.validHours(h),false);
});
test('KC matrix groups by exact roster and subject, not input order or matching names',()=>{
  const people=[{id:'a',name:'Аня'},{id:'b',name:'Борис'}];
  const lessons=[lesson('a',1,people),lesson('b',1.5,[...people].reverse()),{...lesson('c',2,people),subject:'Ансамбль'},lesson('d',1,[{id:'c',name:'Аня'},{id:'b',name:'Борис'}])];
  const before=JSON.stringify(lessons),rows=model.rows(lessons);
  assert.equal(rows.length,3);
  assert.equal(model.total(rows.find(r=>r.lessons.length===2).lessons),2.5);
  assert.equal(rows.reduce((n,r)=>n+model.total(r.lessons),0),model.total(lessons));
  assert.equal(JSON.stringify(lessons),before);
});

test('same KC roster in different courses retains separate class and term labels',()=>{
  const rows=model.rows([{...lesson('one',1),className:'3 кл',termYears:'5'},
    {...lesson('two',1),className:'6 кл',termYears:'8'}]);
  assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.termYears),['5','8']);
});

test('choosing KC timetable type moves the workload to KC without changing the clock time',()=>{
  const js=fs.readFileSync(require.resolve('../app.js'),'utf8');
  const row={id:'row',type:'Специальность',time:'09:00-10:25',pedHours:2,kcHours:0};
  const schoolModel=require('../school-model.js');let refresh=0,saves=0;
  const c=vm.createContext({state:{schedule:[row]},SchoolModel:schoolModel,
    updateHoursFromTime:r=>{r.kcHours=schoolModel.lessonHours(r);},
    refreshGeneratedJournalForScheduleChange:()=>refresh++,persistAndRender:()=>saves++});
  vm.runInContext(js.slice(js.indexOf('function updateScheduleField('),js.indexOf('function handleTimeInput(')),c);
  c.updateScheduleField({dataset:{scheduleId:'row',scheduleField:'type'},value:'Концертмейстер'});
  assert.equal(row.kcHours,2);assert.equal(row.pedHours,0);assert.equal(row.time,'09:00-10:25');
  assert.equal(refresh,1);assert.equal(saves,1);
});
test('KC endpoints and tables have authentication, employee allowlist and own-record checks',()=>{
  const sql=fs.readFileSync(require.resolve('../supabase/accompanist_journal.sql'),'utf8');
  assert.equal((sql.match(/if auth.uid\(\) is null/g)||[]).length,3);
  assert.equal((sql.match(/target_employee is distinct from own|target is distinct from own/g)||[]).length,2);
  assert.match(sql,/revoke all on public.school_accompanists,public.accompanist_lessons from anon,authenticated/);
  assert.match(sql,/old_row.employee_id is distinct from target/);
  assert.match(sql,/old_row.updated_at is distinct from expected_updated_at/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/old_row.hours=amount and old_row.deleted=removing then return/);
  assert.doesNotMatch(sql,/update public.school_state|insert into public.school_state|grades\s+jsonb|person_hours/i);
});
test('KC UI uses bounded requests, a stable insert id, safe escaping and no grade controls',()=>{
  const js=fs.readFileSync(require.resolve('../accompanist-journal.js'),'utf8');
  assert.match(js,/lessonId=existing\?\.id\|\|crypto.randomUUID\(\)/);
  assert.match(js,/SchoolSync.request\(supabaseClient.rpc\('save_accompanist_lesson'/);
  assert.match(js,/if\(request!==serial\|\|initial!==context\(\)\) return/);
  assert.match(js,/escapeHtml\(s.name\)/);
  assert.doesNotMatch(js,/data-grade|personHours|present_student_ids/);
});

function accessFixture(admin,response) {
  const makeNode=()=>({innerHTML:'',value:'',classList:{values:new Set(['is-hidden']),
    add(x){this.values.add(x);},remove(x){this.values.delete(x);},contains(x){return this.values.has(x);},
    toggle(x,on){on?this.add(x):this.remove(x);}}});
  const label=makeNode(),nodes={kcTab:makeNode(),kcEmployee:makeNode(),kcView:makeNode()};
  nodes.kcEmployee.closest=()=>label;
  const c=vm.createContext({session:'own',staff:[],students:[],lessons:[],loaded:false,key:'',accessSerial:0,loadingAccess:false,
    state:{sessionEmployeeId:'own',activeEmployeeId:'other'},isAdmin:()=>admin,el:id=>nodes[id],escapeAttr:x=>x,escapeHtml:x=>x,
    SchoolSync:{request:x=>x},supabaseClient:{rpc:async()=>response},draw(){},status(){},errorText:()=> 'offline',
    switchTab:name=>{c.switched=name;},load:async()=>{c.didLoad=true;}});
  const js=fs.readFileSync(require.resolve('../accompanist-journal.js'),'utf8');
  vm.runInContext(js.slice(js.indexOf('  async function access()'),js.indexOf('  async function load(')),c);
  vm.runInContext(js.match(/  const targetEmployee=[^\n]+/)[0].replace('const targetEmployee','var targetEmployee'),c);
  return {c,nodes,label};
}
test('ordinary teachers never see KC navigation and are redirected out of its view',async()=>{
  const {c,nodes}=accessFixture(false,{data:[]});nodes.kcView.classList.add('active');
  await c.access();assert.equal(nodes.kcTab.classList.contains('is-hidden'),true);
  assert.equal(c.switched,'dashboard');assert.equal(c.didLoad,undefined);
});
test('accompanist only has own journal even when main employee selector differs',async()=>{
  const {c,nodes,label}=accessFixture(false,{data:[{id:'own',name:'Own'},{id:'other',name:'Other'}]});
  await c.access();assert.deepEqual(Array.from(c.staff,s=>s.id),['own']);
  assert.equal(nodes.kcTab.classList.contains('is-hidden'),false);
  assert.equal(label.classList.contains('is-hidden'),true);
  nodes.kcEmployee.value='other';assert.equal(c.targetEmployee(),'own');
});
test('administrator can select every server-authorized KC journal',async()=>{
  const {c,nodes,label}=accessFixture(true,{data:[{id:'own',name:'Own'},{id:'other',name:'Other'}]});
  await c.access();assert.equal(c.staff.length,2);assert.equal(label.classList.contains('is-hidden'),false);
  assert.equal(c.targetEmployee(),'own');nodes.kcEmployee.value='other';
  assert.equal(c.targetEmployee(),'other');assert.equal(nodes.kcTab.classList.contains('is-hidden'),false);
});
test('failed access check hides KC tab and clears previously displayed data',async()=>{
  const {c,nodes}=accessFixture(false,{error:{message:'offline'}});
  nodes.kcTab.classList.remove('is-hidden');nodes.kcView.classList.add('active');
  c.staff=[{id:'own'}];c.students=[{id:'p'}];c.lessons=[{id:'l'}];c.loaded=true;
  await c.access();assert.equal(nodes.kcTab.classList.contains('is-hidden'),true);
  assert.equal(c.staff.length+c.students.length+c.lessons.length,0);
  assert.equal(c.loaded,false);assert.equal(c.switched,'dashboard');
});

test('KC journal inherits its roster and dates and waits for confirmed timetable saves',()=>{
  const js=fs.readFileSync(require.resolve('../accompanist-journal.js'),'utf8');
  assert.match(js,/if\(cloudDirty\|\|cloudSavePromise\)/);
  assert.match(js,/if\(!await flushCloudSave\(\)\)/);
  assert.match(js,/source_hash:existing.source_hash/);
  assert.match(js,/form.elements.date.disabled=true;form.elements.subject.disabled=true/);
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  assert.doesNotMatch(html,/id="kcAdd"/);
});

function loadFixture() {
  const js=fs.readFileSync(require.resolve('../accompanist-journal.js'),'utf8'),nodes={kcEmployee:{value:'own'},kcMonth:{value:'2026-09'}};
  const c=vm.createContext({state:{sessionEmployeeId:'own'},session:'own',staff:[{id:'own'}],key:'',serial:0,loaded:false,busy:false,
    students:[],lessons:[],cloudRevision:1,cloudStateVersion:'v1',cloudDirty:false,cloudSavePromise:null,
    el:id=>nodes[id],draw(){},controls(){},status:x=>{c.message=x;},errorText:e=>e.message,
    SchoolSync:{request:x=>x},targetEmployee:()=>nodes.kcEmployee.value,
    supabaseClient:{rpc:async()=>{c.calls=(c.calls||0)+1;return {data:{students:[{id:'p'}],lessons:[{id:'l'}]}};}}});
  vm.runInContext(js.match(/  const context=[^\n]+/)[0].replace('const context','var context'),c);
  vm.runInContext(js.slice(js.indexOf('  async function load('),js.indexOf('  function classLabel(')),c);
  return c;
}
test('KC waits for a dirty timetable to reach the server and then caches the acknowledged version',async()=>{
  const c=loadFixture();c.cloudDirty=true;let resolve;
  c.flushCloudSave=()=>new Promise(r=>{resolve=r;});
  const loading=c.load();assert.equal(c.calls,undefined);assert.equal(c.busy,true);
  c.cloudDirty=false;c.cloudStateVersion='v2';resolve(true);await loading;
  assert.equal(c.loaded,true);assert.equal(c.calls,1);assert.equal(c.busy,false);
  await c.load();assert.equal(c.calls,1);
  c.cloudRevision++;await c.load();assert.equal(c.calls,2);
});
test('unconfirmed timetable save does not silently show an outdated KC journal',async()=>{
  const c=loadFixture();c.cloudDirty=true;c.flushCloudSave=async()=>false;
  await c.load();assert.equal(c.calls,undefined);assert.equal(c.loaded,false);assert.equal(c.busy,false);
  assert.equal(c.key,'');assert.match(c.message,/Расписание ещё не сохранено/);
});

test('KC timetable generation is private; corrections cannot change owner or source',()=>{
  const sql=fs.readFileSync(require.resolve('../supabase/accompanist_schedule.sql'),'utf8');
  assert.match(sql,/p.is_admin and lower\(p.username\)='admin' and lower\(p.username\)=lower\(e->>'username'\)/);
  assert.match(sql,/r->>'type'='Концертмейстер'/);
  assert.match(sql,/effectiveFrom/);assert.match(sql,/effectiveTo/);assert.match(sql,/school_absences/);
  assert.match(sql,/md5\('kc\|'\|\|target_employee\|\|'\|'\|\|source_key\)::uuid/);
  assert.match(sql,/revoke all on function public.accompanist_schedule_rows\(jsonb,text,date\) from public,anon,authenticated/);
  assert.match(sql,/source_hash' is distinct from lesson->>'source_hash'/);
  assert.match(sql,/Timetable source cannot be removed/);
  assert.doesNotMatch(sql,/update public.school_state|person_hours|grades\s+jsonb/i);
});
