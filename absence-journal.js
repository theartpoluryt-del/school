(function(root) {
  'use strict';
  let busy=false;
  const rows=()=>state.absenceRows || [];
  const name=id=>(state.substituteTeachers||state.employees).find(e=>e.id===id)?.name || 'Преподаватель';
  function projected(employeeId,records) {
    const active=rows().filter(a=>!a.cancelled);
    return records.map(r=>{
      const a=active.find(a=>a.source_employee===employeeId && r.date>=a.starts_on && r.date<=a.ends_on);
      return a ? {...r,status:'absent',absenceId:a.id,absenceLabel:a.substitute_employee?'Замещение':'Отсутствие',pedHours:0,kcHours:0,academicHours:0} : r;
    }).concat(active.filter(a=>a.substitute_employee===employeeId).flatMap(a=>a.lessons.map(r=>({...r,absenceId:a.id,sourceEmployeeName:name(a.source_employee)}))));
  }
  function find(id) {
    for(const a of rows().filter(a=>!a.cancelled)) {
      const r=a.lessons.find(r=>r.id===id);
      if(r && a.substitute_employee===state.activeEmployeeId) return {...r,absenceId:a.id};
    }
    return null;
  }
  async function action(kind,args) {
    if(busy || !(await ensureCloudSaved()) || busy) return false;
    busy=true;
    document.body.classList.add('absence-saving');
    setSyncStatus('Сохраняем замещение…','pending');
    try {
      const {data,error}=await supabaseClient.rpc('school_absence_action',{action:kind,args:{...args,expectedVersion:cloudStateVersion}});
      if(error) throw new Error(error.message);
      const session=state.sessionEmployeeId,active=state.activeEmployeeId;
      const remote=migrateState(data.payload);
      state=SchoolSync.payload(cloudBaseline,state,remote);
      state.sessionEmployeeId=session;state.activeEmployeeId=active;
      cloudStateVersion=data.updated_at;cloudBaseline=structuredClone(remote);
      setSyncStatus('Замещение сохранено','saved');closeModal();render();return true;
    } catch(error) {
      const labels={
        'Absence overlaps an existing period':'Этот период пересекается с уже оформленным отсутствием.',
        'Substitute is absent during this period':'Выбранный преподаватель сам отсутствует в этот период.',
        'Substitute timetable overlaps lessons':'В расписании заменяющего преподавателя есть пересечение по времени.',
        'No scheduled lessons in this period':'В этом периоде нет занятий по расписанию.',
        'Reload before creating absence':'Данные изменились. Обновите страницу и повторите оформление.',
        'Reassign your existing substitutions first':'На этот период у вас есть замещения. Сначала переоформите их.'
        ,'Choose lesson pupils before absence':'Сначала укажите состав учеников у всех занятий за период.'
        ,'Set valid lesson times before absence':'Сначала укажите корректное время всех занятий за период.'
        ,'Resolve ambiguous course before absence':'Сначала выберите предмет и инструмент у занятий с неоднозначной привязкой.'
      };
      setSyncStatus('Замещение не сохранено','error');
      alert(labels[error.message] || 'Не удалось сохранить: '+error.message);return false;
    } finally {busy=false;document.body.classList.remove('absence-saving');if(cloudDirty)void flushCloudSave();}
  }
  function open() {
    if(!state.absencesEnabled) return;
    const employeeId=isAdmin()?state.activeEmployeeId:state.sessionEmployeeId;
    openModal('Отсутствие и замещение',`<form class="modal-form" data-absence-form="create">
      <p>${escapeHtml(name(employeeId))}</p><input type="hidden" name="employeeId" value="${escapeAttr(employeeId)}" />
      <div class="form-grid two"><label>С даты<input type="date" name="from" required value="${todayISO()}" /></label><label>По дату включительно<input type="date" name="to" required value="${todayISO()}" /></label></div>
      <label>Причина<select name="reason"><option>Больничный</option><option>Отсутствие</option></select></label>
      <label>Кто заменяет<select name="substituteId"><option value="">Без замещения — занятия не проводятся</option>${(state.substituteTeachers||[]).filter(e=>e.id!==employeeId).map(e=>`<option value="${escapeAttr(e.id)}">${escapeHtml(e.name)}</option>`).join('')}</select></label>
      <p class="muted-note">Применяется ко всем вашим занятиям основного журнала за период. Ваши часы исключаются из расчёта. При замещении часы и состав занятий попадут в журнал выбранного преподавателя; старые оценки ему не копируются. Платные занятия оформляются отдельно.</p>
      <p class="muted-note">Состав и часы замещения фиксируются по расписанию на момент оформления. После изменения расписания замещение нужно переоформить.</p>
      <button class="primary-button" type="submit">Оформить</button><p role="status" data-absence-status></p></form>`);
  }
  function renderPanel() {
    const panel=document.querySelector('#absencePanel');if(!panel)return;
    if(!state.absencesEnabled){panel.innerHTML='';return;}
    const id=state.activeEmployeeId,month=document.querySelector('#journalMonth').value;
    const relevant=rows().filter(a=>!a.cancelled && (a.source_employee===id||a.substitute_employee===id) && a.starts_on<=month+'-31' && a.ends_on>=month+'-01');
    const replacements=relevant.filter(a=>a.substitute_employee===id).flatMap(a=>a.lessons.filter(r=>r.date.startsWith(month)).map(r=>({...r,sourceName:name(a.source_employee)})));
    panel.innerHTML=`<div class="panel-toolbar no-print"><button class="ghost-button" type="button" data-absence-action="open">Отсутствие / замещение</button>${replacements.length?'<button class="ghost-button" type="button" data-absence-action="print">Печать листа замещения</button>':''}</div>
      <div class="no-print">${relevant.map(a=>`<p>${escapeHtml(name(a.source_employee))}: ${formatDate(a.starts_on)}–${formatDate(a.ends_on)} · ${a.substitute_employee?'заменяет '+escapeHtml(name(a.substitute_employee)):'без замещения'} ${(isAdmin()||a.source_employee===state.sessionEmployeeId)?`<button class="mini-button" type="button" data-absence-action="cancel" data-absence-id="${a.id}">Отменить отсутствие</button>`:''}</p>`).join('')}</div>
      <section class="substitution-sheet"><h3>Лист замещения · ${escapeHtml(name(id))} · ${escapeHtml(month)}</h3><table class="journal-detail-table"><thead><tr><th>Дата</th><th>Время</th><th>За преподавателя</th><th>Группа / ученик</th><th>Предмет</th><th>Пед.</th><th>Кц</th></tr></thead><tbody>${replacements.sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||'')).map(r=>`<tr><td>${formatDate(r.date)}</td><td>${escapeHtml(r.time||'')}</td><td>${escapeHtml(r.sourceName)}</td><td>${escapeHtml(r.studentName)}</td><td>${escapeHtml(SchoolModel.subjectLabel(r))}</td><td>${formatNumber(r.pedHours)}</td><td>${formatNumber(r.kcHours)}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="5">Всего</th><th>${formatNumber(replacements.reduce((n,r)=>n+Number(r.pedHours||0),0))}</th><th>${formatNumber(replacements.reduce((n,r)=>n+Number(r.kcHours||0),0))}</th></tr></tfoot></table><p>Преподаватель ____________________</p></section>`;
  }
  async function grade(id,value,pupilId) {const r=find(id);if(r)await action('grade',{absenceId:r.absenceId,lessonId:id,pupilId:pupilId||r.studentId,grade:value});}
  function topic(id) {
    const r=find(id);if(!r)return;
    openModal('Занятие по замещению',`<form class="modal-form" data-absence-form="topic" data-record-id="${escapeAttr(id)}"><p>${formatDate(r.date)} · ${escapeHtml(r.studentName)} · ${formatNumber(r.pedHours)} Пед., ${formatNumber(r.kcHours)} Кц</p>${r.participantIds.length>=8?`<label>Тема урока<textarea name="topic" maxlength="2000">${escapeHtml(r.topic||'')}</textarea></label><button class="primary-button" type="submit">Сохранить</button>`:'<p>Для этого занятия тема не требуется. Часы заданы листом замещения.</p>'}</form>`);
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-absence-action]');if(!button)return;
    if(button.dataset.absenceAction==='open')open();
    if(button.dataset.absenceAction==='cancel' && confirm('Отменить весь период отсутствия? Часы вернутся исходному преподавателю, а часы замещения исключатся. История оценок замещения останется в базе.'))await action('cancel',{absenceId:button.dataset.absenceId});
    if(button.dataset.absenceAction==='print' && await ensureCloudSaved()) {document.body.classList.add('printing-substitutions');window.print();}
  });
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-absence-form]');if(!form)return;event.preventDefault();
    const button=form.querySelector('[type="submit"]');if(button)button.disabled=true;
    try {
      if(form.dataset.absenceForm==='create')await action('create',Object.fromEntries(new FormData(form)));
      else {const r=find(form.dataset.recordId);if(r)await action('topic',{absenceId:r.absenceId,lessonId:r.id,topic:form.elements.topic.value});}
    } finally {if(button)button.disabled=false;}
  });
  window.addEventListener('afterprint',()=>document.body.classList.remove('printing-substitutions'));
  const isAbsent=id=>projected(state.activeEmployeeId,state.records.filter(r=>r.id===id)).some(r=>r.id===id&&r.status==='absent');
  root.AbsenceJournal={projected,find,grade,topic,renderPanel,isAbsent,isBusy:()=>busy};
})(window);
