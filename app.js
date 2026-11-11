/* =====================================================================
   Consultorio Dr. Juan David Sánchez — v1
   Agenda · Pacientes · Historia clínica · Pagos · Procedimientos · Usuarios
   ===================================================================== */
const C = window.CONFIG;
const sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);

const S = { perfil: null, vista: 'agenda', fecha: hoyISO(), procs: [], perfiles: [] };

/* ---------- Utilidades ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pesos = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const nombre = (p) => p ? `${p.nombres} ${p.apellidos || ''}`.trim() : '—';
const ESTADOS = { pendiente: 'Pendiente', confirmada: 'Confirmada', reprogramar: 'Reprogramar', cancelada: 'Cancelada', atendida: 'Atendida', no_asistio: 'No asistió' };
const METODOS = { efectivo: 'Efectivo', nequi: 'Nequi', transferencia: 'Transferencia', tarjeta: 'Tarjeta', otro: 'Otro' };
const ROLES = { admin: 'Administrador', odontologo: 'Odontólogo', asistente: 'Asistente' };
const esAdmin = () => S.perfil?.rol === 'admin';
const esClinico = () => ['admin', 'odontologo'].includes(S.perfil?.rol);

function hoyISO(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
function horaLocal(iso) { return new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }); }
function fechaLarga(iso) { return new Date(iso).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }); }
function fechaCorta(v) { return new Date(v.length === 10 ? v + 'T12:00' : v).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }); }
function fechaHora(iso) { return new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function horaInput(iso) { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function edad(fn) {
  if (!fn) return '';
  const n = new Date(fn + 'T12:00'), h = new Date();
  let e = h.getFullYear() - n.getFullYear();
  if (h < new Date(h.getFullYear(), n.getMonth(), n.getDate())) e--;
  return `${e} años`;
}
function telWA(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('3')) d = '57' + d;
  return d;
}
function formData(form) {
  const o = {};
  new FormData(form).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; });
  $$('input[type=checkbox]', form).forEach((c) => { o[c.name] = c.checked; });
  Object.keys(o).forEach((k) => { if (o[k] === '') o[k] = null; });
  return o;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}
function err(e) { console.error(e); toast('Error: ' + (e?.message || e)); }

function abrirModal(titulo, html) {
  $('#modal-titulo').textContent = titulo;
  $('#modal-cuerpo').innerHTML = html;
  $('#modal').classList.remove('hidden');
  return $('#modal-cuerpo');
}
function confirmar(msg) {
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'modal confirmar';
    d.innerHTML = `<div class="modal-card" style="max-width:380px"><p style="margin:0 0 14px">${esc(msg)}</p>
      <div class="acciones"><button class="btn" data-r="0">Cancelar</button><button class="btn primario" data-r="1">Sí, continuar</button></div></div>`;
    d.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { d.remove(); resolve(b.dataset.r === '1'); }));
    document.body.appendChild(d);
  });
}
function cerrarModal() { $('#modal').classList.add('hidden'); $('#modal-cuerpo').innerHTML = ''; }
$('#modal-cerrar').onclick = cerrarModal;
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') cerrarModal(); });

/* ---------- Auth ---------- */
let registrando = false;
$('#login-nombre').textContent = C.CONSULTORIO;
$('#login-esp').textContent = C.ESPECIALIDAD;
$('#app-nombre').textContent = C.CONSULTORIO;

$('#toggle-registro').onclick = (e) => {
  e.preventDefault();
  registrando = !registrando;
  $('#campo-nombre').classList.toggle('hidden', !registrando);
  $('#btn-login').textContent = registrando ? 'Crear cuenta' : 'Entrar';
  e.target.textContent = registrando ? 'Ya tengo cuenta, entrar' : '¿No tienes cuenta? Regístrate';
};

$('#form-login').onsubmit = async (e) => {
  e.preventDefault();
  const f = formData(e.target);
  $('#login-msg').textContent = '';
  const { error } = registrando
    ? await sb.auth.signUp({ email: f.email, password: f.password, options: { data: { nombre: f.nombre || '' } } })
    : await sb.auth.signInWithPassword({ email: f.email, password: f.password });
  if (error) $('#login-msg').textContent = error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos' : error.message;
  else if (registrando) $('#login-msg').textContent = 'Cuenta creada. Si te pide confirmar el correo, revisa tu bandeja.';
};
$$('[data-salir]').forEach((b) => (b.onclick = () => sb.auth.signOut()));

sb.auth.onAuthStateChange((_ev, session) => { setTimeout(() => arrancar(session), 0); });

async function arrancar(session) {
  ['#vista-login', '#vista-pendiente', '#app'].forEach((s) => $(s).classList.add('hidden'));
  if (!session) { $('#vista-login').classList.remove('hidden'); return; }
  const { data: perfil } = await sb.from('perfiles').select('*').eq('id', session.user.id).maybeSingle();
  if (!perfil || !perfil.activo) { $('#vista-pendiente').classList.remove('hidden'); return; }
  S.perfil = perfil;
  $('#app-usuario').textContent = `${perfil.nombre || perfil.email} · ${ROLES[perfil.rol]}`;
  $$('#tabs [data-rol]').forEach((b) => b.classList.toggle('hidden', b.dataset.rol === 'admin' && !esAdmin()));
  $('#app').classList.remove('hidden');
  await cargarCatalogos();
  ir(S.vista);
}

async function cargarCatalogos() {
  const [p, u] = await Promise.all([
    sb.from('procedimientos').select('*').order('nombre'),
    sb.from('perfiles').select('id,nombre,email,rol,activo').order('nombre'),
  ]);
  S.procs = p.data || []; S.perfiles = u.data || [];
}

