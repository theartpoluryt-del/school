const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function load(name, context) {
  const start=source.indexOf(`function ${name}(`);
  const end=source.indexOf('\nfunction ',start+1);
  vm.runInContext(source.slice(start,end),context);
}
function fixture() {
  let seq=0;
  const ctx=vm.createContext({
    state:{schedule:[],records:[],students:[],groups:[],activeEmployeeId:'t'},
    todayISO:()=> '2026-09-15',
    monthDates:()=>['2026-09-14','2026-09-21'],
    parseISO:d=>new Date(d+'T12:00:00'),isHoliday:()=>false,createId:()=>`id-${++seq}`,
    studentName:()=> 'Test pupil',educationFormForParticipant:()=> 'ДПП',
    SchoolModel:require('../school-model.js'),escapeHtml:s=>String(s),escapeAttr:s=>String(s),formatNumber:String,
    formatDate:String,openModal:(title,html)=>{ctx.modalHtml=html;}
  });
  ['refreshJournalMonth','activeScheduleForEmployeeDate','gradeOptions','renderJournalCell','snapshotLessonMembers','lessonMemberIds','openLessonAttendance'].forEach(n=>load(n,ctx));
  return ctx;
}
test('old and new schedule retain their effective periods and grade IDs',()=>{
  const c=fixture();
  c.state.schedule=[{id:'old',employeeId:'t',studentId:'s',weekday:1,effectiveFrom:'2026-09-01',effectiveTo:'2026-09-15',time:'10:00-10:40',type:'Специальность',instrument:'Флейта',className:'6 кл'},
    {id:'new',employeeId:'t',studentId:'s',weekday:1,effectiveFrom:'2026-09-16',effectiveTo:'',time:'11:00-11:40',type:'Специальность',instrument:'Флейта',className:'6 кл'}];
  c.state.records=[{id:'graded',employeeId:'t',studentId:'s',scheduleId:'old',date:'2026-09-14',grade:5,status:'conducted'}, {id:'other',employeeId:'other',date:'2026-09-14',grade:'4'}];
  c.refreshJournalMonth('2026-09','2026-09-04','t');
  assert.equal(c.state.records.find(r=>r.id==='graded').grade,5);
  assert.equal(c.state.records.find(r=>r.date==='2026-09-21').time,'11:00-11:40');
  assert.equal(c.state.records.find(r=>r.id==='graded').time,'10:00-10:40');
  assert(c.state.records.some(r=>r.id==='other'));
  const ids=c.state.records.map(r=>r.id).join();
  c.refreshJournalMonth('2026-09','2026-09-04','t');
  assert.equal(c.state.records.map(r=>r.id).join(),ids);
});

test('group subgroup changes affect future lessons, not attendance snapshots',()=>{
  const c=fixture();
  c.state.students=[{id:'a',name:'A'},{id:'b',name:'B'}];
  c.state.groups=[{id:'g',studentIds:['a','b']}];
  c.state.schedule=[{id:'row',employeeId:'t',studentId:'g',weekday:1,time:'10:00-10:40',pedHours:1,kcHours:0,effectiveFrom:'2026-09-01',participantIds:['a','b']}];
  c.refreshJournalMonth('2026-09','2026-09-15','t');
  const past=c.state.records.find(r=>r.date==='2026-09-14');
  past.presentStudentIds=['a','b'];
  past.attendanceLessonHours=1;
  past.grade='5';
  c.state.schedule[0].participantIds=['b'];
  c.refreshJournalMonth('2026-09','2026-09-15','t');
  const updatedPast=c.state.records.find(r=>r.date==='2026-09-14');
  assert.equal(JSON.stringify(updatedPast.participantIds),'["a","b"]');
  assert.equal(updatedPast.participantNames.a,'A');
  assert.equal(updatedPast.grade,'5');
  assert.equal(c.SchoolModel.personHours(updatedPast),2);
  assert.equal(JSON.stringify(c.state.records.find(r=>r.date==='2026-09-21').participantIds),'["b"]');
});

test('legacy past attendance is not fabricated when regenerating a journal',()=>{
  const c=fixture();
  c.state.groups=[{id:'g',studentIds:['a','b']}];
  c.state.schedule=[{id:'row',employeeId:'t',studentId:'g',weekday:1,time:'10:00-10:40',effectiveFrom:'2026-09-01'}];
  c.state.records=[{id:'old',scheduleId:'row',employeeId:'t',studentId:'g',date:'2026-09-14',status:'conducted'}];
  c.refreshJournalMonth('2026-09','2026-09-15','t');
  const old=c.state.records.find(r=>r.id==='old');
  assert.equal(old.participantIds,undefined);
  assert.equal(c.SchoolModel.personHours(old),null);
});
test('numeric and string grades render a visible value and selected option',()=>{
  const c=fixture();
  for(const grade of [5,'5','4+']) {
    const html=c.renderJournalCell({name:'Test',records:[{id:'r',date:'2026-09-14',grade}]},'2026-09-14');
    assert(html.includes(`aria-hidden="true">${grade}</span>`));
    assert(html.includes(`value="${grade}" selected`));
    assert(html.includes('Пед.'));
  }
});

function checkedAttendanceIds(html) {
  return [...html.matchAll(/<input[^>]*name="presentIds"[^>]*value="([^"]+)"[^>]* checked\s*\//g)].map(match=>match[1]);
}

test('unrecorded group attendance defaults to all members without persisting attendance',()=>{
  const c=fixture();
  c.state.records=[{id:'r',employeeId:'t',studentId:'g',date:'2026-09-14',time:'10:00-10:40',participantIds:['a','b'],participantNames:{a:'A',b:'B'}}];
  const before=JSON.stringify(c.state.records);
  c.openLessonAttendance('r');
  assert.deepEqual(checkedAttendanceIds(c.modalHtml),['a','b']);
  assert.equal(JSON.stringify(c.state.records),before);
  assert.equal(c.SchoolModel.personHours(c.state.records[0]),null);
});

test('legacy individual attendance defaults to the pupil checked',()=>{
  const c=fixture();
  c.state.students=[{id:'a',name:'A'}];
  c.state.records=[{id:'r',employeeId:'t',studentId:'a',date:'2026-09-14',time:'10:00-10:40'}];
  c.openLessonAttendance('r');
  assert.deepEqual(checkedAttendanceIds(c.modalHtml),['a']);
  assert.equal(c.state.records[0].participantIds,undefined);
  assert.equal(c.state.records[0].presentStudentIds,undefined);
});

test('saved attendance remains unchanged, including nobody present',()=>{
  for(const presentStudentIds of [['b'],[]]) {
    const c=fixture();
    c.state.records=[{id:'r',employeeId:'t',studentId:'g',date:'2026-09-14',participantIds:['a','b'],presentStudentIds}];
    c.openLessonAttendance('r');
    assert.deepEqual(checkedAttendanceIds(c.modalHtml),presentStudentIds);
  }
});

test('attendance cannot be opened for future lessons or another employee',()=>{
  for(const overrides of [{date:'2026-09-21'},{employeeId:'other'}]) {
    const c=fixture();
    c.state.records=[{id:'r',employeeId:'t',studentId:'a',date:'2026-09-14',...overrides}];
    c.openLessonAttendance('r');
    assert.equal(c.modalHtml,undefined);
  }
});
