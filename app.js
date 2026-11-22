const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s);
const BUCKET = 'miniaturas';
let user = null, rol = null, items = [], verLista = [];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
const pagoDe = m => Array.isArray(m.pagos) ? m.pagos[0] : m.pagos;
const imgUrl = p => p ? db.storage.from(BUCKET).getPublicUrl(p).data.publicUrl : '';
const fmtMin = m => m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
const fmtFecha = f => f ? new Date(f + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const estado = m => { const p = pagoDe(m); if (!p || p.monto == null) return 'sinprecio'; return p.pagado ? 'pagada' : 'pendiente'; };
const ETIQ = { pagada: 'Pagada', pendiente: 'Por cobrar', sinprecio: 'Sin precio' };

/* ---------- sesión ---------- */
async function iniciar() {
  const { data: { session } } = await db.auth.getSession();
  if (session) await entrar(session.user); else mostrarLogin();
}
function mostrarLogin() { $('#login').hidden = false; $('#app').hidden = true; }

async function entrar(u) {
  user = u;
  const { data, error } = await db.from('profiles').select('rol,nombre').eq('id', u.id).maybeSingle();
  if (error || !data) {
    await db.auth.signOut(); mostrarLogin();
    return mostrarError('#loginError', 'Tu usuario aún no tiene un rol asignado. Revisa el README (paso 4).');
  }
  rol = data.rol;
  $('#whoName').textContent = data.nombre || u.email;
  $('#btnNueva').hidden = rol !== 'disenador';
  $('#login').hidden = true; $('#app').hidden = false;
  await cargar();
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button');
  btn.disabled = true; $('#loginError').hidden = true;
  const { data, error } = await db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  btn.disabled = false;
  if (error) return mostrarError('#loginError', 'Correo o contraseña incorrectos.');
  f.reset(); await entrar(data.user);
});
$('#btnSalir').addEventListener('click', async () => { await db.auth.signOut(); items = []; mostrarLogin(); });

function mostrarError(sel, msg) { const el = $(sel); el.textContent = msg; el.hidden = false; }

/* ---------- datos ---------- */
async function cargar() {
  const { data, error } = await db.from('miniaturas').select('*, pagos(*)').order('fecha', { ascending: false }).order('created_at', { ascending: false });
  if (error) { $('#vacio').hidden = false; $('#vacio').textContent = 'No se pudieron cargar las miniaturas: ' + error.message; return; }
  items = data;
  const clientes = [...new Set(items.map(m => m.cliente))].sort((a, b) => a.localeCompare(b));
  const sel = $('#fCliente'), actual = sel.value;
  sel.innerHTML = '<option value="">Todos los clientes</option>' + clientes.map(c => `<option>${esc(c)}</option>`).join('');
  sel.value = clientes.includes(actual) ? actual : '';
  $('#listaClientes').innerHTML = clientes.map(c => `<option value="${esc(c)}">`).join('');
  pintar();
}

function filtrar() {
  const q = $('#q').value.trim().toLowerCase(), c = $('#fCliente').value, e = $('#fEstado').value;
  return items.filter(m => {
    if (c && m.cliente !== c) return false;
    if (e && estado(m) !== e) return false;
    if (!q) return true;
    const p = pagoDe(m);
    return [m.titulo, m.cliente, m.notas, p?.nota].some(t => (t || '').toLowerCase().includes(q));
  });
}

function pintar() {
  verLista = filtrar();
  let pagado = 0, pend = 0, sin = 0;
  verLista.forEach(m => {
    const s = estado(m), p = pagoDe(m);
    if (s === 'pagada') pagado += +p.monto; else if (s === 'pendiente') pend += +p.monto; else sin++;
  });
  $('#stPagado').textContent = money(pagado);
  $('#stPendiente').textContent = money(pend);
  $('#stSinPrecio').textContent = sin;
  $('#stTotal').textContent = verLista.length;
  $('#grid').innerHTML = verLista.map(m => {
    const s = estado(m), p = pagoDe(m);
    return `<button class="card" data-id="${m.id}">
      <img class="thumb" loading="lazy" src="${esc(imgUrl(m.imagen_path))}" alt="">
      <div class="info"><h3>${esc(m.titulo)}</h3>
        <div class="meta"><span>${esc(m.cliente)}</span>
        <span class="badge ${s}">${s === 'sinprecio' ? ETIQ[s] : money(p.monto)}</span></div></div></button>`;
  }).join('');
  const vacio = $('#vacio');
  vacio.hidden = verLista.length > 0;
  vacio.textContent = items.length ? 'Ninguna miniatura coincide con la búsqueda.' : (rol === 'disenador' ? 'Aún no hay miniaturas. Agrega la primera con “Nueva miniatura”.' : 'Aún no hay miniaturas registradas.');
}
['#q', '#fCliente', '#fEstado'].forEach(s => $(s).addEventListener('input', pintar));
$('#grid').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) abrirDetalle(c.dataset.id); });