/* ---------- Navegación ---------- */
$$('#tabs button').forEach((b) => (b.onclick = () => ir(b.dataset.vista)));
function ir(vista, extra) {
  S.vista = vista;
  $$('#tabs button').forEach((b) => b.classList.toggle('activo', b.dataset.vista === vista));
  const main = $('#contenido');
  main.innerHTML = '<p class="vacio">Cargando…</p>';
  ({ agenda: vAgenda, pacientes: vPacientes, ficha: vFicha, pagos: vPagos, procedimientos: vProcedimientos, usuarios: vUsuarios }[vista])(main, extra).catch(err);
}

/* =====================================================================
   AGENDA
   ===================================================================== */
async function vAgenda(main) {
  const sel = new Date(S.fecha + 'T12:00');
  const lunes = new Date(sel); lunes.setDate(sel.getDate() - ((sel.getDay() + 6) % 7));
  const dias = [...Array(7)].map((_, i) => { const d = new Date(lunes); d.setDate(lunes.getDate() + i); return d; });
  const ini = new Date(hoyISO(dias[0]) + 'T00:00'), fin = new Date(hoyISO(dias[6]) + 'T23:59:59');

  const { data: semana, error } = await sb.from('citas')
    .select('id,inicio,fin,estado,motivo,paciente_id,recordatorio_enviado_at,pacientes(nombres,apellidos,telefono),procedimientos(nombre)')
    .gte('inicio', ini.toISOString()).lte('inicio', fin.toISOString()).order('inicio');
  if (error) throw error;

  const delDia = semana.filter((c) => hoyISO(new Date(c.inicio)) === S.fecha);
  const activas = delDia.filter((c) => !['cancelada', 'no_asistio'].includes(c.estado));
  const conteo = (d) => semana.filter((c) => hoyISO(new Date(c.inicio)) === hoyISO(d) && c.estado !== 'cancelada').length;

  main.innerHTML = `
    <div class="barra">
      <div class="grupo">
        <button class="btn sm" id="sem-ant">‹</button>
        <input type="date" id="fecha-sel" value="${S.fecha}" style="width:auto;margin:0" />
        <button class="btn sm" id="sem-sig">›</button>
        <button class="btn sm" id="ir-hoy">Hoy</button>
      </div>
      <button class="btn primario" id="nueva-cita">+ Nueva cita</button>
    </div>
    <div class="semana">
      ${dias.map((d) => `<button class="dia ${hoyISO(d) === S.fecha ? 'sel' : ''} ${hoyISO(d) === hoyISO() ? 'hoy' : ''}" data-f="${hoyISO(d)}">
        <small>${d.toLocaleDateString('es-CO', { weekday: 'short' }).replace('.', '')}</small><b>${d.getDate()}</b><i>${conteo(d) || ''}</i></button>`).join('')}
    </div>
    <div class="barra"><h2>${cap(fechaLarga(S.fecha + 'T12:00'))}</h2>
      <span class="muted">${activas.length} cita${activas.length === 1 ? '' : 's'} · ${delDia.filter((c) => c.estado === 'confirmada').length} confirmadas</span></div>
    <div id="lista-citas">
      ${delDia.length ? delDia.map(htmlCita).join('') : '<div class="vacio card">No hay citas este día.</div>'}
    </div>`;

  const mover = (n) => { const d = new Date(S.fecha + 'T12:00'); d.setDate(d.getDate() + n); S.fecha = hoyISO(d); ir('agenda'); };
  $('#sem-ant').onclick = () => mover(-7);
  $('#sem-sig').onclick = () => mover(7);
  $('#ir-hoy').onclick = () => { S.fecha = hoyISO(); ir('agenda'); };
  $('#fecha-sel').onchange = (e) => { if (e.target.value) { S.fecha = e.target.value; ir('agenda'); } };
  $$('.dia', main).forEach((b) => (b.onclick = () => { S.fecha = b.dataset.f; ir('agenda'); }));
  $('#nueva-cita').onclick = () => modalCita();
  $$('.cita', main).forEach((el) => (el.onclick = () => detalleCita(el.dataset.id)));
}

function htmlCita(c) {
  return `<div class="cita ${c.estado}" data-id="${c.id}">
    <div class="hora">${horaLocal(c.inicio)}<small>${horaLocal(c.fin)}</small></div>
    <div class="quien"><b>${esc(nombre(c.pacientes))}</b><span>${esc(c.procedimientos?.nombre || c.motivo || 'Consulta')}${c.recordatorio_enviado_at ? ' · 📩 recordado' : ''}</span></div>
    <span class="chip ${c.estado}">${ESTADOS[c.estado]}</span>
  </div>`;
}

/* ---------- Buscador de pacientes reutilizable ---------- */
function buscadorPaciente(root, onPick) {
  const input = $('[name=buscar_paciente]', root), box = $('.sugerencias', root);
  let t;
  input.oninput = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { box.classList.add('hidden'); return; }
      const { data } = await sb.from('pacientes').select('id,nombres,apellidos,documento,telefono')
        .or(`nombres.ilike.%${q}%,apellidos.ilike.%${q}%,documento.ilike.%${q}%,telefono.ilike.%${q}%`).limit(8);
      box.innerHTML = (data || []).map((p) => `<div data-id="${p.id}">${esc(nombre(p))} <span class="muted">${esc(p.documento || p.telefono || '')}</span></div>`).join('')
        + `<div data-nuevo="1"><b>+ Crear paciente “${esc(q)}”</b></div>`;
      box.classList.remove('hidden');
      $$('div', box).forEach((d) => (d.onclick = () => {
        box.classList.add('hidden');
        if (d.dataset.nuevo) return modalPaciente(null, (p) => onPick(p), q);
        const p = data.find((x) => x.id === d.dataset.id); input.value = nombre(p); onPick(p);
      }));
    }, 250);
  };
}

