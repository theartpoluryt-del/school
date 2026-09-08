const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function load(name,ctx) {
  const start=source.indexOf(`function ${name}(`);
  const end=source.indexOf('\nfunction ',start+1);
  vm.runInContext(source.slice(start,end),ctx);
}
function fixture(isAdmin=true) {
  const controls={};
  const ctx=vm.createContext({
    state:{sessionEmployeeId:'admin',activeEmployeeId:'teacher',employees:[{id:'admin',name:'Administrator',position:'Администратор',isAdmin},{id:'teacher',name:'Teacher',position:'Преподаватель'}],students:[
      {id:'a',assignedEmployeeIds:['teacher'],enrollments:[{id:'flute',className:'6',employeeIds:['teacher']}]},
      {id:'b',assignedEmployeeIds:[]},{id:'archived',isArchived:true,assignedEmployeeIds:[]}
    ],records:[{id:'grade',grade:5}]},
    selectedStudentIdsFromForm:()=>['a','a','b','archived','missing'],
    document:{querySelector:selector=>controls[selector]||(controls[selector]={})},
    uniqueByIdValues:ids=>[...new Set(ids)],closeModal(){},persistAndRender:()=>{ctx.saved=true;},alert:message=>{ctx.alert=message;},
    employeeInstrument:()=>'',escapeHtml:String
  });
  ['currentUser','isAdmin','isTeachingEmployee','visibleEmployees','visibleStudents','assignStudentsToSelf','teacherCheckboxes'].forEach(name=>load(name,ctx));
  return ctx;
}
test('admin position can receive pupils and appears in the assignment picker',()=>{
  const c=fixture();
  assert.equal(c.isTeachingEmployee(c.state.employees[0]),true);
  const html=c.teacherCheckboxes(['admin']);
  assert.match(html,/value="admin" checked/);
  assert.match(html,/\(вы\)/);
});
test('self-assignment adds own account, keeps other assignments, grades and classes',()=>{
  const c=fixture();
  const courses=JSON.stringify(c.state.students[0].enrollments);
  c.assignStudentsToSelf({});
  c.assignStudentsToSelf({});
  assert.deepEqual(Array.from(c.state.students[0].assignedEmployeeIds),['teacher','admin']);
  assert.equal(JSON.stringify(c.state.students[0].enrollments),courses);
  assert.equal(c.state.records[0].grade,5);
  assert.equal(c.state.students[2].assignedEmployeeIds.length,0);
  assert.equal(c.state.activeEmployeeId,'admin');
  assert.equal(c.visibleStudents().length,2);
  assert.equal(c.saved,true);
});
test('non-admin cannot use self-assignment',()=>{
  const c=fixture(false);
  c.assignStudentsToSelf({});
  assert.deepEqual(Array.from(c.state.students[0].assignedEmployeeIds),['teacher']);
  assert.equal(c.saved,undefined);
});
