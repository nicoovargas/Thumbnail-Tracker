import {localDateKey, selectedMonth, matchesMonth, monthLabel, lastDayOfMonth} from './period-filter.mjs';

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
    throw Object.assign(new Error(data.error || 'No se pudo completar la solicitud.'), {status:response.status});
  }
  return data;
}
const $ = s => document.querySelector(s);
let user = null, rol = null, items = [], verLista = [], cargando = false, selectedDesigner = null, designers = [], loadGeneration = 0, loadingScope = null, designersLoading = false;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
const pagoDe = m => Array.isArray(m.pagos) ? m.pagos[0] : m.pagos;
const imgUrl = p => p ? '/api/images/' + encodeURIComponent(p) : '';
const versionesDe = m => Array.isArray(m.imagenes) && m.imagenes.length ? m.imagenes : [m.imagen_path];
const versionsIcon = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" stroke-width="2"/><path d="M8 21h10a3 3 0 0 0 3-3V8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const versionsBadge = m => versionesDe(m).length > 1 ? `<span class="versions-badge">${versionsIcon}${versionesDe(m).length} versiones</span>` : '';

const fmtFecha = f => f ? new Date(f + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const estado = m => { const p = pagoDe(m); if (!p || p.monto == null) return 'sinprecio'; return p.pagado ? 'pagada' : 'pendiente'; };
const ETIQ = { pagada: 'Pagada', pendiente: 'Por cobrar', sinprecio: 'Sin precio' };
const miConfirmacion = p => !!(rol === 'disenador' ? p?.confirmado_disenador_at : p?.confirmado_encargado_at);
function estadoConfirmacion(p) {
  if (!p || p.monto == null) return 'Primero establece el monto';
  if (p.pagado) return 'Pagada · confirmada por ambos';
  if (miConfirmacion(p)) return 'Confirmaste · falta la otra cuenta';
  if (p.confirmado_disenador_at || p.confirmado_encargado_at) return 'Falta tu confirmación';
  return 'Falta la confirmación de ambos';
}


/* ---------- sesión ---------- */
async function iniciar() {
  try {
    const state = await api('/session');
    if (state.user) await entrar(state.user); else mostrarLogin();
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  } catch (error) { mostrarLogin(); mostrarError('#loginError', error.message); }
}
function avatarHtml(person, large = false) {
  const name = person.nombre || person.username;
  const extra = large ? ' avatar-large' : '';
  return person.avatar_version
    ? `<img class="avatar${extra}" src="/api/avatars/${encodeURIComponent(person.id)}?v=${encodeURIComponent(person.avatar_version)}" alt="Foto de ${esc(name)}">`
    : `<span class="avatar avatar-placeholder${extra}" aria-label="Sin foto de ${esc(name)}">${esc(name.slice(0, 1).toUpperCase())}</span>`;
}
function renderPerfil() {
  $('#whoAvatar').innerHTML = avatarHtml(user);
  $('#whoName').textContent = (user.nombre || user.username) + (rol === 'disenador' ? ' · Diseñador' : ' · Encargado');
}
function limpiarLista() {
  loadGeneration++; cargando = false; loadingScope = null;
  items = []; verLista = [];
  $('#q').value = ''; $('#fEstado').value = ''; $('#fCliente').innerHTML = '<option value="">Todos los clientes</option>';
  $('#listaClientes').replaceChildren(); pintar();
}
function mostrarLogin() {
  loadGeneration++; user = null; rol = null; items = []; verLista = []; selectedDesigner = null; designers = [];
  cargando = false; loadingScope = null;
  $('#grid').replaceChildren(); $('#designersGrid').replaceChildren(); $('#whoName').textContent = ''; $('#whoAvatar').replaceChildren();
  $('#login').hidden = false; $('#app').hidden = true; $('#trackerScreen').hidden = true; $('#designersScreen').hidden = true;
}
async function cargarDisenadores() {
  if (designersLoading || !user || rol !== 'encargado') return;
  designersLoading = true; const accountId = user.id;
  try {
    const data = await api('/designers');
    if (!user || user.id !== accountId || rol !== 'encargado') return;
    designers = data.designers;
    $('#designersGrid').innerHTML = designers.map(d => `<button class="designer-card" type="button" data-designer="${d.id}">${avatarHtml(d, true)}<b>${esc(d.nombre || d.username)}</b><small>Ver miniaturas</small></button>`).join('') || '<p class="muted">Todavía no hay diseñadores.</p>';
    $('#designersError').hidden = true;
    if (selectedDesigner) {
      const updated = designers.find(d => d.id === selectedDesigner.id);
      if (updated) { selectedDesigner = updated; $('#activeDesigner').innerHTML = avatarHtml(updated) + `<b>${esc(updated.nombre || updated.username)}</b>`; }
    }
  } catch (error) { if (user) mostrarError('#designersError', error.message); }
  finally { designersLoading = false; }
}
async function mostrarDisenadores() {
  selectedDesigner = null; limpiarLista();
  $('#trackerScreen').hidden = true; $('#designersScreen').hidden = false;
  await cargarDisenadores();
}
async function entrar(u) {
  user = u; rol = u.rol; selectedDesigner = null; renderPerfil();
  $('#btnNueva').hidden = rol !== 'disenador';
  $('#login').hidden = true; $('#app').hidden = false;
  $('#designerContext').hidden = rol !== 'encargado';
  if (rol === 'encargado') await mostrarDisenadores();
  else {
    selectedDesigner = u; limpiarLista();
    $('#designersScreen').hidden = true; $('#trackerScreen').hidden = false;
    await cargar();
  }
}
$('#designersGrid').addEventListener('click', async e => {
  const card = e.target.closest('[data-designer]'); if (!card) return;
  const designer = designers.find(d => d.id === card.dataset.designer); if (!designer) return;
  selectedDesigner = designer; limpiarLista();
  $('#activeDesigner').innerHTML = avatarHtml(designer) + `<b>${esc(designer.nombre || designer.username)}</b>`;
  $('#designersScreen').hidden = true; $('#trackerScreen').hidden = false;
  await cargar();
});
$('#btnCambiarDesigner').addEventListener('click', mostrarDisenadores);

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
let profilePreviewUrl = null;
$('#btnPerfil').addEventListener('click', () => {
  $('#profileForm').reset(); $('#profileError').hidden = true;
  $('#profileUsername').textContent = user.username;
  $('#profileAvatar').innerHTML = avatarHtml(user, true);
  $('#dlgPerfil').showModal();
});
$('#profilePhoto').addEventListener('change', e => {
  if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
  const file = e.target.files[0]; if (!file) return;
  profilePreviewUrl = URL.createObjectURL(file);
  $('#profileAvatar').innerHTML = `<img class="avatar avatar-large" src="${esc(profilePreviewUrl)}" alt="Vista previa de tu foto">`;
});
$('#dlgPerfil').addEventListener('close', () => {
  if (profilePreviewUrl) {URL.revokeObjectURL(profilePreviewUrl); profilePreviewUrl = null;}
  $('#profileForm').reset();
});
$('#profileForm').addEventListener('submit', async e => {
  e.preventDefault(); const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
  $('#profileError').hidden = true;
  try {
    const file = $('#profilePhoto').files[0]; if (!file) throw new Error('Selecciona una foto.');
    const body = new FormData(); body.set('photo', await optimizarFotoPerfil(file), 'perfil.webp');
    const result = await api('/profile/photo', {method:'PUT', body});
    user = result.user; renderPerfil();
    if (rol === 'disenador') selectedDesigner = user;
    $('#dlgPerfil').close();
  } catch(error) { mostrarError('#profileError', error.message); }
  finally {btn.disabled = false;}
});
async function optimizarFotoPerfil(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('Usa una foto de menos de 20 MB.');
  let bitmap;
  try {bitmap = await createImageBitmap(file);} catch {throw new Error('No se pudo leer la foto. Usa PNG, JPG o WebP.');}
  try {
    const side = Math.min(bitmap.width, bitmap.height), canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    canvas.getContext('2d').drawImage(bitmap, (bitmap.width-side)/2, (bitmap.height-side)/2, side, side, 0, 0, 256, 256);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (!blob || blob.size > 250000) throw new Error('Usa una foto más pequeña.');
    return blob;
  } finally {bitmap.close();}
}

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
  if (!user || (rol === 'encargado' && !selectedDesigner)) return;
  const scope = rol === 'encargado' ? selectedDesigner.id : user.id;
  if (cargando && loadingScope === scope) return;
  cargando = true; loadingScope = scope;
  const generation = ++loadGeneration, accountId = user.id;
  try {
    const all = []; let offset = 0;
    do {
      const page = await api('/miniaturas?offset=' + offset + '&designer_id=' + encodeURIComponent(scope));
      all.push(...page.data); offset = page.nextOffset;
    } while (offset !== null);
    if (!user || user.id !== accountId || generation !== loadGeneration) return;
    items = all;
  } catch (error) {
    if (!user || user.id !== accountId || generation !== loadGeneration) return;
    $('#vacio').hidden = false; $('#vacio').textContent = 'No se pudieron cargar las miniaturas: ' + error.message; return;
  } finally { if (generation === loadGeneration) cargando = false; }
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
      <div class="card-cover"><img class="thumb" loading="lazy" src="${esc(imgUrl(m.imagen_path))}" alt="">${versionsBadge(m)}</div>
      <div class="info"><h3>${esc(m.titulo)}</h3>
        <div class="meta"><span>${esc(m.cliente)}</span>
        <span class="badge ${s}">${s === 'sinprecio' ? ETIQ[s] : money(p.monto)}</span></div>
        <span class="payment-stage">${estadoConfirmacion(p)}</span></div></button>`;
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
  const puedeEditarPago = rol === 'encargado' || user.is_admin;
  const pagoHtml = puedeEditarPago ? `
    <form class="pago" id="formPago">
      <h3>Pago</h3>
      <div class="row">
        <label>Monto <input type="number" name="monto" min="0" step="0.01" inputmode="decimal" value="${p.monto ?? ''}" required></label>
        <label>Fecha de pago <input type="date" name="fecha_pago" value="${p.fecha_pago || lastDayOfMonth()}"></label>
      </div>
      <p class="muted">Guardar el monto no confirma el pago. La fecha sugerida es el último día de este mes y puedes cambiarla.</p>
      <label>Nota <small class="muted">(opcional)</small> <textarea name="nota" rows="2">${esc(p.nota)}</textarea></label>
      <p class="error" id="pagoError" hidden></p>
      <div class="actions"><span class="spacer"></span><button class="btn ghost" type="button" data-cerrar>Cerrar</button><button class="btn primary" type="submit">Guardar monto y fecha</button></div>
    </form>` : `
    <div class="pago"><h3>Pago</h3>
      <dl class="facts">
        <div><dt>Monto</dt><dd>${p.monto != null ? money(p.monto) : 'Aún sin precio'}</dd></div>
        <div><dt>Estado</dt><dd>${ETIQ[estado(m)]}</dd></div>
        <div><dt>Fecha de pago</dt><dd>${fmtFecha(p.fecha_pago)}</dd></div>
      </dl>
      ${p.nota ? `<div><small class="muted">Nota</small><br>${esc(p.nota)}</div>` : ''}
      <div class="actions"><span class="spacer"></span>
        <button class="btn ghost" type="button" data-cerrar>Cerrar</button></div>
    </div>`;
  $('#detalle').innerHTML = `
    <section id="versionGallery" class="version-gallery" aria-label="Versiones de la miniatura">
      <div class="gallery-main">
        <img id="versionMain" class="big" src="${esc(imgUrl(m.imagen_path))}" alt="${esc(m.titulo)} · versión 1">
        ${versionesDe(m).length > 1 ? `<button id="versionPrev" class="gallery-arrow gallery-prev" type="button" aria-label="Versión anterior">‹</button><button id="versionNext" class="gallery-arrow gallery-next" type="button" aria-label="Versión siguiente">›</button><span id="versionPosition" class="gallery-position">1 / ${versionesDe(m).length}</span>` : ''}
      </div>
      ${versionesDe(m).length > 1 ? `<div id="versionTabs" class="version-tabs" role="tablist" aria-label="Elegir versión">${versionesDe(m).map((image,index)=>`<button class="version-tab" type="button" role="tab" aria-selected="${index===0}" data-version="${index}"><img src="${esc(imgUrl(image))}" alt="" loading="lazy"><span>Versión ${index+1}</span></button>`).join('')}</div>` : ''}
    </section>
    <div><h2>${esc(m.titulo)}</h2><span class="muted">${esc(m.cliente)}</span></div>
    <dl class="facts">
      <div><dt>Fecha</dt><dd>${fmtFecha(m.fecha)}</dd></div>
      ${m.revisiones != null ? `<div><dt>Revisiones</dt><dd>${m.revisiones}</dd></div>` : ''}
      ${m.link_video ? `<div><dt>Video</dt><dd><a href="${esc(m.link_video)}" target="_blank" rel="noopener">Abrir en YouTube</a></dd></div>` : ''}
    </dl>
    ${m.notas ? `<div><small class="muted">Notas del diseñador</small><br>${esc(m.notas)}</div>` : ''}
    ${pagoHtml}
    <section class="pago confirmation-panel">
      <h3>Confirmación del pago</h3>
      <p class="payment-rule">Solo aparece como pagada cuando ambas cuentas confirman el mismo monto y fecha.</p>
      <dl class="facts"><div><dt>Monto guardado</dt><dd>${p.monto != null ? money(p.monto) : 'Sin monto'}</dd></div><div><dt>Fecha guardada</dt><dd>${fmtFecha(p.fecha_pago)}</dd></div></dl>
      <div class="confirmation-states"><span>Diseñador: <b>${p.confirmado_disenador_at ? 'Confirmó' : 'Pendiente'}</b></span><span>Encargado: <b>${p.confirmado_encargado_at ? 'Confirmó' : 'Pendiente'}</b></span></div>
      <p>${estadoConfirmacion(p)}</p>
      <p id="confirmSaveFirst" class="muted" hidden>Guarda el monto y la fecha antes de confirmar.</p>
      <p id="confirmError" class="error" hidden></p>
      ${rol === 'disenador' ? '<button class="btn" type="button" id="btnEditar">Editar miniatura</button>' : ''}
      <button id="btnConfirmarMini" class="btn ${miConfirmacion(p) ? 'ghost' : 'primary'}" type="button" ${p.monto == null ? 'disabled' : ''}>${miConfirmacion(p) ? 'Retirar mi confirmación' : 'Confirmar mi parte del pago'}</button>
    </section>`;
  const galleryImages = versionesDe(m); let galleryIndex = 0;
  function mostrarVersion(index) {
    galleryIndex = (index + galleryImages.length) % galleryImages.length;
    $('#versionMain').src = imgUrl(galleryImages[galleryIndex]);
    $('#versionMain').alt = `${m.titulo} · versión ${galleryIndex+1}`;
    if ($('#versionPosition')) $('#versionPosition').textContent = `${galleryIndex+1} / ${galleryImages.length}`;
    $('#versionTabs')?.querySelectorAll('[data-version]').forEach(tab => tab.setAttribute('aria-selected', Number(tab.dataset.version) === galleryIndex ? 'true' : 'false'));
  }
  $('#versionTabs')?.addEventListener('click', e => {const tab=e.target.closest('[data-version]');if(tab)mostrarVersion(Number(tab.dataset.version));});
  $('#versionPrev')?.addEventListener('click', () => mostrarVersion(galleryIndex-1));
  $('#versionNext')?.addEventListener('click', () => mostrarVersion(galleryIndex+1));
  $('#versionGallery').addEventListener('keydown', e => {
    if (galleryImages.length > 1 && ['ArrowLeft','ArrowRight'].includes(e.key)) {e.preventDefault();mostrarVersion(galleryIndex+(e.key==='ArrowLeft'?-1:1));}
  });
  $('#dlgDetalle').showModal();
  $('#btnEditar')?.addEventListener('click', () => { $('#dlgDetalle').close(); abrirForm(m); });
  const paymentForm = $('#formPago');
  if (paymentForm) {
    const initial = JSON.stringify(Object.fromEntries(new FormData(paymentForm)));
    const confirmationButton = $('#btnConfirmarMini');
    const suggestedDateNotSaved = p.monto != null && !p.fecha_pago;
    function revisarCambiosPago() {
      const dirty = suggestedDateNotSaved || JSON.stringify(Object.fromEntries(new FormData(paymentForm))) !== initial;
      confirmationButton.disabled = p.monto == null || dirty;
      $('#confirmSaveFirst').hidden = !dirty;
    }
    paymentForm.addEventListener('input', revisarCambiosPago);
    revisarCambiosPago();
  }
  $('#formPago')?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await api('/miniaturas/' + m.id + '/pago', {method:'PUT', body:{
        monto: +f.monto.value, revision: p.revision ?? null,
        fecha_pago: f.fecha_pago.value || null, nota: f.nota.value.trim() || null
      }});
      $('#dlgDetalle').close(); await cargar();
    } catch (error) {
      if (error.status === 409) { $('#dlgDetalle').close(); await cargar(); alert(error.message); }
      else mostrarError('#pagoError', 'No se pudo guardar: ' + error.message);
    }
    finally { btn.disabled = false; }
  });
  $('#btnConfirmarMini').addEventListener('click', async e => {
    const btn = e.target; btn.disabled = true; $('#confirmError').hidden = true;
    try {
      await api('/pagos/confirmar', {method:'POST', body:{items:[{id:m.id,revision:p.revision}],confirmed:!miConfirmacion(p)}});
      $('#dlgDetalle').close(); await cargar();
    } catch(error) {
      if (error.status === 409) { $('#dlgDetalle').close(); await cargar(); alert(error.message); }
      else mostrarError('#confirmError',error.message);
    } finally {btn.disabled=false;}
  });

}

/* ---------- confirmación rápida ---------- */
function contarSeleccionadas() {
  const count = $('#quickList').querySelectorAll('input[name=miniatura]:checked:not(:disabled)').length;
  $('#btnQuickConfirmar').disabled = count === 0;
  $('#btnQuickConfirmar').textContent = `Confirmar seleccionadas (${count})`;
}
function pintarPagosRapidos() {
  const list = verLista;
  $('#quickPeriod').textContent = `${monthLabel(selectedMonth($('#fPeriodo').value, $('#fMes').value))} · ${list.length} miniaturas en el filtro actual`;
  $('#quickList').innerHTML = list.length ? list.map(m => {
    const p = pagoDe(m), own = miConfirmacion(p), disabled = p?.monto == null || own;
    return `<label class="quick-payment-item">
      <input type="checkbox" name="miniatura" value="${m.id}" ${own ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <img src="${esc(imgUrl(m.imagen_path))}" alt="" loading="lazy">
      <span class="quick-payment-text"><b>${esc(m.titulo)}</b><small>${esc(m.cliente)} · ${p?.monto != null ? money(p.monto) : 'Sin monto'}</small><small>${estadoConfirmacion(p)}${versionesDe(m).length>1 ? ' · '+versionesDe(m).length+' versiones' : ''}</small></span>
    </label>`;
  }).join('') : '<p class="muted">No hay miniaturas en el filtro actual.</p>';
  $('#btnQuickTodas').disabled = !$('#quickList').querySelector('input:not(:disabled)');
  contarSeleccionadas();
}
$('#btnPagoRapido').addEventListener('click', async e => {
  const btn=e.target;btn.disabled=true;
  try {
    await cargar(); if (!user) return;
    $('#quickError').hidden=true; pintarPagosRapidos(); $('#dlgPagoRapido').showModal();
  } finally {btn.disabled=false;}
});
$('#quickList').addEventListener('change',contarSeleccionadas);
$('#btnQuickTodas').addEventListener('click', () => {
  const boxes=[...$('#quickList').querySelectorAll('input:not(:disabled)')];
  const select=boxes.some(b=>!b.checked); boxes.forEach(b=>b.checked=select); contarSeleccionadas();
});
$('#quickForm').addEventListener('submit', async e => {
  e.preventDefault(); const btn=$('#btnQuickConfirmar'); btn.disabled=true;
  $('#quickError').hidden=true; let completed=0;
  const ids=[...$('#quickList').querySelectorAll('input[name=miniatura]:checked:not(:disabled)')].map(b=>b.value);
  const selection=ids.map(id=>({id,revision:pagoDe(items.find(m=>m.id===id))?.revision}));
  $('#btnQuickTodas').disabled=true; $('#quickList').querySelectorAll('input').forEach(b=>b.disabled=true);
  try {
    for (let start=0;start<selection.length;start+=40) {
      const result=await api('/pagos/confirmar', {method:'POST',body:{items:selection.slice(start,start+40),confirmed:true}});
      completed+=result.count;
    }
    $('#dlgPagoRapido').close(); await cargar();
  } catch(error) {
    await cargar(); pintarPagosRapidos();
    mostrarError('#quickError',(completed ? `Se confirmaron ${completed} miniaturas. ` : '')+error.message);
  } finally {contarSeleccionadas();}
});
function actualizarAlVolver() {
  if (user && !document.hidden && !document.querySelector('dialog[open]')) {
    if (rol === 'encargado' && !selectedDesigner) cargarDisenadores();
    else cargar();
  }
}
setInterval(actualizarAlVolver,15000);
window.addEventListener('focus',actualizarAlVolver);
document.addEventListener('visibilitychange',actualizarAlVolver);

/* ---------- formulario de miniatura (diseñador) ---------- */
const form = $('#form');
let draftVersions = [];
function limpiarVersiones() {
  draftVersions.forEach(v => {if(v.file)URL.revokeObjectURL(v.src);}); draftVersions = [];
}
function pintarVersiones() {
  $('#versionCount').textContent = `${draftVersions.length} / 10 versiones · La primera es la portada`;
  $('#versionPreviews').innerHTML = draftVersions.map((v,index)=>`<div class="version-preview"><div class="version-preview-image"><img src="${esc(v.src)}" alt="Versión ${index+1}"><span>${index===0 ? 'Portada · V1' : 'V'+(index+1)}</span></div><div class="version-preview-actions">${index>0 ? `<button type="button" class="btn ghost" data-cover="${index}">Usar de portada</button>` : ''}<button type="button" class="btn danger" data-remove-version="${index}" aria-label="Quitar versión ${index+1}">Quitar</button></div></div>`).join('');
}
function agregarVersiones(files) {
  if (draftVersions.length + files.length > 10) return mostrarError('#formError','Puedes guardar hasta 10 versiones por miniatura.');
  if (files.some(file => !file.type.startsWith('image/'))) return mostrarError('#formError','Selecciona únicamente imágenes.');
  if (files.some(file => file.size > 20*1024*1024)) return mostrarError('#formError','Cada imagen debe pesar menos de 20 MB.');
  $('#formError').hidden = true;
  draftVersions.push(...files.map(file => ({file,src:URL.createObjectURL(file)}))); pintarVersiones();
}
$('#versionPreviews').addEventListener('click', e => {
  const remove=e.target.closest('[data-remove-version]'), cover=e.target.closest('[data-cover]');
  if (remove) {const [version]=draftVersions.splice(Number(remove.dataset.removeVersion),1);if(version.file)URL.revokeObjectURL(version.src);pintarVersiones();}
  if (cover) {const [version]=draftVersions.splice(Number(cover.dataset.cover),1);draftVersions.unshift(version);pintarVersiones();}
});
$('#dlgForm').addEventListener('close', limpiarVersiones);
function abrirForm(m) {
  form.reset(); $('#formError').hidden = true;
  $('#formTitulo').textContent = m ? 'Editar miniatura' : 'Nueva miniatura';
  $('#btnBorrar').hidden = !m;
  form.elements.namedItem('id').value = m?.id ?? ''; form.elements.namedItem('imagen_path').value = m?.imagen_path ?? '';
  form.elements.namedItem('cliente').value = m?.cliente ?? ''; form.elements.namedItem('titulo').value = m?.titulo ?? '';
  form.elements.namedItem('fecha').value = m?.fecha ?? localDateKey();
  form.elements.namedItem('revisiones').value = m?.revisiones ?? '';
  form.elements.namedItem('link_video').value = m?.link_video ?? ''; form.elements.namedItem('notas').value = m?.notas ?? '';
  limpiarVersiones();
  draftVersions = m ? versionesDe(m).map(id=>({id,src:imgUrl(id)})) : [];
  pintarVersiones();
  $('#dlgForm').showModal();
}
$('#btnNueva').addEventListener('click', () => abrirForm(null));
form.elements.namedItem('imagen').addEventListener('change', e => {agregarVersiones([...e.target.files]);e.target.value='';});
$('#dlgForm').addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])].filter(x => x.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault(); agregarVersiones(files);
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = form.querySelector('[type=submit]'); btn.disabled = true; $('#formError').hidden = true;
  try {
    if (!draftVersions.length) throw new Error('Agrega al menos una imagen de la miniatura.');
    const pending = [...draftVersions];
    const n = v => v === '' ? null : +v;
    const row = {
      cliente: form.elements.namedItem('cliente').value.trim(), titulo: form.elements.namedItem('titulo').value.trim(), fecha: form.elements.namedItem('fecha').value,
      revisiones: n(form.elements.namedItem('revisiones').value),
      link_video: form.elements.namedItem('link_video').value.trim() || null, notas: form.elements.namedItem('notas').value.trim() || null
    };
    const body = new FormData(); let uploadIndex = 0; row.versiones = [];
    for (const version of pending) {
      if (version.file) {
        row.versiones.push('new:'+uploadIndex++);
        body.append('imagenes', await optimizarImagen(version.file), 'version.webp');
      } else row.versiones.push(version.id);
    }
    body.set('datos', JSON.stringify(row));
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
