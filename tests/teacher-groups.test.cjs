const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function fixture(admin=false) {
  const c=vm.createContext({state:{teacherGroupsEnabled:true,sessionEmployeeId:'t',activeEmployeeId:'other',
    students:[{id:'own',assignedEmployeeIds:['t']},{id:'other',assignedEmployeeIds:['other']}],groups:[],
    records:[{id:'grade',studentId:'g',grade:'5',educationForm:'ДПП',participantIds:['own']}]},
    isAdmin:()=>admin,currentUser:()=>({id:'t'}),selectedStudentIdsFromForm:()=>['own'],
    nextGroupExternalId:()=> 'G1',createId:()=> 'g',normalizeEducationForm:x=>x,
    closeModal(){},persistAndRender(){c.saved=true;},alert:message=>{c.error=message;},
    checkedValues:()=>['other']});
  for(const name of ['canCreateTeachingGroup','canEditTeachingGroup','validateTeachingGroupSelection','visibleStudents','addGroupFromModal','assignGroupFromModal']) {
    const start=source.indexOf(`function ${name}(`),end=source.indexOf('\nfunction ',start+1);
    vm.runInContext(source.slice(start,end),c);
  }
  return c;
}
function form() {return {dataset:{groupId:'g'},elements:{externalId:{value:''},name:{value:'Моя группа'},className:{value:'1/8'},educationForm:{value:'ДОП'}}};}
test('teacher group belongs to signed-in teacher, not selected employee',()=>{
  const c=fixture(); c.addGroupFromModal(form());
  assert.equal(c.state.groups[0].ownerEmployeeId,'t');
  assert.deepEqual(Array.from(c.state.groups[0].assignedEmployeeIds),['t']);
  assert.equal(c.saved,true);
});
test('feature is unavailable until server migration enables it',()=>{
  const c=fixture(); c.state.teacherGroupsEnabled=false; c.addGroupFromModal(form());
  assert.equal(c.state.groups.length,0);
});
test('teacher cannot include another teacher pupil',()=>{
  const c=fixture(); c.selectedStudentIdsFromForm=()=>['other']; c.addGroupFromModal(form());
  assert.equal(c.state.groups.length,0); assert.ok(c.error);
});
test('teacher cannot change imported or shared groups',()=>{
  const c=fixture(); c.state.groups=[{id:'g',assignedEmployeeIds:['t'],studentIds:['own']}];
  c.assignGroupFromModal(form()); assert.equal(c.saved,undefined);
  c.state.groups[0].ownerEmployeeId='t'; c.state.groups[0].assignedEmployeeIds.push('other');
  c.assignGroupFromModal(form()); assert.equal(c.saved,undefined);
});
test('editing own group preserves teacher assignment and previous lessons',()=>{
  const c=fixture(); c.addGroupFromModal(form()); const before=JSON.stringify(c.state.records);
  c.assignGroupFromModal(form());
  assert.deepEqual(Array.from(c.state.groups[0].assignedEmployeeIds),['t']);
  assert.equal(JSON.stringify(c.state.records),before);
});
test('existing members may remain after assignment ends; no new ones added',()=>{
  const c=fixture(); assert.equal(c.validateTeachingGroupSelection(['other'],{studentIds:['other']}),true);
  assert.equal(c.validateTeachingGroupSelection(['other'],{studentIds:['own']}),false);
});
