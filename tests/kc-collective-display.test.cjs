const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const SchoolModel=require('../school-model.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function fixture(){
  const escape=x=>String(x ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const c=vm.createContext({SchoolModel,escapeHtml:escape,escapeAttr:escape,
    participantById:id=>SchoolModel.kcCollective(id)||{name:'Ученица',kind:'student'},
    courseOptionsFor:()=>[],scheduleTimeParts:()=>({start:'10:00',end:'11:00'}),
    journalClassLabel:row=>row.className,compactJournalClass:x=>x,
    formatNumber:String,digitsOnly:x=>x,weekdays:['Пн'],lessonTypes:['Концертмейстер','КЦ']});
  for(const name of ['courseSelectOptions','lessonTypeOptions','renderScheduleRow','renderSchedulePrintRow']){
    const start=source.indexOf(`function ${name}(`),end=source.indexOf('\nfunction ',start+1);
    vm.runInContext(source.slice(start,end),c);
  }
  return c;
}
test('all KC collectives show name and free class without course, keeping KC accounting',()=>{
  const c=fixture();
  for(const collective of SchoolModel.kcCollectives){
    const row={id:'row',studentId:collective.id,type:'КЦ',kcKind:'kc',className:'2–4 / утро',pedHours:0,kcHours:1.5,weekday:0,time:'10:00-11:00'};
    const html=c.renderScheduleRow(row),printed=c.renderSchedulePrintRow(row);
    assert(html.includes(`<strong>${collective.name}</strong>`));
    assert(html.includes('value="2–4 / утро"'));
    assert(html.includes('<option value="КЦ" selected>Концертмейстер</option>'));
    assert(!html.includes('schedule-course-select'));
    assert(printed.includes(collective.name));assert(printed.includes('2–4 / утро'));
    assert(!printed.includes('<small>'));
    assert(SchoolModel.isKcLesson(row));assert.equal(SchoolModel.personHours(row),0);
  }
});
test('individual pedagogical concertmaster retains its subject and stays out of KC',()=>{
  const c=fixture(),row={id:'ped',studentId:'student',type:'Концертмейстер',kcKind:'pedagogical',className:'7/8',pedHours:1,kcHours:0};
  assert(c.renderSchedulePrintRow(row).includes('<small>Концертмейстер</small>'));
  assert.equal(SchoolModel.isKcLesson(row),false);
});
