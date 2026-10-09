(function(root) {
  'use strict';
  function message(error) {
    if (error?.code === 'invalid_credentials') return 'Неверный логин или пароль.';
    if (error?.status === 429 || /rate_limit|too_many/i.test(error?.code || '')) return 'Слишком много попыток входа. Подождите несколько минут и повторите.';
    if (/refresh_token|session_not_found/.test(error?.code || '')) return 'Сессия входа истекла. Введите логин и пароль заново.';
    if (error?.code === 'CLIENT_TIMEOUT' || /lock|timeout|abort/i.test(error?.name + ' ' + error?.message)) return 'Проверка входа заняла слишком много времени. Повторите вход. Если снова зависнет, нажмите «Восстановить вход».';
    return 'Нет ответа от сервера входа. Проверьте соединение и повторите чуть позже. Это не означает, что пароль неверный.';
  }
  function isTemporary(error) {
    if (error?.status === 429 || error?.code === 'invalid_credentials') return false;
    return [502,503,504].includes(error?.status) || error?.code === 'CLIENT_TIMEOUT' ||
      /AuthRetryableFetchError|AbortError|TimeoutError|TypeError/.test(error?.name || '');
  }
  // Covers Auth fetches as well as PostgREST; respect caller cancellation.
  function boundedFetch(fetcher, timeoutMs = 15000) {
    return async (input, options = {}) => {
      const controller = new AbortController();
      const signal = options.signal || input?.signal;
      let rejectCancelled;
      const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
      const cancel = () => {
        const error = signal?.reason || Object.assign(new Error('Request aborted'), {name:'AbortError'});
        controller.abort(error); rejectCancelled(error);
      };
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, {once: true});
      const timer = setTimeout(() => {
        const error = Object.assign(new Error('Request aborted: response timeout'), {name:'TimeoutError',code:'CLIENT_TIMEOUT'});
        controller.abort(error); rejectCancelled(error);
      }, timeoutMs);
      try {
        return await Promise.race([cancelled, (async () => {
          if (signal?.aborted) throw signal.reason || new Error('Request aborted');
          const response = await fetcher(input, {...options, cache: 'no-store', signal: controller.signal});
          // fetch() resolves at headers. Keep the timeout alive while JSON/body is downloading.
          // All school API calls are finite JSON, not streaming subscriptions.
          if (typeof response.arrayBuffer !== 'function') return response;
          const body = await response.arrayBuffer();
          return new Response([101,204,205,304].includes(response.status) ? null : body,
            {status:response.status,statusText:response.statusText,headers:response.headers});
        })()]);
      }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    };
  }
  // Retry only a completed, failed password request. Never guess after a pending SDK operation,
  // never retry bad credentials/rate limits, and never replay school-data writes here.
  async function signIn(client, credentials, onRetry, delay = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    let result;
    try { result = await client.auth.signInWithPassword(credentials); }
    catch (error) { if (!isTemporary(error)) throw error; result = {data:null,error}; }
    if (!result?.error || !isTemporary(result.error)) return result;
    onRetry?.();
    await delay(600);
    return client.auth.signInWithPassword(credentials);
  }
  function stageMessage(error, stage) {
    const labels = {session:'восстановление сеанса',auth:'проверка логина и пароля',profile:'загрузка профиля',data:'загрузка журнала'};
    return `${message(error)} Этап: ${labels[stage] || stage}. Код: ${stage === 'session' ? 'S' : stage === 'profile' ? 'P' : stage === 'data' ? 'D' : 'A'}-20261009.`;
  }
  function clearSession(storage, projectUrl) {
    const key = `sb-${new URL(projectUrl).hostname.split('.')[0]}-auth-token`;
    for (const suffix of ['', '-code-verifier', '-user']) storage.removeItem(key + suffix);
  }
  const api = {message, stageMessage, isTemporary, signIn, boundedFetch, clearSession};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SchoolAuth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
