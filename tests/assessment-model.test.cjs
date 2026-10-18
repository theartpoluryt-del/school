const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../assessment-model.js'),S=require('../school-model.js');
test('school quarters span the academic year, not calendar quarters',()=>{
 for(const [date,q,y] of [['2026-09-01',1,2026],['2026-10-31',1,2026],['2026-11-01',2,2026],['2027-01-10',3,2026],['2027-04-01',4,2026]]){
  assert.equal(M.quarter(date),q);assert.equal(M.year(date),y);
 }
});
test('quarter grade is shared across months, but never across teacher, subject, instrument or pupil',()=>{
 const sep={id:'s',employeeId:'t',studentId:'g',participantIds:['a','b'],date:'2026-09-01',type:'Сольфеджио',className:'1/5',quarterGrades:{a:'5'}};
 const oct={...sep,id:'o',date:'2026-10-01',quarterGrades:undefined};
 assert.equal(M.anchor([oct,sep],oct,'a',1).id,'s');
 assert.equal(M.anchor([sep],{...oct,type:'Хор'},'a',1),undefined);
 assert.equal(M.anchor([sep],{...oct,employeeId:'other'},'a',1),undefined);
 assert.equal(M.anchor([sep],oct,'stranger',1),undefined);
 assert.equal(M.anchor([sep],oct,'a',2),undefined);
});
test('new pedagogical accompaniment never counts as KC; ambiguous history stays unchanged',()=>{
 assert.equal(S.isKcLesson({type:'Концертмейстер'}),true);
 assert.equal(S.isKcLesson({type:'Концертмейстер',kcKind:'pedagogical'}),false);
 assert.equal(S.isKcLesson({type:'КЦ'}),true);
 assert.equal(S.personHours({type:'КЦ',participantIds:['a','b'],pedHours:0,kcHours:2}),0);
 assert.equal(S.kcCollective('kc-choir-ho').name,'Хор ХО');assert.equal(S.kcCollective('unknown'),undefined);
});
