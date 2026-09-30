(function(root) {
  'use strict';
  function validHours(value) {
    const n=Number(String(value).replace(',','.'));
    return Number.isFinite(n) && n>=0.5 && n<=24 && Number.isInteger(n*2);
  }
  const total = lessons => lessons.filter(l=>!l.deleted).reduce((sum,l)=>sum+Number(l.hours),0);
  function rows(lessons) {
    const groups=new Map();
    for (const lesson of lessons.filter(l=>!l.deleted)) {
      const key=JSON.stringify([lesson.subject,lesson.students.map(s=>s.id).sort(),lesson.className||'',lesson.termYears||'']);
      if (!groups.has(key)) groups.set(key,{subject:lesson.subject,students:lesson.students,className:lesson.className,termYears:lesson.termYears,lessons:[]});
      groups.get(key).lessons.push(lesson);
    }
    return [...groups.values()].sort((a,b)=>a.students.map(s=>s.name).join().localeCompare(b.students.map(s=>s.name).join(),'ru'));
  }
  const api={validHours,total,rows};
  if(typeof module!=='undefined' && module.exports) module.exports=api; else root.AccompanistModel=api;
})(globalThis);