/* ---------- Crear / editar cita ---------- */
function modalCita(cita = null, pacientePre = null) {
  let paciente = cita ? { id: cita.paciente_id, ...cita.pacientes } : pacientePre;
  const durIni = cita ? Math.round((new Date(cita.fin) - new Date(cita.inicio)) / 60000) : 30;
  const root = abrirModal(cita ? 'Editar cita' : 'Nueva cita', `
    <form id="f-cita">
      <label>Paciente<input name="buscar_paciente" autocomplete="off" placeholder="Nombre, cédula o teléfono" value="${esc(paciente ? nombre(paciente) : '')}" ${cita ? 'disabled' : ''} /></label>
      <div class="sugerencias hidden"></div>
      <div class="grid2">
        <label>Fecha<input type="date" name="fecha" required value="${cita ? hoyISO(new Date(cita.inicio)) : S.fecha}" /></label>
        <label>Hora<input type="time" name="hora" required step="900" value="${cita ? horaInput(cita.inicio) : '08:00'}" /></label>
      </div>
      <div class="grid2">
        <label>Procedimiento<select name="procedimiento_id"><option value="">— Consulta general —</option>
          ${S.procs.filter((p) => p.activo || p.id === cita?.procedimiento_id).map((p) => `<option value="${p.id}" data-dur="${p.duracion_min}" ${p.id === cita?.procedimiento_id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}
        </select></label>
        <label>Duración (min)<input type="number" name="duracion" min="5" step="5" value="${durIni}" /></label>
      </div>
      <label>Atiende<select name="profesional_id">
        ${S.perfiles.filter((u) => u.activo && u.rol !== 'asistente').map((u) => `<option value="${u.id}" ${(cita?.profesional_id || (esClinico() ? S.perfil.id : '')) === u.id ? 'selected' : ''}>${esc(u.nombre || u.email)}</option>`).join('')}
      </select></label>
      <label>Motivo / notas<textarea name="motivo" placeholder="Ej: dolor en cordal inferior derecha">${esc(cita?.motivo || '')}</textarea></label>
      <div class="acciones"><button type="button" class="btn" id="cancelar">Cancelar</button><button class="btn primario">Guardar</button></div>
    </form>`);
  if (!cita) buscadorPaciente(root, (p) => (paciente = p));
  $('[name=procedimiento_id]', root).onchange = (e) => { const d = e.target.selectedOptions[0]?.dataset.dur; if (d) $('[name=duracion]', root).value = d; };
  $('#cancelar', root).onclick = cerrarModal;
  $('#f-cita', root).onsubmit = async (e) => {
    e.preventDefault();
    if (!paciente?.id) return toast('Elige un paciente');
    const f = formData(e.target);
    const inicio = new Date(`${f.fecha}T${f.hora}`), fin = new Date(inicio.getTime() + (Number(f.duracion) || 30) * 60000);
    const { data: cruces } = await sb.from('citas').select('id').neq('estado', 'cancelada')
      .lt('inicio', fin.toISOString()).gt('fin', inicio.toISOString()).neq('id', cita?.id || '00000000-0000-0000-0000-000000000000');
    if (cruces?.length && !(await confirmar(`Ya hay ${cruces.length} cita(s) en ese horario. ¿Agendar de todas formas?`))) return;
    const reg = { paciente_id: paciente.id, inicio: inicio.toISOString(), fin: fin.toISOString(),
      procedimiento_id: f.procedimiento_id, profesional_id: f.profesional_id, motivo: f.motivo };
    if (cita && new Date(cita.inicio).getTime() !== inicio.getTime()) { reg.estado = 'pendiente'; reg.recordatorio_enviado_at = null; }
    const { error } = cita ? await sb.from('citas').update(reg).eq('id', cita.id) : await sb.from('citas').insert(reg);
    if (error) return err(error);
    cerrarModal(); toast(cita ? 'Cita actualizada' : 'Cita agendada');
    S.fecha = f.fecha; ir('agenda');
  };
}

/* ---------- Detalle de cita ---------- */
function msgRecordatorio(c) {
  return `Hola ${c.pacientes.nombres} 👋, te recordamos tu cita con el ${C.CONSULTORIO} el ${fechaLarga(c.inicio)} a las ${horaLocal(c.inicio)}.\n\nPor favor responde *SÍ* para confirmar o *NO* si necesitas reprogramar. ¡Gracias!`;
}
async function detalleCita(id) {
  const { data: c, error } = await sb.from('citas')
    .select('*,pacientes(nombres,apellidos,telefono),procedimientos(nombre)').eq('id', id).single();
  if (error) return err(error);
  const prof = S.perfiles.find((u) => u.id === c.profesional_id);
  const root = abrirModal('Cita', `
    <div class="ficha-head">
      <div><h3>${esc(nombre(c.pacientes))}</h3>
        <div class="muted">${cap(fechaLarga(c.inicio))} · ${horaLocal(c.inicio)} – ${horaLocal(c.fin)}</div>
        <div class="muted">${esc(c.procedimientos?.nombre || 'Consulta')}${prof ? ' · ' + esc(prof.nombre || prof.email) : ''}</div>
      </div>
      <span class="chip ${c.estado}">${ESTADOS[c.estado]}</span>
    </div>
    ${c.motivo ? `<p>${esc(c.motivo)}</p>` : ''}
    <label>Cambiar estado</label>
    <div class="estados">${Object.entries(ESTADOS).map(([k, v]) => `<button data-e="${k}" class="${k === c.estado ? 'activo' : ''}">${v}</button>`).join('')}</div>
    ${c.recordatorio_enviado_at ? `<p class="muted">📩 Recordatorio enviado el ${fechaHora(c.recordatorio_enviado_at)}</p>` : ''}
    <div class="acciones">
      ${esAdmin() ? '<button class="btn peligro" id="borrar">Eliminar</button>' : ''}
      <button class="btn" id="ver-pac">Ver paciente</button>
      <button class="btn" id="editar">Editar</button>
      ${c.pacientes?.telefono ? `<a class="btn wa" id="wa" target="_blank" rel="noopener" href="https://wa.me/${telWA(c.pacientes.telefono)}?text=${encodeURIComponent(msgRecordatorio(c))}">Recordar por WhatsApp</a>` : ''}
    </div>`);
  $$('.estados button', root).forEach((b) => (b.onclick = async () => {
    const extra = ['confirmada', 'cancelada', 'reprogramar'].includes(b.dataset.e) ? { respuesta_paciente_at: new Date().toISOString() } : {};
    const { error } = await sb.from('citas').update({ estado: b.dataset.e, ...extra }).eq('id', id);
    if (error) return err(error);
    cerrarModal(); toast('Estado: ' + ESTADOS[b.dataset.e]); ir('agenda');
  }));
  $('#editar', root).onclick = () => modalCita(c);
  $('#ver-pac', root).onclick = () => { cerrarModal(); ir('ficha', { id: c.paciente_id }); };
  const wa = $('#wa', root);
  if (wa) wa.onclick = async () => {
    await sb.from('citas').update({ recordatorio_enviado_at: new Date().toISOString() }).eq('id', id);
    setTimeout(() => { cerrarModal(); ir('agenda'); }, 300);
  };
  const borrar = $('#borrar', root);
  if (borrar) borrar.onclick = async () => {
    if (!(await confirmar('¿Eliminar esta cita? Mejor márcala como cancelada si quieres conservar el registro.'))) return;
    const { error } = await sb.from('citas').delete().eq('id', id);
    if (error) return err(error);
    cerrarModal(); toast('Cita eliminada'); ir('agenda');
  };
}

/* =====================================================================
   PACIENTES
   ===================================================================== */
async function vPacientes(main) {
  main.innerHTML = `
    <div class="barra">
      <input id="buscar" placeholder="Buscar por nombre, cédula o teléfono" style="max-width:420px;margin:0" />
      <button class="btn primario" id="nuevo">+ Nuevo paciente</button>
    </div>
    <div class="card"><ul class="lista" id="lista"></ul></div>`;
  const pintar = async (q = '') => {
    let query = sb.from('pacientes').select('id,nombres,apellidos,documento,telefono,fecha_nacimiento').order('nombres').limit(60);
    if (q) query = query.or(`nombres.ilike.%${q}%,apellidos.ilike.%${q}%,documento.ilike.%${q}%,telefono.ilike.%${q}%`);
    const { data, error } = await query;
    if (error) return err(error);
    $('#lista').innerHTML = data.length ? data.map((p) => `<li class="click" data-id="${p.id}">
        <div><b>${esc(nombre(p))}</b><div class="sub">${esc([p.documento, p.telefono, edad(p.fecha_nacimiento)].filter(Boolean).join(' · '))}</div></div><span class="muted">›</span></li>`).join('')
      : '<li class="vacio">No hay pacientes todavía.</li>';
    $$('#lista li[data-id]').forEach((li) => (li.onclick = () => ir('ficha', { id: li.dataset.id })));
  };
  let t; $('#buscar').oninput = (e) => { clearTimeout(t); t = setTimeout(() => pintar(e.target.value.trim()), 250); };
  $('#nuevo').onclick = () => modalPaciente(null, (p) => ir('ficha', { id: p.id }));
  await pintar();
}

function modalPaciente(p = null, onSave, nombrePre = '') {
  const v = (k) => esc(p?.[k] ?? '');
  const root = abrirModal(p ? 'Editar paciente' : 'Nuevo paciente', `
    <form id="f-pac">
      <div class="grid2">
        <label>Nombres*<input name="nombres" required value="${p ? v('nombres') : esc(nombrePre)}" /></label>
        <label>Apellidos<input name="apellidos" value="${v('apellidos')}" /></label>
      </div>
      <div class="grid3">
        <label>Tipo doc.<select name="tipo_documento">${['CC', 'TI', 'RC', 'CE', 'PA', 'PPT'].map((t) => `<option ${p?.tipo_documento === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Documento<input name="documento" value="${v('documento')}" /></label>
        <label>Nacimiento<input type="date" name="fecha_nacimiento" value="${v('fecha_nacimiento')}" /></label>
      </div>
      <div class="grid2">
        <label>WhatsApp<input name="telefono" inputmode="tel" placeholder="3001234567" value="${v('telefono')}" /></label>
        <label>Sexo<select name="sexo"><option value="">—</option>${['Femenino', 'Masculino', 'Otro'].map((s) => `<option ${p?.sexo === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      </div>
      <div class="grid2">
        <label>Correo<input type="email" name="email" value="${v('email')}" /></label>
        <label>EPS<input name="eps" value="${v('eps')}" /></label>
      </div>
      <div class="grid2">
        <label>Dirección<input name="direccion" value="${v('direccion')}" /></label>
        <label>Ocupación<input name="ocupacion" value="${v('ocupacion')}" /></label>
      </div>
      <div class="grid2">
        <label>Contacto de emergencia<input name="contacto_emergencia" value="${v('contacto_emergencia')}" /></label>
        <label>Tel. emergencia<input name="telefono_emergencia" value="${v('telefono_emergencia')}" /></label>
      </div>
      <label>Notas<textarea name="notas">${v('notas')}</textarea></label>
      <label class="check"><input type="checkbox" name="autoriza_datos" ${p?.autoriza_datos ? 'checked' : ''} />
        El paciente autoriza el tratamiento de sus datos personales (Ley 1581 de 2012) y recibir recordatorios por WhatsApp.</label>
      <div class="acciones"><button type="button" class="btn" id="cancelar">Cancelar</button><button class="btn primario">Guardar</button></div>
    </form>`);
  $('#cancelar', root).onclick = cerrarModal;
  $('#f-pac', root).onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    if (f.autoriza_datos && !p?.autoriza_datos) f.fecha_autorizacion = new Date().toISOString();
    if (!f.autoriza_datos) f.fecha_autorizacion = null;
    const q = p ? sb.from('pacientes').update(f).eq('id', p.id) : sb.from('pacientes').insert(f);
    const { data, error } = await q.select().single();
    if (error) return err(error.code === '23505' ? 'Ya existe un paciente con ese documento' : error);
    cerrarModal(); toast('Paciente guardado'); onSave?.(data);
  };
}

/* ---------- Ficha del paciente ---------- */
async function vFicha(main, { id, tab = 'datos' } = {}) {
  const { data: p, error } = await sb.from('pacientes').select('*').eq('id', id).single();
  if (error) throw error;
  let anam = null;
  if (esClinico()) ({ data: anam } = await sb.from('anamnesis').select('*').eq('paciente_id', id).maybeSingle());
  const tabs = [['datos', 'Datos'], ...(esClinico() ? [['historia', 'Historia clínica']] : []), ['citas', 'Citas'], ['cuenta', 'Cuenta']];

  main.innerHTML = `
    <button class="btn ghost sm" id="volver">‹ Pacientes</button>
    <div class="ficha-head" style="margin-top:8px">
      <div><h2>${esc(nombre(p))}</h2>
        <div class="muted">${esc([p.tipo_documento + ' ' + (p.documento || '—'), edad(p.fecha_nacimiento), p.eps].filter(Boolean).join(' · '))}</div></div>
      <div class="grupo" style="display:flex;gap:6px;flex-wrap:wrap">
        ${p.telefono ? `<a class="btn wa" href="https://wa.me/${telWA(p.telefono)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        <button class="btn primario" id="agendar">+ Cita</button>
      </div>
    </div>
    ${anam?.alergias ? `<div class="alerta">⚠ Alergias: ${esc(anam.alergias)}</div>` : ''}
    <div class="subtabs">${tabs.map(([k, v]) => `<button data-t="${k}" class="${k === tab ? 'activo' : ''}">${v}</button>`).join('')}</div>
    <div id="tab"></div>`;
  $('#volver').onclick = () => ir('pacientes');
  $('#agendar').onclick = () => modalCita(null, p);
  $$('.subtabs button').forEach((b) => (b.onclick = () => ir('ficha', { id, tab: b.dataset.t })));
  const cont = $('#tab');
  if (tab === 'datos') tabDatos(cont, p);
  if (tab === 'historia') await tabHistoria(cont, p, anam);
  if (tab === 'citas') await tabCitas(cont, p);
  if (tab === 'cuenta') await tabCuenta(cont, p);
}

function tabDatos(cont, p) {
  const d = (l, v) => `<div class="dato"><small>${l}</small>${esc(v || '—')}</div>`;
  cont.innerHTML = `<div class="card">
    <div class="grid2">
      ${d('Teléfono / WhatsApp', p.telefono)}${d('Correo', p.email)}
      ${d('Fecha de nacimiento', p.fecha_nacimiento ? fechaCorta(p.fecha_nacimiento) : '')}${d('Sexo', p.sexo)}
      ${d('Dirección', p.direccion)}${d('Ocupación', p.ocupacion)}
      ${d('Contacto de emergencia', p.contacto_emergencia)}${d('Tel. emergencia', p.telefono_emergencia)}
    </div>
    ${d('Notas', p.notas)}
    <div class="dato"><small>Autorización de datos</small>${p.autoriza_datos ? '✅ Autorizó el ' + fechaCorta(p.fecha_autorizacion) : '❌ Pendiente'}</div>
    <div class="acciones"><button class="btn" id="editar">Editar datos</button></div></div>`;
  $('#editar', cont).onclick = () => modalPaciente(p, () => ir('ficha', { id: p.id }));
}

async function tabHistoria(cont, p, anam) {
  const { data: notas, error } = await sb.from('evoluciones').select('*').eq('paciente_id', p.id).order('created_at', { ascending: false });
  if (error) throw error;
  const principales = notas.filter((n) => n.tipo === 'evolucion');
  const aclas = (id) => notas.filter((n) => n.referencia_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const quien = (uid) => { const u = S.perfiles.find((x) => x.id === uid); return u ? (u.nombre || u.email) : ''; };
  const campo = (l, v) => (v ? `<p><b>${l}</b><br>${esc(v)}</p>` : '');
  const htmlNota = (n) => `<div class="nota ${n.tipo}">
      <div class="nota-head"><span>${n.tipo === 'aclaracion' ? 'Nota aclaratoria · ' : ''}${fechaHora(n.created_at)}</span><span>${esc(quien(n.profesional_id))}</span></div>
      ${campo('Motivo de consulta', n.motivo_consulta)}${campo('Hallazgos / examen', n.hallazgos)}${campo('Diagnóstico', n.diagnostico)}
      ${campo('Procedimiento realizado', n.procedimiento)}${campo('Plan de tratamiento', n.plan_tratamiento)}
      ${n.tipo === 'evolucion' ? `<div class="acciones"><button class="btn sm" data-acl="${n.id}">+ Aclaración</button></div>` : ''}
    </div>${n.tipo === 'evolucion' ? aclas(n.id).map(htmlNota).join('') : ''}`;
  const a = (k) => esc(anam?.[k] || '');
  cont.innerHTML = `
    <details class="card" ${anam ? '' : 'open'}>
      <summary><b>Anamnesis</b> <span class="muted">${anam ? '· actualizada ' + fechaCorta(anam.updated_at) : '· sin diligenciar'}</span></summary>
      <form id="f-anam" style="margin-top:12px">
        <label>Alergias<textarea name="alergias">${a('alergias')}</textarea></label>
        <label>Medicamentos actuales<textarea name="medicamentos">${a('medicamentos')}</textarea></label>
        <label>Antecedentes médicos<textarea name="antecedentes_medicos">${a('antecedentes_medicos')}</textarea></label>
        <label>Antecedentes odontológicos<textarea name="antecedentes_odontologicos">${a('antecedentes_odontologicos')}</textarea></label>
        <label>Hábitos<textarea name="habitos" placeholder="Tabaquismo, bruxismo…">${a('habitos')}</textarea></label>
        <div class="acciones"><button class="btn primario">Guardar anamnesis</button></div>
      </form>
    </details>
    <div class="barra"><h2>Evoluciones</h2><button class="btn primario" id="nueva-evol">+ Nueva evolución</button></div>
    ${principales.length ? principales.map(htmlNota).join('') : '<div class="vacio card">Sin evoluciones registradas.</div>'}
    <p class="muted" style="font-size:13px">Las evoluciones no se pueden editar ni borrar (Res. 1995/1999). Para corregir, agrega una nota aclaratoria.</p>`;

  $('#f-anam', cont).onsubmit = async (e) => {
    e.preventDefault();
    const f = { ...formData(e.target), paciente_id: p.id, updated_at: new Date().toISOString(), updated_by: S.perfil.id };
    const { error } = await sb.from('anamnesis').upsert(f);
    if (error) return err(error);
    toast('Anamnesis guardada'); ir('ficha', { id: p.id, tab: 'historia' });
  };
  $('#nueva-evol', cont).onclick = () => modalEvolucion(p);
  $$('[data-acl]', cont).forEach((b) => (b.onclick = () => modalEvolucion(p, b.dataset.acl)));
}

async function modalEvolucion(p, referencia = null) {
  let citasHoy = [];
  if (!referencia) {
    const ini = new Date(); ini.setHours(0, 0, 0, 0); const fin = new Date(ini); fin.setDate(fin.getDate() + 1);
    ({ data: citasHoy } = await sb.from('citas').select('id,inicio,procedimientos(nombre)').eq('paciente_id', p.id)
      .gte('inicio', new Date(ini.getTime() - 7 * 864e5).toISOString()).lt('inicio', fin.toISOString()).order('inicio', { ascending: false }));
  }
  const root = abrirModal(referencia ? 'Nota aclaratoria' : 'Nueva evolución', `
    <form id="f-evol">
      ${referencia ? '<p class="muted">Escribe la corrección o información adicional. La nota original no se modifica.</p>' : `
      <label>Cita relacionada<select name="cita_id"><option value="">— Ninguna —</option>
        ${(citasHoy || []).map((c) => `<option value="${c.id}">${fechaHora(c.inicio)} · ${esc(c.procedimientos?.nombre || 'Consulta')}</option>`).join('')}</select></label>
      <label>Motivo de consulta<textarea name="motivo_consulta"></textarea></label>`}
      <label>Hallazgos / examen clínico<textarea name="hallazgos"></textarea></label>
      <label>Diagnóstico<textarea name="diagnostico"></textarea></label>
      <label>Procedimiento realizado<textarea name="procedimiento"></textarea></label>
      <label>Plan de tratamiento / indicaciones<textarea name="plan_tratamiento"></textarea></label>
      ${!referencia ? '<label class="check"><input type="checkbox" name="marcar_atendida" checked /> Marcar la cita como atendida</label>' : ''}
      <div class="acciones"><button type="button" class="btn" id="cancelar">Cancelar</button><button class="btn primario">Guardar</button></div>
    </form>`);
  $('#cancelar', root).onclick = cerrarModal;
  $('#f-evol', root).onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const marcar = f.marcar_atendida; delete f.marcar_atendida;
    if (!Object.entries(f).some(([k, v]) => v && k !== 'cita_id')) return toast('Escribe al menos un campo');
    if (!(await confirmar('Una vez guardada, la nota no se podrá editar ni borrar. ¿Guardar?'))) return;
    const reg = { ...f, paciente_id: p.id, profesional_id: S.perfil.id, tipo: referencia ? 'aclaracion' : 'evolucion', referencia_id: referencia };
    const { error } = await sb.from('evoluciones').insert(reg);
    if (error) return err(error);
    if (marcar && f.cita_id) await sb.from('citas').update({ estado: 'atendida' }).eq('id', f.cita_id);
    cerrarModal(); toast('Nota guardada'); ir('ficha', { id: p.id, tab: 'historia' });
  };
}

async function tabCitas(cont, p) {
  const { data, error } = await sb.from('citas').select('id,inicio,fin,estado,motivo,pacientes(nombres,apellidos),procedimientos(nombre)')
    .eq('paciente_id', p.id).order('inicio', { ascending: false });
  if (error) throw error;
  cont.innerHTML = data.length ? data.map((c) => htmlCita({ ...c, pacientes: { nombres: fechaCorta(c.inicio), apellidos: '' } })).join('')
    : '<div class="vacio card">Este paciente no tiene citas.</div>';
  $$('.cita', cont).forEach((el) => (el.onclick = () => detalleCita(el.dataset.id)));
}

async function tabCuenta(cont, p) {
  const [c, a] = await Promise.all([
    sb.from('cargos').select('*').eq('paciente_id', p.id).order('fecha', { ascending: false }),
    sb.from('abonos').select('*').eq('paciente_id', p.id).order('fecha', { ascending: false }),
  ]);
  if (c.error || a.error) throw c.error || a.error;
  const tc = c.data.reduce((s, x) => s + Number(x.valor), 0), ta = a.data.reduce((s, x) => s + Number(x.valor), 0), saldo = tc - ta;
  cont.innerHTML = `
    <div class="stats">
      <div class="stat"><span>Total tratamientos</span><b>${pesos(tc)}</b></div>
      <div class="stat"><span>Total abonado</span><b>${pesos(ta)}</b></div>
      <div class="stat"><span>Saldo pendiente</span><b class="valor ${saldo > 0 ? 'debe' : 'ok'}">${pesos(saldo)}</b></div>
    </div>
    <div class="barra"><h2>Movimientos</h2><div class="grupo">
      <button class="btn" id="cargo">+ Cobro</button><button class="btn primario" id="abono">+ Abono</button></div></div>
    <div class="card"><ul class="lista">
      ${[...c.data.map((x) => ({ ...x, _t: 'cargo' })), ...a.data.map((x) => ({ ...x, _t: 'abono' }))]
        .sort((x, y) => y.fecha.localeCompare(x.fecha) || y.created_at.localeCompare(x.created_at))
        .map((m) => `<li><div><b>${esc(m._t === 'cargo' ? m.descripcion : 'Abono · ' + METODOS[m.metodo])}</b>
          <div class="sub">${fechaCorta(m.fecha)}${m.nota ? ' · ' + esc(m.nota) : ''}</div></div>
          <div style="display:flex;gap:6px;align-items:center"><span class="valor ${m._t === 'abono' ? 'ok' : ''}">${m._t === 'abono' ? '−' : ''}${pesos(m.valor)}</span>
          ${esAdmin() ? `<button class="btn ghost sm" data-del="${m._t}:${m.id}" title="Eliminar">✕</button>` : ''}</div></li>`).join('')
        || '<li class="vacio">Sin movimientos.</li>'}
    </ul></div>`;
  $('#cargo', cont).onclick = () => modalCargo(p);
  $('#abono', cont).onclick = () => modalAbono(p, saldo);
  $$('[data-del]', cont).forEach((b) => (b.onclick = async () => {
    const [t, id] = b.dataset.del.split(':');
    if (!(await confirmar('¿Eliminar este movimiento?'))) return;
    const { error } = await sb.from(t === 'cargo' ? 'cargos' : 'abonos').delete().eq('id', id);
    if (error) return err(error);
    ir('ficha', { id: p.id, tab: 'cuenta' });
  }));
}

function modalCargo(p) {
  const root = abrirModal('Registrar cobro', `
    <form id="f-cargo">
      <label>Procedimiento<select name="procedimiento_id"><option value="">— Otro —</option>
        ${S.procs.filter((x) => x.activo).map((x) => `<option value="${x.id}" data-precio="${x.precio_base}" data-nombre="${esc(x.nombre)}">${esc(x.nombre)} · ${pesos(x.precio_base)}</option>`).join('')}</select></label>
      <label>Descripción*<input name="descripcion" required /></label>
      <div class="grid2">
        <label>Valor*<input type="number" name="valor" min="0" step="1000" required /></label>
        <label>Fecha<input type="date" name="fecha" value="${hoyISO()}" /></label>
      </div>
      <div class="acciones"><button type="button" class="btn" id="cancelar">Cancelar</button><button class="btn primario">Guardar</button></div>
    </form>`);
  $('[name=procedimiento_id]', root).onchange = (e) => {
    const o = e.target.selectedOptions[0];
    if (o.dataset.nombre) { $('[name=descripcion]', root).value = o.dataset.nombre; $('[name=valor]', root).value = o.dataset.precio; }
  };
  $('#cancelar', root).onclick = cerrarModal;
  $('#f-cargo', root).onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('cargos').insert({ ...formData(e.target), paciente_id: p.id });
    if (error) return err(error);
    cerrarModal(); toast('Cobro registrado'); ir('ficha', { id: p.id, tab: 'cuenta' });
  };
}

function modalAbono(p, saldo = 0) {
  const root = abrirModal('Registrar abono', `
    <form id="f-abono">
      <p class="muted">Saldo actual: <b>${pesos(saldo)}</b></p>
      <div class="grid2">
        <label>Valor*<input type="number" name="valor" min="1" step="1000" required value="${saldo > 0 ? saldo : ''}" /></label>
        <label>Método<select name="metodo">${Object.entries(METODOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      </div>
      <div class="grid2">
        <label>Fecha<input type="date" name="fecha" value="${hoyISO()}" /></label>
        <label>Nota<input name="nota" placeholder="Opcional" /></label>
      </div>
      <div class="acciones"><button type="button" class="btn" id="cancelar">Cancelar</button><button class="btn primario">Guardar</button></div>
    </form>`);
  $('#cancelar', root).onclick = cerrarModal;
  $('#f-abono', root).onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('abonos').insert({ ...formData(e.target), paciente_id: p.id });
    if (error) return err(error);
    cerrarModal(); toast('Abono registrado'); ir('ficha', { id: p.id, tab: 'cuenta' });
  };
}

/* =====================================================================
   PAGOS (resumen)
   ===================================================================== */
async function vPagos(main) {
  const h = new Date(), ini = hoyISO(new Date(h.getFullYear(), h.getMonth(), 1)), fin = hoyISO(new Date(h.getFullYear(), h.getMonth() + 1, 0));
  const [ab, ca, sal] = await Promise.all([
    sb.from('abonos').select('*,pacientes(nombres,apellidos)').gte('fecha', ini).lte('fecha', fin).order('fecha', { ascending: false }),
    sb.from('cargos').select('valor').gte('fecha', ini).lte('fecha', fin),
    sb.from('saldos_pacientes').select('*').gt('saldo', 0).order('saldo', { ascending: false }),
  ]);
  if (ab.error || ca.error || sal.error) throw ab.error || ca.error || sal.error;
  const recaudo = ab.data.reduce((s, x) => s + Number(x.valor), 0);
  const facturado = ca.data.reduce((s, x) => s + Number(x.valor), 0);
  const porCobrar = sal.data.reduce((s, x) => s + Number(x.saldo), 0);
  const porMetodo = Object.keys(METODOS).map((k) => [k, ab.data.filter((x) => x.metodo === k).reduce((s, x) => s + Number(x.valor), 0)]).filter(([, v]) => v);
  const mes = h.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

  main.innerHTML = `
    <h2 style="margin-bottom:12px">Pagos · ${mes}</h2>
    <div class="stats">
      <div class="stat"><span>Recaudado este mes</span><b>${pesos(recaudo)}</b></div>
      <div class="stat"><span>Tratamientos cobrados</span><b>${pesos(facturado)}</b></div>
      <div class="stat"><span>Por cobrar (total)</span><b class="valor debe">${pesos(porCobrar)}</b></div>
    </div>
    ${porMetodo.length ? `<div class="card"><b>Recaudo por método</b><ul class="lista">${porMetodo.map(([k, v]) => `<li><span>${METODOS[k]}</span><span class="valor">${pesos(v)}</span></li>`).join('')}</ul></div>` : ''}
    <div class="card"><b>Pacientes con saldo pendiente</b><ul class="lista">
      ${sal.data.map((s) => `<li class="click" data-id="${s.paciente_id}"><div><b>${esc(nombre(s))}</b><div class="sub">${esc(s.telefono || '')}</div></div><span class="valor debe">${pesos(s.saldo)}</span></li>`).join('') || '<li class="vacio">Nadie debe nada 🎉</li>'}
    </ul></div>
    <div class="card"><b>Abonos del mes</b><ul class="lista">
      ${ab.data.map((x) => `<li class="click" data-id="${x.paciente_id}"><div><b>${esc(nombre(x.pacientes))}</b><div class="sub">${fechaCorta(x.fecha)} · ${METODOS[x.metodo]}</div></div><span class="valor ok">${pesos(x.valor)}</span></li>`).join('') || '<li class="vacio">Sin abonos este mes.</li>'}
    </ul></div>`;
  $$('li[data-id]', main).forEach((li) => (li.onclick = () => ir('ficha', { id: li.dataset.id, tab: 'cuenta' })));
}

/* =====================================================================
   PROCEDIMIENTOS (admin)
   ===================================================================== */
async function vProcedimientos(main) {
  await cargarCatalogos();
  main.innerHTML = `
    <div class="barra"><h2>Procedimientos y precios</h2><button class="btn primario" id="nuevo">+ Nuevo</button></div>
    <div class="card"><ul class="lista">
      ${S.procs.map((p) => `<li class="click" data-id="${p.id}"><div><b>${esc(p.nombre)}</b> ${p.activo ? '' : '<span class="chip">Inactivo</span>'}
        <div class="sub">${p.duracion_min} min</div></div><span class="valor">${pesos(p.precio_base)}</span></li>`).join('') || '<li class="vacio">Sin procedimientos.</li>'}
    </ul></div>`;
  $('#nuevo').onclick = () => modalProc();
  $$('li[data-id]', main).forEach((li) => (li.onclick = () => modalProc(S.procs.find((p) => p.id === li.dataset.id))));
}

function modalProc(p = null) {
  const root = abrirModal(p ? 'Editar procedimiento' : 'Nuevo procedimiento', `
    <form id="f-proc">
      <label>Nombre*<input name="nombre" required value="${esc(p?.nombre || '')}" /></label>
      <div class="grid2">
        <label>Precio base<input type="number" name="precio_base" min="0" step="1000" value="${p?.precio_base ?? 0}" /></label>
        <label>Duración (min)<input type="number" name="duracion_min" min="5" step="5" value="${p?.duracion_min ?? 30}" /></label>
      </div>
      <label class="check"><input type="checkbox" name="activo" ${p?.activo !== false ? 'checked' : ''} /> Activo</label>
      <div class="acciones"><button type="button" class="btn" id="cancelar">Cancelar</button><button class="btn primario">Guardar</button></div>
    </form>`);
  $('#cancelar', root).onclick = cerrarModal;
  $('#f-proc', root).onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target); f.precio_base = Number(f.precio_base) || 0; f.duracion_min = Number(f.duracion_min) || 30;
    const { error } = p ? await sb.from('procedimientos').update(f).eq('id', p.id) : await sb.from('procedimientos').insert(f);
    if (error) return err(error);
    cerrarModal(); toast('Guardado'); ir('procedimientos');
  };
}

/* =====================================================================
   USUARIOS (admin)
   ===================================================================== */
async function vUsuarios(main) {
  await cargarCatalogos();
  main.innerHTML = `
    <h2 style="margin-bottom:6px">Usuarios</h2>
    <p class="muted">Cada persona se registra desde la pantalla de inicio con “Regístrate”. Aquí la activas y le asignas el rol.</p>
    <div class="card"><ul class="lista">
      ${S.perfiles.map((u) => `<li><div><b>${esc(u.nombre || '(sin nombre)')}</b> ${u.activo ? '' : '<span class="chip pendiente">Pendiente</span>'}<div class="sub">${esc(u.email)}</div></div>
        <div style="display:flex;gap:6px;align-items:center">
          <select data-rol="${u.id}" style="width:auto;margin:0" ${u.id === S.perfil.id ? 'disabled' : ''}>
            ${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${u.rol === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          ${u.id === S.perfil.id ? '' : `<button class="btn sm ${u.activo ? 'peligro' : 'primario'}" data-act="${u.id}" data-v="${!u.activo}">${u.activo ? 'Desactivar' : 'Activar'}</button>`}
        </div></li>`).join('')}
    </ul></div>
    <div class="card muted" style="font-size:14px">
      <b>Administrador:</b> todo. · <b>Odontólogo:</b> todo menos usuarios y precios. · <b>Asistente:</b> agenda, pacientes y pagos (no ve la historia clínica).
    </div>`;
  $$('[data-rol]', main).forEach((s) => (s.onchange = async () => {
    const { error } = await sb.from('perfiles').update({ rol: s.value }).eq('id', s.dataset.rol);
    if (error) return err(error); toast('Rol actualizado');
  }));
  $$('[data-act]', main).forEach((b) => (b.onclick = async () => {
    const { error } = await sb.from('perfiles').update({ activo: b.dataset.v === 'true' }).eq('id', b.dataset.act);
    if (error) return err(error); ir('usuarios');
  }));
}
