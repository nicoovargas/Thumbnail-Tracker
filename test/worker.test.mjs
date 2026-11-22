import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {timingSafeEqual,createHash,createHmac,pbkdf2Sync,randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import worker from '../build/worker.mjs';
crypto.subtle.timingSafeEqual = (a,b) => timingSafeEqual(Buffer.from(a),Buffer.from(b));
const origin='https://tracker.test';
const hash=v=>createHash('sha256').update(v).digest('hex');
function fixture(){
 const sql=new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 for(const [body,rol,isAdmin] of [[ownerBody,'disenador',1],[managerBody,'encargado',0]]) {
  const salt=randomBytes(32).toString('hex');
  const input=createHmac('sha256','test-only-secret-not-for-deployment').update(body.password).digest();
  const passwordHash=pbkdf2Sync(input,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex');
  sql.prepare('INSERT INTO users(id,username,nombre,rol,is_admin,password_hash,salt) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),body.username,body.nombre,rol,isAdmin,passwordHash,salt);
 }
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
const ownerBody={username:'owner_test',nombre:'Diseñador',password:'owner-password-12345'};
const managerBody={username:'manager_test',nombre:'Encargado',password:'manager-password-12345',rol:'encargado'};
const sessionCookie=r=>r.headers.get('Set-Cookie').split(';')[0];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq3sAAAAASUVORK5CYII=','base64');
function thumbnail(data={},bytes=png){const f=new FormData();f.set('datos',JSON.stringify({cliente:'Cliente',titulo:'Miniatura de prueba',fecha:'2026-11-22',minutos:45,revisiones:2,notas:'Registro de prueba',...data}));if(bytes)f.set('imagen',new Blob([bytes],{type:'image/png'}),'thumb.png');return f;}

test('cuentas, permisos, imágenes y pagos',async t=>{
 const {request,sql,env}=fixture(); let owner,manager,id,image;
 await t.test('no hay acceso anónimo a registros e imágenes',async()=>{
  assert.equal((await request('/api/miniaturas')).status,401);
  assert.equal((await request('/api/images/11111111-1111-1111-1111-111111111111')).status,401);
  assert.deepEqual(await (await request('/api/session')).json(),{user:null});
 });
 await t.test('las cuentas existentes entran con usuario y contraseña',async()=>{
  assert.equal((await request('/api/login',{method:'POST',body:{email:'owner@example.test',password:ownerBody.password}})).status,401);
  assert.equal((await request('/api/login',{method:'POST',body:{...ownerBody,password:'wrong'}})).status,401);
  const r=await request('/api/login',{method:'POST',body:{...ownerBody,username:' OWNER_TEST '}});assert.equal(r.status,200);owner=sessionCookie(r);
  assert.match(r.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Strict/);
  const publicUser=(await r.json()).user;assert.equal(publicUser.is_admin,true);assert.equal(publicUser.username,'owner_test');assert.equal(publicUser.email,undefined);
  const stored=sql.prepare('SELECT password_hash FROM users WHERE username=?').get('owner_test');assert.notEqual(stored.password_hash,ownerBody.password);
  assert.equal((await request('/api/setup',{method:'POST',cookie:owner,body:{}})).status,404);
  assert.equal((await request('/api/users',{method:'POST',cookie:owner,body:{username:'unexpected_user'}})).status,404);
 });
 await t.test('la segunda cuenta conserva su rol de encargado',async()=>{
  const r=await request('/api/login',{method:'POST',body:managerBody});assert.equal(r.status,200);manager=sessionCookie(r);
  assert.equal((await r.json()).user.rol,'encargado');
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
 await t.test('el administrador o encargado establece monto sin marcar el pago como completado',async()=>{
  const body={monto:150.50,pagado:true,fecha_pago:'2026-11-30',nota:'Pago del mes'};
  assert.equal((await request('/api/miniaturas/'+id+'/pago',{method:'PUT',cookie:manager,body:{...body,monto:-1}})).status,400);
  assert.equal((await request('/api/miniaturas/'+id+'/pago',{method:'PUT',cookie:owner,body})).status,200);
  const row=(await (await request('/api/miniaturas',{cookie:owner})).json()).data[0];
  assert.equal(row.pagos.pagado,false);assert.equal(row.pagos.monto,150.5);assert.equal(row.pagos.revision,1);
 });
 await t.test('ni el administrador puede confirmar por la otra cuenta',async()=>{
  const body={items:[{id,revision:1}],confirmed:true,role:'encargado',confirmado_encargado_at:'forged'};
  for(let i=0;i<2;i++)assert.equal((await request('/api/pagos/confirmar',{method:'POST',cookie:owner,body})).status,200);
  const p=(await (await request('/api/miniaturas',{cookie:manager})).json()).data[0].pagos;
  assert.ok(p.confirmado_disenador_at);assert.equal(p.confirmado_encargado_at,null);assert.equal(p.pagado,false);
 });
 await t.test('solo con ambas confirmaciones se paga; retirar una lo devuelve a pendiente',async()=>{
  const body={items:[{id,revision:1}],confirmed:true};
  assert.equal((await request('/api/pagos/confirmar',{method:'POST',cookie:manager,body})).status,200);
  assert.equal((await (await request('/api/miniaturas',{cookie:owner})).json()).data[0].pagos.pagado,true);
  assert.equal((await request('/api/pagos/confirmar',{method:'POST',cookie:owner,body:{...body,confirmed:false}})).status,200);
  const p=(await (await request('/api/miniaturas',{cookie:owner})).json()).data[0].pagos;
  assert.equal(p.pagado,false);assert.equal(p.confirmado_disenador_at,null);assert.ok(p.confirmado_encargado_at);
  assert.equal((await request('/api/pagos/confirmar',{method:'POST',cookie:owner,body})).status,200);
 });
 await t.test('cambiar monto o fecha exige dos confirmaciones nuevas y rechaza versiones anteriores',async()=>{
  const base={monto:150.5,fecha_pago:'2026-11-30',nota:'Nota actualizada',revision:1};
  assert.equal((await request('/api/miniaturas/'+id+'/pago',{method:'PUT',cookie:manager,body:base})).status,200);
  let p=(await (await request('/api/miniaturas',{cookie:owner})).json()).data[0].pagos;assert.equal(p.pagado,true);assert.equal(p.revision,1);
  assert.equal((await request('/api/miniaturas/'+id+'/pago',{method:'PUT',cookie:manager,body:{...base,monto:200}})).status,200);
  p=(await (await request('/api/miniaturas',{cookie:owner})).json()).data[0].pagos;
  assert.equal(p.revision,2);assert.equal(p.pagado,false);assert.equal(p.confirmado_disenador_at,null);assert.equal(p.confirmado_encargado_at,null);
  assert.equal((await request('/api/pagos/confirmar',{method:'POST',cookie:owner,body:{items:[{id,revision:1}],confirmed:true}})).status,409);
  assert.equal((await request('/api/miniaturas/'+id+'/pago',{method:'PUT',cookie:manager,body:base})).status,409);
  assert.equal((await request('/api/miniaturas/'+id+'/pago',{method:'PUT',cookie:manager,body:{...base,monto:200,fecha_pago:'2026-12-01',revision:2}})).status,200);
  assert.equal((await (await request('/api/miniaturas',{cookie:owner})).json()).data[0].pagos.revision,3);
 });
 await t.test('la confirmación rápida es atómica y permite confirmar varias minis desde ambas cuentas',async()=>{
  const extra=[];
  for(let i=0;i<3;i++){
   const r=await request('/api/miniaturas',{method:'POST',cookie:owner,body:thumbnail({titulo:'Lote '+i})});extra.push((await r.json()).id);
   if(i<2)assert.equal((await request('/api/miniaturas/'+extra[i]+'/pago',{method:'PUT',cookie:manager,body:{monto:100,fecha_pago:'2026-11-30'}})).status,200);
  }
  const body={items:extra.slice(0,2).map(id=>({id,revision:1})),confirmed:true};
  assert.equal((await request('/api/pagos/confirmar',{method:'POST',cookie:owner,body:{...body,items:[body.items[0],{id:extra[1],revision:2}]}})).status,409);
  assert.equal(sql.prepare('SELECT confirmado_disenador_at FROM pagos WHERE miniatura_id=?').get(extra[0]).confirmado_disenador_at,null);
  assert.equal((await request('/api/pagos/confirmar',{method:'POST',cookie:owner,body:{...body,items:[body.items[0],{id:extra[2],revision:1}]}})).status,409);
  assert.equal(sql.prepare('SELECT confirmado_disenador_at FROM pagos WHERE miniatura_id=?').get(extra[0]).confirmado_disenador_at,null);
  assert.equal((await request('/api/pagos/confirmar',{method:'POST',cookie:owner,body:{...body,items:[body.items[0],body.items[0]]}})).status,400);
  const results=await Promise.all([request('/api/pagos/confirmar',{method:'POST',cookie:owner,body}),request('/api/pagos/confirmar',{method:'POST',cookie:manager,body})]);assert.deepEqual(results.map(r=>r.status),[200,200]);
  for(const iid of extra.slice(0,2))assert.equal(sql.prepare('SELECT pagado FROM pagos WHERE miniatura_id=?').get(iid).pagado,1);
  for(const iid of extra)assert.equal((await request('/api/miniaturas/'+iid,{method:'DELETE',cookie:owner,body:{}})).status,200);
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
test('la página no carga Supabase y el Worker solo sirve archivos públicos',async()=>{
 const {request,sql}=fixture();const r=await request('/');assert.equal(r.status,200);assert.match(r.headers.get('Content-Security-Policy'),/script-src 'self'/);
 const html=await r.text();assert.doesNotMatch(html,/supabase|dlgSetup|btnSetup|type="email"/);assert.match(html,/name="username"/);
 assert.equal(await (await request('/app.js')).text(),readFileSync(new URL('../app.js',import.meta.url),'utf8')); 
 assert.equal((await request('/schema.sql')).status,404);assert.equal((await request('/worker.mjs')).status,404);sql.close();
});

test('la migración conserva el registro anterior y solo atribuye la confirmación que ya existía',()=>{
 const sql=new DatabaseSync(':memory:');
 sql.exec("CREATE TABLE pagos(miniatura_id TEXT PRIMARY KEY,monto REAL,pagado INTEGER,fecha_pago TEXT,nota TEXT,updated_at TEXT); INSERT INTO pagos VALUES('legacy',100,1,'2026-10-31','Nota','2026-10-31T12:00:00Z');");
 sql.exec(readFileSync(new URL('../migrations/0003-payment-confirmations.sql',import.meta.url),'utf8'));
 const row=sql.prepare('SELECT * FROM pagos').get();assert.equal(row.monto,100);assert.equal(row.nota,'Nota');assert.equal(row.pagado,0);assert.equal(row.confirmado_encargado_at,'2026-10-31T12:00:00Z');assert.equal(row.confirmado_disenador_at,null);assert.equal(row.revision,1);sql.close();
});
