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
    state:{schedule:[],records:[]},
    monthDates:()=>['2026-09-14','2026-09-21'],
    parseISO:d=>new Date(d+'T12:00:00'),isHoliday:()=>false,createId:()=>`id-${++seq}`,
    studentName:()=> 'Test pupil',educationFormForParticipant:()=> 'ДПП',
    SchoolModel:require('../school-model.js'),escapeHtml:s=>String(s),escapeAttr:s=>String(s),formatNumber:String
  });
  ['refreshJournalMonth','activeScheduleForEmployeeDate','gradeOptions','renderJournalCell'].forEach(n=>load(n,ctx));
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
test('numeric and string grades render a visible value and selected option',()=>{
  const c=fixture();
  for(const grade of [5,'5','4+']) {
    const html=c.renderJournalCell({name:'Test',records:[{id:'r',date:'2026-09-14',grade}]},'2026-09-14');
    assert(html.includes(`aria-hidden="true">${grade}</span>`));
    assert(html.includes(`value="${grade}" selected`));
    assert(html.includes('Пед.'));
  }
});
