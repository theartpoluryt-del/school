const {test} = require('node:test');
const assert = require('node:assert/strict');
const model = require('../school-model.js');
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
