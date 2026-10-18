const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function load(name,c){const start=source.indexOf(`function ${name}(`),next=source.indexOf('\nfunction ',start+1);vm.runInContext(source.slice(start,next),c);}
function fixture(){
 const own={id:'own',name:'Own',kind:'student',enrollments:[{id:'ped',employeeIds:['kc'],subject:'Специальность',className:'2 кл'}]};
 const other={id:'other',name:'Other',className:'3 кл',enrollments:[{id:'flute',className:'3 кл',termYears:8,instrument:'Флейта'},{id:'sax',className:'6 кл',termYears:8,instrument:'Саксофон'}]};
 const c=vm.createContext({state:{activeEmployeeId:'kc',sessionEmployeeId:'kc',employees:[{id:'kc'}],students:[own],groups:[],kcScheduleEmployeeIds:['kc'],kcScheduleStudents:[other]},
 currentUser:()=>({id:'kc'}),isAdmin:()=>false,visibleParticipants:()=>[own],uniqueById:xs=>[...new Map(xs.map(x=>[x.id,x])).values()],
 SchoolModel:require('../school-model.js'),structuredClone,escapeHtml:x=>x});
 for(const n of ['canScheduleKc','scheduleParticipants','participantOptions','participantById','courseOptionsFor','cloudPayload'])load(n,c);
 return c;
}
test('KC can select every server-provided pupil only for KC, not in ordinary teaching',()=>{
 const c=fixture();assert.equal(c.canScheduleKc(),true);
 assert.deepEqual(Array.from(c.scheduleParticipants('КЦ'),p=>p.id),['kc-collective-music','kc-choir-io','kc-choir-ho','other','own']);
 assert.deepEqual(Array.from(c.scheduleParticipants('Специальность'),p=>p.id),['own']);
 assert.match(c.participantOptions('other','КЦ'),/value="other" selected/);
 assert.equal(c.participantById('other').name,'Other');
 c.state.activeEmployeeId='another';assert.equal(c.canScheduleKc(),false);
});
test('KC course selection preserves instrument and class without inventing teacher assignments',()=>{
 const c=fixture();const options=c.courseOptionsFor('other','kc','КЦ');
 assert.equal(options.length,2);assert.equal(options[0].className,'3 кл');assert.equal(options[1].instrument,'Саксофон');
 assert.equal(options[0].subject,'КЦ');assert.equal(options[0].termYears,8);
 assert.equal(c.courseOptionsFor('other','kc','Специальность').length,0);
 assert.equal(c.state.kcScheduleStudents[0].enrollments[0].employeeIds,undefined);
});
test('ordinary teachers get no KC schedule button or unrestricted roster',()=>{
 const c=fixture();c.state.kcScheduleEmployeeIds=[];c.state.kcScheduleStudents=[];
 assert.equal(c.canScheduleKc(),false);assert.equal(c.scheduleParticipants('КЦ').length,1);
});
test('KC roster is authoritative server metadata, never a pupil edit or writable cloud field',()=>{
 const c=fixture(),before=structuredClone(c.state),payload=c.cloudPayload();
 assert.equal(payload.kcScheduleStudents,undefined);assert.equal(payload.kcScheduleEmployeeIds,undefined);
 const sync=require('../sync-model.js'),remote={...before,kcScheduleStudents:[],kcScheduleEmployeeIds:[]};
 const merged=sync.payload(before,{...before,kcScheduleEmployeeIds:['forged']},remote);
 assert.deepEqual(merged.kcScheduleEmployeeIds,[]);assert.deepEqual(merged.kcScheduleStudents,[]);
 assert.deepEqual(sync.changes(before,payload,before),[]);
});
