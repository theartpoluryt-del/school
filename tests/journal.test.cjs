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
    formatDate:String,openModal:(title,html)=>{ctx.modalHtml=html;},normalizeEducationForm:form=>form || 'ДПП',
    checkedValues:form=>form.presentIds,closeModal(){},persistAndRender:()=>{ctx.saved=true;}
  });
  ['refreshJournalMonth','activeScheduleForEmployeeDate','gradeOptions','renderJournalCell','snapshotLessonMembers','lessonMemberIds','journalAttendance','journalAttendanceLabel','openLessonAttendance','saveLessonAttendance','renderPersonHoursTotal','renderAttendancePrintReport','journalTotals','renderJournalTotal','countableRecord','countableStatus'].forEach(n=>load(n,ctx));
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

test('legacy stored attendance is not rewritten; the journal applies the default using its group roster',()=>{
  const c=fixture();
  c.state.groups=[{id:'g',studentIds:['a','b']}];
  c.state.schedule=[{id:'row',employeeId:'t',studentId:'g',weekday:1,time:'10:00-10:40',effectiveFrom:'2026-09-01'}];
  c.state.records=[{id:'old',scheduleId:'row',employeeId:'t',studentId:'g',date:'2026-09-14',status:'conducted'}];
  c.refreshJournalMonth('2026-09','2026-09-15','t');
  const old=c.state.records.find(r=>r.id==='old');
  assert.equal(old.participantIds,undefined);
  assert.equal(c.SchoolModel.personHours(old),null);
  assert.equal(c.journalAttendance(old).personHours,2);
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

test('legacy individual journal cell and totals show presence without opening or saving attendance',()=>{
  const c=fixture();
  const r={id:'r',employeeId:'t',studentId:'a',date:'2026-09-14',time:'10:00-10:20',pedHours:0.5,kcHours:0,grade:5,status:'conducted'};
  c.state.records=[r];
  c.state.students=[{id:'a',name:'A'}];
  const before=JSON.stringify(c.state);
  const html=c.renderJournalCell({name:'A',records:[r]},r.date);
  assert(html.includes('1/1 · 0.5 чел.-ч.'));
  assert(!html.includes('Не отмечено'));
  assert(html.includes('Присутствуют по умолчанию'));
  assert(html.includes('aria-hidden="true">5</span>'));
  assert.equal(c.renderPersonHoursTotal([r]),'0.5');
  assert.equal(c.journalTotals([r]).total.person,0.5);
  assert.equal(JSON.stringify(c.state),before);
  assert.equal(c.saved,undefined);
});

test('four group lessons default to 80 person-hours consistently in cells, totals and print',()=>{
  const c=fixture();
  c.todayISO=()=> '2026-09-30';
  const ids=Array.from({length:20},(_,i)=>`p${i}`);
  c.state.students=ids.map(id=>({id,name:id}));
  c.state.groups=[{id:'g',studentIds:ids}];
  c.state.records=['2026-09-07','2026-09-14','2026-09-21','2026-09-28'].map(date=>({
    id:date,employeeId:'t',studentId:'g',date,time:'10:00-10:40',type:'Сольфеджио',educationForm:'ДОП',pedHours:1,kcHours:0,status:'planned'
  }));
  const before=JSON.stringify(c.state);
  const r=c.state.records[0];
  assert(c.renderJournalCell({name:'Group',records:[r]},r.date).includes('20/20 · 20 чел.-ч.'));
  assert.equal(c.renderPersonHoursTotal(c.state.records),'80');
  const totals=c.journalTotals(c.state.records);
  assert.equal(totals.total.person,80);
  assert.equal(totals.dop.person,80);
  assert.equal(totals.total.pending,0);
  assert.equal(totals.total.ped,4);
  const print=c.renderAttendancePrintReport(c.state.records);
  assert.equal((print.match(/<td>20<\/td>/g)||[]).length,4);
  assert.equal((print.match(/\+ p0;/g)||[]).length,4);
  assert(!print.includes('Не отмечено'));
  assert.equal(JSON.stringify(c.state),before);
});

test('saved absence overrides defaults in the cell, summary and printed roster, including nobody present',()=>{
  for(const presentStudentIds of [['b'],[]]) {
    const c=fixture();
    const r={id:'r',employeeId:'t',studentId:'g',participantKind:'group',date:'2026-09-14',time:'10:00-11:40',
      participantIds:['a','b'],participantNames:{a:'A',b:'B'},presentStudentIds,attendanceLessonHours:1,status:'conducted'};
    const before=JSON.stringify(r);
    assert.equal(c.journalAttendance(r).personHours,presentStudentIds.length);
    const html=c.renderJournalCell({name:'Group',records:[r]},r.date);
    assert(html.includes(`${presentStudentIds.length}/2 · ${presentStudentIds.length} чел.-ч.`));
    assert(!html.includes('Присутствуют по умолчанию'));
    assert.equal(c.renderPersonHoursTotal([r]),String(presentStudentIds.length));
    assert.equal(c.journalTotals([r]).total.person,presentStudentIds.length);
    const print=c.renderAttendancePrintReport([r]);
    assert(print.includes('− A'));
    assert(print.includes(`${presentStudentIds.length ? '+' : '−'} B`));
    assert.equal(JSON.stringify(r),before);
  }
});

test('future lessons stay planned on screen and print and enter the default total only on their date',()=>{
  const c=fixture();
  const r={id:'r',employeeId:'t',studentId:'g',participantKind:'group',date:'2026-09-21',time:'10:00-10:40',
    participantIds:['a'],participantNames:{a:'A'},status:'conducted'};
  for(const attendanceOverride of [{},{presentStudentIds:['a']}]) {
    const future={...r,...attendanceOverride};
    const html=c.renderJournalCell({name:'Group',records:[future]},r.date);
    assert(html.includes('disabled>План</button>'));
    assert(html.includes('<br>План</small>'));
    assert(!html.includes('1/1'));
    assert.equal(c.renderPersonHoursTotal([future]),'0');
    assert.equal(c.journalTotals([future]).total.person,0);
    const print=c.renderAttendancePrintReport([future]);
    assert(print.includes('· A'));
    assert(print.includes('<td>План</td>'));
    assert(!print.includes('+ A'));
  }
  c.todayISO=()=>r.date;
  assert.equal(c.journalAttendance(r).personHours,1);
  assert.equal(c.renderPersonHoursTotal([r]),'1');
});

test('missing group roster is reported instead of counting the group ID as a pupil',()=>{
  const c=fixture();
  const r={id:'r',employeeId:'t',studentId:'g',participantKind:'group',date:'2026-09-14',time:'10:00-10:40',status:'conducted'};
  assert.equal(c.journalAttendance(r).personHours,null);
  assert(c.renderJournalCell({name:'Group',records:[r]},r.date).includes('Нет состава'));
  assert(c.renderPersonHoursTotal([r]).includes('нет состава: 1'));
  assert.equal(c.journalTotals([r]).total.person,0);
  assert(c.renderAttendancePrintReport([r]).includes('Нет состава'));
});

test('legacy subgroup uses its schedule roster and an existing snapshot takes precedence',()=>{
  const c=fixture();
  c.state.groups=[{id:'g',studentIds:['a','b','c']}];
  c.state.schedule=[{id:'row',employeeId:'t',studentId:'g',participantIds:['b']}];
  const r={id:'r',employeeId:'t',studentId:'g',scheduleId:'row',date:'2026-09-14',time:'10:00-10:40'};
  assert.equal(c.journalAttendance(r).personHours,1);
  assert.equal(JSON.stringify(c.journalAttendance(r).presentStudentIds),'["b"]');
  assert.equal(c.journalAttendance({...r,participantIds:['a','c']}).personHours,2);
  assert.equal(c.journalAttendance({...r,participantIds:[]}).personHours,null);
});

test('saving an absence from default attendance persists the override across reload',()=>{
  for(const presentIds of [['b'],[]]) {
    const c=fixture();
    c.state.groups=[{id:'g',studentIds:['a','b']}];
    c.state.records=[{id:'r',employeeId:'t',studentId:'g',date:'2026-09-14',time:'10:00-10:40'}];
    assert.equal(c.journalAttendance(c.state.records[0]).personHours,2);
    c.saveLessonAttendance({dataset:{recordId:'r'},presentIds});
    assert.equal(c.saved,true);
    assert(c.state.records[0].attendanceRecordedAt);
    const reloaded=fixture();
    reloaded.state=JSON.parse(JSON.stringify(c.state));
    const r=reloaded.state.records[0];
    assert.equal(reloaded.journalAttendance(r).personHours,presentIds.length);
    assert.equal(reloaded.journalAttendance(r).defaultApplied,false);
    reloaded.openLessonAttendance('r');
    assert.deepEqual(checkedAttendanceIds(reloaded.modalHtml),presentIds);
  }
});

test('the same pupil has independent attendance and hours for flute and saxophone',()=>{
  const c=fixture();
  const sax={id:'sax',employeeId:'t',studentId:'a',date:'2026-09-14',time:'10:00-10:20',instrument:'Саксофон',className:'3 кл',
    participantIds:['a'],presentStudentIds:[],status:'conducted'};
  const flute={id:'flute',employeeId:'t',studentId:'a',date:'2026-09-14',time:'11:00-11:40',instrument:'Флейта',className:'6 кл',status:'conducted'};
  assert.equal(c.journalAttendance(sax).personHours,0);
  assert.equal(c.journalAttendance(flute).personHours,1);
  assert.equal(c.renderPersonHoursTotal([sax,flute]),'1');
  assert.equal(c.journalTotals([sax,flute]).total.person,1);
  assert(c.renderJournalCell({name:'A',records:[sax]},sax.date).includes('0/1 · 0 чел.-ч.'));
  assert(c.renderJournalCell({name:'A',records:[flute]},flute.date).includes('1/1 · 1 чел.-ч.'));
});
