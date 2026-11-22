import {localDateKey, selectedMonth, matchesMonth, monthLabel} from './period-filter.mjs';

async function api(path, options = {}) {
  const init = { credentials: 'same-origin', ...options };
  if (init.body && !(init.body instanceof FormData)) {
    init.headers = { 'Content-Type': 'application/json', ...init.headers };
    init.body = JSON.stringify(init.body);
  }
  const response = await fetch('/api' + path, init);
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/login') {
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      mostrarLogin();
    }
    throw new Error(data.error || 'No se pudo completar la solicitud.');
  }
  return data;
}
const $ = s => document.querySelector(s);
let user = null, rol = null, items = [], verLista = [];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
const pagoDe = m => Array.isArray(m.pagos) ? m.pagos[0] : m.pagos;
const imgUrl = p => p ? '/api/images/' + encodeURIComponent(p) : '';
const fmtFecha = f => f ? new Date(f + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const estado = m => { const p = pagoDe(m); if (!p || p.monto == null) return 'sinprecio'; return p.pagado ? 'pagada' : 'pendiente'; };
const ETIQ = { pagada: 'Pagada', pendiente: 'Por cobrar', sinprecio: 'Sin precio' };

/* ---------- sesión ---------- */
async function iniciar() {
  try {
    const state = await api('/session');
    if (state.user) await entrar(state.user); else mostrarLogin();
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  } catch (error) { mostrarLogin(); mostrarError('#loginError', error.message); }
}
function mostrarLogin() {
  user = null; rol = null; items = []; verLista = [];
  $('#grid').replaceChildren(); $('#whoName').textContent = '';
  $('#login').hidden = false; $('#app').hidden = true;
}
async function entrar(u) {
  user = u; rol = u.rol;
  $('#whoName').textContent = (u.nombre || u.username) + (rol === 'disenador' ? ' · Diseñador' : ' · Encargado');
  $('#btnNueva').hidden = rol !== 'disenador';
  $('#login').hidden = true; $('#app').hidden = false;
  await cargar();
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button[type=submit]');
  btn.disabled = true; $('#loginError').hidden = true;
  try {
    const data = await api('/login', { method: 'POST', body: { username: f.elements.namedItem('username').value.trim(), password: f.password.value } });
    f.reset(); await entrar(data.user);
  } catch (error) { mostrarError('#loginError', error.message); }
  finally { btn.disabled = false; }
});
$('#btnSalir').addEventListener('click', async () => {
  try { await api('/logout', {method:'POST', body:{}}); mostrarLogin(); }
  catch (error) { alert(error.message); }
});
$('#btnPassword').addEventListener('click', () => {$('#passwordError').hidden=true;$('#passwordForm').reset();$('#dlgPassword').showModal();});
$('#passwordForm').addEventListener('submit', async e => {
  e.preventDefault(); const f=e.target, btn=f.querySelector('[type=submit]'); btn.disabled=true;
  $('#passwordError').hidden=true;
  try {
    await api('/password', {method:'POST',body:Object.fromEntries(new FormData(f))});
    f.reset(); $('#dlgPassword').close(); alert('Contraseña actualizada. Se cerraron las demás sesiones.');
  } catch(error) {mostrarError('#passwordError',error.message);}
  finally {btn.disabled=false;}
});

function mostrarError(sel, msg) { const el = $(sel); el.textContent = msg; el.hidden = false; }

/* ---------- datos ---------- */
async function cargar() {
  try {
    const all = []; let offset = 0;
    do {
      const page = await api('/miniaturas?offset=' + offset);
      all.push(...page.data); offset = page.nextOffset;
    } while (offset !== null);
    items = all;
  } catch (error) {
    $('#vacio').hidden = false; $('#vacio').textContent = 'No se pudieron cargar las miniaturas: ' + error.message; return;
  }
  const clientes = [...new Set(items.map(m => m.cliente))].sort((a, b) => a.localeCompare(b));
  const sel = $('#fCliente'), actual = sel.value;
  sel.innerHTML = '<option value="">Todos los clientes</option>' + clientes.map(c => `<option>${esc(c)}</option>`).join('');
  sel.value = clientes.includes(actual) ? actual : '';
  $('#listaClientes').innerHTML = clientes.map(c => `<option value="${esc(c)}">`).join('');
  pintar();
}

function filtrar() {
  const q = $('#q').value.trim().toLowerCase(), c = $('#fCliente').value, e = $('#fEstado').value;
  const month = selectedMonth($('#fPeriodo').value, $('#fMes').value);
  return items.filter(m => {
    if (!matchesMonth(m.fecha, month)) return false;
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
  const month = selectedMonth($('#fPeriodo').value, $('#fMes').value);
  const total = verLista.length;
  $('#periodoResumen').textContent = `${total} ${total === 1 ? 'miniatura' : 'miniaturas'} · ${monthLabel(month)}`;
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
$('#fMes').value = localDateKey().slice(0, 7);
$('#fPeriodo').addEventListener('change', () => {
  $('#fMesLabel').hidden = $('#fPeriodo').value !== 'custom';
  pintar();
});
['#q', '#fCliente', '#fEstado', '#fMes'].forEach(s => $(s).addEventListener('input', pintar));
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
    try {
      await api('/miniaturas/' + m.id + '/pago', {method:'PUT', body:{
        monto: +f.monto.value, pagado: f.pagado.checked,
        fecha_pago: f.fecha_pago.value || null, nota: f.nota.value.trim() || null
      }});
      $('#dlgDetalle').close(); await cargar();
    } catch (error) { mostrarError('#pagoError', 'No se pudo guardar: ' + error.message); }
    finally { btn.disabled = false; }
  });
}

