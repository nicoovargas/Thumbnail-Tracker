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
 for(const [body,rol,isAdmin] of [[ownerBody,'disenador',1],[managerBody,'encargado',0],[otherDesignerBody,'disenador',0]]) {
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
const otherDesignerBody={username:'other_designer',nombre:'Otro diseñador',password:'other-designer-password'};
const managerBody={username:'manager_test',nombre:'Encargado',password:'manager-password-12345',rol:'encargado'};
const sessionCookie=r=>r.headers.get('Set-Cookie').split(';')[0];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq3sAAAAASUVORK5CYII=','base64');
function thumbnail(data={},bytes=png){const f=new FormData();f.set('datos',JSON.stringify({cliente:'Cliente',titulo:'Miniatura de prueba',fecha:'2026-11-22',minutos:45,revisiones:2,notas:'Registro de prueba',...data}));if(bytes)f.set('imagen',new Blob([bytes],{type:'image/png'}),'thumb.png');return f;}

test('cuentas, permisos, imágenes y pagos',async t=>{
 const {request,sql,env}=fixture(); let owner,manager,id,image;
 const ownerId=sql.prepare('SELECT id FROM users WHERE username=?').get(ownerBody.username).id;
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
  const page=await (await request('/api/miniaturas?designer_id='+ownerId,{cookie:manager})).json();assert.equal(page.data.length,1);assert.equal(page.data[0].titulo,'Miniatura de prueba');image=page.data[0].imagen_path;
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
  const p=(await (await request('/api/miniaturas?designer_id='+ownerId,{cookie:manager})).json()).data[0].pagos;
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
  assert.equal((await request('/api/miniaturas?designer_id='+ownerId,{cookie:manager})).status,401);manager=sessionCookie(r);
  assert.equal((await request('/api/miniaturas?designer_id='+ownerId,{cookie:manager})).status,200);
 });
 await t.test('borrar miniatura borra pago e imagen y logout invalida sesión',async()=>{
  assert.equal((await request('/api/miniaturas/'+id,{method:'DELETE',cookie:manager,body:{}})).status,403);
  assert.equal((await request('/api/miniaturas/'+id,{method:'DELETE',cookie:owner,body:{}})).status,200);
  for(const table of ['images','miniaturas','pagos'])assert.equal(sql.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  assert.equal((await request('/api/logout',{method:'POST',cookie:manager,body:{}})).status,200);
  assert.equal((await request('/api/miniaturas?designer_id='+ownerId,{cookie:manager})).status,401);
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

async function signIn(request, body) {
 const r=await request('/api/login',{method:'POST',body});assert.equal(r.status,200);
 return {cookie:sessionCookie(r),user:(await r.json()).user};
}
function profilePhoto(bytes=png,extra={}) {
 const form=new FormData();form.set('photo',new Blob([bytes],{type:'image/png'}),'photo.png');
 for(const [key,value] of Object.entries(extra)) form.set(key,value);
 return form;
}
test('los diseñadores están aislados incluso cuando uno es administrador',async()=>{
 const {request,sql}=fixture();
 const a=await signIn(request,ownerBody),b=await signIn(request,otherDesignerBody),manager=await signIn(request,managerBody);
 for(const current of [a,b]){
  const list=await (await request('/api/designers',{cookie:current.cookie})).json();assert.deepEqual(list.designers.map(d=>d.id),[current.user.id]);
 }
 const designers=await (await request('/api/designers',{cookie:manager.cookie})).json();assert.equal(designers.designers.length,2);assert.equal(designers.designers[0].password_hash,undefined);
 const noSelection=await (await request('/api/miniaturas',{cookie:manager.cookie})).json();assert.deepEqual(noSelection.data,[]);assert.equal(noSelection.needsDesigner,true);
 const minis=[];
 for(const current of [a,b]) {
  const r=await request('/api/miniaturas',{method:'POST',cookie:current.cookie,body:thumbnail({titulo:'Privada de '+current.user.username,user_id:current===a?b.user.id:a.user.id})});assert.equal(r.status,201);
  const id=(await r.json()).id;minis.push(id);
  assert.equal(sql.prepare('SELECT user_id FROM miniaturas WHERE id=?').get(id).user_id,current.user.id);
 }
 for(let i=0;i<2;i++) {
  const current=[a,b][i],foreign=[a,b][1-i];
  const mine=await (await request('/api/miniaturas',{cookie:current.cookie})).json();assert.deepEqual(mine.data.map(m=>m.id),[minis[i]]);
  assert.equal((await request('/api/miniaturas?designer_id='+foreign.user.id,{cookie:current.cookie})).status,404);
  const chosen=await (await request('/api/miniaturas?designer_id='+current.user.id,{cookie:manager.cookie})).json();assert.deepEqual(chosen.data.map(m=>m.id),[minis[i]]);
  const image=chosen.data[0].imagen_path;
  assert.equal((await request('/api/images/'+image,{cookie:foreign.cookie})).status,404);
  assert.equal((await request('/api/images/'+image,{method:'HEAD',cookie:foreign.cookie})).status,404);
  assert.equal((await request('/api/images/'+image,{cookie:manager.cookie})).status,200);
  assert.equal((await request('/api/miniaturas/'+minis[i],{method:'PUT',cookie:foreign.cookie,body:thumbnail({titulo:'Intento ajeno'})})).status,404);
  assert.equal((await request('/api/miniaturas/'+minis[i],{method:'DELETE',cookie:foreign.cookie,body:{}})).status,404);
  assert.equal((await request('/api/miniaturas/'+minis[i]+'/pago',{method:'PUT',cookie:manager.cookie,body:{monto:100+i,fecha_pago:'2026-11-30'}})).status,200);
 }
 assert.equal((await request('/api/miniaturas?designer_id='+manager.user.id,{cookie:manager.cookie})).status,404);
 assert.equal((await request('/api/miniaturas/'+minis[1]+'/pago',{method:'PUT',cookie:a.cookie,body:{monto:999,revision:1}})).status,404);
 const mixed={items:minis.map(id=>({id,revision:1})),confirmed:true};
 assert.equal((await request('/api/pagos/confirmar',{method:'POST',cookie:a.cookie,body:mixed})).status,409);
 for(const id of minis) assert.equal(sql.prepare('SELECT confirmado_disenador_at FROM pagos WHERE miniatura_id=?').get(id).confirmado_disenador_at,null);
 for(let i=0;i<2;i++) {
  const current=[a,b][i];
  assert.equal((await request('/api/pagos/confirmar',{method:'POST',cookie:current.cookie,body:{items:[{id:minis[1-i],revision:1}],confirmed:true}})).status,409);
  assert.equal((await request('/api/pagos/confirmar',{method:'POST',cookie:current.cookie,body:{items:[{id:minis[i],revision:1}],confirmed:true}})).status,200);
 }
 assert.equal((await request('/api/pagos/confirmar',{method:'POST',cookie:manager.cookie,body:mixed})).status,200);
 for(const current of [a,b]) {
  const page=await (await request('/api/miniaturas',{cookie:current.cookie})).json();assert.equal(page.data.length,1);assert.equal(page.data[0].pagos.pagado,true);
 }
 sql.close();
});
test('cada cuenta cambia únicamente su foto y Cris ve las de ambos perfiles',async()=>{
 const {request,sql}=fixture();const a=await signIn(request,ownerBody),b=await signIn(request,otherDesignerBody),manager=await signIn(request,managerBody);
 assert.equal((await request('/api/profile/photo',{method:'PUT',body:profilePhoto()})).status,401);
 assert.equal((await request('/api/profile/photo',{method:'PUT',cookie:a.cookie,body:profilePhoto(Buffer.from('<svg>bad</svg>'))})).status,400);
 assert.equal((await request('/api/profile/photo',{method:'PUT',cookie:a.cookie,body:profilePhoto(new Uint8Array(260000))})).status,413);
 const r=await request('/api/profile/photo',{method:'PUT',cookie:a.cookie,body:profilePhoto(png,{user_id:b.user.id})});assert.equal(r.status,200);
 const updated=(await r.json()).user;assert.ok(updated.avatar_version);assert.equal(updated.id,a.user.id);
 assert.equal(sql.prepare('SELECT count(*) n FROM profile_photos WHERE user_id=?').get(b.user.id).n,0);
 for(const current of [b,manager])assert.equal((await request('/api/profile/photo',{method:'PUT',cookie:current.cookie,body:profilePhoto()})).status,200);
 const old=updated.avatar_version;
 const replaced=await request('/api/profile/photo',{method:'PUT',cookie:a.cookie,body:profilePhoto()});assert.notEqual((await replaced.json()).user.avatar_version,old);
 const choices=(await (await request('/api/designers',{cookie:manager.cookie})).json()).designers;assert.equal(choices.length,2);assert.ok(choices.every(d=>d.avatar_version));
 for(const current of [a,b]) {
  const own=await request('/api/avatars/'+current.user.id,{cookie:current.cookie});assert.equal(own.status,200);assert.deepEqual(Buffer.from(await own.arrayBuffer()),png);
  assert.equal((await request('/api/avatars/'+current.user.id,{cookie:manager.cookie})).status,200);
  const foreign=current===a?b:a;assert.equal((await request('/api/avatars/'+current.user.id,{cookie:foreign.cookie})).status,404);
 }
 assert.equal((await (await request('/api/session',{cookie:a.cookie})).json()).user.avatar_version,sql.prepare('SELECT avatar_version FROM users WHERE id=?').get(a.user.id).avatar_version);
 sql.close();
});
test('crear una cuenta de diseñador requiere administrador y nunca concede sus privilegios',async()=>{
 const {request,sql}=fixture();const a=await signIn(request,ownerBody),b=await signIn(request,otherDesignerBody),manager=await signIn(request,managerBody);
 const body={username:'new_designer',password:'new-designer-password',rol:'encargado',is_admin:1};
 for(const current of [b,manager])assert.equal((await request('/api/designers',{method:'POST',cookie:current.cookie,body})).status,403);
 const r=await request('/api/designers',{method:'POST',cookie:a.cookie,body});assert.equal(r.status,201);const newUser=(await r.json()).user;assert.equal(newUser.rol,'disenador');assert.equal(newUser.is_admin,false);
 assert.equal((await request('/api/designers',{method:'POST',cookie:a.cookie,body})).status,409);
 const login=await signIn(request,body);assert.equal(login.user.id,newUser.id);assert.deepEqual((await (await request('/api/miniaturas',{cookie:login.cookie})).json()).data,[]);
 sql.close();
});

function multipleThumbnail(files=[png,png],data={}) {
 const form=new FormData();
 form.set('datos',JSON.stringify({cliente:'Cliente versiones',titulo:'Mini con alternativas',fecha:'2026-11-22',versiones:files.map((_,i)=>'new:'+i),...data}));
 files.forEach(bytes=>form.append('imagenes',new Blob([bytes],{type:'image/png'}),'version.png'));
 return form;
}
test('varias versiones comparten miniatura y pago, y mantienen el aislamiento por diseñador',async t=>{
 const {request,sql}=fixture();const owner=await signIn(request,ownerBody),other=await signIn(request,otherDesignerBody),manager=await signIn(request,managerBody);
 let id,images,foreignId,foreignImage;
 const read=async()=> (await (await request('/api/miniaturas',{cookie:owner.cookie})).json()).data.find(m=>m.id===id);
 await t.test('dos imágenes crean un solo registro y cada imagen es privada',async()=>{
  const r=await request('/api/miniaturas',{method:'POST',cookie:owner.cookie,body:multipleThumbnail()});assert.equal(r.status,201);id=(await r.json()).id;
  const row=await read();images=row.imagenes;assert.equal(images.length,2);assert.equal(row.imagen_path,images[0]);
  assert.equal(sql.prepare('SELECT count(*) n FROM miniaturas').get().n,1);
  for(const image of images){assert.equal((await request('/api/images/'+image,{cookie:owner.cookie})).status,200);assert.equal((await request('/api/images/'+image,{cookie:manager.cookie})).status,200);assert.equal((await request('/api/images/'+image,{cookie:other.cookie})).status,404);}
  const page=(await (await request('/api/miniaturas?designer_id='+owner.user.id,{cookie:manager.cookie})).json()).data;assert.equal(page.length,1);assert.deepEqual(page[0].imagenes,images);
  assert.equal((await request('/api/miniaturas/'+id+'/pago',{method:'PUT',cookie:manager.cookie,body:{monto:100,fecha_pago:'2026-11-30'}})).status,200);
  for(const cookie of [owner.cookie,manager.cookie])assert.equal((await request('/api/pagos/confirmar',{method:'POST',cookie,body:{items:[{id,revision:1}],confirmed:true}})).status,200);
 });
 await t.test('agregar otra versión conserva el registro y su único pago',async()=>{
  const r=await request('/api/miniaturas/'+id,{method:'PUT',cookie:owner.cookie,body:multipleThumbnail([png],{versiones:[...images,'new:0']})});assert.equal(r.status,200);
  const row=await read();assert.equal(row.imagenes.length,3);assert.equal(row.pagos.monto,100);assert.equal(row.pagos.pagado,true);assert.equal(row.pagos.revision,1);images=row.imagenes;
  assert.equal(sql.prepare('SELECT count(*) n FROM pagos').get().n,1);
 });
 await t.test('elegir portada reordena las versiones y quitar una elimina solo esa imagen',async()=>{
  const reordered=[images[2],images[0],images[1]];
  assert.equal((await request('/api/miniaturas/'+id,{method:'PUT',cookie:owner.cookie,body:multipleThumbnail([],{versiones:reordered})})).status,200);
  let row=await read();assert.deepEqual(row.imagenes,reordered);assert.equal(row.imagen_path,reordered[0]);
  images=reordered.slice(0,2);
  assert.equal((await request('/api/miniaturas/'+id,{method:'PUT',cookie:owner.cookie,body:multipleThumbnail([],{versiones:images})})).status,200);
  assert.equal((await request('/api/images/'+reordered[2],{cookie:owner.cookie})).status,404);
  assert.deepEqual((await read()).imagenes,images);
 });
 await t.test('ningún diseñador puede editar versiones ajenas ni reutilizar sus imágenes',async()=>{
  const r=await request('/api/miniaturas',{method:'POST',cookie:other.cookie,body:multipleThumbnail()});foreignId=(await r.json()).id;
  foreignImage=sql.prepare('SELECT imagen_path FROM miniaturas WHERE id=?').get(foreignId).imagen_path;
  assert.equal((await request('/api/miniaturas/'+foreignId,{method:'PUT',cookie:owner.cookie,body:multipleThumbnail()})).status,404);
  const count=sql.prepare('SELECT count(*) n FROM images').get().n;
  assert.equal((await request('/api/miniaturas/'+id,{method:'PUT',cookie:owner.cookie,body:multipleThumbnail([png],{versiones:[...images,foreignImage,'new:0']})})).status,400);
  assert.equal(sql.prepare('SELECT count(*) n FROM images').get().n,count);
  assert.equal((await request('/api/miniaturas/'+id,{method:'PUT',cookie:owner.cookie,body:multipleThumbnail([],{versiones:[images[0],images[0]]})})).status,400);
 });
 await t.test('archivos inválidos o demasiadas versiones no cambian lo ya guardado',async()=>{
  const count=sql.prepare('SELECT count(*) n FROM images').get().n;
  for(const [body,status] of [[multipleThumbnail([png,Buffer.from('<svg>bad</svg>')]),400],[multipleThumbnail(Array(11).fill(png)),400],[multipleThumbnail([new Uint8Array(700001)]),413],[multipleThumbnail([],{versiones:[]}),400]]){
   assert.equal((await request('/api/miniaturas/'+id,{method:'PUT',cookie:owner.cookie,body})).status,status);
   assert.deepEqual((await read()).imagenes,images);assert.equal(sql.prepare('SELECT count(*) n FROM images').get().n,count);
  }
 });
 await t.test('eliminar la miniatura limpia todas sus versiones y su único pago',async()=>{
  assert.equal((await request('/api/miniaturas/'+id,{method:'DELETE',cookie:owner.cookie,body:{}})).status,200);
  assert.equal((await request('/api/miniaturas/'+foreignId,{method:'DELETE',cookie:other.cookie,body:{}})).status,200);
  for(const table of ['images','miniaturas','miniatura_imagenes','pagos'])assert.equal(sql.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
 });
 sql.close();
});
test('la migración de versiones mantiene las portadas de las minis existentes',()=>{
 const sql=new DatabaseSync(':memory:');sql.exec("PRAGMA foreign_keys=ON; CREATE TABLE images(id TEXT PRIMARY KEY); CREATE TABLE miniaturas(id TEXT PRIMARY KEY,imagen_path TEXT REFERENCES images(id)); INSERT INTO images VALUES('image-a'),('image-b'); INSERT INTO miniaturas VALUES('mini-a','image-a'),('mini-b','image-b');");
 sql.exec(readFileSync(new URL('../migrations/0005-thumbnail-versions.sql',import.meta.url),'utf8'));
 const rows=sql.prepare('SELECT miniatura_id,imagen_id,orden FROM miniatura_imagenes ORDER BY miniatura_id').all();
 assert.deepEqual(rows.map(r=>({...r})),[{miniatura_id:'mini-a',imagen_id:'image-a',orden:0},{miniatura_id:'mini-b',imagen_id:'image-b',orden:0}]);sql.close();
});