/* ---------- detalle y pago ---------- */
function abrirDetalle(id) {
  const m = items.find(x => x.id === id); if (!m) return;
  const p = pagoDe(m) || {};
  const esEnc = rol === 'encargado';
  const pagoHtml = esEnc ? `
    <form class="pago" id="formPago">
      <h3>Pago</h3>
      <div class="row">
        <label>Monto <input type="number" name="monto" min="0" step="0.01" inputmode="decimal" value="${p.monto ?? ''}" required></label>
        <label>Fecha de pago <input type="date" name="fecha_pago" value="${p.fecha_pago ?? ''}"></label>
      </div>
      <label class="check"><input type="checkbox" name="pagado" ${p.pagado ? 'checked' : ''}> Ya está pagada</label>
      <label>Nota <small class="muted">(opcional)</small> <textarea name="nota" rows="2">${esc(p.nota)}</textarea></label>
      <p class="error" id="pagoError" hidden></p>
      <div class="actions"><span class="spacer"></span><button class="btn ghost" type="button" data-cerrar>Cerrar</button><button class="btn primary" type="submit">Guardar pago</button></div>
    </form>` : `
    <div class="pago"><h3>Pago</h3>
      <dl class="facts">
        <div><dt>Monto</dt><dd>${p.monto != null ? money(p.monto) : 'Aún sin precio'}</dd></div>
        <div><dt>Estado</dt><dd>${ETIQ[estado(m)]}</dd></div>
        <div><dt>Fecha de pago</dt><dd>${fmtFecha(p.fecha_pago)}</dd></div>
      </dl>
      ${p.nota ? `<div><small class="muted">Nota</small><br>${esc(p.nota)}</div>` : ''}
      <div class="actions"><span class="spacer"></span>
        ${rol === 'disenador' ? '<button class="btn" type="button" id="btnEditar">Editar miniatura</button>' : ''}
        <button class="btn ghost" type="button" data-cerrar>Cerrar</button></div>
    </div>`;
  $('#detalle').innerHTML = `
    <img class="big" src="${esc(imgUrl(m.imagen_path))}" alt="">
    <div><h2>${esc(m.titulo)}</h2><span class="muted">${esc(m.cliente)}</span></div>
    <dl class="facts">
      <div><dt>Fecha</dt><dd>${fmtFecha(m.fecha)}</dd></div>
      <div><dt>Tiempo</dt><dd>${fmtMin(m.minutos)}</dd></div>
      ${m.revisiones != null ? `<div><dt>Revisiones</dt><dd>${m.revisiones}</dd></div>` : ''}
      ${m.link_video ? `<div><dt>Video</dt><dd><a href="${esc(m.link_video)}" target="_blank" rel="noopener">Abrir en YouTube</a></dd></div>` : ''}
    </dl>
    ${m.notas ? `<div><small class="muted">Notas del diseñador</small><br>${esc(m.notas)}</div>` : ''}
    ${pagoHtml}`;
  $('#dlgDetalle').showModal();
  $('#btnEditar')?.addEventListener('click', () => { $('#dlgDetalle').close(); abrirForm(m); });
  $('#formPago')?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    const { error } = await db.from('pagos').upsert({
      miniatura_id: m.id, monto: f.monto.value === '' ? null : +f.monto.value, pagado: f.pagado.checked,
      fecha_pago: f.fecha_pago.value || null, nota: f.nota.value.trim() || null, updated_at: new Date().toISOString()
    });
    btn.disabled = false;
    if (error) return mostrarError('#pagoError', 'No se pudo guardar: ' + error.message);
    $('#dlgDetalle').close(); await cargar();
  });
}

