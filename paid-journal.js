/* Paid data is fetched and saved independently; never put it in school_state. */
(() => {
  const el = id => document.getElementById(id);
  let courses = [], lessons = [], key = '', serial = 0, busy = false, loaded = false;
  const course = () => courses.find(c => c.id === el('paidCourse').value);
  const selectedLessons = () => lessons.filter(l => l.course_id === course()?.id && !l.deleted)
    .sort((a,b) => a.lesson_date.localeCompare(b.lesson_date));
  const contextKey = () => `${state.sessionEmployeeId}|${state.activeEmployeeId}|${el('paidMonth').value}`;
  const status = (message, error = false) => {
    el('paidStatus').textContent = message;
    el('paidStatus').classList.toggle('paid-error', error);
    if (el('paidModalStatus')) el('paidModalStatus').textContent = message;
  };
  function message(error) {
    if (error?.code === 'PT409' || error?.code === '40001') return 'Данные изменены в другой вкладке. Нажмите «Обновить» и повторите правку.';
    if (error?.code === '23505') return 'На эту дату занятие уже есть. Откройте его дату, чтобы изменить часы.';
    if (error?.code === '42501') return 'Нет доступа к этому занятию. Обновите страницу или обратитесь к администратору.';
    if (error?.code === 'PGRST202' || error?.code === '42P01') return 'Платный журнал ещё не подключён к базе. Обратитесь к администратору.';
    return 'Не удалось сохранить или загрузить данные. Проверьте соединение и повторите попытку.';
  }
  function setBusy(value) {
    busy = value;
    el('paidView').querySelectorAll('button, input, select').forEach(n => n.disabled = value);
    if (!value) {
      el('paidAddLesson').disabled = !loaded || !course() || course().archived || course().starts_on.slice(0,7)>el('paidMonth').value;
      el('paidEditCourse').disabled = !loaded || !course();
      el('paidAddCourse').disabled = !loaded;
      el('paidPrint').disabled = !loaded;
    }
  }
  function draw() {
    const chosen = course();
    const rows = selectedLessons();
    el('paidEditCourse').classList.toggle('is-hidden', !isAdmin());
    el('paidAddCourse').classList.toggle('is-hidden', !isAdmin());
    el('paidHeading').textContent = `${state.employees.find(e=>e.id===state.activeEmployeeId)?.name || ''} · ${el('paidMonth').value}${chosen ? ' · '+chosen.name : ''}`;
    el('paidTotal').textContent = loaded ? `Отработано за месяц: ${formatNumber(PaidModel.workedHours(lessons))} ч.${chosen ? ' · выбранные занятия: '+formatNumber(PaidModel.workedHours(rows))+' ч.' : ''}` : '';
    if (!chosen) {
      el('paidMatrix').innerHTML = loaded ? '<p class="empty-state">У выбранного сотрудника пока нет платных занятий.</p>' : '';
      setBusy(busy); return;
    }
    if (!rows.length) {
      el('paidMatrix').innerHTML = '<p class="empty-state">В этом месяце занятия ещё не добавлены. Нажмите «Добавить занятие» и укажите дату.</p>';
      setBusy(busy); return;
    }
    const people = PaidModel.roster(chosen, rows);
    el('paidMatrix').innerHTML = `<table class="paid-table"><thead><tr><th scope="col">Ученик</th>${rows.map(l=>`<th scope="col"><button class="paid-date" data-edit="${escapeAttr(l.id)}" title="Изменить дату или часы">${escapeHtml(l.lesson_date.slice(8))}.${escapeHtml(l.lesson_date.slice(5,7))}</button></th>`).join('')}</tr></thead>
      <tbody>${people.map(p=>`<tr><th scope="row">${escapeHtml(p.name)}</th>${rows.map(l=>{
        if (!l.students.some(s=>s.id===p.id)) return '<td>—</td>';
        const label = `${p.name}, ${formatDate(l.lesson_date)}`;
        const present = l.present_student_ids.includes(p.id);
        return `<td><div class="paid-cell"><input type="checkbox" data-attendance="${escapeAttr(l.id)}" data-pupil="${escapeAttr(p.id)}" aria-label="Посещение: ${escapeAttr(label)}" ${present?'checked':''} ${l.lesson_date>todayISO()?'disabled':''} />
          <select class="paid-grade" data-grade="${escapeAttr(l.id)}" data-pupil="${escapeAttr(p.id)}" aria-label="Оценка: ${escapeAttr(label)}"><option value="">·</option>${PaidModel.grades.map(g=>`<option value="${g}" ${l.grades[p.id]===g?'selected':''}>${g}</option>`).join('')}</select>
          <span class="paid-print-value">${present?'✓':'—'}${l.grades[p.id]?' / '+escapeHtml(l.grades[p.id]):''}</span></div></td>`;
      }).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr><th scope="row">Проведено</th>${rows.map(l=>`<td><input type="checkbox" data-completed="${escapeAttr(l.id)}" aria-label="Проведено ${escapeAttr(formatDate(l.lesson_date))}" ${l.completed?'checked':''} /><span class="paid-print-value">${l.completed?'✓':'—'}</span></td>`).join('')}</tr>
      <tr><th scope="row">Часы</th>${rows.map(l=>`<td>${formatNumber(l.hours)}</td>`).join('')}</tr></tfoot></table>`;
    setBusy(busy);
    // Future attendance/completion cannot be recorded ahead of the actual lesson.
    rows.filter(l=>l.lesson_date>todayISO()).forEach(l=>el('paidMatrix').querySelectorAll(`[data-attendance="${CSS.escape(l.id)}"], [data-completed="${CSS.escape(l.id)}"], [data-grade="${CSS.escape(l.id)}"]`).forEach(n=>n.disabled=true));
  }
  async function load(force = false) {
    const next = contextKey();
    if (!force && next === key) return;
    const selected = el('paidCourse').value;
    key = next; const request = ++serial; loaded = false;
    courses = []; lessons = []; el('paidCourse').innerHTML = ''; draw(); setBusy(true);
    status('Загрузка платного журнала…');
    try {
      if (!/^\d{4}-\d{2}$/.test(el('paidMonth').value)) throw new Error('month');
      if (!supabaseClient) throw new Error('connection');
      const {data,error} = await supabaseClient.rpc('get_paid_journal', {target_employee:state.activeEmployeeId, month_start:el('paidMonth').value+'-01'});
      if (request !== serial || contextKey() !== next) return;
      if (error) throw error;
      courses = data.courses; lessons = data.lessons; loaded = true;
      el('paidCourse').innerHTML = courses.map(c=>`<option value="${escapeAttr(c.id)}">${escapeHtml(c.name)}${c.age_label?' · '+escapeHtml(c.age_label):''}${c.archived?' (архив)':''}</option>`).join('');
      if (courses.some(c=>c.id===selected)) el('paidCourse').value=selected;
      status('');
    } catch(error) {
      if (request !== serial) return;
      key = ''; status(message(error),true);
    } finally {
      if (request === serial) {busy=false; draw();}
    }
  }
  function sync() {
    if (!currentUser()) {
      ++serial; key=''; courses=[]; lessons=[]; loaded=false; busy=false;
      el('paidCourse').innerHTML=''; el('paidMatrix').innerHTML=''; el('paidHeading').textContent=''; el('paidTotal').textContent=''; status('');
      return;
    }
    if (el('paidView').classList.contains('active')) void load();
  }
  async function saveLesson(value, afterSave) {
    if (busy || !loaded) return;
    const requestKey = contextKey(); const request = serial;
    setBusy(true); status('Сохранение…');
    try {
      const {data,error} = await supabaseClient.rpc('save_paid_lesson',{lesson:value,expected_updated_at:value.updated_at || null});
      if (error) throw error;
      if (request !== serial || requestKey !== contextKey()) return;
      lessons=lessons.filter(l=>l.id!==data.id);
      if (!data.deleted && data.lesson_date.startsWith(el('paidMonth').value)) lessons.push(data);
      status('Сохранено'); afterSave?.();
    } catch(error) {
      if (request === serial && requestKey === contextKey()) status(message(error),true);
    } finally {
      if (request === serial && requestKey === contextKey()) {busy=false; draw();}
    }
  }
  function lessonDialog(id) {
    if (busy || !course()) return;
    const existing = lessons.find(l=>l.id===id);
    const month = el('paidMonth').value;
    const defaultDate = [month+'-01',course().starts_on].sort().at(-1);
    openModal(existing?'Занятие платных услуг':'Добавить платное занятие', `<form id="paidLessonForm">
      <p>${escapeHtml(course().name)}</p>
      <div class="form-grid"><label>Дата<input name="date" type="date" required min="${escapeAttr(defaultDate)}" max="${month}-${new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate()}" value="${escapeAttr(existing?.lesson_date || defaultDate)}" /></label>
      <label>Часы (40 минут)<input name="hours" type="number" min="0.25" max="24" step="0.25" required value="${existing?.hours || course().weekly_hours || 1}" /></label></div>
      <p>Если в этот день несколько занятий, укажите суммарные часы. Посещаемость отмечается отдельно в журнале.</p>
      <p id="paidModalStatus" role="status"></p><div class="form-actions"><button class="primary-button" type="submit">Сохранить</button>${existing?'<button class="danger-button" type="button" id="paidRemoveLesson">Удалить занятие</button>':''}</div></form>`);
    const form = el('paidLessonForm');
    const employee = state.activeEmployeeId; const selected = course(); const initialKey=contextKey();
    form.addEventListener('submit',async event=>{
      event.preventDefault(); if (initialKey!==contextKey()) return closeModal();
      const fields = new FormData(form); if (!PaidModel.validHours(fields.get('hours'))) return;
      form.querySelectorAll('button').forEach(b=>b.disabled=true);
      await saveLesson({...existing || PaidModel.newLesson(selected,employee,fields.get('date'),fields.get('hours')),
        lesson_date:fields.get('date'),hours:Number(fields.get('hours'))},closeModal);
      form.querySelectorAll('button').forEach(b=>b.disabled=false);
    });
    el('paidRemoveLesson')?.addEventListener('click',async()=>{
      if (!confirm('Убрать это занятие из журнала и итогов часов?')) return;
      form.querySelectorAll('button').forEach(b=>b.disabled=true);
      await saveLesson({...existing,deleted:true},closeModal);
      form.querySelectorAll('button').forEach(b=>b.disabled=false);
    });
  }
  function courseDialog(add) {
    if (!isAdmin() || busy) return;
    const old = add ? null : course(); const initialKey=contextKey();
    const options = ids => state.employees.map(e=>`<label class="paid-staff-option"><input type="checkbox" value="${escapeAttr(e.id)}" ${ids.includes(e.id)?'checked':''} />${escapeHtml(e.name)}</label>`).join('');
    openModal(add?'Новая платная группа / ученик':'Состав и настройки', `<form id="paidCourseForm">
      <label>Название<input name="name" required maxlength="200" value="${escapeAttr(old?.name||'')}" placeholder="Например: Сольное пение — Иванова Анна" /></label>
      <div class="form-grid"><label>Предмет<input name="subject" required maxlength="120" value="${escapeAttr(old?.subject||'')}" /></label>
      <label>Возраст / группа<input name="age_label" value="${escapeAttr(old?.age_label||'')}" placeholder="Например: 5 лет" /></label>
      <label>Начало обучения<input name="starts_on" required type="date" value="${escapeAttr(old?.starts_on||el('paidMonth').value+'-01')}" /></label>
      <label>Часов в неделю<input name="weekly_hours" type="number" min="0.25" max="40" step="0.25" value="${old?.weekly_hours||''}" /></label></div>
      <label>Ученики (каждый с новой строки)<textarea name="students" required rows="7">${escapeHtml((old?.students||[]).map(s=>s.name).join('\n'))}</textarea></label>
      <p>Новый состав применяется к новым занятиям. В уже заполненных занятиях состав сохраняется.</p>
      <details><summary>Преподаватели и концертмейстеры</summary><fieldset id="paidTeachers"><legend>Преподаватели</legend>${options(old?.teacher_ids||[state.activeEmployeeId])}</fieldset>
      <fieldset id="paidAccompanists"><legend>Концертмейстеры</legend>${options(old?.accompanist_ids||[])}</fieldset></details>
      <label class="paid-staff-option"><input name="archived" type="checkbox" ${old?.archived?'checked':''} />Архив (без новых занятий)</label>
      <p id="paidFormError" role="alert"></p><button class="primary-button" type="submit">Сохранить</button></form>`);
    const form=el('paidCourseForm');
    form.addEventListener('submit',async event=>{
      event.preventDefault(); if (initialKey!==contextKey()) return closeModal();
      const f=new FormData(form);
      const names=String(f.get('students')).split('\n').map(n=>n.trim()).filter(Boolean);
      if (new Set(names.map(n=>n.toLocaleLowerCase('ru'))).size!==names.length) {el('paidFormError').textContent='В списке повторяются имена.';return;}
      const ids=id=>[...el(id).querySelectorAll('input:checked')].map(n=>n.value);
      const value={...old,name:f.get('name'),subject:f.get('subject'),age_label:f.get('age_label'),starts_on:f.get('starts_on'),weekly_hours:f.get('weekly_hours')||null,
        teacher_ids:ids('paidTeachers'),accompanist_ids:ids('paidAccompanists'),archived:f.has('archived'),
        students:names.map(name=>old?.students.find(s=>s.name===name)||{id:crypto.randomUUID(),name})};
      if (!value.teacher_ids.length&&!value.accompanist_ids.length) {el('paidFormError').textContent='Выберите хотя бы одного сотрудника.';return;}
      form.querySelector('button[type=submit]').disabled=true;
      try {
        const {error}=await supabaseClient.rpc('save_paid_course',{course:value,expected_updated_at:old?.updated_at||null});
        if (error) throw error;
        closeModal(); await load(true);
      } catch(error) {el('paidFormError').textContent=message(error);form.querySelector('button[type=submit]').disabled=false;}
    });
  }
  el('paidMonth').value = todayISO().slice(0,7);
  el('paidMonth').addEventListener('change',()=>load(true));
  el('paidCourse').addEventListener('change',draw);
  el('paidReload').addEventListener('click',()=>load(true));
  el('paidAddLesson').addEventListener('click',()=>lessonDialog());
  el('paidAddCourse').addEventListener('click',()=>courseDialog(true));
  el('paidEditCourse').addEventListener('click',()=>courseDialog(false));
  el('paidPrint').addEventListener('click',()=>window.print());
  el('paidMatrix').addEventListener('click',event=>{
    const button=event.target.closest('[data-edit]'); if (button) lessonDialog(button.dataset.edit);
  });
  el('paidMatrix').addEventListener('change',event=>{
    const target=event.target, id=target.dataset.attendance||target.dataset.completed||target.dataset.grade;
    const old=lessons.find(l=>l.id===id); if (!old||busy) return;
    const value=structuredClone(old), pupil=target.dataset.pupil;
    if (target.dataset.attendance) value.present_student_ids=target.checked ? [...new Set([...value.present_student_ids,pupil])] : value.present_student_ids.filter(p=>p!==pupil);
    if (target.dataset.completed) value.completed=target.checked;
    if (target.dataset.grade) {if(target.value) value.grades[pupil]=target.value;else delete value.grades[pupil];}
    void saveLesson(value);
  });
  window.PaidJournal={sync}; sync();
})();
