const {test} = require('node:test');
const assert = require('node:assert/strict');
const model = require('../school-model.js');

test('four 40-minute lessons with 20 children equal 4 lesson hours and 80 person-hours',()=>{
  const ids=Array.from({length:20},(_,i)=>`p${i}`);
  const lesson={time:'10:00-10:40',participantIds:ids,presentStudentIds:ids,pedHours:1,kcHours:1};
  assert.equal(model.lessonHours(lesson)*4,4);
  assert.equal(model.personHours(lesson)*4,80);
});

test('person-hours use the unique roster regardless of old attendance and support fractional hours',()=>{
  const lesson={time:'10:00-11:40',studentId:'group',participantIds:['a','b','c','c']};
  assert.equal(model.personHours(lesson),7.5);
  assert.equal(model.personHours({...lesson,presentStudentIds:[]}),7.5);
  assert.equal(model.personHours({...lesson,presentStudentIds:['a','b','a','outsider']}),7.5);
  assert.equal(model.personHours({...lesson,presentStudentIds:['a','b','c']}),7.5);
  assert.equal(model.personHours({...lesson,attendanceLessonHours:1,presentStudentIds:['a','b','c']}),7.5);
  assert.equal(model.personHours({...lesson,participantIds:[]}),null);
  assert.equal(model.personHours({time:'10:00-10:40',studentId:'group'}),null);
  assert.deepEqual(model.memberIds({studentId:'a'}),['a']);
  assert.deepEqual(model.memberIds({studentId:'g'}, {studentIds:['a','a','b']}),['a','b']);
  assert.deepEqual(model.memberIds({studentId:'g',participantIds:[]},{studentIds:['a']}),[]);
  assert.equal(model.lessonHours({time:'99:99-99:99',pedHours:'bad'}),0);
});
test('40-minute academic hours and decimal comma', () => {
  assert.equal(model.endTime('10:00',1),'10:40');
  assert.equal(model.endTime('10:00',2),'11:20');
  assert.equal(model.endTime('10:00','2,5'),'11:40');
  assert.equal(model.endTime('23:50',1),'');
  assert.equal(model.endTime('10:00',0),'');
});
test('same child and teacher can have distinct instruments and classes', () => {
  const student={enrollments:[
    {id:'flute',instrument:'Флейта',subject:'Специальность',className:'6 кл',employeeIds:['teacher']},
    {id:'sax',instrument:'Саксофон',subject:'Специальность',className:'3 кл',employeeIds:['teacher']},
    {id:'piano',subject:'Музыкальный инструмент',className:'6 кл',employeeIds:['other']}
  ]};
  assert.equal(model.courses(student,'teacher').length,2);
  const row=model.applyCourse({},model.courses(student,'teacher')[1]);
  assert.equal(row.className,'3 кл');
  assert.equal(model.subjectLabel(row),'Специальность: Саксофон');
  assert.equal(model.courses(student,'other')[0].id,'piano');
  const choices=model.courseChoices(model.courses(student,'teacher'),'Специальность');
  assert.equal(choices.simple,true);
  assert.deepEqual(choices.items.map(e=>e.label),['Флейта','Саксофон']);
  const lesson={};
  model.applyCourse(lesson,choices.items[1]);
  assert.equal(lesson.className,'3 кл');
  model.applyCourse(lesson,choices.items[0]);
  assert.equal(lesson.className,'6 кл');
  assert.equal(model.courseChoices(model.courses(student,'teacher'),'Ансамбль').simple,false);
});
