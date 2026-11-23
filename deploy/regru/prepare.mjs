import {randomBytes, createHmac, createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, copyFile, cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(directory, '../..');
const domain = process.argv[2];
if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/i.test(domain || '')) {
  throw new Error('Usage: node prepare.mjs journal.example.ru');
}
const envPath = path.join(directory, '.env');
let env;
try {
  env = await readFile(envPath, 'utf8');
  if (!env.includes(`DOMAIN=${domain}\n`)) throw new Error('Existing .env belongs to another domain');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const secret = randomBytes(48).toString('hex');
  const issued = Math.floor(Date.now()/1000);
  const token = role => {
    const unsigned = [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),
      Buffer.from(JSON.stringify({role,iss:'school-vps',iat:issued,exp:issued+10*365*86400})).toString('base64url')].join('.');
    return unsigned+'.'+createHmac('sha256',secret).update(unsigned).digest('base64url');
  };
  env = `DOMAIN=${domain}\nPOSTGRES_PASSWORD=${randomBytes(32).toString('hex')}\nAUTH_DB_PASSWORD=${randomBytes(32).toString('hex')}\nREST_DB_PASSWORD=${randomBytes(32).toString('hex')}\nJWT_SECRET=${secret}\nANON_KEY=${token('anon')}\nSERVICE_ROLE_KEY=${token('service_role')}\n`;
  await writeFile(envPath,env,{flag:'wx',mode:0o600});
}
const publicPath = path.join(directory,'public');
await mkdir(path.join(publicPath,'vendor'),{recursive:true});
const sdkText = await readFile(path.join(source,'vendor/supabase.js'),'utf8');
if (sdkText.length<10000 || !sdkText.includes('2.116.0')) throw new Error('Unexpected pinned browser SDK');
await copyFile(path.join(source,'vendor/supabase.js'),path.join(publicPath,'vendor/supabase.js'));
await copyFile(path.join(source,'vendor/LICENSE.supabase-js'),path.join(publicPath,'vendor/LICENSE.supabase-js'));
const files = ['app.js','styles.css','school-model.js','assessment-model.js','sync-model.js',
  'auth-network.js','absence-journal.js','accompanist-journal.js','accompanist-model.js',
  'paid-journal.js','paid-model.js','account-passwords.js'];
for (const name of files) await copyFile(path.join(source,name),path.join(publicPath,name));
await cp(path.join(source,'assets'),path.join(publicPath,'assets'),{recursive:true});
let html = (await readFile(path.join(source,'index.html'),'utf8'))
  .replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0','/vendor/supabase.js');
const key = env.match(/^ANON_KEY=(.+)$/m)[1];
await writeFile(path.join(publicPath,'supabase-config.js'),
  `window.SCHOOL_SUPABASE_CONFIG=${JSON.stringify({url:'https://'+domain,publishableKey:key,compactSaves:true})};\n`);
// A browser may still cache files from GitHub Pages at this same domain.
// Version every local JS/CSS URL by the deployed bytes, including the new config.
for (const match of [...html.matchAll(/\b(?:src|href)="((?!https?:)[^"]+\.(?:js|css))(?:\?[^"]*)?"/g)]) {
  const filename = match[1].replace(/^\//,'');
  const bytes = await readFile(path.join(publicPath,filename));
  const revision = createHash('sha256').update(bytes).digest('hex').slice(0,16);
  html = html.replace(match[0],match[0].slice(0,match[0].indexOf('="')+2)+match[1]+'?v='+revision+'"');
}
await writeFile(path.join(publicPath,'index.html'),html);
console.log('Prepared public files and private .env. Secrets were not printed.');
