(function(root) {
  'use strict';
  const quarter = date => { const m=Number(date.slice(5,7)); return m>=9&&m<=10?1:m>=11?2:m<=3?3:4; };
  const year = date => Number(date.slice(0,4))-(Number(date.slice(5,7))<9?1:0);
  const key = (r,pupil) => JSON.stringify([r.employeeId,pupil,r.type,r.instrument||'',r.program||'',r.className||'',r.termYears||'']);
  function anchor(records, reference, pupil, period) {
    const candidates=records.filter(r=>!r.isSubstitution && r.date && year(r.date)===year(reference.date) && quarter(r.date)===period
      && key(r,pupil)===key(reference,pupil) && (r.studentId===pupil || r.participantIds?.includes(pupil)));
    return candidates.sort((a,b)=>Number(!!b.quarterGrades?.[pupil])-Number(!!a.quarterGrades?.[pupil]) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id))[0];
  }
  const api={quarter,year,key,anchor};
  if(typeof module!=='undefined'&&module.exports) module.exports=api; else root.AssessmentModel=api;
})(globalThis);
