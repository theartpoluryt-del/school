/* Independent, server-authorized KC records. Never merged into school_state. */
(() => {
  const el=id=>document.getElementById(id);
  let session='',staff=[],students=[],lessons=[],key='',serial=0,accessSerial=0,loadingAccess=false,loaded=false,busy=false;
  const context=()=>`${state.sessionEmployeeId}|${el('kcEmployee').value}|${el('kcMonth').value}`;
  const targetEmployee=()=>isAdmin()?el('kcEmployee').value:session;
  const status=(text,error=false)=>{
    el('kcStatus').textContent=text; el('kcStatus').classList.toggle('paid-error',error);
    if(el('kcFormStatus')) el('kcFormStatus').textContent=text;
  };
  function errorText(error) {
    if(['PT409','40001'].includes(error?.code)) return 'Это занятие изменили в другой вкладке. Закройте форму, нажмите «Обновить» и проверьте новую версию. Ваши поля пока остаются в форме.';
    if(error?.code==='42501') return 'Нет доступа к журналу этого концертмейстера.';
    if(['PGRST202','42P01'].includes(error?.code)) return 'Журнал КЦ ещё не подключён к серверу.';
    if(['22023','23514'].includes(error?.code)) return 'Проверьте дату, учеников, предмет и часы (от 0,5 до 24 с шагом 0,5).';
    return SchoolSync.errorMessage(error);
  }
  function controls() {
    el('kcView').querySelectorAll('button,input,select').forEach(n=>n.disabled=busy);
    el('kcAdd').disabled=busy||!loaded;
    el('kcPrint').disabled=busy||!loaded||!lessons.length;
  }
  function draw() {
    el('kcHeading').textContent=`Журнал концертмейстера · ${staff.find(s=>s.id===el('kcEmployee').value)?.name||''} · ${el('kcMonth').value}`;
    el('kcTotal').textContent=loaded?`Итого отработано: ${formatNumber(AccompanistModel.total(lessons))} ч. КЦ`:'';
    const dates=[...new Set(lessons.map(l=>l.lesson_date))].sort();
    if(!loaded||!lessons.length) {
      el('kcMatrix').innerHTML=loaded?'<p class="empty-state">В этом месяце ещё нет записей. Добавьте отработанное занятие.</p>':'';
      controls(); return;
    }
    el('kcMatrix').innerHTML=`<table class="paid-table kc-table"><thead><tr><th>Ученик / состав занятия</th><th>Предмет</th>${dates.map(d=>`<th>${escapeHtml(d.slice(8)+'.'+d.slice(5,7))}</th>`).join('')}<th>Итого КЦ</th></tr></thead><tbody>${AccompanistModel.rows(lessons).map(row=>`<tr>
      <th scope="row">${row.students.map(s=>escapeHtml(s.name)).join('<br>')}</th><td>${escapeHtml(row.subject)}</td>
      ${dates.map(d=>`<td>${row.lessons.filter(l=>l.lesson_date===d).map(l=>`<button class="kc-hours" data-kc-edit="${escapeAttr(l.id)}" aria-label="Изменить часы: ${escapeAttr(row.students.map(s=>s.name).join(', '))}, ${escapeAttr(formatDate(d))}">${formatNumber(l.hours)}</button>`).join(' ')||'—'}</td>`).join('')}
      <td>${formatNumber(AccompanistModel.total(row.lessons))}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="2">Итого КЦ</th>${dates.map(d=>`<td>${formatNumber(AccompanistModel.total(lessons.filter(l=>l.lesson_date===d)))}</td>`).join('')}<td>${formatNumber(AccompanistModel.total(lessons))}</td></tr></tfoot></table>`;
    controls();
  }
  async function access() {
    if(loadingAccess||!session) return;
    loadingAccess=true; const request=++accessSerial,who=session;
    try {
      const {data,error}=await SchoolSync.request(supabaseClient.rpc('get_accompanist_access'));
      if(request!==accessSerial||who!==session) return;
      if(error) throw error;
      staff=Array.isArray(data)?data.filter(s=>isAdmin()||s.id===session):[];
      el('kcTab').classList.toggle('is-hidden',!staff.length);
      el('kcEmployee').closest('label').classList.toggle('is-hidden',!isAdmin()||staff.length<2);
      el('kcEmployee').innerHTML=staff.map(s=>`<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join('');
      if(staff.some(s=>s.id===state.activeEmployeeId)) el('kcEmployee').value=state.activeEmployeeId;
      if(el('kcView').classList.contains('active')) {
        if(staff.length) await load(true); else {loaded=false;students=[];lessons=[];draw();switchTab('dashboard');}
      }
    } catch(error) {
      if(request!==accessSerial) return;
      // A failed access check must never reveal a restricted section.
      staff=[];students=[];lessons=[];loaded=false;key='';
      el('kcEmployee').innerHTML='';el('kcTab').classList.add('is-hidden');draw();
      status(errorText(error),true);
      if(el('kcView').classList.contains('active')) switchTab('dashboard');
    } finally {if(request===accessSerial) loadingAccess=false;}
  }
  async function load(force=false) {
    if(busy) return;
    if(!staff.length) {void access();return;}
    const next=context(); if(!force&&next===key) return;
    key=next;const request=++serial;loaded=false;students=[];lessons=[];draw();busy=true;controls();status('Загрузка журнала КЦ…');
    try {
      if(!/^\d{4}-\d{2}$/.test(el('kcMonth').value)) throw new Error('Выберите месяц.');
      const {data,error}=await SchoolSync.request(supabaseClient.rpc('get_accompanist_journal',{target_employee:targetEmployee(),month_start:el('kcMonth').value+'-01'}));
      if(request!==serial||next!==context()) return;
      if(error) throw error;
      students=data.students;lessons=data.lessons;loaded=true;status('');
    } catch(error) {if(request===serial) {key='';status(errorText(error),true);}}
    finally {if(request===serial) {busy=false;draw();}}
  }
  function classLabel(student) {
    return [...new Set((student.courses||[]).map(c=>{
      const cls=String(c.className||'').match(/\d+/)?.[0];return cls?`${cls}${c.termYears?'/'+c.termYears:''}`:'';
    }).filter(Boolean))].join(', ')||student.className||'';
  }
  function dialog(id) {
    if(busy||!loaded) return;
    const existing=lessons.find(l=>l.id===id),initial=context(),employee=targetEmployee();
    const lessonId=existing?.id||crypto.randomUUID(),selected=new Set(existing?.students.map(s=>s.id)||[]);
    const roster=[...new Map([...students,...(existing?.students||[]).filter(s=>!students.some(p=>p.id===s.id))].map(s=>[s.id,s])).values()];
    const month=el('kcMonth').value;
    openModal(existing?'Часы концертмейстера':'Добавить отработанное занятие',`<form id="kcLessonForm" class="modal-form">
      <div class="form-grid"><label>Дата<input name="date" type="date" required value="${escapeAttr(existing?.lesson_date||(todayISO().startsWith(month)?todayISO():month+'-01'))}" /></label>
      <label>Часы КЦ<input name="hours" type="number" required min="0.5" max="24" step="0.5" value="${existing?.hours||''}" placeholder="Например, 1,5" /></label></div>
      <label>Предмет<input name="subject" required maxlength="120" list="kcSubjects" value="${escapeAttr(existing?.subject||'')}" placeholder="Например, Хор" /></label>
      <datalist id="kcSubjects">${lessonTypes.map(s=>`<option value="${escapeAttr(s)}"></option>`).join('')}</datalist>
      <p>Выберите ученика или состав совместного занятия. Часы всего занятия учитываются один раз.</p>
      <label>Поиск среди всех учеников<input id="kcStudentSearch" type="search" placeholder="Фамилия, класс или инструмент" /></label>
      <p id="kcSelectedCount"></p><div id="kcSelected"></div><div id="kcStudentOptions" class="kc-student-options"></div>
      <p id="kcFormStatus" role="status"></p><div class="form-actions"><button class="primary-button" type="submit">Сохранить</button>${existing?'<button id="kcRemove" class="danger-button" type="button">Удалить занятие</button>':''}</div></form>`);
    const form=el('kcLessonForm');
    function picker() {
      const query=el('kcStudentSearch').value.trim().toLocaleLowerCase('ru').replaceAll('ё','е');
      const matching=roster.filter(s=>[s.name,classLabel(s),...(s.courses||[]).map(c=>c.instrument||c.program)].join(' ').toLocaleLowerCase('ru').replaceAll('ё','е').includes(query));
      el('kcSelectedCount').textContent=`Выбрано: ${selected.size}. Найдено: ${matching.length}${matching.length>60?' (показаны первые 60 — уточните поиск)':''}`;
      el('kcSelected').innerHTML=roster.filter(s=>selected.has(s.id)).map(s=>`<button type="button" class="ghost-button" data-kc-remove="${escapeAttr(s.id)}">${escapeHtml(s.name)} ×</button>`).join(' ');
      el('kcStudentOptions').innerHTML=matching.slice(0,60).map(s=>`<label class="paid-staff-option"><input type="checkbox" value="${escapeAttr(s.id)}" ${selected.has(s.id)?'checked':''} />${escapeHtml(s.name)} <small>${escapeHtml(classLabel(s))}</small></label>`).join('');
    }
    el('kcStudentSearch').addEventListener('input',picker);
    el('kcStudentOptions').addEventListener('change',event=>{const t=event.target;if(t.type==='checkbox') {t.checked?selected.add(t.value):selected.delete(t.value);picker();}});
    el('kcSelected').addEventListener('click',event=>{const b=event.target.closest('[data-kc-remove]');if(b){selected.delete(b.dataset.kcRemove);picker();}});
    picker();
    async function save(removing=false) {
      if(busy||initial!==context()) return;
      const fields=new FormData(form);
      if(!selected.size) {el('kcFormStatus').textContent='Выберите хотя бы одного ученика.';return;}
      if(!AccompanistModel.validHours(fields.get('hours'))) {el('kcFormStatus').textContent='Часы — от 0,5 до 24 с шагом 0,5.';return;}
      const value={id:lessonId,employee_id:employee,student_ids:[...selected],lesson_date:fields.get('date'),subject:fields.get('subject'),hours:Number(fields.get('hours')),deleted:removing};
      busy=true;controls();form.querySelectorAll('input,button').forEach(n=>n.disabled=true);status('Сохранение…');
      const request=serial;
      try {
        const {data,error}=await SchoolSync.request(supabaseClient.rpc('save_accompanist_lesson',{lesson:value,expected_updated_at:existing?.updated_at||null}));
        if(request!==serial||initial!==context()) return;
        if(error) throw error;
        lessons=lessons.filter(l=>l.id!==data.id);
        if(!data.deleted&&data.lesson_date.startsWith(month)) lessons.push(data);
        busy=false;closeModal();status('Сохранено');draw();
      } catch(error) {if(request===serial) status(errorText(error)+' Изменения не подтверждены; можно повторить сохранение.',true);}
      finally {if(request===serial) {busy=false;controls();form.querySelectorAll('input,button').forEach(n=>n.disabled=false);}}
    }
    form.addEventListener('submit',event=>{event.preventDefault();void save();});
    el('kcRemove')?.addEventListener('click',()=>{if(confirm('Убрать занятие и его часы из журнала КЦ?')) void save(true);});
  }
  function sync() {
    const who=state.sessionEmployeeId||'';
    if(who!==session) {
      session=who;serial++;accessSerial++;key='';staff=[];students=[];lessons=[];loaded=false;busy=false;loadingAccess=false;
      el('kcTab').classList.add('is-hidden');el('kcEmployee').innerHTML='';status('');draw();
      if(who) void access();
    } else if(who&&el('kcView').classList.contains('active')) void load();
  }
  el('kcMonth').value=todayISO().slice(0,7);
  el('kcMonth').addEventListener('change',()=>load(true));
  el('kcEmployee').addEventListener('change',()=>load(true));
  el('kcReload').addEventListener('click',()=>staff.length?load(true):access());
  window.addEventListener('online',()=>{if(session&&!staff.length) void access();});
  el('kcAdd').addEventListener('click',()=>dialog());
  el('kcMatrix').addEventListener('click',event=>{const b=event.target.closest('[data-kc-edit]');if(b) dialog(b.dataset.kcEdit);});
  el('kcPrint').addEventListener('click',()=>{if(!busy&&loaded) {delete document.body.dataset.journalPrint;window.print();}});
  window.AccompanistJournal={sync,isBusy:()=>busy};sync();
})();
