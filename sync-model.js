(function(root) {
  'use strict';
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  function merge(base, local, remote, path='') {
    if (equal(local,base)) return structuredClone(remote);
    if (equal(remote,base) || equal(local,remote)) return structuredClone(local);
    if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote) &&
      [...base,...local,...remote].every(x => object(x) && typeof x.id === 'string')) {
      const maps=[base,local,remote].map(rows=>new Map(rows.map(x=>[x.id,x])));
      return [...new Set([...remote,...local].map(x=>x.id))].map(id=>merge(maps[0].get(id),maps[1].get(id),maps[2].get(id),`${path}/${id}`)).filter(x=>x!==undefined);
    }
    if (object(base) && object(local) && object(remote)) {
      const result={};
      for (const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])) {
        const value=merge(base[key],local[key],remote[key],`${path}/${key}`);
        if (value!==undefined) result[key]=value;
      }
      return result;
    }
    throw new Error(`Одно и то же поле изменено в двух сеансах: ${path}`);
  }
  function payload(base,local,remote) {
    const serverKeys=['teacherGroupsEnabled','absencesEnabled','absenceRows','substituteTeachers'];
    const clean=x=>{const copy=structuredClone(x); for(const key of ['sessionEmployeeId','activeEmployeeId',...serverKeys]) delete copy[key]; return copy;};
    return {...merge(clean(base),clean(local),clean(remote)), sessionEmployeeId:local.sessionEmployeeId,
      activeEmployeeId:local.activeEmployeeId,...Object.fromEntries(serverKeys.map(key=>[key,remote[key]]))};
  }
  async function request(builder, timeoutMs=20000) {
    const controller=new AbortController();
    let timer;
    const timeout=new Promise((_,reject)=>{
      timer=setTimeout(()=>{
        const error=new Error('Сервер не ответил за отведённое время. Проверьте соединение и повторите сохранение.');
        error.code='CLIENT_TIMEOUT';
        reject(error);
        controller.abort();
      },timeoutMs);
    });
    try {
      // Also covers an SDK auth/token lock before fetch has started.
      return await Promise.race([typeof builder.abortSignal==='function' ? builder.abortSignal(controller.signal) : builder,timeout]);
    } finally {clearTimeout(timer);}
  }
  function errorMessage(error) {
    const message=error?.message || 'Неизвестная ошибка сервера.';
    if (/statement timeout|57014/i.test(message)) return 'Сервер слишком долго обрабатывает запрос. Повторите сохранение через минуту.';
    if (/JWT expired|invalid JWT|refresh token|session.*expired/i.test(message)) return 'Сессия входа истекла. Не закрывайте страницу с изменениями; обратитесь к администратору.';
    if (/failed to fetch|network|load failed/i.test(message)) return 'Нет ответа от сервера. Проверьте интернет и повторите сохранение.';
    return message;
  }
  const api={merge,payload,request,errorMessage};
  if(typeof module!=='undefined' && module.exports) module.exports=api; else root.SchoolSync=api;
})(typeof globalThis!=='undefined'?globalThis:this);
