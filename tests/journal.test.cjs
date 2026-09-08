const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function load(name, context) {
  const start=source.indexOf(`function ${name}(`);
  assert(start>=0, name+' must exist');
  const end=source.indexOf('\nfunction ',start+1);
  vm.runInContext(source.slice(start,end),context);
}
function fixture() {
  let seq=0;
  const ctx=vm.createContext({
    state:{schedule:[],records:[],students:[],groups:[],activeEmployeeId:'t'},
    todayISO:()=> '2026-09-15',
    monthDates:()=>['2026-09-14','2026-09-21'],
    parseISO:d=>new Date(d+'T12:00:00'),isHoliday:()=>false,createId:()=> 'id-'+(++seq),
    studentName:()=> 'Test pupil',educationFormForParticipant:()=> 'ДПП',
    SchoolModel:require('../school-model.js'),escapeHtml:String,escapeAttr:String,formatNumber:String,
    formatDate:String,normalizeEducationForm:form=>form || 'ДПП',
    checkedValues:form=>form.memberIds,closeModal(){},persistAndRender:()=>{ctx.saved=true;},
    lessonMemberCandidates:group=>ctx.state.students.filter(s=>group.studentIds.includes(s.id))
  });
  ['refreshJournalMonth','refreshGeneratedJournalForScheduleChange','activeScheduleForEmployeeDate',
    'gradeOptions','renderJournalCell','snapshotLessonMembers','lessonMemberIds','journalLessonRoster',
    'journalRosterLabel','renderPersonHoursTotal','renderLessonRosterPrintReport','journalTotals',
    'renderJournalTotal','countableRecord','countableStatus','saveLessonMembers'].forEach(n=>load(n,ctx));
  return ctx;
}
function subgroupFixture() {
  const c=fixture();
  const ids=Array.from({length:13},(_,i)=>'p'+(i+1));
  c.state.students=ids.map((id,i)=>({id,name:'Ученик '+String(i+1).padStart(2,'0')}));
  c.state.groups=[{id:'g',studentIds:ids}];
  c.monthDates=()=>['2026-09-02','2026-09-03'];
  c.state.schedule=[
    {id:'wed',weekday:3,participantIds:['p1','p2']},
    {id:'thu',weekday:4,participantIds:['p3','p4','p5']}
  ].map(row=>({...row,employeeId:'t',studentId:'g',participantKind:'group',effectiveFrom:'2026-09-01',
    time:'10:00-10:40',type:'Сценическая речь',className:'1 класс',pedHours:1,kcHours:0}));
  c.state.records=c.state.schedule.map((row,i)=>({...row,id:'record-'+row.id,scheduleId:row.id,
    date:c.monthDates()[i],participantIds:ids,participantNames:Object.fromEntries(c.state.students.map(s=>[s.id,s.name])),
    presentStudentIds:[],attendanceLessonHours:0.5,attendanceRecordedAt:'2026-09-03T12:00:00Z',
    grade:i ? '4' : '5',status:'conducted'}));
  return c;
}

test('old and new schedules retain effective periods, grade IDs and independent subgroups',()=>{
  const c=fixture();
  c.state.groups=[{id:'g',studentIds:['a','b','c']}];
  c.state.schedule=[
    {id:'old',employeeId:'t',studentId:'g',weekday:1,effectiveFrom:'2026-09-01',effectiveTo:'2026-09-15',archiveId:'archive',time:'10:00-10:40',type:'Сольфеджио',participantIds:['a','b']},
    {id:'new',employeeId:'t',studentId:'g',weekday:1,effectiveFrom:'2026-09-16',effectiveTo:'',time:'11:00-11:40',type:'Сольфеджио',participantIds:['c']}
  ];
  c.state.records=[{id:'graded',employeeId:'t',studentId:'g',scheduleId:'old',date:'2026-09-14',grade:5,status:'conducted'},
    {id:'other',employeeId:'other',date:'2026-09-14',grade:'4'}];
  c.refreshJournalMonth('2026-09','2026-09-15','t');
  const past=c.state.records.find(r=>r.id==='graded');
  const future=c.state.records.find(r=>r.date==='2026-09-21');
  assert.equal(past.grade,5);
  assert.equal(past.time,'10:00-10:40');
  assert.equal(JSON.stringify(past.participantIds),'["a","b"]');
  assert.equal(future.time,'11:00-11:40');
  assert.equal(JSON.stringify(future.participantIds),'["c"]');
  assert(c.state.records.some(r=>r.id==='other'));
  assert.equal(c.journalLessonRoster(past).personHours,2);
  c.todayISO=()=> '2026-09-30';
  assert.equal(c.journalLessonRoster(future).personHours,1);
  const ids=c.state.records.map(r=>r.id).join();
  c.refreshJournalMonth('2026-09','2026-09-30','t');
  assert.equal(c.state.records.map(r=>r.id).join(),ids);
});

