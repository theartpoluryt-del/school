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
test('person-hours round each lesson to nearest half hour before multiplying or summing',()=>{
  for(const [time,hours] of [
    ['10:00-10:20',0.5],['10:00-10:40',1],['10:00-10:45',1],
    ['10:00-11:00',1.5],['10:00-11:05',1.5],['10:00-11:20',2],
    ['10:00-11:25',2],['10:00-11:40',2.5],['10:00-11:45',2.5],
    ['10:00-11:29',2],['10:00-11:30',2.5]
  ]) {
    const lesson={time,participantIds:Array.from({length:13},(_,i)=>'p'+i),pedHours:2.125,kcHours:0};
    const before=JSON.stringify(lesson);
    assert.equal(model.lessonHours(lesson),hours,time);
    assert.equal(model.personHours(lesson),hours*13,time);
    assert.equal(model.personHours(lesson)*4,hours*13*4,time);
    assert.equal(JSON.stringify(lesson),before,'rounding must not rewrite workload or time');
  }
  assert.equal(model.personHours({time:'10:00-11:25',participantIds:['a']}),2);
  assert.equal(model.lessonHours({academicHours:2.13,time:'10:00-11:25'}),2);
  assert.equal(model.lessonHours({pedHours:2.13}),2);
  assert.equal(model.lessonHours({academicHours:0,time:'10:00-11:25'}),0);
  assert.equal(model.endTime('10:00',1.25),'10:50','schedule clock calculation is unchanged');
});

test('40-minute academic hours and decimal comma', () => {
  assert.equal(model.endTime('10:00',1),'10:40');
  assert.equal(model.endTime('10:00',2),'11:20');
  assert.equal(model.endTime('10:00','2,5'),'11:40');
  assert.equal(model.endTime('23:50',1),'');
  assert.equal(model.endTime('10:00',0),'');
});

test('choir actual minutes and workload are independent without changing ordinary lessons', () => {
  assert.equal(model.endTime('10:00',1.5,55),'10:55');
  assert.equal(model.endTime('10:00',1.5,60),'11:00');
  assert.equal(model.endTime('10:00',2,80),'11:20');
  assert.equal(model.endTime('10:00',0.5),'10:20');
  assert.equal(model.endTime('23:30',1.5,55),'');
  assert.equal(model.endTime('10:00',1.5,-55),'');
  const first={time:'10:00-10:55',academicHours:1.5,pedHours:1.5,kcHours:0,participantIds:['a','b']};
  assert.equal(model.lessonHours(first),1.5);
  assert.equal(model.personHours(first),3);
  assert.equal(model.personHours({...first,academicHours:0}),0);
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
