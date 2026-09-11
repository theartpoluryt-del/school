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
    openModal:(title,html)=>{ctx.modalHtml=html;},alert:message=>{ctx.alert=message;},
    lessonMemberCandidates:group=>ctx.state.students.filter(s=>group.studentIds.includes(s.id))
  });
  ['refreshJournalMonth','refreshGeneratedJournalForScheduleChange','activeScheduleForEmployeeDate',
    'gradeOptions','renderJournalCell','snapshotLessonMembers','lessonMemberIds','journalLessonRoster',
    'journalRosterLabel','renderPersonHoursTotal','renderLessonRosterPrintReport','journalTotals',
    'renderJournalTotal','countableRecord','countableStatus','saveLessonMembers','gradeValues','clearLegacyAttendance',
    'journalRosterCandidates','openJournalRoster','saveJournalRoster','resetJournalRoster','setGrade','lessonMemberCheckboxes',
    'journalPupilEntries','compactJournalClass','renderJournalEntry','sum'].forEach(n=>load(n,ctx));
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
  assert.equal(c.journalLessonRoster(future).personHours,1);
  assert.equal(c.journalTotals(c.state.records.filter(r=>r.employeeId==='t')).total.person,3);
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
  const html=c.renderJournalEntry({name:'Group',records:[wed]},[wed.date]);
  assert(/<summary[^>]*>2 уч\.<\/summary>/.test(html));
  assert(!html.includes('чел.-ч.'));
  assert(html.includes('Ученик 01'));
  assert(html.includes('Ученик 02'));
  assert(!html.includes('Ученик 03'));
  assert(!html.includes('Ученик 13'));
  assert(!html.includes('<input'));
  assert(!html.includes('Не отмечено'));
  assert(!html.includes('data-action="lessonAttendance'));
  assert.equal(c.renderPersonHoursTotal(c.state.records),'5');
  assert.equal(c.journalTotals(c.state.records).total.person,5);
  const print=c.renderLessonRosterPrintReport(c.state.records);
  assert(print.includes('Ученик 01: —; Ученик 02: —</td><td>2</td>'));
  assert(print.includes('Ученик 03: —; Ученик 04: —; Ученик 05: —</td><td>3</td>'));
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
    assert(!html.includes('1 уч.'));
    assert(!html.includes('чел.-ч.'));
    assert(!html.includes('Не отмечено'));
    assert(!html.includes('<button'));
    assert(html.includes('aria-hidden="true">5</span>'));
    assert.equal(JSON.stringify(r),before);
  }
});

test('journal class labels use compact class and study-term notation',()=>{
  const c=fixture();
  assert.equal(c.compactJournalClass('1 класс · 5-летний срок обучения'),'1/5');
  assert.equal(c.compactJournalClass('2 класс · 8-летний срок обучения'),'2/8');
  assert.equal(c.compactJournalClass('6 кл'),'6');
  assert.equal(c.compactJournalClass('Подготовительный класс'),'Подготовительный класс');
  const html=c.renderJournalEntry({name:'A',className:'1 класс · 5-летний срок обучения',records:[]},[]);
  assert(html.includes('<td class="class-cell" title="1 класс · 5-летний срок обучения">1/5</td>'));
});

test('four group lessons yield 80 monthly person-hours from the start of the month, regardless of attendance',()=>{
  const c=fixture();
  c.todayISO=()=> '2026-09-01';
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
  assert.equal(c.renderPersonHoursTotal(records,'p0'),'4');
  for (const today of ['2026-09-08','2026-09-30']) {
    c.todayISO=()=>today;
    assert.equal(c.renderPersonHoursTotal(records),'80');
    assert.equal(c.journalTotals(records).total.person,80);
  }
});

test('future lessons immediately count in row and monthly totals and print while remaining planned',()=>{
  const c=fixture();
  const r={id:'r',employeeId:'t',studentId:'g',participantKind:'group',date:'2026-09-21',time:'10:00-10:40',
    participantIds:['a','b'],participantNames:{a:'A',b:'B'},status:'planned'};
  const before=JSON.stringify(r);
  const html=c.renderJournalCell({name:'Group',records:[r]},r.date);
  assert(!html.includes('План'));
  assert(!html.includes('чел.-ч.'));
  assert(/<summary[^>]*>2 уч\.<\/summary>/.test(html));
  assert(c.renderJournalEntry({name:'Group',records:[r]},[r.date]).includes('Оценка A'));
  assert.equal(c.renderPersonHoursTotal([r]),'2');
  assert.equal(c.renderPersonHoursTotal([r],'a'),'1');
  assert.equal(c.journalTotals([r]).total.person,2);
  const print=c.renderLessonRosterPrintReport([r]);
  assert(print.includes('за весь выбранный месяц, включая будущие занятия'));
  assert(print.includes('A: —; B: —</td><td>2</td>'));
  assert(print.includes('10:00-10:40</td>'));
  assert(!print.includes('План'));
  c.todayISO=()=>r.date;
  assert.equal(c.journalLessonRoster(r).personHours,2);
  assert.equal(c.renderPersonHoursTotal([r]),'2');
  assert.equal(JSON.stringify(r),before);
});

