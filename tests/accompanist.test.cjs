const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const model=require('../accompanist-model.js');
const lesson=(id,hours,students=[{id:'a',name:'Аня'}])=>({id,hours,students,subject:'Хор',lesson_date:'2026-09-01'});
test('KC counts a joint lesson once, not once per pupil, and excludes deleted lessons',()=>{
  const lessons=[lesson('one',1.5,[{id:'a',name:'Аня'},{id:'b',name:'Борис'}]),lesson('two',2),{...lesson('old',10),deleted:true}];
  assert.equal(model.total(lessons),3.5);
  assert.equal(model.rows(lessons).length,2);
});
test('KC accepts only positive half-hour units through 24, including decimal comma',()=>{
  for(const h of [0.5,1,1.5,2,2.5,24,'1,5']) assert.equal(model.validHours(h),true);
  for(const h of ['',null,0,-1,0.25,2.13,25,NaN,Infinity,'abc']) assert.equal(model.validHours(h),false);
});
test('KC matrix groups by exact roster and subject, not input order or matching names',()=>{
  const people=[{id:'a',name:'Аня'},{id:'b',name:'Борис'}];
  const lessons=[lesson('a',1,people),lesson('b',1.5,[...people].reverse()),{...lesson('c',2,people),subject:'Ансамбль'},lesson('d',1,[{id:'c',name:'Аня'},{id:'b',name:'Борис'}])];
  const before=JSON.stringify(lessons),rows=model.rows(lessons);
  assert.equal(rows.length,3);
  assert.equal(model.total(rows.find(r=>r.lessons.length===2).lessons),2.5);
  assert.equal(rows.reduce((n,r)=>n+model.total(r.lessons),0),model.total(lessons));
  assert.equal(JSON.stringify(lessons),before);
});
test('KC endpoints and tables have authentication, employee allowlist and own-record checks',()=>{
  const sql=fs.readFileSync(require.resolve('../supabase/accompanist_journal.sql'),'utf8');
  assert.equal((sql.match(/if auth.uid\(\) is null/g)||[]).length,3);
  assert.equal((sql.match(/target_employee is distinct from own|target is distinct from own/g)||[]).length,2);
  assert.match(sql,/revoke all on public.school_accompanists,public.accompanist_lessons from anon,authenticated/);
  assert.match(sql,/old_row.employee_id is distinct from target/);
  assert.match(sql,/old_row.updated_at is distinct from expected_updated_at/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/old_row.hours=amount and old_row.deleted=removing then return/);
  assert.doesNotMatch(sql,/update public.school_state|insert into public.school_state|grades\s+jsonb|person_hours/i);
});
test('KC UI uses bounded requests, a stable insert id, safe escaping and no grade controls',()=>{
  const js=fs.readFileSync(require.resolve('../accompanist-journal.js'),'utf8');
  assert.match(js,/lessonId=existing\?\.id\|\|crypto.randomUUID\(\)/);
  assert.match(js,/SchoolSync.request\(supabaseClient.rpc\('save_accompanist_lesson'/);
  assert.match(js,/if\(request!==serial\|\|initial!==context\(\)\) return/);
  assert.match(js,/escapeHtml\(s.name\)/);
  assert.doesNotMatch(js,/data-grade|personHours|present_student_ids/);
});
