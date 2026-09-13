const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const paid=require('../paid-model.js');
const course={id:'group',students:Array.from({length:11},(_,i)=>({id:'p'+i,name:'Ученик '+i}))};
test('new paid lesson has NO attendance, NO grades and is NOT completed',()=>{
  const lesson=paid.newLesson(course,'teacher','2026-09-02',1);
  assert.deepEqual(lesson.present_student_ids,[]); assert.deepEqual(lesson.grades,{});
  assert.equal(lesson.completed,false); assert.equal(paid.workedHours([lesson]),0);
  assert.equal(lesson.students.length,11);
  lesson.students[0].name='Changed'; assert.notEqual(course.students[0].name,'Changed');
});
test('group hours count once; attendance does not multiply hours',()=>{
  const lesson=paid.newLesson(course,'teacher','2026-09-02',1);
  lesson.completed=true;
  assert.equal(paid.workedHours([lesson]),1);
  lesson.present_student_ids=course.students.map(s=>s.id);
  assert.equal(paid.workedHours([lesson]),1);
  assert.equal(paid.workedHours([lesson,{...lesson,hours:2.5}, {...lesson,hours:10,completed:false}]),3.5);
  assert.equal(paid.workedHours([{...lesson,deleted:true}]),0);
});
test('quarter academic hours are validated',()=>{
  for(const h of [0.25,0.5,1,2,2.5,24]) assert.equal(paid.validHours(h),true);
  for(const h of [0,-1,0.3,25,'bad',Infinity]) assert.equal(paid.validHours(h),false);
});
test('historical pupils remain visible, duplicate IDs do not duplicate rows',()=>{
  const lesson=paid.newLesson(course,'teacher','2026-09-02',1);
  const next={...course,students:[course.students[0],{id:'new',name:'Новый ученик'}]};
  assert.equal(paid.roster(next,[lesson]).length,12);
});
test('paid page uses separate RPCs and never main context persistence',()=>{
  const source=fs.readFileSync(require.resolve('../paid-journal.js'),'utf8');
  assert.match(source,/get_paid_journal/); assert.match(source,/save_paid_lesson/);
  assert.doesNotMatch(source,/persistAndRender|save_school_context|personHours|чел\.-ч\./);
});
