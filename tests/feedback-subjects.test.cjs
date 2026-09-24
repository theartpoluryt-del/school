const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('requested theory and group subjects can be selected without duplicates',()=>{
  const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
  const declaration=source.match(/const lessonTypes = .*;/)[0];
  const start=source.indexOf('function lessonTypeOptions(');
  const end=source.indexOf('\nfunction ',start+1);
  const ctx=vm.createContext({escapeAttr:String,escapeHtml:String});
  vm.runInContext(declaration+'\n'+source.slice(start,end),ctx);
  for(const name of ['Сольфеджио','Музыкальная литература','Элементарная теория музыки','Слушание музыки','Коллективное музицирование']) {
    const options=ctx.lessonTypeOptions(name);
    assert.ok(options.includes(`value="${name}" selected`));
    assert.equal(options.split(`value="${name}"`).length-1,1);
  }
});
test('paid future marks are allowed in UI and server; access guards remain',()=>{
  const ui=fs.readFileSync(require.resolve('../paid-journal.js'),'utf8');
  assert.doesNotMatch(ui,/lesson_date\s*>\s*todayISO/);
  for(const file of ['paid_journal.sql','paid_future_marks.sql']) {
    const sql=fs.readFileSync(require.resolve('../supabase/'+file),'utf8');
    assert.doesNotMatch(sql,/A future lesson cannot/);
    for(const guard of ['Authentication required','Employee access denied','Invalid attendance roster','Lesson changed in another session']) assert.ok(sql.includes(guard));
  }
});