test('two out of thirteen on the 2nd and three on the 3rd appear immediately without attendance setup',()=>{
  const c=subgroupFixture();
  const before=JSON.stringify(c.state);
  const [wed,thu]=c.state.records;
  assert.equal(JSON.stringify(c.journalLessonRoster(wed).participantIds),'["p1","p2"]');
  assert.equal(JSON.stringify(c.journalLessonRoster(thu).participantIds),'["p3","p4","p5"]');
  assert.equal(c.journalLessonRoster(wed).personHours,2);
  assert.equal(c.journalLessonRoster(thu).personHours,3);
  const html=c.renderJournalCell({name:'Group',records:c.state.records},wed.date);
  assert(html.includes('2 уч. · 2 чел.-ч.'));
  assert(html.includes('Ученик 01<br>Ученик 02'));
  assert(!html.includes('Ученик 03'));
  assert(!html.includes('Ученик 13'));
  assert(!html.includes('<input'));
  assert(!html.includes('Не отмечено'));
  assert(!html.includes('data-action="lessonAttendance'));
  assert.equal(c.renderPersonHoursTotal(c.state.records),'5');
  assert.equal(c.journalTotals(c.state.records).total.person,5);
  const print=c.renderLessonRosterPrintReport(c.state.records);
  assert(print.includes('Ученик 01; Ученик 02</td><td>2</td>'));
  assert(print.includes('Ученик 03; Ученик 04; Ученик 05</td><td>3</td>'));
  assert(!print.includes('Ученик 13'));
  assert(!print.includes('посещаемость'));
  assert.equal(JSON.stringify(c.state),before);
  assert.equal(c.saved,undefined);
});

test('regeneration copies each exact subgroup despite old attendance, keeps grades and valid server fields',()=>{
  const c=subgroupFixture();
  c.refreshJournalMonth('2026-09','2026-09-15','t');
  for(const row of c.state.schedule) {
    const record=c.state.records.find(r=>r.scheduleId===row.id);
    assert.equal(record.id,'record-'+row.id);
    assert.equal(JSON.stringify(record.participantIds),JSON.stringify(row.participantIds));
    assert.equal(record.grade,row.id==='wed' ? '5' : '4');
    assert.equal(record.participantNames[row.participantIds[0]],row.id==='wed' ? 'Ученик 01' : 'Ученик 03');
    assert.equal(record.presentStudentIds,undefined);
    assert.equal(record.attendanceLessonHours,undefined);
    assert.equal(record.attendanceRecordedAt,undefined);
    assert.equal(c.SchoolModel.personHours(record),row.participantIds.length);
  }
});

test('editing the timetable subgroup synchronizes journal and persists correctly across reload',()=>{
  const c=subgroupFixture();
  c.saveLessonMembers({dataset:{rowId:'wed'},memberIds:['p6','p7']});
  assert.equal(c.saved,true);
  const reloaded=fixture();
  reloaded.state=JSON.parse(JSON.stringify(c.state));
  const wed=reloaded.state.records.find(r=>r.scheduleId==='wed');
  const thu=reloaded.state.records.find(r=>r.scheduleId==='thu');
  assert.equal(JSON.stringify(wed.participantIds),'["p6","p7"]');
  assert.equal(JSON.stringify(reloaded.journalLessonRoster(wed).participantIds),'["p6","p7"]');
  assert.equal(JSON.stringify(thu.participantIds),'["p3","p4","p5"]');
  assert.equal(wed.grade,'5');
  assert.equal(thu.grade,'4');
  assert.equal(reloaded.journalTotals([wed,thu]).total.person,5);
});

test('legacy individual lessons count full person-hours even if marked absent before',()=>{
  for(const attendance of [{},{presentStudentIds:[]},{presentStudentIds:['outsider'],attendanceLessonHours:10}]) {
    const c=fixture();
    const r={id:'r',employeeId:'t',studentId:'a',date:'2026-09-14',time:'10:00-10:20',pedHours:0.5,kcHours:0,grade:5,status:'conducted',...attendance};
    c.state.students=[{id:'a',name:'A'}];
    const before=JSON.stringify(r);
    assert.equal(c.journalLessonRoster(r).personHours,0.5);
    assert.equal(c.renderPersonHoursTotal([r]),'0.5');
    assert.equal(c.journalTotals([r]).total.person,0.5);
    const html=c.renderJournalCell({name:'A',records:[r]},r.date);
    assert(html.includes('1 уч. · 0.5 чел.-ч.'));
    assert(!html.includes('Не отмечено'));
    assert(!html.includes('<button'));
    assert(html.includes('aria-hidden="true">5</span>'));
    assert.equal(JSON.stringify(r),before);
  }
});

