const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const SchoolSync=require('../sync-model.js');
function fixture(){
  const c=vm.createContext({state:{activeEmployeeId:'t',employees:[],records:[],absenceRows:[]},
    document:{addEventListener(){}},window:{addEventListener(){}}});
  vm.runInContext(fs.readFileSync(require.resolve('../absence-journal.js'),'utf8'),c);
  return {c,api:c.window.AbsenceJournal};
}
test('absence zeros source hours only within period without mutating original grades',()=>{
  const {c,api}=fixture();
  c.state.absenceRows=[{id:'a',source_employee:'t',substitute_employee:'s',starts_on:'2026-09-15',ends_on:'2026-09-20',lessons:[]}];
  const records=['14','15','20','21'].map(d=>({id:d,date:'2026-09-'+d,pedHours:1,kcHours:0,grade:'5'}));
  assert.equal(api.projected('t',records).reduce((n,r)=>n+r.pedHours,0),2);
  assert.equal(records[1].pedHours,1);assert.equal(records[1].grade,'5');
  c.state.absenceRows[0].cancelled=true;
  assert.equal(api.projected('t',records).reduce((n,r)=>n+r.pedHours,0),4);
});
test('only designated substitute receives snapshots; cancellation removes hours and keeps audit data',()=>{
  const {c,api}=fixture();
  c.state.absenceRows=[{id:'a',source_employee:'t',substitute_employee:'s',starts_on:'2026-09-15',ends_on:'2026-09-20',lessons:[{id:'sub-1',date:'2026-09-16',pedHours:1.5,participantIds:['p'],grade:'4'}]}];
  assert.equal(api.projected('other',[]).length,0);
  assert.equal(api.projected('s',[])[0].pedHours,1.5);
  assert.equal(api.find('sub-1'),null);
  c.state.activeEmployeeId='s';assert.equal(api.find('sub-1').absenceId,'a');
  c.state.absenceRows[0].cancelled=true;
  assert.equal(api.projected('s',[]).length,0);assert.equal(c.state.absenceRows[0].lessons[0].grade,'4');
});
test('authoritative absence metadata refreshes without merging into ordinary saved state',()=>{
  const base={records:[]},local={...base,absenceRows:[{id:'old'}]},remote={...base,absenceRows:[{id:'new'}],absencesEnabled:true};
  assert.equal(SchoolSync.payload(base,local,remote).absenceRows[0].id,'new');
});
