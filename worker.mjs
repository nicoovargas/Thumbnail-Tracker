import { assets } from './build/assets.mjs';

const enc = new TextEncoder();
const SESSION_SECONDS = 30 * 86400;
const COOKIE = '__Host-thumbnail_session';
const ITERATIONS = 100000;
const IMAGE_LIMIT = 700000;
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const unhex = str => Uint8Array.from(str.match(/../g) || [], b => parseInt(b, 16));
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async value => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
function fail(status, message) { throw Object.assign(new Error(message), {status}); }
function json(data, status = 200, headers = {}) {
 return Response.json(data, {status, headers:{'Cache-Control':'no-store', ...headers}});
}
function publicUser(u) { return {id:u.id, username:u.username, nombre:u.nombre, rol:u.rol, is_admin:!!u.is_admin}; }
function cookie(token, age = SESSION_SECONDS) { return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`; }
async function limited(env, request, suffix) {
 const ip = request.headers.get('CF-Connecting-IP') || 'local';
 if (!(await env.LOGIN_LIMIT.limit({key:`${suffix}:${ip}`})).success) fail(429, 'Demasiados intentos. Espera un minuto.');
}
async function passwordHash(password, salt, env, iterations = ITERATIONS) {
 // Pepper kept as a Worker secret, outside the database and repository.
 const pepper = await crypto.subtle.importKey('raw', enc.encode(env.AUTH_PEPPER), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
 const input = await crypto.subtle.sign('HMAC', pepper, enc.encode(password));
 const key = await crypto.subtle.importKey('raw', input, 'PBKDF2', false, ['deriveBits']);
 return hex(await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:unhex(salt), iterations}, key, 256));
}
function text(value, label, max, required = false) {
 if (value == null && !required) return null;
 if (typeof value !== 'string') fail(400, `${label} no es válido.`);
 const result = value.trim();
 if ((required && !result) || result.length > max) fail(400, `${label} no es válido (máximo ${max} caracteres).`);
 return result || null;
}
async function bodyJson(request) {
 const bytes = await boundedBody(request, 20000);
 try { const value=JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value!=='object' || Array.isArray(value)) fail(400,'Solicitud inválida.'); return value; } catch { fail(400, 'Solicitud inválida.'); }
}
async function boundedBody(request, max) {
 if (Number(request.headers.get('Content-Length')) > max) fail(413, 'El archivo es demasiado grande.');
 const reader = request.body?.getReader();
 if (!reader) return new Uint8Array();
 const chunks = []; let total = 0;
 while (true) {
  const {done, value} = await reader.read(); if (done) break;
  total += value.length;
  if (total > max) { await reader.cancel(); fail(413, 'El archivo es demasiado grande.'); }
  chunks.push(value);
 }
 const result = new Uint8Array(total); let offset = 0;
 for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
 return result;
}
async function session(env, request) {
 const token = request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
 if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
 return env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await digest(token), Math.floor(Date.now()/1000)).first();
}
async function newSession(env, u) {
 const token = randomToken(), now = Math.floor(Date.now()/1000);
 await env.DB.batch([
  env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),
  env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(token), u.id, now+SESSION_SECONDS)
 ]);
 return json({user:publicUser(u)}, 200, {'Set-Cookie':cookie(token)});
}
function requireRole(u, role) { if (u.rol !== role) fail(403, 'Tu rol no permite realizar esta acción.'); }
function date(value, label, required = false) {
 const result = text(value, label, 10, required);
 if (result && (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result+'T00:00:00Z')) || new Date(result+'T00:00:00Z').toISOString().slice(0,10)!==result)) fail(400, `${label} no es válida.`);
 return result;
}
function integer(value, label) {
 if (value == null || value === '') return null;
 if (!Number.isSafeInteger(value) || value < 0 || value > 10000000) fail(400, `${label} no es válido.`);
 return value;
}
function imageMime(bytes) {
 if (bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff) return 'image/jpeg';
 if (bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10') return 'image/png';
 if (new TextDecoder().decode(bytes.slice(0,4))==='RIFF' && new TextDecoder().decode(bytes.slice(8,12))==='WEBP') return 'image/webp';
 fail(400, 'Usa una imagen PNG, JPG o WebP.');
}
async function saveThumbnail(request, env, u, id) {
 requireRole(u, 'disenador');
 const old = id ? await env.DB.prepare('SELECT * FROM miniaturas WHERE id=?').bind(id).first() : null;
 if (id && !old) fail(404, 'La miniatura no existe.');
 const bytes = await boundedBody(request, IMAGE_LIMIT+30000);
 const form = await new Response(bytes, {headers:{'Content-Type':request.headers.get('Content-Type') || ''}}).formData().catch(()=>fail(400, 'Formulario inválido.'));
 let data; try { data=JSON.parse(form.get('datos')); if(!data || typeof data!=='object' || Array.isArray(data)) fail(400,'Datos inválidos.'); } catch { fail(400, 'Datos inválidos.'); }
 const values = [text(data.cliente,'Cliente',120,true),text(data.titulo,'Título',250,true),date(data.fecha,'Fecha',true),integer(data.minutos ?? old?.minutos,'Tiempo'),integer(data.revisiones,'Revisiones'),text(data.link_video,'Enlace',2000),text(data.notas,'Notas',5000)];
 if (values[5]) { let url; try {url=new URL(values[5]);} catch {fail(400,'Enlace inválido.');} if (!['https:','http:'].includes(url.protocol)) fail(400,'Usa un enlace HTTP o HTTPS.'); }
 const file = form.get('imagen'); const statements = []; let imageId=old?.imagen_path;
 if (file && typeof file !== 'string' && file.size) {
  if (file.size>IMAGE_LIMIT) fail(413, 'La imagen optimizada debe pesar menos de 700 KB.');
  const imageBytes=new Uint8Array(await file.arrayBuffer()); const mime=imageMime(imageBytes);
  imageId=crypto.randomUUID();
  statements.push(env.DB.prepare('INSERT INTO images(id,mime,data) VALUES(?,?,?)').bind(imageId,mime,imageBytes));
 }
 if (!imageId) fail(400, 'Agrega una imagen de la miniatura.');
 const itemId=id || crypto.randomUUID();
 statements.push(old
  ? env.DB.prepare('UPDATE miniaturas SET cliente=?,titulo=?,fecha=?,minutos=?,revisiones=?,link_video=?,notas=?,imagen_path=? WHERE id=?').bind(...values,imageId,itemId)
  : env.DB.prepare('INSERT INTO miniaturas(cliente,titulo,fecha,minutos,revisiones,link_video,notas,imagen_path,id,user_id) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(...values,imageId,itemId,u.id));
 if (old && old.imagen_path !== imageId) statements.push(env.DB.prepare('DELETE FROM images WHERE id=? AND NOT EXISTS(SELECT 1 FROM miniaturas WHERE imagen_path=?)').bind(old.imagen_path,old.imagen_path));
 await env.DB.batch(statements);
 return json({id:itemId}, old?200:201);
}
async function api(request, env) {
 const url=new URL(request.url), path=url.pathname, method=request.method;
 // JSON/multipart requests are same-origin only. No credentialed cross-site API.
 if (!['GET','HEAD'].includes(method)) {
  if (request.headers.get('Origin')!==url.origin) fail(403,'Solicitud de otro sitio bloqueada.');
  if (!/^(application\/json|multipart\/form-data)(;|$)/i.test(request.headers.get('Content-Type')||'')) fail(415,'Formato de solicitud inválido.');
 }
 if (path==='/api/health' && method==='GET') {await env.DB.prepare('SELECT 1').first();return json({ok:true});}
 if (path==='/api/session' && method==='GET') {
  const u=await session(env,request);
  return json({user:u?publicUser(u):null});
 }
 if (path==='/api/login' && method==='POST') {
  await limited(env,request,'login'); const body=await bodyJson(request);
  const username=typeof body.username==='string'?body.username.trim().toLowerCase():'';
  if (!/^[a-z0-9_]{3,32}$/.test(username) || typeof body.password!=='string' || body.password.length>128) fail(401,'Usuario o contraseña incorrectos.');
  const u=await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first(), now=Math.floor(Date.now()/1000);
  if (u && u.locked_until>now) fail(429,'Demasiados intentos. Espera 15 minutos.');
  const candidate=await passwordHash(body.password,u?.salt||'0'.repeat(64),env,u?.iterations||ITERATIONS);
  if (!u || !crypto.subtle.timingSafeEqual(unhex(candidate),unhex(u.password_hash))) {
   if (u) await env.DB.prepare('UPDATE users SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts>=9 THEN ? ELSE 0 END WHERE id=?').bind(now+900,u.id).run();
   fail(401,'Usuario o contraseña incorrectos.');
  }
  await env.DB.prepare('UPDATE users SET failed_attempts=0,locked_until=0 WHERE id=?').bind(u.id).run();
  return newSession(env,u);
 }
 const u=await session(env,request); if (!u) fail(401,'Inicia sesión para continuar.');
 if (path==='/api/logout' && method==='POST') {
  const token=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
  return json({ok:true},200,{'Set-Cookie':cookie('',0)});
 }
 if (path==='/api/password' && method==='POST') {
  await limited(env,request,'password'); const body=await bodyJson(request);
  if (typeof body.current!=='string' || body.current.length>128 || typeof body.password!=='string' || body.password.length<12 || body.password.length>128) fail(400,'La contraseña nueva debe tener entre 12 y 128 caracteres.');
  if (!crypto.subtle.timingSafeEqual(unhex(await passwordHash(body.current,u.salt,env,u.iterations)),unhex(u.password_hash))) fail(403,'La contraseña actual no coincide.');
  const salt=randomToken(), hash=await passwordHash(body.password,salt,env);
  await env.DB.batch([
   env.DB.prepare('UPDATE users SET password_hash=?,salt=?,iterations=? WHERE id=?').bind(hash,salt,ITERATIONS,u.id),
   env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id)
  ]);
  return newSession(env,u);
 }
 if (path==='/api/miniaturas' && method==='GET') {
  const offset=Number(url.searchParams.get('offset')||0); if (!Number.isSafeInteger(offset)||offset<0) fail(400,'Página inválida.');
  const rows=(await env.DB.prepare('SELECT m.*,p.monto,p.pagado,p.fecha_pago,p.nota,p.updated_at,p.confirmado_disenador_at,p.confirmado_encargado_at,p.revision FROM miniaturas m LEFT JOIN pagos p ON p.miniatura_id=m.id ORDER BY m.fecha DESC,m.created_at DESC,m.id LIMIT 201 OFFSET ?').bind(offset).all()).results;
  const more=rows.length>200; const data=rows.slice(0,200).map(row=>{
   const {monto,pagado,fecha_pago,nota,updated_at,confirmado_disenador_at,confirmado_encargado_at,revision,...m}=row;
   return {...m,pagos:updated_at?{monto,pagado:monto!=null && !!confirmado_disenador_at && !!confirmado_encargado_at,fecha_pago,nota,updated_at,confirmado_disenador_at,confirmado_encargado_at,revision}:null};
  });
  return json({data,nextOffset:more?offset+200:null});
 }
 if (path==='/api/miniaturas' && method==='POST') return saveThumbnail(request,env,u,null);
 const item=path.match(/^\/api\/miniaturas\/([a-f0-9-]{36})$/);
 if (item && method==='PUT') return saveThumbnail(request,env,u,item[1]);
 if (item && method==='DELETE') {
  requireRole(u,'disenador'); const m=await env.DB.prepare('SELECT imagen_path FROM miniaturas WHERE id=?').bind(item[1]).first();
  if (!m) fail(404,'La miniatura no existe.');
  await env.DB.batch([
   env.DB.prepare('DELETE FROM miniaturas WHERE id=?').bind(item[1]),
   env.DB.prepare('DELETE FROM images WHERE id=? AND NOT EXISTS(SELECT 1 FROM miniaturas WHERE imagen_path=?)').bind(m.imagen_path,m.imagen_path)
  ]); return json({ok:true});
 }
 if (path==='/api/pagos/confirmar' && method==='POST') {
  if (!['disenador','encargado'].includes(u.rol)) fail(403,'Tu cuenta no puede confirmar pagos.');
  const b=await bodyJson(request);
  if (!Array.isArray(b.items) || b.items.length<1 || b.items.length>40 || typeof b.confirmed!=='boolean') fail(400,'Selecciona entre 1 y 40 miniaturas.');
  const ids=new Set(); const params=[];
  for (const item of b.items) {
   if (!item || typeof item.id!=='string' || !/^[a-f0-9-]{36}$/.test(item.id) || !Number.isSafeInteger(item.revision) || item.revision<1 || ids.has(item.id)) fail(400,'Selección de pagos inválida.');
   ids.add(item.id); params.push(item.id,item.revision);
  }
  const own=u.rol==='disenador'?'confirmado_disenador_at':'confirmado_encargado_at';
  const other=u.rol==='disenador'?'confirmado_encargado_at':'confirmado_disenador_at';
  const values=b.items.map(()=>'(?,?)').join(','); const now=new Date().toISOString();
  // One statement validates every revision and applies the whole selection atomically.
  // The authenticated role selects the column; an administrator cannot confirm for the other account.
  const result=await env.DB.prepare(`WITH expected(id,version) AS (VALUES ${values})
   UPDATE pagos SET ${own}=CASE WHEN ?=1 THEN ? ELSE NULL END,
    pagado=CASE WHEN ?=1 AND ${other} IS NOT NULL AND monto IS NOT NULL THEN 1 ELSE 0 END,updated_at=?
   WHERE miniatura_id IN(SELECT id FROM expected) AND NOT EXISTS(
    SELECT 1 FROM expected e LEFT JOIN pagos p ON p.miniatura_id=e.id
    WHERE p.revision IS NULL OR p.revision<>e.version OR p.monto IS NULL
   )`).bind(...params,b.confirmed?1:0,now,b.confirmed?1:0,now).run();
  if (result.meta.changes!==b.items.length) fail(409,'Algún pago cambió o todavía no tiene monto. Actualiza la lista y vuelve a seleccionar.');
  return json({ok:true,count:b.items.length});
 }
 const pay=path.match(/^\/api\/miniaturas\/([a-f0-9-]{36})\/pago$/);
 if (pay && method==='PUT') {
  if (u.rol!=='encargado' && !u.is_admin) fail(403,'Solo el encargado o administrador puede establecer el monto.');
  const b=await bodyJson(request);
  if (typeof b.monto!=='number' || !Number.isFinite(b.monto)||b.monto<0||b.monto>999999999) fail(400,'Monto inválido.');
  if (b.revision!=null && (!Number.isSafeInteger(b.revision)||b.revision<1)) fail(400,'Versión de pago inválida.');
  const fecha=date(b.fecha_pago,'Fecha de pago'), nota=text(b.nota,'Nota',5000);
  if (!await env.DB.prepare('SELECT id FROM miniaturas WHERE id=?').bind(pay[1]).first()) fail(404,'La miniatura no existe.');
  const changed='pagos.monto IS NOT excluded.monto OR pagos.fecha_pago IS NOT excluded.fecha_pago';
  const result=await env.DB.prepare(`INSERT INTO pagos(miniatura_id,monto,pagado,fecha_pago,nota,updated_at)
   SELECT ?,?,0,?,?,? WHERE (? IS NULL AND NOT EXISTS(SELECT 1 FROM pagos WHERE miniatura_id=?))
    OR EXISTS(SELECT 1 FROM pagos WHERE miniatura_id=? AND revision=?)
   ON CONFLICT(miniatura_id) DO UPDATE SET monto=excluded.monto,fecha_pago=excluded.fecha_pago,nota=excluded.nota,updated_at=excluded.updated_at,
    confirmado_disenador_at=CASE WHEN ${changed} THEN NULL ELSE pagos.confirmado_disenador_at END,
    confirmado_encargado_at=CASE WHEN ${changed} THEN NULL ELSE pagos.confirmado_encargado_at END,
    pagado=CASE WHEN ${changed} THEN 0 ELSE pagos.pagado END,
    revision=CASE WHEN ${changed} THEN pagos.revision+1 ELSE pagos.revision END
   WHERE pagos.revision=?`).bind(pay[1],Math.round(b.monto*100)/100,fecha,nota,new Date().toISOString(),b.revision??null,pay[1],pay[1],b.revision??null,b.revision??null).run();
  if (!result.meta.changes) fail(409,'El pago cambió en la otra cuenta. Actualiza la miniatura antes de guardar.');
  return json({ok:true});
 }
 const image=path.match(/^\/api\/images\/([a-f0-9-]{36})$/);
 if (image && ['GET','HEAD'].includes(method)) {
  const row=await env.DB.prepare('SELECT mime,data FROM images WHERE id=?').bind(image[1]).first(); if (!row) fail(404,'Imagen no encontrada.');
  return new Response(method==='HEAD'?null:new Uint8Array(row.data),{headers:{'Content-Type':row.mime,'Cache-Control':'private, no-store','Content-Disposition':'inline'}});
 }
 fail(404,'Ruta no encontrada.');
}
export default {
 async fetch(request, env) {
  const url=new URL(request.url); let response;
  try {
   if (url.pathname.startsWith('/api/')) response=await api(request,env);
   else {
    if (!['GET','HEAD'].includes(request.method)) fail(405,'Método no permitido.');
    const asset=assets[url.pathname==='/'?'/index.html':url.pathname];
    if (!asset) fail(404,'Página no encontrada.');
    response=new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache'}});
   }
  } catch(error) {
   const status=error.status||500;
   if (status>=500) console.error(JSON.stringify({event:'request_failed',path:url.pathname,message:error.message}));
   response=json({error:status>=500?'Ocurrió un error al guardar o consultar. Intenta nuevamente.':error.message},status);
  }
  const headers=new Headers(response.headers);
  headers.set('X-Content-Type-Options','nosniff'); headers.set('Referrer-Policy','no-referrer');
  headers.set('X-Frame-Options','DENY');
  headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return new Response(response.body,{status:response.status,headers});
 }
};
