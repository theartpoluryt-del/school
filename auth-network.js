(function(root) {
  'use strict';
  function message(error) {
    if (error?.code === 'invalid_credentials') return 'Неверный логин или пароль.';
    if (error?.status === 429 || /rate_limit|too_many/i.test(error?.code || '')) return 'Слишком много попыток входа. Подождите несколько минут и повторите.';
    if (/refresh_token|session_not_found/.test(error?.code || '')) return 'Сессия входа истекла. Введите логин и пароль заново.';
    if (error?.code === 'CLIENT_TIMEOUT' || /lock|timeout|abort/i.test(error?.name + ' ' + error?.message)) return 'Проверка входа заняла слишком много времени. Повторите вход. Если снова зависнет, нажмите «Восстановить вход».';
    return 'Нет ответа от сервера входа. Проверьте соединение и повторите чуть позже. Это не означает, что пароль неверный.';
  }
  // Covers Auth fetches as well as PostgREST; respect caller cancellation.
  function boundedFetch(fetcher, timeoutMs = 15000) {
    return async (input, options = {}) => {
      const controller = new AbortController();
      const signal = options.signal || input?.signal;
      const cancel = () => controller.abort(signal?.reason);
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, {once: true});
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try { return await fetcher(input, {...options, signal: controller.signal}); }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    };
  }
  function clearSession(storage, projectUrl) {
    const key = `sb-${new URL(projectUrl).hostname.split('.')[0]}-auth-token`;
    for (const suffix of ['', '-code-verifier', '-user']) storage.removeItem(key + suffix);
  }
  const api = {message, boundedFetch, clearSession};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SchoolAuth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
