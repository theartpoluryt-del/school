/* Passwords go directly to Auth, never to school_state or browser storage. */
(() => {
  let busy = false;
  const offered = new Set();
  const el = id => document.getElementById(id);

  function message(error) {
    if (error?.code === 'same_password') return 'Новый пароль должен отличаться от прежнего.';
    if (error?.code === 'weak_password') return 'Пароль слишком простой. Используйте не менее 12 символов, буквы, цифры и знаки.';
    if (['reauthentication_needed', 'reauthentication_not_valid', 'session_not_found', 'refresh_token_not_found'].includes(error?.code)) {
      return 'Нужно заново войти в аккаунт. Сначала сохраните изменения в журнале, затем выйдите и войдите снова.';
    }
    return 'Не удалось подтвердить смену пароля. При обрыве связи он мог уже измениться. Не закрывайте это окно: сохраните новый пароль и попробуйте его при следующем входе. Если войти не получится, обратитесь к администратору.';
  }

  function open(employeeId = '') {
    if (busy || !currentProfile) return;
    const employee = employeeId ? state.employees.find(e => e.id === employeeId) : null;
    if (employeeId && (!isAdmin() || !employee?.username)) return;
    const reset = Boolean(employee);
    const profileId = currentProfile.id;
    const username = reset ? employee.username : currentProfile.username;
    openModal(reset ? 'Сбросить пароль сотрудника' : 'Сменить пароль', `<form id="accountPasswordForm" class="modal-form">
      <p>${reset ? `Новый пароль для ${escapeHtml(employee.name)}. Прежний перестанет работать. Передайте новый пароль сотруднику лично.` : 'Пароль можно менять в любой момент. После смены используйте новый пароль для входа.'}</p>
      <label>Логин<input autocomplete="username" name="username" readonly value="${escapeAttr(username)}" /></label>
      <label>Новый пароль<input type="password" name="newPassword" autocomplete="new-password" minlength="12" required /></label>
      <label>Повторите пароль<input type="password" name="confirmation" autocomplete="new-password" minlength="12" required /></label>
      <p class="muted-note">Не менее 12 символов. Рекомендуем сочетать буквы, цифры и знаки.</p>
      <div class="form-actions"><button type="button" class="ghost-button" id="accountPasswordReveal" aria-pressed="false">Показать пароль</button>
      ${reset ? '<button type="button" class="ghost-button" id="accountPasswordGenerate">Сгенерировать</button>' : ''}</div>
      <p id="accountPasswordStatus" class="form-status" role="status" aria-live="polite"></p>
      <div class="form-actions"><button type="submit" class="primary-button">${reset ? 'Сбросить пароль' : 'Сохранить пароль'}</button><button type="button" class="ghost-button" id="accountPasswordCancel">Отмена</button></div>
    </form>`);
    const form = el('accountPasswordForm');
    el('accountPasswordCancel').onclick = closeModal;
    el('accountPasswordReveal').onclick = () => {
      const visible = form.elements.newPassword.type === 'password';
      for (const name of ['newPassword', 'confirmation']) form.elements[name].type = visible ? 'text' : 'password';
      el('accountPasswordReveal').textContent = visible ? 'Скрыть пароль' : 'Показать пароль';
      el('accountPasswordReveal').setAttribute('aria-pressed', String(visible));
    };
    if (reset) el('accountPasswordGenerate').onclick = () => {
      form.elements.newPassword.value = form.elements.confirmation.value = createTemporaryPassword();
      el('accountPasswordStatus').textContent = 'Пароль сгенерирован. Нажмите «Сбросить пароль», чтобы применить его.';
    };
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy || currentProfile?.id !== profileId || (reset && !isAdmin())) return;
      const password = form.elements.newPassword.value;
      const status = el('accountPasswordStatus');
      if (password.length < 12) { status.textContent = 'Нужно не менее 12 символов.'; return; }
      if (password !== form.elements.confirmation.value) { status.textContent = 'Пароли не совпадают.'; return; }
      busy = true;
      form.querySelectorAll('button,input').forEach(n => n.disabled = true);
      status.textContent = 'Меняем пароль на сервере…';
      try {
        if (reset) await invokeCredentialUpdate(username, username, password);
        else {
          const { data, error } = await cloudRequest(supabaseClient.auth.updateUser({ password }));
          if (error) throw error;
          if (data?.user?.id !== profileId) throw new Error('Password update was not confirmed');
        }
        busy = false;
        form.reset();
        closeModal();
        if (reset) openCredentialResult(employee.name, username, password);
        else openModal('Пароль изменён', '<p>Новый пароль сохранён на сервере. Используйте его при следующем входе.</p><button type="button" class="primary-button" id="accountPasswordDone">Готово</button>');
        if (!reset) el('accountPasswordDone').onclick = closeModal;
      } catch (error) {
        status.textContent = message(error);
      } finally {
        busy = false;
        form.querySelectorAll('button,input').forEach(n => n.disabled = false);
      }
    };
  }

  async function offer() {
    const id = currentProfile?.id;
    if (!id || offered.has(id)) return;
    offered.add(id);
    try {
      const { data, error } = await cloudRequest(supabaseClient.rpc('claim_password_change_prompt'));
      if (error) { offered.delete(id); return; }
      if (!data || currentProfile?.id !== id) return;
      // A banner cannot replace an editor with unsaved work opened during the request.
      el('passwordSuggestion').classList.remove('is-hidden');
      el('passwordSuggestionChange').onclick = () => { el('passwordSuggestion').classList.add('is-hidden'); open(); };
      el('passwordSuggestionSkip').onclick = () => el('passwordSuggestion').classList.add('is-hidden');
    } catch { offered.delete(id); } // The optional prompt never blocks sign-in.
  }

  function render() {
    if (el('accountUsername')) el('accountUsername').textContent = currentProfile?.username || '';
    if (!currentProfile) el('passwordSuggestion')?.classList.add('is-hidden');
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-password-action]');
    if (button) open(button.dataset.passwordEmployee || '');
  });
  window.SchoolPasswords = { open, offer, render, isBusy: () => busy };
})();
