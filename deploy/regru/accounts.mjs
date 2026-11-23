import http from 'node:http';

export function createAccountsServer({authUrl, restUrl, serviceKey, fetcher = fetch}) {
  const request = async (base, route, token, options = {}) => {
    const response = await fetcher(base+route, {...options, signal:AbortSignal.timeout(12000),
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...options.headers}});
    const value = await response.json();
    if (!response.ok) {
      const error = new Error('Account operation failed');
      error.status = response.status;
      throw error;
    }
    return value;
  };
  return http.createServer(async (req,res) => {
    const send = (status,value) => {
      res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify(value));
    };
    if (req.url !== '/functions/v1/manage-school-user' || req.method !== 'POST') return send(404,{error:'Not found'});
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    if (!token) return send(401,{error:'Authentication required'});
    try {
      const caller = await request(authUrl,'/user',token);
      const profiles = await request(restUrl,'/school_profiles?select=is_admin&id=eq.'+encodeURIComponent(caller.id),serviceKey);
      if (profiles.length!==1 || !profiles[0].is_admin) return send(403,{error:'Administrator access required'});
      const chunks=[];
      let size=0;
      for await (const chunk of req) {
        size+=chunk.length;
        if (size>8192) return send(413,{error:'Request too large'});
        chunks.push(chunk);
      }
      let body;
      try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return send(400,{error:'Invalid JSON'}); }
      const currentUsername=String(body.currentUsername || '').trim().toLowerCase();
      const newUsername=String(body.newUsername || '').trim().toLowerCase();
      const newPassword=String(body.newPassword || '');
      const validLogin = value => /^[a-z0-9][a-z0-9._-]{2,31}$/.test(value);
      if (!validLogin(currentUsername) || !validLogin(newUsername) || (newPassword && newPassword.length<12)
        || newPassword.length>128 || (currentUsername===newUsername && !newPassword)) return send(400,{error:'Invalid credentials update'});
      const targets=await request(restUrl,'/school_profiles?select=id,username&username=eq.'+encodeURIComponent(currentUsername),serviceKey);
      if (targets.length!==1) return send(404,{error:'Employee profile was not found'});
      const target=targets[0];
      let updatedAt=null;
      if (currentUsername!==newUsername) {
        updatedAt=await request(restUrl,'/rpc/admin_sync_employee_username',serviceKey,
          {method:'POST',body:JSON.stringify({target_profile_id:target.id,new_username:newUsername})});
      }
      const attributes={};
      if (currentUsername!==newUsername) Object.assign(attributes,{email:newUsername+'@journal.local',email_confirm:true});
      if (newPassword) attributes.password=newPassword;
      try {
        await request(authUrl,'/admin/users/'+encodeURIComponent(target.id),serviceKey,
          {method:'PUT',body:JSON.stringify(attributes)});
      } catch(error) {
        // Roll back a rejected Auth update. An ambiguous network timeout may have
        // committed, so do not undo the profile underneath a successful Auth write.
        if (currentUsername!==newUsername && error.status>=400 && error.status<500) {
          await request(restUrl,'/rpc/admin_sync_employee_username',serviceKey,
            {method:'POST',body:JSON.stringify({target_profile_id:target.id,new_username:currentUsername})});
        }
        throw error;
      }
      return send(200,{ok:true,profileId:target.id,username:newUsername,passwordChanged:Boolean(newPassword),updatedAt});
    } catch(error) {
      return send(error.status===401 ? 401 : 503,{error:'Account operation could not be confirmed'});
    }
  });
}

if (process.env.PORT) {
  const {AUTH_URL,REST_URL,SERVICE_ROLE_KEY}=process.env;
  if (!AUTH_URL || !REST_URL || !SERVICE_ROLE_KEY) throw new Error('Account service configuration is incomplete');
  createAccountsServer({authUrl:AUTH_URL,restUrl:REST_URL,serviceKey:SERVICE_ROLE_KEY})
    .listen(Number(process.env.PORT),'0.0.0.0');
}
