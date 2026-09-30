(function(root) {
  'use strict';
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  // JSONB may reorder object keys. Key order is not an edit; array order is.
  function equal(a,b) {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
        a.every((value,index)=>equal(value,b[index]));
    }
    if (!object(a) || !object(b)) return false;
    const keys=Object.keys(a);
    return keys.length === Object.keys(b).length &&
      keys.every(key=>Object.prototype.hasOwnProperty.call(b,key) && equal(a[key],b[key]));
  }
  function merge(base, local, remote, path='', resolve) {
    if (equal(local,base)) return structuredClone(remote);
    if (equal(remote,base) || equal(local,remote)) return structuredClone(local);
    if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote) &&
      [...base,...local,...remote].every(x => object(x) && typeof x.id === 'string')) {
      const maps=[base,local,remote].map(rows=>new Map(rows.map(x=>[x.id,x])));
      return [...new Set([...remote,...local].map(x=>x.id))].map(id=>merge(maps[0].get(id),maps[1].get(id),maps[2].get(id),`${path}/${id}`,resolve)).filter(x=>x!==undefined);
    }
    if (object(base) && object(local) && object(remote)) {
      const result={};
      for (const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])) {
        const value=merge(base[key],local[key],remote[key],`${path}/${key}`,resolve);
        if (value!==undefined) result[key]=value;
      }
      return result;
    }
    if (resolve) return structuredClone(resolve({path,base,local,remote}));
    throw new Error(`Одно и то же поле изменено в двух сеансах: ${path}`);
  }
  function payload(base,local,remote,resolve) {
    const serverKeys=['teacherGroupsEnabled','absencesEnabled','absenceRows','substituteTeachers'];
    const clean=x=>{const copy=structuredClone(x); for(const key of ['sessionEmployeeId','activeEmployeeId',...serverKeys]) delete copy[key]; return copy;};
    return {...merge(clean(base),clean(local),clean(remote),'',resolve), sessionEmployeeId:local.sessionEmployeeId,
      activeEmployeeId:local.activeEmployeeId,...Object.fromEntries(serverKeys.map(key=>[key,remote[key]]))};
  }
  // Apply only actual user edits to the raw server row. Display migrations/defaults
  // are not edits and must not create false conflicts or erase unknown server fields.
  function edited(base,local,raw) {
    if(equal(base,local)) return structuredClone(raw);
    if(object(base) && object(local)) {
      const out=object(raw)?structuredClone(raw):{};
      for(const key of new Set([...Object.keys(base),...Object.keys(local)])) {
        if(equal(base[key],local[key])) continue;
        const value=edited(base[key],local[key],raw?.[key]);
        if(value===undefined) delete out[key]; else out[key]=value;
      }
      return out;
    }
    return structuredClone(local);
  }
  function changes(base,local,raw=base) {
    const result=[];
    for(const collection of ['schedule','records','scheduleArchives','groups','students','employees','holidays']) {
      const [b,l,r]=[base,local,raw].map(x=>new Map((x?.[collection]||[]).map(row=>[row.id,row])));
      for(const id of new Set([...b.keys(),...l.keys()])) {
        if(equal(b.get(id),l.get(id))) continue;
        const before=r.get(id),after=edited(b.get(id),l.get(id),before);
        if(!equal(before,after)) result.push({collection,id,before:before??null,after:after??null});
      }
    }
    if(!equal(base?.academicPlanVersion,local?.academicPlanVersion)) result.push({collection:'academicPlanVersion',
      before:raw?.academicPlanVersion??null,after:local?.academicPlanVersion??null});
    return result;
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
  const api={merge,payload,changes,request,errorMessage};
  if(typeof module!=='undefined' && module.exports) module.exports=api; else root.SchoolSync=api;
})(typeof globalThis!=='undefined'?globalThis:this);