test('monthly generation uses all four or five calendar occurrences, not a four-week estimate or as-of cutoff',()=>{
  for (const [month,weekday,count] of [['2026-09',1,4],['2026-10',4,5]]) {
    const c=fixture();
    load('monthDates',c);
    c.todayISO=()=>month+'-01';
    const ids=Array.from({length:20},(_,i)=>'p'+i);
    c.state.groups=[{id:'g',studentIds:ids}];
    c.state.schedule=[{id:'row',employeeId:'t',studentId:'g',participantKind:'group',weekday,
      effectiveFrom:month+'-01',time:'10:00-10:40',pedHours:1,kcHours:0,educationForm:'ДОП'}];
    c.refreshJournalMonth(month,month+'-01','t');
    assert.equal(c.state.records.length,count);
    assert.equal(c.journalTotals(c.state.records).total.person,count*20);
    assert.equal(c.renderPersonHoursTotal(c.state.records),String(count*20));
    const idsBefore=c.state.records.map(r=>r.id).join();
    c.refreshJournalMonth(month,month+'-25','t');
    assert.equal(c.state.records.map(r=>r.id).join(),idsBefore);
    assert.equal(c.journalTotals(c.state.records).total.person,count*20);
  }
});

test('whole-month totals and print exclude non-teaching dates and flag missing future rosters',()=>{
  const c=fixture();
  c.todayISO=()=> '2026-09-01';
  c.isHoliday=date=>date==='2026-09-14';
  const records=['2026-09-07','2026-09-14','2026-09-21','2026-09-28'].map(date=>({
    id:date,employeeId:'t',studentId:'g',date,participantKind:'group',time:'10:00-10:40',
    participantIds:['a','b'],participantNames:{a:'A',b:'B'},pedHours:1,kcHours:0,status:'planned'
  }));
  records[2].status='holiday';
  records[3].participantIds=[];
  assert.equal(c.renderPersonHoursTotal(records),'2 <small>(нет состава: 1)</small>');
  assert.equal(c.journalTotals(records).total.person,2);
  assert.equal(c.journalTotals(records).total.pending,1);
  const print=c.renderLessonRosterPrintReport(records);
  assert(!print.includes('2026-09-14'));
  assert(!print.includes('2026-09-21'));
  assert(print.includes('Нет состава</td>'));
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

test('past lesson roster can be corrected independently, survives regeneration and can return to its schedule',()=>{
  const c=subgroupFixture();
  c.state.schedule[0].participantIds=[...c.state.groups[0].studentIds];
  c.state.schedule[0].archiveId='old-week';
  const first=c.state.records[0];
  assert.equal(c.journalLessonRoster(first).personHours,13);
  const scheduleBefore=JSON.stringify(c.state.schedule);
  c.openJournalRoster(first.id);
  assert(c.modalHtml.includes('Сохранить состав на эту дату'));
  c.saveJournalRoster({dataset:{recordId:first.id},memberIds:['p1','p2']});
  assert.equal(first.rosterOverride,true);
  assert.equal(c.journalLessonRoster(first).personHours,2);
  assert.equal(c.journalLessonRoster(c.state.records[1]).personHours,3);
  assert.equal(JSON.stringify(c.state.schedule),scheduleBefore);
  assert.equal(c.journalTotals(c.state.records).total.person,5);
  c.refreshJournalMonth('2026-09','2026-09-15','t');
  const reloaded=fixture();
  reloaded.state=JSON.parse(JSON.stringify(c.state));
  const corrected=reloaded.state.records.find(r=>r.id===first.id);
  assert.equal(corrected.rosterOverride,true);
  assert.equal(reloaded.journalLessonRoster(corrected).personHours,2);
  assert.equal(corrected.grade,'5');
  assert(!reloaded.renderLessonRosterPrintReport([corrected]).includes('Состав исправлен'));
  reloaded.resetJournalRoster(corrected.id);
  assert.equal(corrected.rosterOverride,undefined);
  assert.equal(reloaded.journalLessonRoster(corrected).personHours,13);
});

test('pupils have independent grades and old shared grades are not copied to everyone',()=>{
  const c=subgroupFixture();
  const first=c.state.records[0];
  const entry={name:'Group',className:'1 класс',records:[first]};
  const before=c.renderJournalEntry(entry,[first.date]);
  assert.equal((before.match(/aria-hidden="true">•<\/span>/g)||[]).length,2);
  assert(before.includes('Старая общая оценка: 5'));
  assert(!before.includes('Оценка Group'));
  c.setGrade(first.id,'5','p1');
  c.setGrade(first.id,'4','p2');
  assert.equal(JSON.stringify(first.studentGrades),'{"p1":"5","p2":"4"}');
  assert.equal(first.grade,'5');
  const pupils=c.journalPupilEntries(entry);
  assert(c.renderJournalCell(pupils.find(p=>p.memberId==='p1'),first.date).includes('value="5" selected'));
  assert(c.renderJournalCell(pupils.find(p=>p.memberId==='p2'),first.date).includes('value="4" selected'));
  assert.equal(c.renderPersonHoursTotal([first],'p1'),'1');
  assert.equal(c.journalTotals([first]).total.ped,1);
  assert.equal(c.journalTotals([first]).total.person,2);
  assert(c.renderLessonRosterPrintReport([first]).includes('Ученик 01: 5; Ученик 02: 4'));
  c.refreshJournalMonth('2026-09','2026-09-15','t');
  assert.equal(JSON.stringify(c.state.records.find(r=>r.id===first.id).studentGrades),'{"p1":"5","p2":"4"}');
});

test('removing and restoring a graded pupil preserves their grade without transferring it',()=>{
  const c=subgroupFixture();
  const first=c.state.records[0];
  c.setGrade(first.id,'5','p1');
  c.setGrade(first.id,'4','p2');
  c.saveJournalRoster({dataset:{recordId:first.id},memberIds:['p1','p6']});
  assert.equal(first.studentGrades.p2,'4');
  assert.equal(first.studentGrades.p6,undefined);
  const pupils=c.journalPupilEntries({records:[first]});
  assert(!pupils.some(p=>p.memberId==='p2'));
  assert(c.renderJournalCell(pupils.find(p=>p.memberId==='p6'),first.date).includes('aria-hidden="true">•</span>'));
  c.saveJournalRoster({dataset:{recordId:first.id},memberIds:['p1','p2']});
  assert.equal(first.studentGrades.p2,'4');
  c.setGrade(first.id,'','p1');
  assert.equal(first.studentGrades.p1,undefined);
  assert.equal(first.studentGrades.p2,'4');
});

test('compact group cells keep correction controls collapsed and all metadata available in print',()=>{
  const c=subgroupFixture();
  const first=c.state.records[0];
  c.saveJournalRoster({dataset:{recordId:first.id},memberIds:['p1','p2']});
  c.setGrade(first.id,'5','p1');
  c.setGrade(first.id,'4','p2');
  const before=JSON.stringify(c.state);
  const html=c.renderJournalEntry({name:'Group',className:'1 класс',records:[first]},[first.date]);
  assert(html.includes('<details class="journal-roster-details">'));
  assert(!/<details[^>]*\bopen\b/.test(html));
  assert(/<summary[^>]*>2 уч\.<\/summary>/.test(html));
  assert(html.includes('aria-label="Состав Group за 2026-09-02: 2 уч."'));
  assert(/<div class="journal-roster-options">[\s\S]*data-action="journalRoster:record-wed"[\s\S]*Старая общая оценка: 5[\s\S]*<\/details>/.test(html));
  assert(!html.includes('2 уч. · 2 чел.-ч.'));
  assert(!html.includes('Исправлено на дату'));
  assert(/<\/details>\s*<small class="print-lesson-details">[^<]*<br>Старая общая оценка: 5<\/small>/.test(html));
  assert.equal((html.match(/data-grade-student=/g)||[]).length,2);
  assert(html.includes('value="5" selected'));
  assert(html.includes('value="4" selected'));
  assert.equal(JSON.stringify(c.state),before);
});

test('correction and pupil grading guards reject outsiders, invalid grades and another employee',()=>{
  const c=subgroupFixture();
  const first=c.state.records[0];
  const before=JSON.stringify(c.state);
  c.setGrade(first.id,'5','outsider');
  c.setGrade(first.id,'6','p1');
  c.setGrade(first.id,'5');
  assert.equal(JSON.stringify(c.state),before);
  c.saveJournalRoster({dataset:{recordId:first.id},memberIds:[]});
  assert(c.alert);
  assert.equal(JSON.stringify(c.state),before);
  c.state.activeEmployeeId='other';
  c.openJournalRoster(first.id);
  c.saveJournalRoster({dataset:{recordId:first.id},memberIds:['p1']});
  c.setGrade(first.id,'5','p1');
  c.resetJournalRoster(first.id);
  c.state.activeEmployeeId='t';
  assert.equal(JSON.stringify(c.state),before);
});
