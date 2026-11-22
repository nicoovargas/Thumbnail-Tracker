import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {timingSafeEqual,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import worker from '../build/worker.mjs';
crypto.subtle.timingSafeEqual = (a,b) => timingSafeEqual(Buffer.from(a),Buffer.from(b));
const origin='https://tracker.test';
const hash=v=>createHash('sha256').update(v).digest('hex');
function fixture(){
 const sql=new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 sql.prepare('INSERT INTO setup(id,token_hash) VALUES(1,?)').run(hash('test-setup-code'));
 const convert=row=>row && Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v instanceof Uint8Array?Array.from(v):v]));
 const DB={prepare(query){return {params:[],bind(...params){this.params=params.map(v=>v instanceof ArrayBuffer?Buffer.from(v):v);return this;},async first(){return convert(sql.prepare(query).get(...this.params))||null;},async all(){return {results:sql.prepare(query).all(...this.params).map(convert),success:true};},async run(){const r=sql.prepare(query).run(...this.params);return {success:true,meta:{changes:Number(r.changes)},results:[]};}};},async batch(statements){sql.exec('BEGIN');try {const out=[];for(const s of statements) out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB,AUTH_PEPPER:'test-only-secret-not-for-deployment',LOGIN_LIMIT:{async limit(){return {success:true};}}};
 async function request(path,{method='GET',body,cookie,headers={}}={}){
  if(method!=='GET' && method!=='HEAD') headers={Origin:origin,...headers};
  if(cookie)headers.Cookie=cookie;
  if(body && !(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
  return worker.fetch(new Request(origin+path,{method,headers,body}),env);
 }
 return {sql,env,request};
}
const ownerBody={email:'owner@example.test',nombre:'Diseñador',password:'owner-password-12345',code:'test-setup-code'};
const managerBody={email:'manager@example.test',nombre:'Encargado',password:'manager-password-12345',rol:'encargado'};
const sessionCookie=r=>r.headers.get('Set-Cookie').split(';')[0];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq3sAAAAASUVORK5CYII=','base64');
function thumbnail(data={},bytes=png){const f=new FormData();f.set('datos',JSON.stringify({cliente:'Cliente',titulo:'Miniatura de prueba',fecha:'2026-11-22',minutos:45,revisiones:2,notas:'Registro de prueba',...data}));if(bytes)f.set('imagen',new Blob([bytes],{type:'image/png'}),'thumb.png');return f;}

test('cuentas, permisos, imágenes y pagos',async t=>{
 const {request,sql,env}=fixture(); let owner,manager,id,image;
 await t.test('no hay acceso anónimo a registros e imágenes',async()=>{
  assert.equal((await request('/api/miniaturas')).status,401);
  assert.equal((await request('/api/images/11111111-1111-1111-1111-111111111111')).status,401);
  assert.equal((await (await request('/api/session')).json()).needsSetup,true);
 });
 await t.test('el código protege la primera cuenta y solo se puede usar una vez',async()=>{
  assert.equal((await request('/api/setup',{method:'POST',body:{...ownerBody,code:'wrong'}})).status,403);
  const r=await request('/api/setup',{method:'POST',body:ownerBody});assert.equal(r.status,200);owner=sessionCookie(r);
  assert.match(r.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Strict/);
  assert.equal((await r.json()).user.is_admin,true);
  assert.equal((await request('/api/setup',{method:'POST',body:{...ownerBody,email:'intruder@example.test'}})).status,409);
  const stored=sql.prepare('SELECT password_hash FROM users').get();assert.notEqual(stored.password_hash,ownerBody.password);
  assert.equal((await (await request('/api/session',{cookie:owner})).json()).needsSetup,false);
 });
 await t.test('solo el administrador crea cuentas y el login conserva el rol',async()=>{
  assert.equal((await request('/api/users',{method:'POST',cookie:owner,body:managerBody})).status,201);
  assert.equal((await request('/api/login',{method:'POST',body:{...managerBody,password:'wrong-password'}})).status,401);
  const r=await request('/api/login',{method:'POST',body:managerBody});assert.equal(r.status,200);manager=sessionCookie(r);
  assert.equal((await r.json()).user.rol,'encargado');
  assert.equal((await request('/api/users',{cookie:manager})).status,403);
  assert.equal((await request('/api/users',{method:'POST',cookie:manager,body:{...managerBody,email:'third@example.test'}})).status,403);
 });
 await t.test('validación de tamaño, contenido, fechas y enlaces',async()=>{
  for(const [data,bytes,status] of [[{},Buffer.from('<svg>bad</svg>'),400],[{},new Uint8Array(750000),413],[{link_video:'javascript:alert(1)'},png,400],[{fecha:'2026-02-31'},png,400],[{minutos:-1},png,400]]){
   assert.equal((await request('/api/miniaturas',{method:'POST',cookie:owner,body:thumbnail(data,bytes)})).status,status);
  }
  assert.equal(sql.prepare('SELECT count(*) n FROM images').get().n,0);
 });
 await t.test('diseñador guarda miniaturas y el encargado solo puede verlas',async()=>{
  assert.equal((await request('/api/miniaturas',{method:'POST',cookie:manager,body:thumbnail()})).status,403);
  const r=await request('/api/miniaturas',{method:'POST',cookie:owner,body:thumbnail()});assert.equal(r.status,201);id=(await r.json()).id;
  const page=await (await request('/api/miniaturas',{cookie:manager})).json();assert.equal(page.data.length,1);assert.equal(page.data[0].titulo,'Miniatura de prueba');image=page.data[0].imagen_path;
  const response=await request('/api/images/'+image,{cookie:manager});assert.equal(response.headers.get('Content-Type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
 });
 await t.test('solo el encargado modifica pagos',async()=>{
  const body={monto:150.50,pagado:true,fecha_pago:'2026-11-22',nota:'Liquidado'};
  assert.equal((await request('/api/miniaturas/'+id+'/pago',{method:'PUT',cookie:owner,body})).status,403);
  assert.equal((await request('/api/miniaturas/'+id+'/pago',{method:'PUT',cookie:manager,body:{...body,monto:-1}})).status,400);
  assert.equal((await request('/api/miniaturas/'+id+'/pago',{method:'PUT',cookie:manager,body})).status,200);
  const row=(await (await request('/api/miniaturas',{cookie:owner})).json()).data[0];assert.equal(row.pagos.pagado,true);assert.equal(row.pagos.monto,150.5);
 });
 await t.test('editar sin imagen la conserva y reemplazar elimina la anterior',async()=>{
  assert.equal((await request('/api/miniaturas/'+id,{method:'PUT',cookie:manager,body:thumbnail()})).status,403);
  assert.equal((await request('/api/miniaturas/'+id,{method:'PUT',cookie:owner,body:thumbnail({titulo:'Editada'},null)})).status,200);
  assert.equal((await request('/api/images/'+image,{cookie:owner})).status,200);
  assert.equal((await request('/api/miniaturas/'+id,{method:'PUT',cookie:owner,body:thumbnail({titulo:'Otra imagen'})})).status,200);
  assert.equal((await request('/api/images/'+image,{cookie:owner})).status,404);
  assert.equal(sql.prepare('SELECT count(*) n FROM images').get().n,1);
 });
 await t.test('rechaza solicitudes desde otro sitio',async()=>{
  assert.equal((await request('/api/miniaturas/'+id,{method:'DELETE',cookie:owner,body:{},headers:{Origin:'https://attacker.test'}})).status,403);
 });
 await t.test('contraseña nueva revoca sesiones previas',async()=>{
  assert.equal((await request('/api/password',{method:'POST',cookie:manager,body:{current:'wrong',password:'new-manager-password'}})).status,403);
  const r=await request('/api/password',{method:'POST',cookie:manager,body:{current:managerBody.password,password:'new-manager-password'}});assert.equal(r.status,200);
  assert.equal((await request('/api/miniaturas',{cookie:manager})).status,401);manager=sessionCookie(r);
  assert.equal((await request('/api/miniaturas',{cookie:manager})).status,200);
 });
 await t.test('borrar miniatura borra pago e imagen y logout invalida sesión',async()=>{
  assert.equal((await request('/api/miniaturas/'+id,{method:'DELETE',cookie:manager,body:{}})).status,403);
  assert.equal((await request('/api/miniaturas/'+id,{method:'DELETE',cookie:owner,body:{}})).status,200);
  for(const table of ['images','miniaturas','pagos'])assert.equal(sql.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  assert.equal((await request('/api/logout',{method:'POST',cookie:manager,body:{}})).status,200);
  assert.equal((await request('/api/miniaturas',{cookie:manager})).status,401);
 });
 await t.test('limitador de acceso devuelve un error claro',async()=>{
  env.LOGIN_LIMIT.limit=async()=>({success:false});
  assert.equal((await request('/api/login',{method:'POST',body:ownerBody})).status,429);
 });
 sql.close();
});
test('la primera cuenta no se puede tomar dos veces con solicitudes concurrentes',async()=>{
 const {request,sql}=fixture();
 const responses=await Promise.all([request('/api/setup',{method:'POST',body:ownerBody}),request('/api/setup',{method:'POST',body:{...ownerBody,email:'second@example.test'}})]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 assert.equal(sql.prepare('SELECT count(*) n FROM users').get().n,1);sql.close();
});
test('la página no carga Supabase y el Worker solo sirve archivos públicos',async()=>{
 const {request,sql}=fixture();const r=await request('/');assert.equal(r.status,200);assert.match(r.headers.get('Content-Security-Policy'),/script-src 'self'/);
 assert.doesNotMatch(await r.text(),/supabase/);
 assert.equal(await (await request('/app.js')).text(),readFileSync(new URL('../app.js',import.meta.url),'utf8')); 
 assert.equal((await request('/schema.sql')).status,404);assert.equal((await request('/worker.mjs')).status,404);sql.close();
});