/* ---------- formulario de miniatura (diseñador) ---------- */
const form = $('#form');
function abrirForm(m) {
  form.reset(); $('#formError').hidden = true;
  $('#formTitulo').textContent = m ? 'Editar miniatura' : 'Nueva miniatura';
  $('#btnBorrar').hidden = !m;
  form.id.value = m?.id ?? ''; form.imagen_path.value = m?.imagen_path ?? '';
  form.cliente.value = m?.cliente ?? ''; form.titulo.value = m?.titulo ?? '';
  form.fecha.value = m?.fecha ?? new Date().toISOString().slice(0, 10);
  form.minutos.value = m?.minutos ?? ''; form.revisiones.value = m?.revisiones ?? '';
  form.link_video.value = m?.link_video ?? ''; form.notas.value = m?.notas ?? '';
  verPreview(m ? imgUrl(m.imagen_path) : '');
  $('#dlgForm').showModal();
}
function verPreview(src) { const p = $('#preview'); p.hidden = !src; p.src = src || ''; }
$('#btnNueva').addEventListener('click', () => abrirForm(null));
form.imagen.addEventListener('change', () => { const f = form.imagen.files[0]; if (f) verPreview(URL.createObjectURL(f)); });
$('#dlgForm').addEventListener('paste', e => {
  const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
  if (!f) return;
  const dt = new DataTransfer(); dt.items.add(f); form.imagen.files = dt.files; verPreview(URL.createObjectURL(f));
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = form.querySelector('[type=submit]'); btn.disabled = true; $('#formError').hidden = true;
  try {
    let path = form.imagen_path.value || null;
    const file = form.imagen.files[0];
    if (!file && !path) throw new Error('Agrega una imagen de la miniatura.');
    if (file) {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const nuevo = `${crypto.randomUUID()}.${ext}`;
      const { error } = await db.storage.from(BUCKET).upload(nuevo, file, { contentType: file.type });
      if (error) throw error;
      if (path) await db.storage.from(BUCKET).remove([path]);
      path = nuevo;
    }
    const n = v => v === '' ? null : +v;
    const row = {
      cliente: form.cliente.value.trim(), titulo: form.titulo.value.trim(), fecha: form.fecha.value,
      minutos: n(form.minutos.value), revisiones: n(form.revisiones.value),
      link_video: form.link_video.value.trim() || null, notas: form.notas.value.trim() || null, imagen_path: path
    };
    const { error } = form.id.value
      ? await db.from('miniaturas').update(row).eq('id', form.id.value)
      : await db.from('miniaturas').insert({ ...row, user_id: user.id });
    if (error) throw error;
    $('#dlgForm').close(); await cargar();
  } catch (err) { mostrarError('#formError', err.message || 'No se pudo guardar.'); }
  btn.disabled = false;
});

$('#btnBorrar').addEventListener('click', async () => {
  if (!confirm('¿Eliminar esta miniatura y su pago? No se puede deshacer.')) return;
  const m = items.find(x => x.id === form.id.value);
  const { error } = await db.from('miniaturas').delete().eq('id', form.id.value);
  if (error) return mostrarError('#formError', error.message);
  if (m?.imagen_path) await db.storage.from(BUCKET).remove([m.imagen_path]);
  $('#dlgForm').close(); await cargar();
});

/* ---------- varios ---------- */
document.addEventListener('click', e => { if (e.target.closest('[data-cerrar]')) e.target.closest('dialog').close(); });
$('#btnCsv').addEventListener('click', () => {
  const cab = ['Fecha', 'Cliente', 'Título', 'Minutos', 'Revisiones', 'Monto', 'Estado', 'Fecha de pago', 'Notas', 'Nota de pago'];
  const cel = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const filas = verLista.map(m => { const p = pagoDe(m) || {};
    return [m.fecha, m.cliente, m.titulo, m.minutos, m.revisiones, p.monto, ETIQ[estado(m)], p.fecha_pago, m.notas, p.nota].map(cel).join(','); });
  const blob = new Blob(['\ufeff' + [cab.map(cel).join(','), ...filas].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'miniaturas.csv' });
  a.click(); URL.revokeObjectURL(a.href);
});

iniciar();