/* ---------- formulario de miniatura (diseñador) ---------- */
const form = $('#form');
function abrirForm(m) {
  form.reset(); $('#formError').hidden = true;
  $('#formTitulo').textContent = m ? 'Editar miniatura' : 'Nueva miniatura';
  $('#btnBorrar').hidden = !m;
  form.elements.namedItem('id').value = m?.id ?? ''; form.elements.namedItem('imagen_path').value = m?.imagen_path ?? '';
  form.elements.namedItem('cliente').value = m?.cliente ?? ''; form.elements.namedItem('titulo').value = m?.titulo ?? '';
  form.elements.namedItem('fecha').value = m?.fecha ?? localDateKey();
  form.elements.namedItem('revisiones').value = m?.revisiones ?? '';
  form.elements.namedItem('link_video').value = m?.link_video ?? ''; form.elements.namedItem('notas').value = m?.notas ?? '';
  verPreview(m ? imgUrl(m.imagen_path) : '');
  $('#dlgForm').showModal();
}
function verPreview(src) { const p = $('#preview'); p.hidden = !src; p.src = src || ''; }
$('#btnNueva').addEventListener('click', () => abrirForm(null));
form.elements.namedItem('imagen').addEventListener('change', () => { const f = form.elements.namedItem('imagen').files[0]; if (f) verPreview(URL.createObjectURL(f)); });
$('#dlgForm').addEventListener('paste', e => {
  const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
  if (!f) return;
  const dt = new DataTransfer(); dt.items.add(f); form.elements.namedItem('imagen').files = dt.files; verPreview(URL.createObjectURL(f));
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = form.querySelector('[type=submit]'); btn.disabled = true; $('#formError').hidden = true;
  try {
    const file = form.elements.namedItem('imagen').files[0];
    if (!file && !form.elements.namedItem('imagen_path').value) throw new Error('Agrega una imagen de la miniatura.');
    const n = v => v === '' ? null : +v;
    const row = {
      cliente: form.elements.namedItem('cliente').value.trim(), titulo: form.elements.namedItem('titulo').value.trim(), fecha: form.elements.namedItem('fecha').value,
      revisiones: n(form.elements.namedItem('revisiones').value),
      link_video: form.elements.namedItem('link_video').value.trim() || null, notas: form.elements.namedItem('notas').value.trim() || null
    };
    const body = new FormData(); body.set('datos', JSON.stringify(row));
    if (file) body.set('imagen', await optimizarImagen(file), 'miniatura.webp');
    const id = form.elements.namedItem('id').value;
    await api('/miniaturas' + (id ? '/' + id : ''), {method:id?'PUT':'POST', body});
    $('#dlgForm').close(); await cargar();
  } catch (err) { mostrarError('#formError', err.message || 'No se pudo guardar.'); }
  btn.disabled = false;
});

$('#btnBorrar').addEventListener('click', async () => {
  if (!confirm('¿Eliminar esta miniatura y su pago? No se puede deshacer.')) return;
  const btn = $('#btnBorrar'); btn.disabled = true;
  try {
    await api('/miniaturas/' + form.elements.namedItem('id').value, {method:'DELETE', body:{}});
    $('#dlgForm').close(); await cargar();
  } catch (error) { mostrarError('#formError', error.message); }
  finally { btn.disabled = false; }
});

/* ---------- varios ---------- */
document.addEventListener('click', e => { if (e.target.closest('[data-cerrar]')) e.target.closest('dialog').close(); });
$('#btnCsv').addEventListener('click', () => {
  const cab = ['Fecha', 'Cliente', 'Título', 'Revisiones', 'Monto', 'Estado', 'Fecha de pago', 'Notas', 'Nota de pago'];
  const cel = v => { let value=String(v ?? ''); if (/^[=+@\t\r-]/.test(value)) value="'"+value; return `"${value.replace(/"/g, '""')}"`; };
  const filas = verLista.map(m => { const p = pagoDe(m) || {};
    return [m.fecha, m.cliente, m.titulo, m.revisiones, p.monto, ETIQ[estado(m)], p.fecha_pago, m.notas, p.nota].map(cel).join(','); });
  const blob = new Blob(['\ufeff' + [cab.map(cel).join(','), ...filas].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'miniaturas.csv' });
  a.click(); URL.revokeObjectURL(a.href);
});

async function optimizarImagen(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('Usa una imagen de menos de 20 MB.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('No se pudo leer la imagen. Usa PNG, JPG o WebP.'); }
  try {
    const scale = Math.min(1, 1280 / bitmap.width, 1280 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.92, 0.85, 0.75, 0.6, 0.45]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
      if (blob && blob.size <= 700000) return blob;
    }
    throw new Error('La imagen sigue pesando demasiado. Usa una versión más pequeña.');
  } finally { bitmap.close(); }
}

iniciar();