test('four group lessons yield 80 person-hours regardless of old presence arrays',()=>{
  const c=fixture();
  c.todayISO=()=> '2026-09-30';
  const ids=Array.from({length:20},(_,i)=>'p'+i);
  c.state.students=ids.map(id=>({id,name:id}));
  c.state.groups=[{id:'g',studentIds:ids}];
  const records=['2026-09-07','2026-09-14','2026-09-21','2026-09-28'].map(date=>({
    id:date,employeeId:'t',studentId:'g',date,time:'10:00-10:40',type:'Сольфеджио',
    educationForm:'ДОП',pedHours:1,kcHours:0,status:'planned',presentStudentIds:[]
  }));
  assert.equal(c.renderPersonHoursTotal(records),'80');
  const totals=c.journalTotals(records);
  assert.equal(totals.total.person,80);
  assert.equal(totals.dop.person,80);
  assert.equal(totals.total.ped,4);
  assert.equal(totals.total.pending,0);
  assert.equal((c.renderLessonRosterPrintReport(records).match(/<td>20<\/td>/g)||[]).length,4);
});

test('future lessons display their subgroup but enter person-hours only on their date',()=>{
  const c=fixture();
  const r={id:'r',employeeId:'t',studentId:'g',participantKind:'group',date:'2026-09-21',time:'10:00-10:40',
    participantIds:['a','b'],participantNames:{a:'A',b:'B'},status:'conducted'};
  const html=c.renderJournalCell({name:'Group',records:[r]},r.date);
  assert(html.includes('План · 2 уч.'));
  assert(html.includes('A<br>B'));
  assert.equal(c.renderPersonHoursTotal([r]),'0');
  assert.equal(c.journalTotals([r]).total.person,0);
  assert(c.renderLessonRosterPrintReport([r]).includes('A; B</td><td>План</td>'));
  c.todayISO=()=>r.date;
  assert.equal(c.journalLessonRoster(r).personHours,2);
  assert.equal(c.renderPersonHoursTotal([r]),'2');
});

test('missing and explicitly empty rosters are not replaced by the whole group',()=>{
  const c=fixture();
  const r={id:'r',employeeId:'t',studentId:'g',participantKind:'group',scheduleId:'row',date:'2026-09-14',time:'10:00-10:40',status:'conducted'};
  assert.equal(c.journalLessonRoster(r).personHours,null);
  assert(c.renderJournalCell({name:'Group',records:[r]},r.date).includes('Нет состава'));
  c.state.groups=[{id:'g',studentIds:['a','b','c']}];
  c.state.schedule=[{id:'row',employeeId:'t',studentId:'g',participantIds:[]}];
  assert.equal(c.journalLessonRoster({...r,participantIds:['a']}).personHours,null);
  assert(c.renderPersonHoursTotal([r]).includes('нет состава: 1'));
  assert.equal(c.journalTotals([r]).total.person,0);
});

test('fallback retains historical names and does not take another employees subgroup',()=>{
  const c=fixture();
  c.state.schedule=[{id:'row',employeeId:'other',studentId:'g',participantIds:['wrong']}];
  const r={id:'r',employeeId:'t',studentId:'g',scheduleId:'row',participantKind:'group',
    participantIds:['a'],participantNames:{a:'Historical A'},date:'2026-09-14',time:'10:00-10:40'};
  assert.equal(JSON.stringify(c.journalLessonRoster(r).participantIds),'["a"]');
  assert.equal(c.journalLessonRoster(r).participantNames.a,'Historical A');
  assert(!c.renderLessonRosterPrintReport([r]).includes('wrong'));
});

test('the same pupil has independent lesson hours for flute and saxophone',()=>{
  const c=fixture();
  const sax={id:'sax',employeeId:'t',studentId:'a',date:'2026-09-14',time:'10:00-10:20',instrument:'Саксофон',className:'3 кл',
    participantIds:['a'],presentStudentIds:[],status:'conducted'};
  const flute={id:'flute',employeeId:'t',studentId:'a',date:'2026-09-14',time:'11:00-11:40',instrument:'Флейта',className:'6 кл',status:'conducted'};
  assert.equal(c.journalLessonRoster(sax).personHours,0.5);
  assert.equal(c.journalLessonRoster(flute).personHours,1);
  assert.equal(c.renderPersonHoursTotal([sax,flute]),'1.5');
  assert.equal(c.journalTotals([sax,flute]).total.person,1.5);
});

test('numeric and string grades still render and no attendance editor or handlers remain',()=>{
  const c=fixture();
  for(const grade of [5,'5','4+']) {
    const html=c.renderJournalCell({name:'Test',records:[{id:'r',date:'2026-09-14',grade}]},'2026-09-14');
    assert(html.includes('aria-hidden="true">'+grade+'</span>'));
    assert(html.includes('value="'+grade+'" selected'));
    assert(html.includes('Пед.'));
  }
  for(const removed of ['openLessonAttendance','saveLessonAttendance','attendanceAll','attendanceNone','data-modal-form="lessonAttendance"']) {
    assert(!source.includes(removed),removed+' must be removed');
  }
});
