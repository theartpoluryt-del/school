const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 for(const file of ['schema.sql','lesson_members.sql','journal_corrections.sql','teacher_groups.sql','save_performance.sql','atomic_changes.sql','absences.sql','accompanist_journal.sql','accompanist_schedule.sql','accompanist_roster.sql','accompanist_roster.sql'])
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase',file),'utf8'));
 const kc=randomUUID(),teacher=randomUUID(),admin=randomUUID();
 await db.query('insert into auth.users values($1),($2),($3)',[kc,teacher,admin]);
 await db.query("insert into school_profiles(id,username,display_name,is_admin) values($1,'kc','KC',false),($2,'teacher','Teacher',false),($3,'admin','Admin',true)",[kc,teacher,admin]);
 const original={employees:[{id:'kc',username:'kc'},{id:'teacher',username:'teacher'},{id:'admin',username:'admin'}],students:[
  {id:'p1',name:'Pupil',assignedEmployeeIds:['teacher'],secret:'must-not-leak',enrollments:[{id:'e1',instrument:'Флейта',className:'3 кл',termYears:8,employeeIds:['teacher']}]},
  {id:'archived',isArchived:true,name:'Archived',assignedEmployeeIds:[]}],groups:[],schedule:[],records:[{id:'grade',employeeId:'teacher',studentId:'p1',grade:'5'}],scheduleArchives:[],holidays:[]};
 await db.query('insert into school_state(payload) values($1)',[original]);
 await db.exec("insert into school_accompanists(employee_id) values('kc'),('admin');");
 const as=uid=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 const context=()=>db.query('select get_school_context() as c').then(r=>r.rows[0].c);
 const save=(collection,before,after)=>db.query('select save_school_changes($1,$2) as c',[[{collection,id:before?.id||after.id,before,after}],randomUUID()]).then(r=>r.rows[0].c);
 await as(kc);let c=await context();
 assert.deepEqual(c.payload.students,[]);assert.deepEqual(c.payload.records,[]);
 assert.deepEqual(c.payload.kcScheduleEmployeeIds,['kc']);assert.equal(c.payload.kcScheduleStudents.length,1);
 assert.equal(c.payload.kcScheduleStudents[0].secret,undefined);assert.equal(c.payload.kcScheduleStudents[0].assignedEmployeeIds,undefined);
 assert.equal(c.payload.kcScheduleStudents[0].enrollments[0].employeeIds,undefined);
 const row={id:'kc-row',employeeId:'kc',studentId:'p1',type:'Концертмейстер',className:'3 кл',termYears:8,instrument:'Флейта',
  enrollmentId:'e1',effectiveFrom:'2026-10-01',effectiveTo:'',archiveId:'',weekday:1,time:'10:00-10:40',kcHours:1,pedHours:0};
 c=await save('schedule',null,row);assert.deepEqual(c.payload.schedule,[row]);
 c=await context();assert.deepEqual(c.payload.schedule,[row]);
 const journal=(await db.query("select get_accompanist_journal('kc','2026-10-01') as j")).rows[0].j;
 assert.equal(journal.lessons.length,4);assert.equal(journal.lessons[0].students[0].name,'Pupil');assert.equal(journal.lessons[0].hours,1);
 assert.equal(journal.lessons.reduce((n,l)=>n+Number(l.hours),0),4);
 await assert.rejects(save('schedule',row,{...row,type:'Специальность'}),e=>e.code==='42501');
 await assert.rejects(save('schedule',null,{...row,id:'wrong',type:'Специальность'}),e=>e.code==='42501');
 await assert.rejects(save('schedule',null,{...row,id:'foreign',employeeId:'teacher'}),e=>e.code==='42501');
 await assert.rejects(save('schedule',null,{...row,id:'unknown',studentId:'unknown'}),e=>e.code==='42501');
 await assert.rejects(save('records',null,{id:'grade',employeeId:'kc',studentId:'p1',grade:'2'}),e=>e.code==='42501');
 c=await context();const legacy={...c.payload,schedule:[{...row,time:'11:00-11:40'}]};
 await db.query('select save_school_context($1,$2)',[legacy,c.updated_at]);
 assert.equal((await context()).payload.schedule[0].time,'11:00-11:40');
 c=await context();await assert.rejects(db.query('select save_school_context($1,$2)',[{...c.payload,schedule:[{...row,type:'Специальность'}]},c.updated_at]),e=>e.code==='42501');

 const legacyHash=journal.lessons[0].source_hash;
 const migration=fs.readFileSync(path.join(__dirname,'../supabase/kc_kinds_assessments.sql'),'utf8');
 await db.exec(migration);await db.exec(migration);
 const after=(await db.query("select get_accompanist_journal('kc','2026-10-01') as j")).rows[0].j;
 // Timetable time was changed above; compare to the same original time before asserting old hash.
 c=await context(); await save('schedule',c.payload.schedule[0],row);
 const unchanged=(await db.query("select get_accompanist_journal('kc','2026-10-01') as j")).rows[0].j;
 assert.equal(unchanged.lessons[0].source_hash,legacyHash);
 assert.equal(unchanged.lessons[0].legacyKind,true);
 await assert.rejects(save('schedule',row,{...row,kcKind:'pedagogical'}),e=>e.code==='42501');
 const collective={...row,id:'collective',studentId:'kc-choir-ho',type:'КЦ',instrument:'',enrollmentId:'',participantIds:[],className:'2–4 / утро',kcHours:1.5,time:'11:00-12:00'};
 await save('schedule',null,collective);
 let j=(await db.query("select get_accompanist_journal('kc','2026-10-01') as j")).rows[0].j;
 assert.equal(j.lessons.filter(l=>l.collective).length,4);
 assert.equal(j.lessons.find(l=>l.collective).students[0].name,'Хор ХО');
 assert.equal(j.lessons.find(l=>l.collective).className,'2–4 / утро');
 assert.equal(j.lessons.find(l=>l.collective).hours,1.5);
 assert.equal(j.lessons.find(l=>l.collective).subject,'—');
 await assert.rejects(save('schedule',collective,{...collective,type:'Сольфеджио'}));
 await assert.rejects(save('schedule',collective,{...collective,instrument:'Флейта'}));
 await save('schedule',collective,null);
 await as(teacher);c=await context();
 const ped={...row,id:'ped',employeeId:'teacher',kcKind:'pedagogical',pedHours:1,kcHours:0};
 await save('schedule',null,ped);
 const rec={id:'assessment',scheduleId:'ped',employeeId:'teacher',studentId:'p1',date:'2026-10-05',participantIds:['p1'],type:'Концертмейстер',kcKind:'pedagogical',quarterGrades:{p1:'5'},extraGrades:{p1:['4','5','','3+']}};
 await save('records',null,rec);
 assert.deepEqual((await context()).payload.records.find(r=>r.id==='assessment').extraGrades,rec.extraGrades);
 await assert.rejects(save('records',rec,{...rec,quarterGrades:{stranger:'5'}}),e=>e.code==='42501');
 await assert.rejects(save('records',rec,{...rec,extraGrades:{p1:['6','','','']}}),e=>e.code==='22023');
 await save('records',rec,null);await save('schedule',ped,null);
 await as(teacher);c=await context();assert.deepEqual(c.payload.kcScheduleStudents,[]);assert.deepEqual(c.payload.kcScheduleEmployeeIds,[]);
 await assert.rejects(save('schedule',null,{...row,id:'not-kc',employeeId:'teacher',studentId:'unknown'}),e=>e.code==='42501');
 await as(admin);c=await context();assert.equal(c.payload.kcScheduleEmployeeIds.length,2);
 const stored=(await db.query('select payload from school_state')).rows[0].payload;
 assert.equal(stored.kcScheduleStudents,undefined);assert.equal(stored.kcScheduleEmployeeIds,undefined);
 assert.deepEqual(stored.students,original.students);assert.deepEqual(stored.records,original.records);
 await as('');await assert.rejects(context(),e=>e.code==='42501');
 for(const fn of ['school_kc_schedule_context(jsonb)','school_kc_lesson_allowed(jsonb,text,jsonb)'])
  assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') as allowed",['public.'+fn])).rows[0].allowed,false);
 console.log('PASS new kinds, legacy hashes, collective class/roster/hours, quarter and extra grades validation; KC roster: least-data context, all active pupils, atomic and legacy save/reload, journal 4 hours, no assignment changes, no foreign grades, no pedagogical escalation, admin scope, anonymous denial, idempotent migration');
 await db.close();
})().catch(e=>{console.error(e.message,e.code,e.where);process.exit(1)});
