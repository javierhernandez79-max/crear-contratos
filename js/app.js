import * as db from './db.js';
import { TEMPLATES, CLAUSES, CATEGORIES } from './templates.js';
import {
  uid, VAR_TYPES, slugify, humanize, newContractFromTemplate, syncVarDefs, usedVariables, fill,
  missingVariables, contentHash, changedSinceSigned, addVersion, layoutSections, ordinal, restoreVersion, logChange, duplicateContract,
  contractToTemplate, fmtDateTime, fmtRelative, formatValue, canonicalText, brokenEfirmas, hasEfirma, todayISO,
} from './model.js';
import {
  PARTY_KINDS, newParty, newApoderado, newAccionista, partyGaps, declaracionesText, applyParty, matchesQuery, fmtLongDate, rfcDuplicado, DATOS_PARTE } from './parties.js';
import { catalogToXlsx, xlsxToCatalog } from './catalog-xlsx.js';
import * as dbx from './dropbox.js';
import * as sync from './sync.js';
import * as ds from './docusign.js';
import { verifySignature, base64ToBlob } from './efirma.js';
import { buildPdf, shareOrDownload, download } from './pdf.js';
import { buildDocxBlob, buildErroresDocxBlob } from './docx-export.js';
import { moldeDocx } from './molde.js';
import { plantillaDesdeWord, leerWord, marcarWord, contarCampos } from './plantilla-word.js';
import { planAlta } from './alta-pdf.js';
import { subcarpetaDe, subcarpetaLote, duenoCarpeta } from './carpetas.js';
import { propagarPartes } from './propagar.js';
import { P1_COLUMNS, DATE_KEYS, PERIODICIDADES, readP1, normalizeRow, toISODate, p1Final, toBase64, fromBase64, validateWorkers, isLoteTemplate, tipoDePlantilla, esComision, usaColumna, TIPO_LOTE, workerContract, fileNameFor } from './lote.js';
import { buildZip } from './zip.js';
import { readSugerido, candidatos, mejorCoincidencia, listaServicios, isServiciosTemplate, parecido, nucleo, esContratoServicios, codigoFormato, ordenFormato, formatosDelCliente, formatoFijo, formatoOcupado, conflictoFormato } from './servicios.js';
import { DIAS_DEFAULT, SEGUIMIENTO, listaVencimientos, porAtender, textoDias, PLAZO_FIRMA, plazoFirma, listaFirmasPendientes, firmasPorAtender } from './vencimientos.js';
import { TIPOS, pdfText, sinTexto, detectarTipo, extraer, lecturaPobre } from './extraccion.js';
import { estadoIA, cambiarIA, leerConIA, detectarCampos } from './ia.js';

// ---------- Estado ----------
const state = {
  contracts: [],
  userTemplates: [],
  parties: [],
  lotes: [],
  loteDraft: null,
  loteQuery: '',
  servDraft: null,
  vencFilter: 'atender',
  prefs: { anticipacion: DIAS_DEFAULT },
  partyFilter: 'todas',
  partyQuery: '',
  returnTo: null, // { contractId, signerId } al capturar una parte nueva desde un contrato
  current: null, // contrato abierto en el editor
  homeFilter: 'todos',
  homeQuery: '',
  tplCategory: 'todas',
  tplQuery: '',
  installPrompt: null,
};

// 'revision' ya no se usa (el flujo es Documento → Aprobación → Firma); los contratos viejos en revisión se leen como borrador
const STATUS = { borrador: 'Borrador', revision: 'Borrador', aprobado: 'Aprobado', final: 'Firmado' };
// Nombre para listas y archivos; el título (c.title) es el encabezado impreso del documento
const nombreDe = (c) => c.etiqueta || fill(c, c.title);
const statusBadge = (c) => `<span class="badge ${esc(c.status)}">${esc(STATUS[c.status] || c.status)}</span>`;

const app = document.getElementById('app');
const nav = document.getElementById('bottom-nav');

// ---------- Utilidades ----------
/** Envuelve un manejador asíncrono para que un error (p. ej. sin conexión al cargar un módulo) se avise y no quede mudo. */
/** Usuario de Dropbox conectado ('' si no hay); whoAmI lo nombra para historiales y mensajes. */
const cuenta = () => dbx.config()?.account?.name || '';
const whoAmI = () => cuenta() || 'este equipo';
const conAviso = (fn) => async (...args) => {
  try { return await fn(...args); } catch (err) { console.error(err); toast(err.message || 'Ocurrió un error', 'error'); }
};
/** Evita que un doble clic ejecute dos veces una acción que crea cosas (contratos, lotes). */
const enCurso = new Set();
const sinRepetir = (key, fn) => async (...args) => {
  if (enCurso.has(key)) return;
  enCurso.add(key);
  try { return await fn(...args); } finally { enCurso.delete(key); }
};
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
// Las plantillas de la app que tienen una versión modificada ("replaces") se muestran solo modificadas
const allTemplates = () => {
  const replaced = new Set(state.userTemplates.map((t) => t.replaces).filter(Boolean));
  return [...state.userTemplates, ...TEMPLATES.filter((t) => !replaced.has(t.id))];
};
const go = (hash) => { location.hash = hash; };

/** Word original del formato (molde) del contrato, o null si el contrato sale del generador de la app. */
const moldeDe = (c) => ((c.conMolde || c.formato) && allTemplates().find((t) => t.id === c.templateId)?.molde) || null;
/** Contrato que sale del molde pero cuya plantilla ya no está en este equipo (p. ej., falta sincronizar). */
const sinMolde = (c) => !!c.conMolde && !moldeDe(c);
/** Word del contrato: del molde del formato (conserva su estilo) o del generador de la app. */
async function wordDe(c, label = '', opts = {}) {
  if (c.conMolde) {
    const molde = moldeDe(c);
    if (!molde) throw new Error(`No está la plantilla del formato ${c.formato || ''} en este equipo; sincroniza e intenta de nuevo.`);
    return moldeDocx(c, molde, opts);
  }
  return buildDocxBlob(await loadDocx(), c, { label });
}
const avisoMolde = (c) => (c.conMolde
  ? `<div class="banner info">${icon('doc')} <span>${c.formato ? `Formato ${esc(c.formato)}` : 'Word de la plantilla'}: el Word sale del formato original (letra, márgenes y encabezados intactos) con los datos llenos. El texto de las cláusulas es fijo; el PDF se saca desde Word (Archivo › Guardar como › PDF).${sinMolde(c) ? ' <strong>Falta la plantilla en este equipo: sincroniza.</strong>' : ''}</span></div>`
  : '');

const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>',
  pdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 18v-6M9 15l3 3 3-3"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  library: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
  paperclip: '<path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- Toast, modal, confirmación ----------
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

function modal({ title, body, actions = [], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = `modal ${wide ? 'wide' : ''}`;
    dlg.innerHTML = `
      <form method="dialog" class="modal-inner">
        <header class="modal-head">
          <h2>${esc(title)}</h2>
          <button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon('x')}</button>
        </header>
        <div class="modal-body">${body}</div>
        ${actions.length ? `<footer class="modal-foot">${actions.map((a) =>
          `<button value="${esc(a.value)}" class="btn ${a.kind || ''}" ${a.formnovalidate ? 'formnovalidate' : ''}>${esc(a.label)}</button>`).join('')}</footer>` : ''}
      </form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => {
      const form = $('form', dlg);
      const data = Object.fromEntries(new FormData(form));
      resolve({ value: dlg.returnValue, data, dlg });
      dlg.remove();
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close('');
    });
    // Enter en un campo activa la acción principal, no el primer botón del formulario
    dlg.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      const scope = e.target.closest('details') || dlg;
      $('.btn.primary', scope)?.click();
    });
    dlg.showModal();
    onOpen?.(dlg);
  });
}

async function confirmDialog(title, text, okLabel = 'Confirmar', kind = 'danger') {
  const r = await modal({
    title,
    body: `<p>${esc(text)}</p>`,
    actions: [{ label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true }, { label: okLabel, value: 'ok', kind }],
  });
  return r.value === 'ok';
}

async function promptDialog(title, label, value = '', okLabel = 'Guardar') {
  const r = await modal({
    title,
    body: `<label class="field"><span>${esc(label)}</span><input name="v" value="${esc(value)}" required autofocus></label>`,
    actions: [{ label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true }, { label: okLabel, value: 'ok', kind: 'primary' }],
  });
  return r.value === 'ok' ? r.data.v.trim() : null;
}

// ---------- Persistencia ----------
async function loadAll() {
  state.contracts = (await db.getAll('contracts')).sort((a, b) => b.updatedAt - a.updatedAt);
  state.userTemplates = (await db.getAll('templates')).sort((a, b) => b.createdAt - a.createdAt);
  state.parties = await db.getAll('parties');
  state.lotes = await db.getAll('lotes');
  // Contratos del Sugerido creados antes de separar etiqueta y título: el título largo salía como encabezado
  for (const c of state.contracts) {
    if (c.status === 'revision') c.status = 'borrador';
    if (!c.etiqueta && /^Contrato de Prestación de Servicios · .+ · .+/.test(c.title)) {
      c.etiqueta = c.title.replace(/^Contrato de Prestación de Servicios/, 'Prestación de servicios');
      c.title = 'Contrato de Prestación de Servicios';
      await saveContract(c);
    }
  }
  state.prefs = { anticipacion: DIAS_DEFAULT, ...((await db.get('meta', 'prefs')) || {}) };
}

async function saveContract(c) {
  c.updatedAt = Date.now();
  if (dbx.isConnected()) c.updatedBy = cuenta();
  await db.put('contracts', structuredClone(c));
  await sync.markDirty('contracts', c.id);
  scheduleSync();
  const i = state.contracts.findIndex((x) => x.id === c.id);
  if (i >= 0) state.contracts[i] = c; else state.contracts.unshift(c);
  state.contracts.sort((a, b) => b.updatedAt - a.updatedAt);
  updateVencBadge(); // el aviso de firma de servicios depende del estado del contrato
}

const setSaveStatus = (txt) => { const el = $('#save-status'); if (el) el.textContent = txt; };
let saveTimer = null;
let pendingSave = null;
function scheduleSave() {
  pendingSave = state.current;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}
async function saveNow() {
  clearTimeout(saveTimer);
  const c = pendingSave;
  pendingSave = null;
  if (!c) return;
  await saveContract(c);
  setSaveStatus('Guardado');
}

/** Llamar tras cualquier cambio del contrato abierto. */
function touched({ log, groupKey, content = true } = {}) {
  const c = state.current;
  if (log) logChange(c, log, groupKey);
  if (content && c.status !== 'borrador') {
    logChange(c, `El contrato pasó de "${STATUS[c.status]}" a borrador por una edición`);
    c.status = 'borrador';
    toast('El contrato volvió a borrador: hay que aprobarlo de nuevo');
    // Solo la etiqueta de estado: redibujar el encabezado sacaría el cursor del título si se está escribiendo ahí
    const badge = $('#editor-head .title-meta .badge');
    if (badge) badge.outerHTML = statusBadge(c); else renderEditorHeader();
  }
  setSaveStatus('Guardando…');
  scheduleSave();
  refreshSidePreview();
}

// ---------- Router ----------
function route(opts) {
  const y = opts?.keepScroll ? window.scrollY : null;
  const r = routeView();
  if (y !== null) Promise.resolve(r).then(() => window.scrollTo(0, y));
}

async function routeView() {
  const [, view, id, tab] = location.hash.split('/');
  saveNow();
  // Al salir de la ficha (o de cualquier pantalla) se copian a los contratos los datos del catálogo que cambiaron
  if (partesPorPropagar.size && !(view === 'catalogo' && id)) await propagarCatalogo();
  if (view === 'c' && id) return openEditor(id, tab || 'secciones');
  state.current = null;
  document.body.classList.remove('in-editor');
  if (view === 'plantillas') return renderTemplates();
  if (view === 'plantilla' && id) return renderTemplateEditor(id);
  if (view === 'catalogo') return id ? renderPartyEditor(id) : renderCatalog();
  if (view === 'lotes') return id === 'nuevo' ? renderNuevoLote() : id ? renderLote(id) : renderLotes();
  if (view === 'ajustes') return renderSettings();
  if (view === 'vencimientos') return renderVencimientos();
  if (view === 'servicios') return id ? renderServiciosRevision(id) : renderServicios();
  return renderHome();
}

function setNav(active) {
  $$('a', nav).forEach((a) => a.classList.toggle('active', a.dataset.nav === active));
  updateVencBadge();
}

// ---------- Servicios desde el Excel "Sugerido de conceptos" ----------
// Un contrato de prestación de servicios por empresa del grupo, para un mismo cliente.
function renderServicios() {
  setNav('home');
  const tpls = allTemplates().filter(isServiciosTemplate);
  const d = (state.servDraft ||= { fmt: {}, fecha: todayISO(), file: null, cliente: '', clienteModo: 'catalogo', clienteId: '', clienteApoId: '', manual: {}, empresas: [] });
  // Formatos: las plantillas de servicios con código (F1, F2…); mientras no haya ninguna, cualquier plantilla de servicios
  const conCodigo = tpls.filter(codigoFormato).sort(ordenFormato);
  const formatos = conCodigo.length ? conCodigo : tpls;
  const grupo = sortParties(state.parties.filter((p) => p.activa && p.propia));
  const todas = sortParties(state.parties.filter((p) => p.activa));
  const cliente = state.parties.find((p) => p.id === d.clienteId);
  const apoSelect = (p, sel, attr) => {
    const apos = p ? p.apoderados.filter((a) => a.nombre.trim()) : [];
    return `<select ${attr} ${p ? '' : 'disabled'}><option value="">${p ? (apos.length ? 'Elige…' : 'Sin apoderados en el catálogo') : '—'}</option>
      ${apos.map((a) => `<option value="${esc(a.id)}" ${a.id === sel ? 'selected' : ''}>${esc(a.nombre)}${a.vigente ? '' : ' (poder no vigente)'}</option>`).join('')}</select>`;
  };
  const clienteCands = d.cliente ? candidatos(d.cliente, todas, 0.3) : [];
  const clienteOpts = [...clienteCands.map((x) => x.p), ...todas.filter((p) => !clienteCands.some((x) => x.p === p))];
  // Datos del cliente capturado a mano: los que pide cualquiera de los formatos elegidos (o de todos, si aún no hay)
  const elegidos = formatos.filter((t) => Object.values(d.fmt).includes(t.id));
  const manualVars = [...new Map((elegidos.length ? elegidos : formatos).flatMap((t) => t.vars.filter(([k]) => k.startsWith('cliente_'))).map((v) => [v[0], v])).values()];
  // Quien tenga apoderados en el catálogo debe tener elegido quién firma
  const firmaOk = (p, apoId) => !p || !p.apoderados.some((a) => a.nombre.trim()) || !!apoId;
  const nCrear = new Set(d.empresas.map((e) => e.partyId || e.nombre)).size;
  const empresasOk = d.empresas.length && d.empresas.every((e) => e.partyId && firmaOk(state.parties.find((p) => p.id === e.partyId), e.apoId));
  // El nombre del Excel viene precargado en la captura manual aunque no se haya tocado el campo
  if (d.clienteModo === 'manual') d.manual.cliente_nombre ??= d.cliente;
  const fx = formatosServicios(d, formatos);
  const listo = empresasOk && fx.ok &&
    (d.clienteModo === 'catalogo' ? !!cliente && firmaOk(cliente, d.clienteApoId) : !!String(d.manual.cliente_nombre || '').trim());
  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow"><a href="#/">Contratos</a></p>
        <h1>Servicios desde Sugerido de conceptos</h1>
      </div>
    </header>
    <section class="card settings-block lote-form">
      <div class="row wrap">
        <label class="field"><span>Fecha de firma</span><input id="s-fecha" type="date" value="${esc(d.fecha)}"></label>
      </div>
      ${tpls.length ? (conCodigo.length ? '' : '<p class="warn-text small">Ninguna plantilla de servicios tiene código de formato (F1, F2…): se puede elegir cualquiera, pero no se aplica la regla de formatos por cliente.</p>') : '<p class="warn-text small">No hay plantilla de servicios con la variable {{servicios}}. Sincroniza para traer la plantilla marco actualizada.</p>'}
      <label class="btn">${icon('upload')} ${d.file ? `Cambiar Excel (${esc(d.file)})` : 'Subir Sugerido de conceptos'}<input type="file" id="s-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
      <p class="muted small">Arriba el nombre del cliente; abajo la tabla EMPRESA | CONCEPTO. Se crea un contrato por empresa del grupo con todos sus conceptos como objeto (sin la clave SAT). Los montos no se usan. A cada empresa se le asigna un formato; con un mismo cliente, cada empresa conserva su formato y un formato no se repite entre empresas.</p>
    </section>
    ${d.file ? `
      <h4 class="sub">Cliente${d.cliente ? ` <span class="muted small">(en el Excel: ${esc(d.cliente)})</span>` : ''}</h4>
      <section class="card settings-block">
        <div class="chips">
          <button type="button" class="chip ${d.clienteModo === 'catalogo' ? 'on' : ''}" data-modo="catalogo">Del catálogo</button>
          <button type="button" class="chip ${d.clienteModo === 'manual' ? 'on' : ''}" data-modo="manual">Capturar aquí (no se guarda en el catálogo)</button>
        </div>
        ${d.clienteModo === 'catalogo' ? `
          <div class="row wrap">
            <label class="field"><span>Cliente</span>
              <select id="s-cli"><option value="">Elige…</option>${clienteOpts.map((p) => `<option value="${esc(p.id)}" ${p.id === d.clienteId ? 'selected' : ''}>${esc(p.nombre)}${p.propia ? ' (empresa del grupo)' : ''}</option>`).join('')}</select></label>
            <label class="field"><span>Firma por el cliente</span>${apoSelect(cliente, d.clienteApoId, 'id="s-cli-apo"')}</label>
          </div>
          ${!clienteCands.length && d.cliente ? `<p class="warn-text small">No encontré en el catálogo nada parecido a “${esc(d.cliente)}”. Elígelo de la lista o captúralo aquí.</p>` : ''}` : `
          <div class="p1-grid full">${manualVars.map(([k, label, type]) => `
            <label class="field"><span>${esc(label.replace(/\s*\(El “?Cliente”?\)\s*$/i, ''))}</span>
              <input data-man="${k}" ${type === 'date' ? 'type="date"' : ''} value="${esc(d.manual[k] ?? (k === 'cliente_nombre' ? d.cliente : ''))}"></label>`).join('')}</div>`}
      </section>
      <h4 class="sub">Contratos a crear (${nCrear})</h4>
      ${d.empresas.length ? `
      <div class="card lotes-list serv-list">
        <div class="ll-row ll-head"><span>En el Excel</span><span>Empresa del grupo (prestador)</span><span>Firma</span><span>Formato</span><span>Servicios</span></div>
        ${d.empresas.map((e, i) => {
          const p = state.parties.find((x) => x.id === e.partyId);
          const repetida = d.empresas.findIndex((x) => x.partyId && x.partyId === e.partyId) < i;
          return `
        <div class="ll-row">
          <span><strong>${esc(e.nombre)}</strong>${d.empresas.findIndex((x) => x.partyId && x.partyId === e.partyId) < i ? '<span class="warn-text small">Misma empresa que otra fila: sus servicios van en un solo contrato</span>' : ''}${e.manual ? '<span class="muted small">Elegida a mano</span>' : e.score === 1 ? '<span class="ok-text small">Coincide</span>' : e.score ? `<span class="warn-text small">Parecido ${Math.round(e.score * 100)}%: revisa</span>` : '<span class="error-text small">Sin coincidencia: elígela</span>'}</span>
          <span><select data-emp="${i}"><option value="">Elige…</option>${grupo.map((g) => `<option value="${esc(g.id)}" ${g.id === e.partyId ? 'selected' : ''}>${esc(g.nombre)}</option>`).join('')}</select></span>
          <span>${apoSelect(p, e.apoId, `data-apo="${i}"`)}</span>
          <span>${repetida ? '<span class="muted small">El de arriba</span>' : formatoSelect(d, fx, e.partyId)}</span>
          <span class="small">${e.conceptos.map(esc).join('<br>')}</span>
        </div>`;
        }).join('')}
      </div>` : '<div class="banner warn">No encontré empresas con conceptos en el Excel.</div>'}
      <div class="row wrap lote-actions">
        <a class="btn ghost" href="#/" id="s-cancel">Cancelar</a>
        <button class="btn primary" id="s-create" ${listo ? '' : 'disabled'}>${icon('check')} Crear ${nCrear} contrato${nCrear === 1 ? '' : 's'}</button>
      </div>` : ''}`;

  const vigenteUnico = (p) => { const v = p?.apoderados.filter((a) => a.nombre.trim() && a.vigente) || []; return v.length === 1 ? v[0].id : ''; };
  $$('[data-fmt]').forEach((sel) => sel.addEventListener('change', () => { d.fmt[sel.dataset.fmt] = sel.value; renderServicios(); }));
  $('#s-fecha').addEventListener('change', (e) => { d.fecha = e.target.value; });
  $('#s-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const ExcelJS = await loadExcel();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const r = readSugerido(wb);
      if (r.error) return toast(r.error, 'error');
      d.file = f.name;
      d.cliente = r.cliente;
      d.manual = {};
      const m = r.cliente ? mejorCoincidencia(r.cliente, todas) : null;
      d.clienteId = m?.p.id || '';
      d.clienteApoId = vigenteUnico(m?.p);
      d.clienteModo = 'catalogo';
      d.empresas = r.empresas.map((emp) => {
        const best = mejorCoincidencia(emp.nombre, grupo);
        return { ...emp, partyId: best?.p.id || '', score: best?.score || 0, apoId: vigenteUnico(best?.p) };
      });
      renderServicios();
    } catch (err) {
      console.error(err);
      toast(`No se pudo leer el Excel: ${err.message}`, 'error');
    }
  });
  $$('[data-modo]').forEach((b) => b.addEventListener('click', () => { d.clienteModo = b.dataset.modo; renderServicios(); }));
  $('#s-cli')?.addEventListener('change', (e) => { d.clienteId = e.target.value; d.clienteApoId = vigenteUnico(state.parties.find((p) => p.id === d.clienteId)); renderServicios(); });
  $('#s-cli-apo')?.addEventListener('change', (e) => { d.clienteApoId = e.target.value; renderServicios(); });
  $$('[data-man]').forEach((inp) => inp.addEventListener('input', () => {
    d.manual[inp.dataset.man] = inp.value;
    if (inp.dataset.man === 'cliente_nombre') $('#s-create').disabled = !(empresasOk && fx.ok && inp.value.trim());
  }));
  // Con otro nombre de cliente cambian los formatos ya usados; solo se vuelve a dibujar si eso cambia algo
  // (si no, al pasar al siguiente campo se perdería lo que se está escribiendo)
  const firmaFx = (x) => JSON.stringify([d.fmt, [...x.filas].map(([id, f]) => [id, f.fijo?.formato, f.error, f.opciones.map((o) => o.motivo)])]);
  const antes = firmaFx(fx);
  $('[data-man="cliente_nombre"]')?.addEventListener('change', () => { if (firmaFx(formatosServicios(d, formatos)) !== antes) renderServicios(); });
  $$('[data-emp]').forEach((sel) => sel.addEventListener('change', () => {
    const e = d.empresas[Number(sel.dataset.emp)];
    e.partyId = sel.value;
    e.manual = !!sel.value;
    e.apoId = vigenteUnico(state.parties.find((p) => p.id === sel.value));
    renderServicios();
  }));
  $$('[data-apo]').forEach((sel) => sel.addEventListener('change', () => { d.empresas[Number(sel.dataset.apo)].apoId = sel.value; renderServicios(); }));
  $('#s-cancel')?.addEventListener('click', () => { state.servDraft = null; });
  $('#s-create')?.addEventListener('click', sinRepetir('servicios', crearServicios));
}

/** Filas del Excel que apuntan a la misma empresa del grupo se juntan en un solo contrato. */
function porEmpresa(empresas) {
  const m = new Map();
  for (const e of empresas) {
    const prev = m.get(e.partyId);
    if (!prev) m.set(e.partyId, { ...e, conceptos: [...e.conceptos] });
    else for (const c of e.conceptos) if (!prev.conceptos.includes(c)) prev.conceptos.push(c);
  }
  return [...m.values()];
}

/** Cliente del borrador de servicios: { id, nombre } o null. */
function clienteServicios(d) {
  if (d.clienteModo === 'catalogo') {
    const p = state.parties.find((x) => x.id === d.clienteId);
    return p ? { id: p.id, nombre: p.nombre } : null;
  }
  const nombre = String(d.manual.cliente_nombre ?? d.cliente ?? '').trim();
  return nombre ? { id: null, nombre } : null;
}

/**
 * Formato de cada empresa del borrador con la regla por cliente: la empresa que ya tiene formato con el
 * cliente lo conserva (fijo) y un formato no se repite entre empresas (ni con las de contratos anteriores
 * ni entre filas). Corrige `d.fmt` (partyId → plantilla) y devuelve { ok, filas: Map(partyId → fila) }.
 */
function formatosServicios(d, formatos) {
  const cliente = clienteServicios(d);
  const usados = cliente ? formatosDelCliente(state.contracts, cliente) : [];
  const ids = [...new Set(d.empresas.map((e) => e.partyId).filter(Boolean))];
  const tplDe = (id) => formatos.find((t) => t.id === d.fmt[id]);
  const filas = new Map();
  const tomados = new Map(); // código → fila
  for (const id of ids) {
    const pref = { id, nombre: state.parties.find((x) => x.id === id)?.nombre || '' };
    const fila = { pref, fijo: formatoFijo(usados, pref), error: '' };
    filas.set(id, fila);
    if (!fila.fijo) continue;
    const t = formatos.find((x) => codigoFormato(x) === fila.fijo.formato && x.id === fila.fijo.contrato.templateId)
      || formatos.find((x) => codigoFormato(x) === fila.fijo.formato);
    d.fmt[id] = t?.id || '';
    if (!t) fila.error = `Ya tiene el formato ${fila.fijo.formato} con este cliente y esa plantilla no está disponible.`;
    tomados.set(fila.fijo.formato, fila);
  }
  // Lo elegido a mano deja de valer si el formato ya es de otra empresa (p. ej., al cambiar de cliente)
  for (const id of ids) {
    const fila = filas.get(id);
    if (fila.fijo) continue;
    const cod = codigoFormato(tplDe(id));
    if (!tplDe(id) || (cod && (tomados.has(cod) || formatoOcupado(usados, cod, fila.pref)))) d.fmt[id] = '';
    else if (cod) tomados.set(cod, fila);
  }
  for (const id of ids) {
    const fila = filas.get(id);
    fila.opciones = formatos.map((t) => {
      const cod = codigoFormato(t);
      const hist = cod && formatoOcupado(usados, cod, fila.pref);
      const otra = cod && tomados.get(cod);
      return { t, motivo: hist ? `ya es de ${hist.prestador.nombre} con este cliente` : otra && otra !== fila ? `elegido para ${otra.pref.nombre}` : '' };
    });
    if (!d.fmt[id] && formatos.length === 1 && !fila.opciones[0].motivo) d.fmt[id] = formatos[0].id;
    if (!d.fmt[id] && !fila.error) fila.error = fila.opciones.some((o) => !o.motivo) ? 'Elige el formato' : 'No queda ningún formato libre para esta empresa con este cliente';
    else if (d.fmt[id]) fila.error = '';
  }
  return { ok: ids.length > 0 && ids.every((id) => d.fmt[id] && !filas.get(id).error), filas };
}

function formatoSelect(d, fx, partyId) {
  const fila = fx.filas.get(partyId);
  if (!fila) return '<span class="muted small">Elige la empresa</span>';
  // "Prestación de servicios · Formato 2" ya dice el formato: basta el código
  const label = (t) => (!codigoFormato(t) ? t.name : /formato/i.test(t.name) ? codigoFormato(t) : `${codigoFormato(t)} — ${t.name}`);
  return `<select data-fmt="${esc(partyId)}" ${fila.fijo ? 'disabled' : ''} aria-label="Formato">
      <option value="">Elige…</option>
      ${fila.opciones.map((o) => `<option value="${esc(o.t.id)}" ${o.t.id === d.fmt[partyId] ? 'selected' : ''} ${o.motivo ? 'disabled' : ''}>${esc(label(o.t))}${o.motivo ? ` (${esc(o.motivo)})` : ''}</option>`).join('')}
    </select>
    ${fila.fijo ? `<span class="muted small">Fijo: ya lo usa con este cliente</span>` : ''}
    ${fila.error && fila.error !== 'Elige el formato' ? `<span class="error-text small">${esc(fila.error)}</span>` : ''}`;
}

async function crearServicios() {
  const d = state.servDraft;
  if (!d) return;
  const cliente = d.clienteModo === 'catalogo' ? state.parties.find((p) => p.id === d.clienteId) : null;
  const cliApo = cliente?.apoderados.find((a) => a.id === d.clienteApoId) || null;
  if (d.clienteModo === 'manual' && !d.manual.cliente_nombre) d.manual.cliente_nombre = d.cliente;
  const clienteNombre = cliente?.nombre || d.manual.cliente_nombre;
  // La regla se revisa otra vez al crear: otro usuario pudo crear un contrato para el mismo cliente mientras tanto
  const tpls = allTemplates().filter(isServiciosTemplate);
  const conCodigo = tpls.filter(codigoFormato);
  const fx = formatosServicios(d, conCodigo.length ? conCodigo : tpls);
  if (!fx.ok) {
    toast('Revisa los formatos: cambiaron los contratos de este cliente.', 'error');
    return renderServicios();
  }
  const grupo = { id: uid(), cliente: clienteNombre, archivo: d.file };
  const creados = [];
  for (const e of porEmpresa(d.empresas)) {
    const p = state.parties.find((x) => x.id === e.partyId);
    const apo = p.apoderados.find((a) => a.id === e.apoId) || null;
    const c = newContractFromTemplate(allTemplates().find((t) => t.id === d.fmt[e.partyId]));
    applyParty(c, c.signers.find((s) => s.bind?.prefix === 'prestador'), p, apo);
    const sgC = c.signers.find((s) => s.bind?.prefix === 'cliente');
    if (cliente) applyParty(c, sgC, cliente, cliApo);
    else for (const [k, v] of Object.entries(d.manual)) if (k.startsWith('cliente_')) c.variables[k] = v;
    c.variables.servicios = listaServicios(e.conceptos);
    if (d.fecha) c.variables.fecha_firma = d.fecha;
    c.etiqueta = `Prestación de servicios · ${p.nombre} · ${clienteNombre}`;
    c.grupoServicios = grupo;
    syncVarDefs(c);
    logChange(c, `Creado desde el Sugerido de conceptos (${d.file}): ${e.conceptos.length} servicio${e.conceptos.length === 1 ? '' : 's'}${c.formato ? `; formato ${c.formato}` : ''}`);
    await saveContract(c);
    creados.push(c);
  }
  state.servDraft = null;
  toast(`${creados.length} contrato${creados.length === 1 ? '' : 's'} creado${creados.length === 1 ? '' : 's'} para ${clienteNombre}`, 'ok');
  go(`#/servicios/${grupo.id}`);
}

/** Revisión de los contratos creados juntos desde un Sugerido: se leen completos y se aprueban todos. */
function renderServiciosRevision(gid) {
  setNav('home');
  const list = state.contracts.filter((c) => c.grupoServicios?.id === gid).sort((a, b) => a.createdAt - b.createdAt);
  if (!list.length) { toast('No se encontraron esos contratos', 'error'); return go('#/'); }
  const g = list[0].grupoServicios;
  const pendientes = list.filter((c) => !['aprobado', 'final'].includes(c.status));
  const incompletos = pendientes.filter((c) => missingVariables(c).length).length;
  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow"><a href="#/">Contratos</a> · Sugerido de conceptos</p>
        <h1>${list.length} contrato${list.length === 1 ? '' : 's'} para ${esc(g.cliente)}</h1>
      </div>
    </header>
    ${incompletos ? `<div class="banner warn">${icon('alert')} <span>${incompletos === 1 ? 'Un contrato tiene' : `${incompletos} contratos tienen`} datos por completar; no se puede aprobar hasta llenarlos (botón “Editar”).</span></div>` : ''}
    ${pendientes.length
      ? `<div class="banner info">${icon('doc')} <span>Revisa cada contrato completo. Si alguno necesita cambios, ábrelo con “Editar”; al final, cualquier usuario puede aprobarlos.</span></div>`
      : `<div class="banner ok">${icon('check')} <span>Todos aprobados.${dbx.isConnected() ? ' El Word y el PDF finales están en la carpeta de cada contrato en Dropbox.' : ''}</span></div>`}
    ${list.map((c, i) => {
      const prest = c.variables.prestador_nombre || '';
      const faltan = missingVariables(c).length;
      return `
      <section class="serv-doc">
        <div class="serv-doc-head">
          <div><strong>${i + 1}. ${esc(prest)} ${formatoChip(c)}</strong>
            <span class="muted small">Firma: ${esc(c.variables.prestador_representante || 'sin representante')}${faltan ? ` · <span class="warn-text">${faltan} dato${faltan === 1 ? '' : 's'} por completar</span>` : ''}</span></div>
          <div class="row">${statusBadge(c)}<a class="btn sm" href="#/c/${c.id}/variables">${icon('pen')} Editar</a></div>
        </div>
        <div class="paper-wrap"><div class="paper full">${documentHTML(c)}</div></div>
      </section>`;
    }).join('')}
    <div class="row wrap lote-actions">
      <a class="btn ghost" href="#/">Volver a contratos</a>
      ${list.some((c) => ['aprobado', 'final'].includes(c.status)) ? `<button class="btn" id="sr-zip">${icon('download')} Descargar .zip (Word y PDF)</button>` : ''}
      ${pendientes.length ? `<button class="btn primary" id="sr-approve" ${incompletos ? 'disabled' : ''}>${icon('check')} Aprobar ${pendientes.length === list.length ? (list.length === 1 ? 'el contrato' : `los ${list.length} contratos`) : `los ${pendientes.length} pendientes`}</button>` : ''}
    </div>`;

  $('#sr-approve')?.addEventListener('click', async (e) => {
    if (!(await confirmDialog('Aprobar contratos', `Se generarán el Word y el PDF finales de ${pendientes.length} contrato${pendientes.length === 1 ? '' : 's'}${dbx.isConnected() ? ', se guardarán en Dropbox' : ''} y se descargará un .zip con todos.`, 'Aprobar', 'primary'))) return;
    e.target.disabled = true;
    let ok = 0;
    try {
      for (const c of pendientes) { await approveContract(c, { descargar: false }); ok++; }
      toast(`${ok} contrato${ok === 1 ? '' : 's'} aprobado${ok === 1 ? '' : 's'}`, 'ok');
    } catch (err) {
      console.error(err);
      toast(`No se pudo aprobar${ok ? ` (se aprobaron ${ok})` : ''}: ${err.message}`, 'error');
    }
    // El .zip lleva todos los aprobados del grupo, también los de un intento anterior que falló a medias
    if (ok) await conAviso(zipAprobados)(g, list);
    renderServiciosRevision(gid);
  });
  $('#sr-zip')?.addEventListener('click', conAviso(() => zipAprobados(g, list)));
}

async function zipAprobados(g, list) {
  const D = await loadDocx();
  const entries = [];
  for (const c of list.filter((x) => ['aprobado', 'final'].includes(x.status))) {
    for (const f of await finalFiles(c, D)) entries.push({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) });
  }
  download(new Blob([buildZip(entries)], { type: 'application/zip' }), `${safeName(`Servicios - ${g.cliente}`)}.zip`);
}

// ---------- Vencimientos ----------
const vencimientos = () => listaVencimientos(state.lotes, { hoy: todayISO(), anticipacion: state.prefs.anticipacion });

function updateVencBadge() {
  const dot = $('#venc-badge');
  if (!dot) return;
  const n = porAtender(vencimientos()).length + firmasPorAtender(firmasPend()).length;
  dot.textContent = n > 99 ? '99+' : n || '';
  dot.hidden = !n;
}

// Contratos de servicios: días hábiles desde que se generaron sin marcarse como firmados
const firmasPend = () => listaFirmasPendientes(state.contracts, { hoy: todayISO(), esServicios: esContratoServicios });

function firmaBanner() {
  const n = firmasPorAtender(firmasPend()).length;
  if (!n) return '';
  return `<a class="banner danger banner-link" href="#/vencimientos">${icon('bell')} <span>${n} contrato${n === 1 ? '' : 's'} de servicios con más de ${PLAZO_FIRMA} días hábiles sin firma del cliente.</span><strong>Ver</strong></a>`;
}

/** Etiqueta "N días háb. sin firma" para contratos de servicios no firmados. */
/** Código de formato (F1, F2…): solo en la app, nunca en el documento. */
const formatoChip = (c) => (c.formato ? `<span class="badge formato-chip" title="Formato del contrato (no aparece en el documento)">${esc(c.formato)}</span>` : '');

function plazoChip(c) {
  if (!esContratoServicios(c) || c.alertaFirma?.descartada) return '';
  const p = plazoFirma(c, todayISO());
  if (!p) return '';
  return `<span class="small ${p.atrasado ? 'warn-text' : 'muted'} plazo-chip" title="Generado el ${esc(fmtLongDate(p.inicio))}; el plazo de ${PLAZO_FIRMA} días hábiles se cumple el ${esc(fmtLongDate(p.limite))}">${p.habiles} día${p.habiles === 1 ? '' : 's'} háb. sin firma</span>`;
}

/** Nombre del cliente (contraparte) de un contrato de servicios. */
function clienteDe(c) {
  const sg = c.signers.find((s) => s.bind?.prefix === 'cliente') || c.signers.find((s) => s.party && !state.parties.find((p) => p.id === s.party.id)?.propia);
  if (!sg) return '';
  return state.parties.find((p) => p.id === sg.party?.id)?.nombre || fill(c, sg.name);
}

function vencBanner() {
  const pend = porAtender(vencimientos());
  if (!pend.length) return '';
  const venc = pend.filter((v) => v.nivel === 'vencido').length;
  return `<a class="banner ${venc ? 'danger' : 'warn'} banner-link" href="#/vencimientos">${icon('bell')} <span>${pend.length} contrato${pend.length === 1 ? '' : 's'} de trabajo por atender${venc ? ` (${venc} ya vencido${venc === 1 ? '' : 's'})` : ''}: vencen en los próximos ${state.prefs.anticipacion} días.</span><strong>Ver</strong></a>`;
}

function renderVencimientos() {
  setNav('vencimientos');
  const todos = vencimientos();
  const groups = {
    atender: porAtender(todos),
    vencidos: todos.filter((v) => !v.seguimiento && v.nivel === 'vencido'),
    vigentes: todos.filter((v) => !v.seguimiento),
    atendidos: todos.filter((v) => v.seguimiento),
  };
  const list = groups[state.vencFilter] || groups.atender;
  const firmas = firmasPend();
  const fg = {
    atrasados: firmasPorAtender(firmas),
    plazo: firmas.filter((x) => !x.atrasado && !x.descartada),
    descartados: firmas.filter((x) => x.descartada),
  };
  const flist = fg[state.firmaFilter || 'atrasados'] || fg.atrasados;
  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow">Alertas</p>
        <h1>Vencimientos</h1>
      </div>
    </header>
    <h2 class="section-title">Contratos de servicios sin firma del cliente</h2>
    <p class="muted small">Se cuentan los días hábiles (lunes a viernes, sin días de descanso obligatorio) desde que se generó el contrato. Pasados ${PLAZO_FIRMA} sin marcarse como firmado, se avisa.</p>
    <div class="toolbar">
      <div class="chips">
        ${[['atrasados', `Más de ${PLAZO_FIRMA} días hábiles`], ['plazo', 'En plazo'], ['descartados', 'Descartados']].map(([k, l]) =>
          `<button class="chip ${(state.firmaFilter || 'atrasados') === k ? 'on' : ''}" data-ff="${k}">${l} <span>${fg[k].length}</span></button>`).join('')}
      </div>
    </div>
    ${flist.length ? `
      <div class="card lotes-list firma-list">
        <div class="ll-row ll-head"><span>Contrato</span><span>Cliente</span><span>Generado</span><span>Días hábiles</span><span>Plazo</span><span></span></div>
        ${flist.map((x) => `
        <div class="ll-row ${x.atrasado && !x.descartada ? 'v-vencido' : ''}" data-cid="${esc(x.c.id)}" tabindex="0" role="link">
          <span><strong>${esc(nombreDe(x.c))}</strong>${statusBadge(x.c)}</span>
          <span class="small">${esc(clienteDe(x.c)) || '<span class="muted">—</span>'}</span>
          <span>${esc(fmtLongDate(x.inicio))}</span>
          <span><span class="venc-dias">${x.habiles}</span></span>
          <span>${x.descartada
            ? `<span class="badge aprobado">Descartado</span><span class="muted small">${esc(x.descartada.by || '')}${x.descartada.nota ? ` · ${esc(x.descartada.nota)}` : ''}</span>`
            : `<span class="small">${x.atrasado ? 'Se cumplió' : 'Se cumple'} el ${esc(fmtLongDate(x.limite))}</span>`}</span>
          <span class="ll-acts">
            <button class="icon-btn sm" data-act="view" title="Abrir contrato" aria-label="Abrir contrato">${icon('eye')}</button>
            ${x.descartada
              ? `<button class="icon-btn sm" data-act="undo" title="Volver a avisar" aria-label="Volver a avisar">${icon('x')}</button>`
              : `<button class="icon-btn sm" data-act="discard" title="Descartar aviso" aria-label="Descartar aviso">${icon('check')}</button>`}
          </span>
        </div>`).join('')}
      </div>` : `<p class="empty-inline">${firmas.length ? 'Nada en esta vista.' : 'No hay contratos de servicios pendientes de firma.'}</p>`}
    <h2 class="section-title">Contratos de trabajo por tiempo determinado</h2>
    <div class="toolbar">
      <div class="chips">
        ${[['atender', `Por atender (${state.prefs.anticipacion} días)`], ['vencidos', 'Vencidos'], ['vigentes', 'Todos sin atender'], ['atendidos', 'Atendidos']].map(([k, l]) =>
          `<button class="chip ${state.vencFilter === k ? 'on' : ''}" data-vf="${k}">${l} <span>${groups[k].length}</span></button>`).join('')}
      </div>
      <a class="btn ghost sm" href="#/ajustes">Cambiar anticipación</a>
    </div>
    ${!todos.length ? `
      <section class="empty">
        <div class="empty-art">${icon('bell')}</div>
        <h2>Sin vencimientos</h2>
        <p>Aquí aparecen los trabajadores de los lotes aprobados por tiempo determinado, con la Fecha de Terminación del P1. Se avisa desde ${state.prefs.anticipacion} días antes.</p>
      </section>` : list.length ? `
      <div class="card lotes-list venc-list">
        <div class="ll-row ll-head"><span>Trabajador</span><span>Cliente</span><span>Empresa (patrón)</span><span>Termina</span><span>Estado</span><span></span></div>
        ${list.map((v) => `
        <div class="ll-row ${v.seguimiento ? '' : `v-${v.nivel}`}" data-lote="${v.loteId}" data-idx="${v.idx}" tabindex="0" role="link">
          <span><strong>${esc(v.nombre)}</strong><span class="muted small">${esc(v.puesto || '')}${v.curp ? ` · <span class="mono">${esc(v.curp)}</span>` : ''}</span></span>
          <span>${v.cliente ? esc(v.cliente) : '<span class="muted">—</span>'}</span>
          <span class="small">${esc(v.empresa)}</span>
          <span>${esc(fmtLongDate(v.fin))}</span>
          <span>${v.seguimiento
            ? `<span class="badge aprobado">${SEGUIMIENTO[v.seguimiento.estado]}</span><span class="muted small">${esc(v.seguimiento.by || '')}${v.seguimiento.nota ? ` · ${esc(v.seguimiento.nota)}` : ''}</span>`
            : `<span class="venc-dias">${textoDias(v.dias)}</span>`}</span>
          <span class="ll-acts">
            <button class="icon-btn sm" data-act="view" title="Ver lote" aria-label="Ver lote">${icon('eye')}</button>
            ${v.seguimiento
              ? `<button class="icon-btn sm" data-act="undo" title="Quitar seguimiento" aria-label="Quitar seguimiento">${icon('x')}</button>`
              : `<button class="icon-btn sm" data-act="done" title="Marcar como atendido" aria-label="Marcar como atendido">${icon('check')}</button>`}
          </span>
        </div>`).join('')}
      </div>` : '<p class="empty-inline">Nada en esta vista.</p>'}`;

  $$('[data-vf]').forEach((b) => b.addEventListener('click', () => { state.vencFilter = b.dataset.vf; renderVencimientos(); }));
  $$('[data-ff]').forEach((b) => b.addEventListener('click', () => { state.firmaFilter = b.dataset.ff; renderVencimientos(); }));
  $$('.firma-list .ll-row[data-cid]').forEach((row) => {
    const c = state.contracts.find((x) => x.id === row.dataset.cid);
    row.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'discard') return descartarAlertaFirma(c);
      if (act === 'undo') {
        delete c.alertaFirma;
        logChange(c, 'Volvió a activar el aviso de firma del cliente');
        await saveContract(c);
        updateVencBadge();
        return renderVencimientos();
      }
      go(`#/c/${c.id}/documento`);
    });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) go(`#/c/${c.id}/documento`); });
  });
  $$('.venc-list .ll-row[data-lote]').forEach((row) => {
    const l = state.lotes.find((x) => x.id === row.dataset.lote);
    const w = l?.trabajadores[Number(row.dataset.idx)];
    row.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'done') return atenderVencimiento(l, w);
      if (act === 'undo') {
        if (!(await confirmDialog('Quitar seguimiento', `${w.nombre} volverá a aparecer en los vencimientos por atender.`, 'Quitar', 'primary'))) return;
        delete w.seguimiento;
        await saveLote(l, `Quitó el seguimiento del vencimiento de ${w.nombre}`);
        return renderVencimientos();
      }
      go(`#/lotes/${l.id}`);
    });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) go(`#/lotes/${l.id}`); });
  });
}

async function descartarAlertaFirma(c) {
  const r = await modal({
    title: `Descartar aviso: ${nombreDe(c)}`,
    body: `
      <p class="muted">Si el cliente ya lo regresó firmado, mejor súbelo en Aprobación y firma → Firmado en papel. Descarta el aviso solo si el contrato ya no se va a firmar.</p>
      <label class="field"><span>Motivo</span><input name="nota" required placeholder="Ej. el cliente canceló el servicio"></label>`,
    actions: [{ label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true }, { label: 'Descartar aviso', value: 'ok', kind: 'primary' }],
  });
  if (r.value !== 'ok') return;
  c.alertaFirma = { descartada: true, nota: r.data.nota.trim(), by: whoAmI(), at: Date.now() };
  logChange(c, `Descartó el aviso de firma del cliente: ${c.alertaFirma.nota}`);
  await saveContract(c);
  updateVencBadge();
  toast('Aviso descartado', 'ok');
  renderVencimientos();
}

async function atenderVencimiento(l, w) {
  const r = await modal({
    title: `Vencimiento: ${w.nombre}`,
    body: `
      <p class="muted">Su contrato termina el ${esc(fmtLongDate(w.fin))}. Al marcarlo como atendido deja de aparecer en los avisos.</p>
      <label class="field"><span>¿Qué se hizo?</span>
        <select name="estado">${Object.entries(SEGUIMIENTO).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label class="field"><span>Nota (opcional)</span><input name="nota" placeholder="Ej. renovado por 3 meses en el lote de noviembre"></label>`,
    actions: [{ label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true }, { label: 'Marcar atendido', value: 'ok', kind: 'primary' }],
  });
  if (r.value !== 'ok') return;
  w.seguimiento = { estado: r.data.estado, nota: r.data.nota.trim(), by: whoAmI(), at: Date.now() };
  await saveLote(l, `Marcó el vencimiento de ${w.nombre} como ${SEGUIMIENTO[w.seguimiento.estado].toLowerCase()}`);
  toast('Vencimiento atendido', 'ok');
  renderVencimientos();
}

// ---------- Inicio: mis contratos ----------
function contractProgress(c) {
  const missing = missingVariables(c).length;
  // Firmas: las de DocuSign mientras el envío está abierto; firmado = todas
  const total = c.signers.length;
  const signed = c.status === 'final' ? total : (c.docusign?.recipients || []).filter((r) => r.status === 'completed').length;
  return { missing, signed, total };
}

function renderHome() {
  setNav('home');
  const q = state.homeQuery.toLowerCase();
  const list = state.contracts.filter((c) =>
    (state.homeFilter === 'todos' || c.status === state.homeFilter) &&
    (!q || nombreDe(c).toLowerCase().includes(q)));
  const counts = { todos: state.contracts.length };
  for (const k of Object.keys(STATUS)) counts[k] = state.contracts.filter((c) => c.status === k).length;

  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow">Crear Contratos</p>
        <h1>Mis contratos</h1>
      </div>
      <div class="row">
        <a href="#/servicios" class="btn hide-sm" title="Un contrato de prestación de servicios por empresa del grupo">${icon('upload')} Desde Sugerido de conceptos</a>
        <a href="#/plantillas" class="btn primary hide-sm">${icon('plus')} Nuevo contrato</a>
      </div>
    </header>
    ${vencBanner()}
    ${firmaBanner()}
    ${state.contracts.length ? `
      <div class="toolbar">
        <label class="search">${icon('search')}<input id="home-q" type="search" placeholder="Buscar contrato" value="${esc(state.homeQuery)}"></label>
        <div class="chips" role="tablist">
          ${[['todos', 'Todos'], ['borrador', 'Borradores'], ['aprobado', 'Aprobados'], ['final', 'Firmados']].map(([k, l]) =>
            `<button class="chip ${state.homeFilter === k ? 'on' : ''}" data-filter="${k}">${l} <span>${counts[k]}</span></button>`).join('')}
        </div>
      </div>
      ${list.length ? `
      <div class="card lotes-list contract-list">
        <div class="ll-row ll-head"><span>Contrato</span><span>Estado</span><span>Datos</span><span>Firmas</span><span>Actualizado</span><span></span></div>
        ${list.map(contractRow).join('')}
      </div>` : '<p class="empty-inline">No hay contratos que coincidan.</p>'}` : `
      <section class="empty">
        <div class="empty-art">${icon('doc')}</div>
        <h2>Crea tu primer contrato</h2>
        <p>Elige una plantilla, completa las variables y exporta un PDF listo para firmar. ${dbx.isConnected() ? 'Se comparte con tu equipo a través de Dropbox.' : 'Todo se guarda en este dispositivo hasta que conectes Dropbox en Ajustes.'}</p>
        <a href="#/plantillas" class="btn primary lg">${icon('plus')} Elegir plantilla</a>
      </section>`}
    <a href="#/plantillas" class="fab show-sm" aria-label="Nuevo contrato">${icon('plus')}</a>
  `;

  $('#home-q')?.addEventListener('input', (e) => {
    state.homeQuery = e.target.value;
    const pos = e.target.selectionStart;
    renderHome();
    const el = $('#home-q'); el.focus(); el.setSelectionRange(pos, pos);
  });
  $$('[data-filter]').forEach((b) => b.addEventListener('click', () => { state.homeFilter = b.dataset.filter; renderHome(); }));
  $$('.contract-list .ll-row[data-id]').forEach((row) => {
    const id = row.dataset.id;
    row.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return go(`#/c/${id}`);
      contractAction(act, state.contracts.find((c) => c.id === id));
    });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) go(`#/c/${id}`); });
  });
}

function contractRow(c) {
  const { missing, signed, total } = contractProgress(c);
  const tpl = allTemplates().find((t) => t.id === c.templateId);
  return `
        <div class="ll-row" data-id="${esc(c.id)}" tabindex="0" role="link">
          <span><strong>${esc(nombreDe(c))}</strong><span class="muted small">${esc(tpl?.name || 'Documento personalizado')}</span></span>
          <span>${statusBadge(c)}${formatoChip(c)}${plazoChip(c)}</span>
          <span>${missing ? `<span class="warn-text">${missing} por completar</span>` : '<span class="ok-text">Completos</span>'}</span>
          <span>${total ? `${signed}/${total}` : '<span class="muted">—</span>'}</span>
          <span class="small">${fmtRelative(c.updatedAt)}${c.updatedBy ? `<span class="muted">${esc(c.updatedBy)}</span>` : ''}</span>
          <span class="ll-acts">
            <button class="icon-btn sm" data-act="view" title="Visualizar" aria-label="Visualizar">${icon('eye')}</button>
            <button class="icon-btn sm" data-act="open" title="Editar" aria-label="Editar">${icon('pen')}</button>
            <button class="icon-btn sm" data-act="download" title="Descargar Word o PDF" aria-label="Descargar">${icon('download')}</button>
            <button class="icon-btn sm danger" data-act="del" title="Eliminar" aria-label="Eliminar">${icon('trash')}</button>
            <button class="icon-btn sm" data-act="menu" title="Más acciones" aria-label="Más acciones">${icon('more')}</button>
          </span>
        </div>`;
}

async function contractAction(act, c) {
  if (act === 'menu') {
    const r = await modal({
      title: nombreDe(c),
      body: `<div class="menu-list">
        <button value="open" class="menu-item">${icon('pen')} Abrir y editar</button>
        <button value="pdf" class="menu-item">${icon('pdf')} Exportar PDF</button>
        <button value="dup" class="menu-item">${icon('copy')} Duplicar</button>
        <button value="tpl" class="menu-item">${icon('library')} Guardar como plantilla</button>
        <button value="del" class="menu-item danger">${icon('trash')} Eliminar</button>
      </div>`,
    });
    if (r.value) return contractAction(r.value, c);
    return;
  }
  if (act === 'open') return go(`#/c/${c.id}`);
  if (act === 'view') {
    const r = await modal({ title: nombreDe(c), wide: true, body: `<div class="paper">${documentHTML(c)}</div>`,
      actions: [{ label: 'Cerrar', value: '', kind: 'ghost' }, { label: 'Exportar PDF', value: 'pdf', kind: 'ghost' }, { label: 'Abrir y editar', value: 'open', kind: 'primary' }] });
    if (r.value) return contractAction(r.value, c);
    return;
  }
  if (act === 'pdf') return exportPdf(c);
  if (act === 'word') return downloadWord(c);
  if (act === 'download') {
    const r = await modal({
      title: `Descargar: ${nombreDe(c)}`,
      body: `<p class="muted small">${['aprobado', 'final'].includes(c.status) ? 'Versión final.' : 'Sale marcado como borrador hasta que el contrato se apruebe.'}</p>
        <div class="menu-list">
          <button value="word" class="menu-item">${icon('doc')} Word (.docx)</button>
          <button value="pdf" class="menu-item">${icon('pdf')} PDF</button>
        </div>`,
    });
    if (r.value) return contractAction(r.value, c);
    return;
  }
  if (act === 'dup') {
    const copy = duplicateContract(c);
    await saveContract(copy);
    toast('Contrato duplicado', 'ok');
    return state.current ? go(`#/c/${copy.id}`) : renderHome();
  }
  if (act === 'tpl') {
    const name = await promptDialog('Guardar como plantilla', 'Nombre de la plantilla', fill(c, c.title));
    if (!name) return;
    const tpl = contractToTemplate(c, name);
    await db.put('templates', tpl);
    await sync.markDirty('templates', tpl.id);
    scheduleSync();
    state.userTemplates.unshift(tpl);
    toast('Plantilla guardada en "Mis plantillas"', 'ok');
    return;
  }
  if (act === 'del') {
    if (!(await confirmDialog('Eliminar contrato', `Se eliminará "${nombreDe(c)}" con todas sus versiones y firmas. Esta acción no se puede deshacer.`, 'Eliminar'))) return;
    await db.remove('contracts', c.id);
    await sync.markDeleted('contracts', c.id);
    scheduleSync();
    state.contracts = state.contracts.filter((x) => x.id !== c.id);
    toast('Contrato eliminado');
    if (state.current?.id === c.id) { state.current = null; go('#/'); } else renderHome();
  }
}

async function downloadWord(c) {
  try {
    download(await wordDe(c, c.status === 'aprobado' || c.status === 'final' ? '' : 'BORRADOR'), `${safeName(nombreDe(c))}.docx`);
    toast('Word descargado', 'ok');
  } catch (err) {
    console.error(err);
    toast(`No se pudo generar el Word: ${err.message}`, 'error');
  }
}

async function exportPdf(c) {
  if (c.conMolde) {
    if (await confirmDialog('PDF desde Word', `Este contrato usa el formato ${c.formato}: para conservar su letra y márgenes, el PDF se saca desde Word (Archivo › Guardar como › PDF). ¿Descargar el Word?`, 'Descargar Word', 'primary')) await downloadWord(c);
    return;
  }
  const missing = missingVariables(c);
  if (missing.length) {
    const ok = await confirmDialog('Faltan datos',
      `Hay ${missing.length} variable(s) sin completar. Aparecerán entre corchetes en el PDF. ¿Exportar de todos modos?`, 'Exportar', 'primary');
    if (!ok) return;
  }
  try {
    const { blob, filename } = buildPdf(c);
    const res = await shareOrDownload(blob, filename, nombreDe(c));
    if (res !== 'cancelled') {
      if (state.current?.id === c.id) touched({ log: 'Exportó el PDF', content: false });
      toast(res === 'shared' ? 'PDF compartido' : 'PDF descargado', 'ok');
    }
  } catch (err) {
    console.error(err);
    toast('No se pudo generar el PDF', 'error');
  }
}

// ---------- Plantillas ----------
function renderTemplates() {
  setNav('templates');
  const q = state.tplQuery.toLowerCase();
  const cats = [{ id: 'todas', label: 'Todas' }, ...(state.userTemplates.length ? [{ id: 'mis', label: 'Mis plantillas' }] : []), ...CATEGORIES];
  if (!cats.some((c) => c.id === state.tplCategory)) state.tplCategory = 'todas';
  // "Mis plantillas" son las propias (incluidas las marco), sea cual sea su categoría
  // Los formatos de servicios (F1, F2…) no se muestran: se usan por dentro desde el Sugerido de conceptos;
  // en la biblioteca queda la plantilla maestra
  const formatos = allTemplates().filter(codigoFormato);
  const list = allTemplates().filter((t) => (state.verFormatos || !codigoFormato(t)) &&
    (state.tplCategory === 'todas' || (state.tplCategory === 'mis' ? t.custom : t.category === state.tplCategory)) &&
    (!q || (t.name + ' ' + t.description).toLowerCase().includes(q)));

  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow">Biblioteca</p>
        <h1>Plantillas</h1>
      </div>
      <button class="btn primary" id="tpl-word">${icon('upload')} Subir Word</button>
    </header>
    <div class="toolbar">
      <label class="search">${icon('search')}<input id="tpl-q" type="search" placeholder="Buscar plantilla" value="${esc(state.tplQuery)}"></label>
      <div class="chips">
        ${cats.map((c) => `<button class="chip ${state.tplCategory === c.id ? 'on' : ''}" data-cat="${esc(c.id)}">${esc(c.label)}</button>`).join('')}
      </div>
    </div>
    ${list.length ? `
    <div class="card lotes-list tpl-list">
      <div class="ll-row ll-head"><span>Plantilla</span><span>Categoría</span><span>Secciones</span><span>Variables</span><span>Origen</span><span></span></div>
      ${list.map((t) => `
      <div class="ll-row" data-id="${esc(t.id)}" tabindex="0" role="button">
        <span><strong>${esc(t.name)}</strong><span class="muted small clamp">${esc(t.description)}</span></span>
        <span>${esc(CATEGORIES.find((c) => c.id === t.category)?.label || 'Mis plantillas')}</span>
        <span>${t.sections.length}</span>
        <span>${t.vars.length}</span>
        <span class="small">${t.replaces ? 'Modificada' : t.custom ? 'Propia' : '<span class="muted">Incluida</span>'}</span>
        <span class="ll-acts">
          <button class="icon-btn sm" data-act="view" title="Visualizar" aria-label="Visualizar">${icon('eye')}</button>
          <button class="icon-btn sm" data-act="edit" title="Editar plantilla" aria-label="Editar">${icon('pen')}</button>
          ${t.custom && !t.replaces
            ? `<button class="icon-btn sm danger" data-act="del" title="Eliminar plantilla" aria-label="Eliminar">${icon('trash')}</button>`
            : `<button class="icon-btn sm" disabled title="${t.replaces ? 'Es una modificación de una plantilla incluida: restáurala desde el editor' : 'Las plantillas incluidas no se eliminan'}" aria-label="No se puede eliminar">${icon('trash')}</button>`}
        </span>
      </div>`).join('')}
    </div>` : '<p class="empty-inline">Sin resultados.</p>'}
    ${formatos.length ? `<p class="muted small"><button class="link" id="tpl-fmt">${state.verFormatos ? 'Ocultar' : 'Ver'} los ${formatos.length} formatos de servicios</button> (no aparecen en la biblioteca; se asignan desde Servicios desde Sugerido de conceptos).</p>` : ''}
    <p class="disclaimer">Las plantillas son modelos generales de referencia y no sustituyen la asesoría de un abogado. Revisa que el contenido se ajuste a tu caso y a la legislación aplicable.</p>
  `;
  $('#tpl-q').addEventListener('input', (e) => {
    state.tplQuery = e.target.value;
    const pos = e.target.selectionStart;
    renderTemplates();
    const el = $('#tpl-q'); el.focus(); el.setSelectionRange(pos, pos);
  });
  $$('[data-cat]').forEach((b) => b.addEventListener('click', () => { state.tplCategory = b.dataset.cat; renderTemplates(); }));
  $('#tpl-fmt')?.addEventListener('click', () => { state.verFormatos = !state.verFormatos; renderTemplates(); });
  $('#tpl-word').addEventListener('click', conAviso(subirPlantillaWord));
  $$('.tpl-list .ll-row[data-id]').forEach((row) => {
    const t = allTemplates().find((x) => x.id === row.dataset.id);
    row.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'del') return deleteTemplate(t);
      if (act === 'edit') return editTemplate(t);
      previewTemplate(t);
    });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) previewTemplate(t); });
  });
}

async function previewTemplate(t) {
  const r = await modal({
    title: t.name,
    wide: true,
    body: `
      <p class="muted">${esc(t.description)}</p>
      <h4 class="sub">Secciones</h4>
      <ol class="tpl-sections">${t.sections.map((s) => `<li><strong>${esc(s.title)}</strong><span>${esc(s.body.slice(0, 140))}${s.body.length > 140 ? '…' : ''}</span></li>`).join('')}</ol>
      <h4 class="sub">Variables</h4>
      <div class="token-list">${t.vars.map(([k, l]) => `<span class="token" title="{{${esc(k)}}}">${esc(l)}</span>`).join('')}</div>`,
    actions: [
      ...(t.custom && !t.replaces ? [{ label: 'Eliminar plantilla', value: 'del', kind: 'ghost danger' }] : []),
      { label: 'Editar plantilla', value: 'edit', kind: 'ghost' },
      { label: 'Usar plantilla', value: 'use', kind: 'primary' },
    ],
  });
  if (r.value === 'edit') return editTemplate(t);
  if (r.value === 'use') {
    const c = newContractFromTemplate(t);
    await saveContract(c);
    go(`#/c/${c.id}/variables`);
    toast('Contrato creado. Empieza completando los datos.', 'ok');
  } else if (r.value === 'del') {
    await deleteTemplate(t);
  }
}

/** Nueva plantilla desde un Word con marcas {{dato}}: el Word se conserva tal cual y se llenan sus marcas. */
async function subirPlantillaWord() {
  const marcas = (lista) => lista.map(([k, l]) => `<li><code>{{cliente_${esc(k)}}}</code> ${esc(l)}</li>`).join('');
  const r = await modal({
    title: 'Subir Word como plantilla',
    wide: true,
    body: `
      <p class="muted small">Sube el contrato tal cual (lleno con un caso o con espacios en blanco): la IA detecta los datos que cambian y tú confirmas cuáles se vuelven campos. La letra, márgenes y encabezados se conservan. Si el Word ya trae marcas <code>{{dato}}</code>, se usan esas.</p>
      <label class="field"><span>Archivo Word (.docx)</span><input type="file" name="docx" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required></label>
      <div class="form-grid">
        <label class="field"><span>Nombre de la plantilla</span><input name="nombre" required maxlength="120" placeholder="Ej. Contrato de arrendamiento"></label>
        <label class="field"><span>Categoría</span><select name="categoria">${CATEGORIES.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select></label>
      </div>
      <details class="small">
        <summary>Marcar los datos a mano (sin IA)</summary>
        <p><b>Partes</b> (se llenan desde el catálogo): un prefijo por parte, el que quieras (<code>cliente</code>, <code>prestador</code>, <code>arrendador</code>…) seguido del dato. Con <code>{{prefijo_nombre}}</code> la app reconoce la parte y la agrega como firmante. Ejemplos con <code>cliente</code>:</p>
        <ul class="marcas">${marcas(DATOS_PARTE)}</ul>
        <p><b>Firma por DocuSign</b>: <code>{{_ds_cliente}}</code> donde va la firma de esa parte (queda invisible).</p>
        <p><b>Cualquier otro dato</b>: <code>{{monto_renta}}</code>, <code>{{fecha_inicio}}</code>… Si la clave dice fecha, monto, domicilio o correo, la app le da ese tipo.</p>
      </details>`,
    actions: [{ label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true }, { label: 'Crear plantilla', value: 'ok', kind: 'primary' }],
    onOpen: (dlg) => {
      const nombre = $('[name=nombre]', dlg);
      $('[name=docx]', dlg).addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (f && !nombre.value.trim()) nombre.value = f.name.replace(/\.docx$/i, '');
      });
    },
  });
  const file = r.data?.docx;
  if (r.value !== 'ok' || !file?.size) return;
  if (file.size > 10 * 1024 * 1024) return toast('El Word pasa de 10 MB', 'error');
  const nombre = String(r.data.nombre).trim();
  if (allTemplates().some((t) => t.name.toLowerCase() === nombre.toLowerCase())) return toast(`Ya existe una plantilla “${nombre}”`, 'error');
  let bytes = new Uint8Array(await file.arrayBuffer());
  const w = await leerWord(bytes);
  let ia = null;
  if (!w.marcas) {
    // Sin marcas: la IA propone los datos y el usuario confirma
    const e = await estadoIA(true);
    if (!e.activa) return toast(e.disponible ? 'El Word no tiene marcas {{dato}} y la lectura con IA está apagada: pide al administrador que la encienda (Ajustes → Lectura con IA) o marca los datos en el Word.' : 'El Word no tiene marcas {{dato}} y la detección con IA no está disponible aquí: marca los datos en el Word.', 'error');
    toast('Buscando los datos del Word con IA… puede tardar un minuto');
    const propuesta = await detectarCampos({ name: file.name, parrafos: w.parrafos });
    ia = await revisarCamposIA(propuesta, w.parrafos);
    if (!ia) return;
    bytes = await marcarWord(bytes, ia);
  }
  const { plantilla, avisos } = await plantillaDesdeWord(bytes, {
    nombre, categoria: r.data.categoria, archivo: file.name, id: `u-${uid()}`,
    ...(ia ? { etiquetas: Object.fromEntries(ia.campos.map((c) => [c.clave, [c.etiqueta, c.tipo]])), partes: Object.fromEntries(ia.partes.map((p) => [p.prefijo, p])) } : {}),
  });
  const ok = await modal({
    title: 'Revisa la plantilla',
    body: `
      <p><strong>${esc(nombre)}</strong>: ${plantilla.vars.length} dato${plantilla.vars.length === 1 ? '' : 's'}${plantilla.signers.length ? ` y ${plantilla.signers.length} firmante${plantilla.signers.length === 1 ? '' : 's'} (${plantilla.signers.map((s) => esc(s.role)).join(', ')})` : ''}.</p>
      ${plantilla.vars.length ? `<p class="muted small">${plantilla.vars.map(([k, l]) => `${esc(l)} <code>{{${esc(k)}}}</code>`).join(' · ')}</p>` : ''}
      ${avisos.map((a) => `<div class="banner warn">${icon('alert')} <span>${esc(a)}</span></div>`).join('')}`,
    actions: [{ label: 'Cancelar', value: '', kind: 'ghost' }, { label: 'Guardar plantilla', value: 'ok', kind: 'primary' }],
  });
  if (ok.value !== 'ok') return;
  await saveTemplate(plantilla);
  toast(`Plantilla “${nombre}” creada`, 'ok');
  state.tplCategory = 'mis';
  renderTemplates();
}

/** Revisión de los datos que propuso la IA: cada uno con casilla y etiqueta editable. Devuelve lo elegido o null. */
async function revisarCamposIA(prop, parrafosW) {
  const veces = contarCampos(parrafosW, prop.campos);
  const corto = (t) => (/^[_\s]+$/.test(t) ? 'espacio en blanco ____' : t.length > 70 ? `${t.slice(0, 67)}…` : t);
  const rolDe = (k) => prop.partes.find((p) => k.startsWith(`${p.prefijo}_`))?.rol;
  const r = await modal({
    title: 'Datos que encontró la IA',
    wide: true,
    body: `
      <p class="muted small">Cada dato marcado se vuelve un campo de la plantilla (el texto del Word se sustituye en todos los lugares indicados). Desmarca lo que sea texto fijo y corrige el nombre del campo si hace falta.</p>
      ${prop.partes.length ? `<p class="small"><strong>Partes:</strong> ${prop.partes.map((p) => `${esc(p.rol)}${prop.firmas.some((f) => f.prefijo === p.prefijo) ? '' : ' <span class="warn-text">(sin lugar de firma)</span>'}`).join(' · ')}</p>` : ''}
      <div class="ia-campos">
        ${prop.campos.map((c, i) => `
        <label class="ia-campo ${veces[i] ? '' : 'off'}">
          <input type="checkbox" name="c${i}" ${veces[i] ? 'checked' : 'disabled'}>
          <span class="grow">
            <input name="e${i}" value="${esc(c.etiqueta || c.clave)}" aria-label="Nombre del campo" ${veces[i] ? '' : 'disabled'} ${rolDe(c.clave) ? 'readonly title="Dato de la parte: se llena desde el catálogo"' : ''}>
            <span class="muted small">“${esc(corto(c.texto.trim()))}” · ${esc(VAR_TYPES[c.tipo] || 'Texto')}${rolDe(c.clave) ? ` · ${esc(rolDe(c.clave))}` : ''} · ${veces[i] ? `${veces[i]} ${veces[i] === 1 ? 'vez' : 'veces'}` : '<span class="warn-text">no se encontró en el Word</span>'}</span>
          </span>
        </label>`).join('')}
      </div>`,
    actions: [{ label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true }, { label: 'Usar estos campos', value: 'ok', kind: 'primary' }],
  });
  if (r.value !== 'ok') return null;
  const campos = prop.campos.map((c, i) => (r.data[`c${i}`] ? { ...c, etiqueta: String(r.data[`e${i}`] || c.etiqueta).trim() } : null)).filter(Boolean);
  if (!campos.length) { toast('No se eligió ningún campo', 'error'); return null; }
  return { ...prop, campos };
}

async function deleteTemplate(t) {
  if (!(await confirmDialog('Eliminar plantilla', `¿Eliminar "${t.name}"? Los contratos creados con ella no se modifican.`, 'Eliminar'))) return;
  await db.remove('templates', t.id);
  await sync.markDeleted('templates', t.id);
  scheduleSync();
  state.userTemplates = state.userTemplates.filter((x) => x.id !== t.id);
  renderTemplates();
}

// ---------- Editor ----------
const TABS = [
  ['secciones', 'Secciones'],
  ['variables', 'Variables'],
  ['vista', 'Vista previa'],
  ['documento', 'Aprobación y firma'],
  ['firmas', 'Firmantes'],
  ['anexos', 'Anexos'],
  ['versiones', 'Versiones'],
];

async function openEditor(id, tab) {
  if (state.current?.id !== id) {
    const c = state.contracts.find((x) => x.id === id) || (await db.get('contracts', id));
    if (!c) { toast('Contrato no encontrado', 'error'); return go('#/'); }
    state.current = c;
    syncVarDefs(c);
  }
  document.body.classList.add('in-editor');
  state.tab = TABS.some(([k]) => k === tab) ? tab : 'secciones';
  app.innerHTML = `
    <div class="editor">
      <header class="editor-head" id="editor-head"></header>
      <nav class="tabs" role="tablist">
        ${TABS.map(([k, l]) => `<a href="#/c/${id}/${k}" role="tab" class="tab ${state.tab === k ? 'on' : ''}" aria-selected="${state.tab === k}">${l}${k === 'variables' ? '<span class="tab-dot" id="missing-dot"></span>' : ''}</a>`).join('')}
      </nav>
      <div class="editor-body ${['secciones', 'variables'].includes(state.tab) ? 'with-side' : ''}">
        <main class="editor-main" id="tab-content"></main>
        <aside class="side-preview" aria-label="Vista previa en vivo">
          <div class="side-label">Vista previa en vivo</div>
          <div class="paper" id="side-paper"></div>
        </aside>
      </div>
    </div>`;
  renderEditorHeader();
  const focusVar = state.focusVar;
  state.focusVar = null;
  ({ secciones: renderSections, variables: () => renderVariables(focusVar), vista: renderPreviewTab, documento: renderDocumento, firmas: renderSigners, anexos: renderAnexos, versiones: renderVersions })[state.tab]();
  refreshSidePreview();
  window.scrollTo(0, 0);
}

function renderEditorHeader() {
  const c = state.current;
  const el = $('#editor-head');
  if (!c || !el) return;
  el.innerHTML = `
    <a href="#/" class="icon-btn" aria-label="Volver">${icon('back')}</a>
    <div class="title-wrap">
      <input id="doc-title" class="doc-title" value="${esc(c.title)}" aria-label="Título del contrato">
      <div class="title-meta">
        ${statusBadge(c)}
        ${formatoChip(c)}
        ${plazoChip(c)}
        <span id="save-status" class="muted small">Guardado</span>
      </div>
    </div>
    <a class="btn primary" href="#/c/${esc(c.id)}/documento">${icon('doc')}<span class="hide-xs">Aprobación y firma</span></a>
    <button class="icon-btn" id="btn-more" aria-label="Más acciones">${icon('more')}</button>`;
  $('#doc-title').addEventListener('input', (e) => {
    c.title = e.target.value;
    touched({ log: 'Cambió el título', groupKey: 'title' });
  });
  $('#btn-more').addEventListener('click', () => contractAction('menu', c));
  updateMissingDot();
}

function updateMissingDot() {
  const dot = $('#missing-dot');
  if (!dot || !state.current) return;
  const n = missingVariables(state.current).length;
  dot.textContent = n || '';
  dot.hidden = !n;
}

const refreshSidePreview = debounce(() => {
  const paper = $('#side-paper');
  if (paper && state.current && getComputedStyle(paper.parentElement).display !== 'none') {
    paper.innerHTML = documentHTML(state.current);
  }
  updateMissingDot();
}, 250);

/** Reemplaza el contenedor de la pestaña para no acumular listeners entre renders. */
function tabBox() {
  const old = $('#tab-content');
  const box = old.cloneNode(false);
  old.replaceWith(box);
  return box;
}

function documentHTML(c, { interactive = false } = {}) {
  const parts = (txt) => fill(c, txt, 'parts').map((p) =>
    p.var ? `<span class="v ${p.missing ? 'missing' : ''}" ${interactive ? `data-var="${esc(p.var)}" role="button" tabindex="0"` : ''}>${esc(p.text)}</span>` : esc(p.text)).join('');
  return `
    ${!['aprobado', 'final'].includes(c.status) ? `<div class="watermark">BORRADOR</div>` : ''}
    <h1 class="doc-h1">${parts(c.title)}</h1>
    ${layoutSections(c).map((l) => {
      const paras = l.s.body.split(/\n/).filter((p) => p.trim());
      const head = l.heading ? `<h2${l.texto ? ' class="center"' : ''}>${parts(l.heading)}</h2>` : '';
      return `
      <section class="doc-sec">
        ${head}
        ${paras.map((p, j) => `<p>${j === 0 && l.prefix ? `<b>${esc(l.prefix)}</b>` : ''}${parts(p)}</p>`).join('')}
      </section>`;
    }).join('')}
    ${c.signers.length ? `
      <div class="doc-signs">
        ${c.signers.map((sg) => `
          <div class="doc-sign">
            <div class="sig-img">${c.signatures[sg.id]?.type === 'efirma'
              ? `<div class="sig-efirma">Firmado electrónicamente<br>e.firma · Cert. ${esc(c.signatures[sg.id].info.certNumber)}</div>`
              : c.signatures[sg.id] ? `<img src="${esc(c.signatures[sg.id].image)}" alt="Firma">` : ''}</div>
            <div class="sig-line"></div>
            <strong>${parts(sg.name) || '&nbsp;'}</strong>
            <span>${esc(sg.role)}</span>
          </div>`).join('')}
      </div>` : ''}`;
}

// --- Pestaña: Secciones ---
let lastField = null;

function renderSections() {
  const c = state.current;
  const box = tabBox();
  if (c.conMolde) {
    // Formato con texto fijo: se lee aquí, pero solo se llenan los datos (pestaña Variables)
    box.innerHTML = `${avisoMolde(c)}
      <div class="paper-wrap"><div class="paper full">${documentHTML(c)}</div></div>
      <p class="muted small">Para cambiar la redacción, edita el Word que se descarga o pide que se actualice el formato.</p>`;
    return;
  }
  const nums = sectionNumbers(c);
  box.innerHTML = `
    ${efirmaEditBanner(c)}
    ${numberingControls(c)}
    <div class="sections" id="sections">
      ${c.sections.map((s, i) => sectionCard(s, i, c.sections.length, nums[i])).join('')}
    </div>
    <div class="add-row">
      <button class="btn" data-add="blank">${icon('plus')} Sección en blanco</button>
      <button class="btn" data-add="clause">${icon('library')} Desde biblioteca de cláusulas</button>
    </div>`;

  $$('textarea', box).forEach(autosize);
  box.addEventListener('focusin', (e) => {
    if (e.target.matches('[data-field]')) lastField = e.target;
  });
  box.addEventListener('input', (e) => {
    const f = e.target.dataset.field;
    if (!f || f === 'kind') return;
    const sec = c.sections.find((s) => s.id === e.target.closest('.sec-card').dataset.id);
    sec[f] = e.target.value;
    if (f === 'body') autosize(e.target);
    syncVarDefs(c);
    touched({ log: `Editó la sección "${sec.title || 'sin título'}"`, groupKey: `sec-${sec.id}` });
  });
  box.addEventListener('change', (e) => {
    if (e.target.dataset.field === 'kind') {
      const sec = c.sections.find((s) => s.id === e.target.closest('.sec-card').dataset.id);
      if (e.target.value === 'texto') sec.kind = 'texto'; else delete sec.kind;
      touched({ log: `Cambió "${sec.title || 'sin título'}" a ${e.target.value === 'texto' ? 'texto sin número' : 'cláusula'}` });
      return renderSections();
    }
    const k = e.target.dataset.num;
    if (k) {
      c[k] = e.target.value;
      touched({ log: 'Cambió el estilo de numeración' });
      renderSections();
    }
  });
  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.add === 'blank') return addSection({ title: 'Nueva sección', body: '' });
    if (btn.dataset.add === 'clause') return pickClause();
    const card = btn.closest('.sec-card');
    if (!card) return;
    const idx = c.sections.findIndex((s) => s.id === card.dataset.id);
    const sec = c.sections[idx];
    switch (btn.dataset.act) {
      case 'up': return moveSection(idx, idx - 1);
      case 'down': return moveSection(idx, idx + 1);
      case 'dup': {
        c.sections.splice(idx + 1, 0, { ...structuredClone(sec), id: uid(), title: `${sec.title} (copia)` });
        touched({ log: `Duplicó la sección "${sec.title}"` });
        return renderSections();
      }
      case 'del': {
        if (!(await confirmDialog('Eliminar sección', `¿Eliminar "${sec.title}"? Puedes recuperarla desde una versión guardada.`, 'Eliminar'))) return;
        c.sections.splice(idx, 1);
        touched({ log: `Eliminó la sección "${sec.title}"` });
        return renderSections();
      }
      case 'var': {
        const target = lastField && card.contains(lastField) ? lastField : $('textarea', card);
        return insertVariable(target);
      }
    }
  });
  enableDrag($('#sections'));
}

/** Número que se muestra en el editor: "1", "PRIMERA" o "—" para secciones de texto. */
function sectionNumbers(c) {
  return layoutSections(c).map((l, i, all) => {
    if (l.texto) return '—';
    const n = all.slice(0, i + 1).filter((x) => !x.texto).length;
    return c.numeracion === 'ordinal' ? ordinal(n) : String(n);
  });
}

function numberingControls(t) {
  return `
    <div class="card soft numbering">
      <label class="field inline"><span>Numeración</span>
        <select data-num="numeracion">
          <option value="decimal" ${t.numeracion !== 'ordinal' ? 'selected' : ''}>1. 2. 3.</option>
          <option value="ordinal" ${t.numeracion === 'ordinal' ? 'selected' : ''}>PRIMERA.- SEGUNDA.-</option>
        </select>
      </label>
      ${t.numeracion === 'ordinal' ? `
      <label class="field inline"><span>Título de cláusula</span>
        <select data-num="tituloClausula">
          <option value="arriba" ${t.tituloClausula !== 'en_linea' ? 'selected' : ''}>Arriba: “OBJETO” / “PRIMERA.- …”</option>
          <option value="en_linea" ${t.tituloClausula === 'en_linea' ? 'selected' : ''}>En línea: “PRIMERA. - Objeto.”</option>
        </select>
      </label>` : ''}
    </div>`;
}

function sectionCard(s, i, n, num = String(i + 1)) {
  return `
    <article class="card sec-card ${s.kind === 'texto' ? 'is-texto' : ''}" data-id="${esc(s.id)}">
      <div class="sec-head">
        <span class="grip" title="Arrastra para reordenar" aria-hidden="true">${icon('grip')}</span>
        <span class="sec-num">${esc(num)}</span>
        <input class="sec-title" data-field="title" value="${esc(s.title)}" aria-label="Título de la sección">
        <select class="sec-kind" data-field="kind" aria-label="Tipo de sección">
          <option value="clausula" ${s.kind !== 'texto' ? 'selected' : ''}>Cláusula</option>
          <option value="texto" ${s.kind === 'texto' ? 'selected' : ''}>Texto sin número</option>
        </select>
        <div class="sec-actions">
          <button class="icon-btn sm" data-act="var" title="Insertar variable" aria-label="Insertar variable">${icon('braces')}</button>
          <button class="icon-btn sm" data-act="up" title="Subir" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button class="icon-btn sm" data-act="down" title="Bajar" aria-label="Bajar" ${i === n - 1 ? 'disabled' : ''}>${icon('down')}</button>
          <button class="icon-btn sm" data-act="dup" title="Duplicar" aria-label="Duplicar">${icon('copy')}</button>
          <button class="icon-btn sm danger" data-act="del" title="Eliminar" aria-label="Eliminar">${icon('trash')}</button>
        </div>
      </div>
      <textarea data-field="body" rows="3" placeholder="Escribe el texto de la sección. Usa {{variable}} para datos que se repiten.">${esc(s.body)}</textarea>
    </article>`;
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}

function addSection({ title, body }) {
  const c = state.current;
  c.sections.push({ id: uid(), title, body });
  syncVarDefs(c);
  touched({ log: `Agregó la sección "${title}"` });
  renderSections();
  const cards = $$('.sec-card');
  const last = cards[cards.length - 1];
  last.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('.sec-title', last).select();
}

function moveSection(from, to) {
  const c = state.current;
  if (to < 0 || to >= c.sections.length || from === to) return;
  const [sec] = c.sections.splice(from, 1);
  c.sections.splice(to, 0, sec);
  touched({ log: `Movió la sección "${sec.title}" a la posición ${to + 1}` });
  renderSections();
  $(`.sec-card[data-id="${esc(sec.id)}"]`)?.classList.add('flash');
}

function enableDrag(list) {
  let dragId = null;
  list.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.sec-card');
    if (card) card.draggable = !!e.target.closest('.grip');
  });
  // Solo se arrastran secciones tomadas del asa; arrastrar texto seleccionado debe comportarse normal
  list.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.('.sec-card');
    if (!card?.draggable) return;
    dragId = card.dataset.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const over = e.target.closest('.sec-card');
    $$('.sec-card', list).forEach((c) => c.classList.toggle('drop-target', c === over && over.dataset.id !== dragId));
  });
  list.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const over = e.target.closest('.sec-card');
    const secs = state.current.sections;
    if (over && dragId) moveSection(secs.findIndex((s) => s.id === dragId), secs.findIndex((s) => s.id === over.dataset.id));
  });
  list.addEventListener('dragend', () => {
    $$('.sec-card', list).forEach((c) => { c.classList.remove('dragging', 'drop-target'); c.draggable = false; });
    dragId = null;
  });
}

async function pickClause() {
  const r = await modal({
    title: 'Biblioteca de cláusulas',
    wide: true,
    body: `<div class="clause-list">${CLAUSES.map((cl, i) => `
      <button value="${i}" class="clause-item">
        <strong>${esc(cl.title)}</strong>
        <span>${esc(cl.body)}</span>
      </button>`).join('')}</div>`,
  });
  if (r.value === '') return;
  const cl = CLAUSES[Number(r.value)];
  addSection({ title: cl.title, body: cl.body });
  toast(`Cláusula "${cl.title}" agregada`, 'ok');
}

async function insertVariable(target) {
  const c = state.current;
  const r = await modal({
    title: 'Insertar variable',
    body: `
      <p class="muted small">Se inserta donde está el cursor y se completa automáticamente en todo el documento.</p>
      <div class="menu-list var-pick">
        ${c.varDefs.map((d) => `<button value="${esc(d.key)}" class="menu-item"><span>${esc(d.label)}</span><code>{{${esc(d.key)}}}</code></button>`).join('')}
      </div>
      <details class="new-var">
        <summary>${icon('plus', 'xs')} Crear nueva variable</summary>
        <div class="row">
          <label class="field"><span>Nombre</span><input name="label" placeholder="Ej. Monto del anticipo"></label>
          <label class="field"><span>Tipo</span><select name="type">${Object.entries(VAR_TYPES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        </div>
        <button value="__new" class="btn primary">Crear e insertar</button>
      </details>`,
  });
  let key = r.value;
  if (!key) return;
  if (key === '__new') {
    if (!r.data.label?.trim()) return toast('Escribe un nombre para la variable', 'error');
    key = uniqueKey(slugify(r.data.label));
    c.varDefs.push({ key, label: r.data.label.trim(), type: r.data.type });
    c.variables[key] = '';
    logChange(c, `Creó la variable "${r.data.label.trim()}"`);
  }
  const token = `{{${key}}}`;
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  target.value = target.value.slice(0, start) + token + target.value.slice(end);
  target.focus();
  target.setSelectionRange(start + token.length, start + token.length);
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

function uniqueKey(base) {
  let key = base;
  let n = 2;
  while (state.current.varDefs.some((d) => d.key === key)) key = `${base}_${n++}`;
  return key;
}

// --- Pestaña: Variables ---
function renderVariables(focusKey) {
  const c = state.current;
  const used = usedVariables(c);
  const defs = c.varDefs;
  const usedDefs = defs.filter((d) => used.has(d.key));
  // Las variables del catálogo que no se usan en el texto se agrupan aparte para no saturar
  const prefixes = c.signers.filter((s) => s.party).map((s) => `${s.party.prefix}_`);
  const fromCatalog = (d) => prefixes.some((p) => d.key.startsWith(p));
  const unused = defs.filter((d) => !used.has(d.key) && !fromCatalog(d));
  const catalogUnused = defs.filter((d) => !used.has(d.key) && fromCatalog(d));
  const missing = missingVariables(c).length;
  const box = tabBox();
  box.innerHTML = `
    ${efirmaEditBanner(c)}
    ${partiesBlock(c)}
    <div class="var-intro card soft">
      <div>
        <strong>${missing ? `${missing} de ${usedDefs.length} datos por completar` : 'Todos los datos están completos'}</strong>
        <p class="muted small">Cada valor se inserta automáticamente en todas las secciones donde aparece.</p>
      </div>
      <label class="field inline"><span>Moneda</span>
        <select id="currency">${['MXN', 'USD', 'EUR', 'COP', 'ARS', 'CLP', 'PEN'].map((m) => `<option ${c.currency === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
      </label>
    </div>
    <div class="vars">${usedDefs.map((d) => varRow(d, true)).join('')}</div>
    ${unused.length ? `<h4 class="sub">No usadas en el texto</h4><div class="vars">${unused.map((d) => varRow(d, false)).join('')}</div>` : ''}
    ${catalogUnused.length ? `<details class="catalog-vars"><summary>Datos del catálogo disponibles para insertar (${catalogUnused.length})</summary>
      <p class="muted small">Insértalos en cualquier sección con el botón ${icon('braces', 'xs')}.</p>
      <div class="vars">${catalogUnused.map((d) => varRow(d, false)).join('')}</div></details>` : ''}
    <form class="card new-var-form" id="new-var">
      <strong>Nueva variable</strong>
      <div class="row">
        <label class="field"><span>Nombre</span><input name="label" required placeholder="Ej. Fecha de pago"></label>
        <label class="field"><span>Tipo</span><select name="type">${Object.entries(VAR_TYPES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <button class="btn">${icon('plus')} Agregar</button>
      </div>
      <p class="muted small">Después insértala en cualquier sección con el botón ${icon('braces', 'xs')}.</p>
    </form>`;

  box.addEventListener('input', (e) => {
    const row = e.target.closest('.var-row');
    if (!row) return;
    const key = row.dataset.key;
    const def = c.varDefs.find((d) => d.key === key);
    if (e.target.dataset.role === 'value') {
      c.variables[key] = e.target.value;
      row.classList.toggle('is-missing', formatValue(def, e.target.value) === null);
      const fmt = $('.var-fmt', row);
      if (fmt) fmt.textContent = def.type === 'date' || def.type === 'money' ? formatValue(def, e.target.value, c.currency) || '' : '';
      touched({ log: `Actualizó "${def.label}"`, groupKey: `var-${key}` });
    } else if (e.target.dataset.role === 'label') {
      def.label = e.target.value;
      touched({ log: `Renombró la variable "${key}"`, groupKey: `varlabel-${key}` });
    }
  });
  box.addEventListener('change', (e) => {
    if (e.target.id === 'currency') {
      c.currency = e.target.value;
      touched({ log: `Cambió la moneda a ${c.currency}` });
      return renderVariables();
    }
    if (e.target.dataset.role === 'type') {
      const def = c.varDefs.find((d) => d.key === e.target.closest('.var-row').dataset.key);
      def.type = e.target.value;
      touched({ log: `Cambió el tipo de "${def.label}" a ${VAR_TYPES[def.type]}` });
      renderVariables(def.key);
    }
  });
  box.addEventListener('click', async (e) => {
    const pbtn = e.target.closest('button[data-pact]');
    if (pbtn) return partyAction(pbtn.dataset.pact, c.signers.find((s) => s.id === pbtn.closest('[data-sid]')?.dataset.sid));
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const key = btn.closest('.var-row').dataset.key;
    if (btn.dataset.act === 'copy') {
      try { await navigator.clipboard.writeText(`{{${key}}}`); toast('Variable copiada'); } catch { toast(`{{${key}}}`); }
    } else if (btn.dataset.act === 'del') {
      const def = c.varDefs.find((d) => d.key === key);
      c.varDefs = c.varDefs.filter((d) => d.key !== key);
      delete c.variables[key];
      touched({ log: `Eliminó la variable "${def.label}"` });
      renderVariables();
    }
  });
  $('#new-var').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const label = fd.get('label').trim();
    if (!label) return toast('Escribe el nombre de la variable', 'error');
    const key = uniqueKey(slugify(label));
    c.varDefs.push({ key, label, type: fd.get('type') });
    c.variables[key] = '';
    touched({ log: `Creó la variable "${label}"`, content: false });
    renderVariables(key);
    toast(`Variable {{${key}}} creada`, 'ok');
  });

  if (focusKey) {
    const row = $(`.var-row[data-key="${CSS.escape(focusKey)}"]`);
    row?.scrollIntoView({ block: 'center' });
    $('[data-role="value"]', row)?.focus();
  }
}

function varRow(d, used) {
  const c = state.current;
  const v = c.variables[d.key] ?? '';
  const isMissing = formatValue(d, v) === null;
  const input = (() => {
    const common = `data-role="value" aria-label="${esc(d.label)}"`;
    switch (d.type) {
      case 'date': return `<input type="date" ${common} value="${esc(v)}">`;
      case 'money': return `<input type="text" inputmode="decimal" ${common} value="${esc(v)}" placeholder="0.00">`;
      case 'number': return `<input type="number" ${common} value="${esc(v)}">`;
      case 'email': return `<input type="email" ${common} value="${esc(v)}" placeholder="nombre@correo.com">`;
      case 'address': return `<textarea rows="2" ${common} placeholder="Calle, número, colonia, ciudad">${esc(v)}</textarea>`;
      default: return `<input type="text" ${common} value="${esc(v)}">`;
    }
  })();
  const fmt = d.type === 'date' || d.type === 'money' ? formatValue(d, v, c.currency) || '' : '';
  return `
    <div class="var-row card ${used && isMissing ? 'is-missing' : ''}" data-key="${esc(d.key)}">
      <input class="var-label" data-role="label" value="${esc(d.label)}" aria-label="Nombre de la variable">
      <div class="var-input">${input}<span class="var-fmt muted small">${esc(fmt)}</span></div>
      <div class="var-foot">
        <select data-role="type" aria-label="Tipo">${Object.entries(VAR_TYPES).map(([k, l]) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${used ? '' : `<button type="button" class="link danger" data-act="del">Eliminar</button>`}
        <button type="button" class="token" data-act="copy" title="Copiar variable">{{${esc(d.key)}}}</button>
      </div>
    </div>`;
}

// --- Pestaña: Vista previa ---
function renderPreviewTab() {
  const c = state.current;
  const missing = missingVariables(c);
  tabBox().innerHTML = `
    ${missing.length ? `<div class="banner warn">${icon('alert')} <span>${missing.length} dato(s) por completar. Toca un campo marcado para llenarlo.</span></div>` : ''}
    ${signedChangedBanner(c)}
    <div class="paper-wrap"><div class="paper full" id="paper">${documentHTML(c, { interactive: true })}</div></div>`;
  $('#paper').addEventListener('click', (e) => {
    const v = e.target.closest('[data-var]');
    if (v) { state.focusVar = v.dataset.var; go(`#/c/${c.id}/variables`); }
  });
}

function signedChangedBanner(c) {
  const broken = brokenEfirmas(c);
  if (broken.length) {
    return `<div class="banner danger">${icon('alert')} <span>El contenido cambió después de firmarse con e.firma. La firma electrónica de ${broken.map((sg) => esc(fill(c, sg.name) || sg.role)).join(', ')} ya no es válida para este texto: deshaz el cambio (restaurando una versión) o firma de nuevo.</span></div>`;
  }
  const hasSigs = Object.keys(c.signatures).length > 0;
  if (!hasSigs || !changedSinceSigned(c)) return '';
  return `<div class="banner danger">${icon('alert')} <span>El contenido cambió después de que se firmó. Considera solicitar las firmas de nuevo.</span></div>`;
}

/** Aviso en las pestañas de edición cuando hay firmas electrónicas avanzadas vigentes. */
function efirmaEditBanner(c) {
  if (brokenEfirmas(c).length) return signedChangedBanner(c);
  if (!hasEfirma(c)) return '';
  return `<div class="banner info">${icon('shield')} <span>Este contrato tiene firmas electrónicas avanzadas. Cualquier cambio en el texto, los datos o los firmantes las invalidará.</span></div>`;
}

// --- Pestaña: Firmantes ---
function renderSigners() {
  const c = state.current;
  const box = tabBox();
  // Quién firma el contrato (DocuSign toma de aquí nombre y correo). Las firmas se recaban en Aprobación y firma
  box.innerHTML = `
    ${signedChangedBanner(c)}
    <div class="banner info">${icon('pen')} <span>Aquí se define quién firma. Para firmar: pestaña <a href="#/c/${c.id}/documento">Aprobación y firma</a> → Enviar a firma (DocuSign) o Firmado en papel.</span></div>
    <div class="signers">
      ${c.signers.map((sg) => {
        const sig = c.signatures[sg.id];
        return `
        <div class="card signer" data-id="${esc(sg.id)}">
          <div class="row">
            <label class="field role"><span>Rol</span><input data-f="role" value="${esc(sg.role)}"></label>
            <label class="field grow"><span>Nombre (admite variables)</span><input data-f="name" value="${esc(sg.name)}" placeholder="{{nombre}} o texto"></label>
          </div>
          <p class="muted small">Se mostrará como: <strong>${esc(fill(c, sg.name)) || '—'}</strong></p>
          ${!sig ? '' : sig.type === 'efirma' ? efirmaBox(c, sig) : `
          <div class="sig-box has">
            <img src="${esc(sig.image)}" alt="Firma de ${esc(fill(c, sg.name))}"><span class="muted small">Firma autógrafa · ${fmtDateTime(sig.date)}</span>
          </div>`}
          <div class="row end">
            <button class="link danger" data-act="remove-signer">Quitar firmante</button>
            ${sig ? '<button class="btn sm" data-act="clear-sig">Borrar firma</button>' : ''}
            ${sig?.type === 'efirma' ? `
              <button class="btn sm" data-act="verify">${icon('check')} Verificar</button>
              <button class="btn sm" data-act="p7s">Descargar .p7s</button>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
    <button class="btn" data-act="add-signer">${icon('plus')} Agregar firmante</button>`;

  box.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    const sg = c.signers.find((s) => s.id === e.target.closest('.signer').dataset.id);
    sg[f] = e.target.value;
    syncVarDefs(c);
    touched({ log: 'Editó los firmantes', groupKey: `signer-${sg.id}` });
  });
  box.addEventListener('change', (e) => { if (e.target.dataset.f) renderSigners(); });
  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.signer')?.dataset.id;
    const sg = c.signers.find((s) => s.id === id);
    switch (btn.dataset.act) {
      case 'verify': return verifyEfirma(sg);
      case 'p7s': {
        const sig = c.signatures[id];
        download(base64ToBlob(sig.p7s, 'application/pkcs7-signature'), `firma-${slugify(sig.info.rfc || sig.info.name)}.p7s`);
        return toast('Firma .p7s descargada', 'ok');
      }
      case 'clear-sig':
        if (c.signatures[id]?.type === 'efirma' &&
          !(await confirmDialog('Borrar firma electrónica', 'Se eliminará la firma electrónica avanzada de este firmante. Para recuperarla deberá firmar de nuevo con su e.firma.', 'Borrar'))) return;
        delete c.signatures[id];
        if (!Object.keys(c.signatures).length) c.signedHash = null;
        touched({ log: `Borró la firma de ${fill(c, sg.role)}` });
        return renderSigners();
      case 'remove-signer':
        if (!(await confirmDialog('Quitar firmante', `¿Quitar a "${fill(c, sg.name) || sg.role}"?`, 'Quitar'))) return;
        c.signers = c.signers.filter((s) => s.id !== id);
        delete c.signatures[id];
        touched({ log: `Quitó al firmante ${sg.role}` });
        return renderSigners();
      case 'add-signer':
        c.signers.push({ id: uid(), role: 'Firmante', name: '' });
        touched({ log: 'Agregó un firmante' });
        return renderSigners();
    }
  });
}

function efirmaBox(c, sig) {
  const ok = sig.signedText === canonicalText(c);
  const i = sig.info;
  return `
    <div class="efirma-box ${ok ? '' : 'broken'}">
      <div class="efirma-head">${icon('shield')} <strong>Firma electrónica avanzada</strong>
        <span class="badge ${ok ? 'final' : 'invalid'}">${ok ? 'Íntegra' : 'Inválida: el texto cambió'}</span></div>
      <dl>
        <dt>Titular</dt><dd>${esc(i.name)}</dd>
        ${i.rfc ? `<dt>RFC</dt><dd>${esc(i.rfc)}</dd>` : ''}
        <dt>No. de certificado</dt><dd class="mono">${esc(i.certNumber)}</dd>
        <dt>Emisor</dt><dd>${esc(i.issuer)}</dd>
        <dt>Firmado</dt><dd>${fmtDateTime(sig.date)}</dd>
        <dt>Huella SHA-256</dt><dd class="mono small">${esc(sig.hash.slice(0, 32))}…</dd>
      </dl>
    </div>`;
}

async function verifyEfirma(sg) {
  const c = state.current;
  const sig = c.signatures[sg.id];
  let v;
  try { v = await verifySignature(sig, canonicalText(c)); } catch (err) { return toast(`No se pudo verificar: ${err.message}`, 'error'); }
  const line = (ok, yes, no) => `<li class="${ok ? 'ok-text' : 'warn-text'}">${icon(ok ? 'check' : 'alert', 'xs')} ${ok ? yes : no}</li>`;
  await modal({
    title: v.valid ? 'Firma válida' : 'La firma no es válida',
    body: `
      <ul class="verify-list">
        ${line(v.signatureOk, 'La firma criptográfica corresponde al certificado y al texto firmado.', 'La firma criptográfica no coincide con el texto o el certificado.')}
        ${line(v.unchanged, 'El contrato no ha cambiado desde que se firmó.', 'El contrato cambió después de la firma.')}
        ${line(v.certValidAtSigning, 'El certificado estaba vigente al momento de firmar.', 'El certificado no estaba vigente al momento de firmar.')}
      </ul>
      <p class="muted small">Titular según el certificado: <b>${esc(v.info.name)}</b>${v.info.rfc ? ` · RFC ${esc(v.info.rfc)}` : ''} · Certificado ${esc(v.info.certNumber)} · Emisor: ${esc(v.info.issuer || '—')}</p>
      <p class="muted small">Esta verificación no valida la cadena del certificado ante el SAT (un certificado hecho por cualquiera pasaría la prueba criptográfica), no comprueba la fecha de firma ni consulta revocaciones. Para una validación oficial usa el servicio de verificación del SAT o un prestador de servicios de certificación.</p>`,
    actions: [{ label: 'Cerrar', value: '', kind: 'primary' }],
  });
}

// --- Pestaña: Versiones ---
function renderVersions() {
  const c = state.current;
  const box = tabBox();
  box.innerHTML = `
    <form class="card save-version" id="save-version">
      <label class="field grow"><span>Guardar versión actual</span><input name="note" placeholder="Ej. Enviada al cliente para revisión"></label>
      <button class="btn primary">${icon('check')} Guardar versión</button>
    </form>
    <h4 class="sub">Versiones (${c.versions.length})</h4>
    ${c.versions.length ? `<div class="list">${c.versions.map((v) => `
      <div class="list-item card" data-id="${esc(v.id)}">
        <div>
          <strong>${esc(v.note)}</strong>
          <p class="muted small">${fmtDateTime(v.date)} · ${v.data.sections.length} secciones</p>
        </div>
        <div class="row">
          <button class="btn sm" data-act="view">Ver</button>
          <button class="btn sm" data-act="restore">Restaurar</button>
          <button class="icon-btn sm danger" data-act="del" aria-label="Eliminar versión">${icon('trash')}</button>
        </div>
      </div>`).join('')}</div>` : '<p class="muted">Aún no hay versiones. Guarda una antes de enviar o hacer cambios importantes.</p>'}
    <h4 class="sub">Registro de cambios</h4>
    <ul class="history">${c.history.map((h) => `<li><span>${esc(h.text)}</span><time class="muted small">${fmtDateTime(h.date)}</time></li>`).join('')}</ul>`;

  $('#save-version').addEventListener('submit', async (e) => {
    e.preventDefault();
    const note = new FormData(e.target).get('note').trim();
    addVersion(c, note);
    logChange(c, `Guardó la versión "${note || 'Versión guardada'}"`);
    await saveContract(c);
    toast('Versión guardada', 'ok');
    renderVersions();
  });
  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const v = c.versions.find((x) => x.id === btn.closest('.list-item').dataset.id);
    if (btn.dataset.act === 'view') {
      const temp = { ...c, ...structuredClone(v.data), status: 'final' };
      const r = await modal({
        title: v.note, wide: true,
        body: `<p class="muted small">${fmtDateTime(v.date)}</p><div class="paper full">${documentHTML(temp)}</div>`,
        actions: [{ label: 'Restaurar esta versión', value: 'restore', kind: 'primary' }],
      });
      if (r.value !== 'restore') return;
    } else if (btn.dataset.act === 'del') {
      if (!(await confirmDialog('Eliminar versión', `¿Eliminar la versión "${v.note}"?`, 'Eliminar'))) return;
      c.versions = c.versions.filter((x) => x.id !== v.id);
      await saveContract(c);
      return renderVersions();
    }
    if (!(await confirmDialog('Restaurar versión', `El documento volverá a "${v.note}". La versión actual se guardará como respaldo.`, 'Restaurar', 'primary'))) return;
    restoreVersion(c, v.id);
    touched({});
    renderEditorHeader();
    renderVersions();
    toast('Versión restaurada', 'ok');
  });
}

// ---------- Catálogo de partes ----------
let excelReady;
function loadExcel() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  excelReady ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: 'vendor/exceljs.min.js' });
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => { excelReady = null; reject(new Error('No se pudo cargar el módulo de Excel')); };
    document.head.appendChild(s);
  });
  return excelReady;
}

// Partes editadas cuyos datos falta copiar a los contratos (se hace al salir de la ficha, no a cada tecla)
const partesPorPropagar = new Set();

/** Copia los datos nuevos del catálogo a los contratos no firmados que usan esas partes. */
async function propagarCatalogo() {
  if (!partesPorPropagar.size) return;
  const cambiadas = state.parties.filter((p) => partesPorPropagar.has(p.id));
  partesPorPropagar.clear();
  const tocados = propagarPartes(state.contracts, cambiadas);
  for (const c of tocados) await saveContract(c);
  if (tocados.length) {
    const aprob = tocados.filter((c) => c.history?.[0]?.text?.includes('volvió a borrador')).length;
    toast(`${tocados.length} contrato${tocados.length === 1 ? '' : 's'} actualizado${tocados.length === 1 ? '' : 's'} con los datos nuevos del catálogo${aprob ? `; ${aprob} volvi${aprob === 1 ? 'ó' : 'eron'} a borrador para aprobarse de nuevo` : ''}`, 'ok');
  }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) propagarCatalogo(); });

async function saveParty(p) {
  partesPorPropagar.add(p.id);
  p.updatedAt = Date.now();
  await db.put('parties', structuredClone(p));
  await sync.markDirty('parties', p.id);
  scheduleSync();
  const i = state.parties.findIndex((x) => x.id === p.id);
  if (i >= 0) state.parties[i] = p; else state.parties.push(p);
}

const sortParties = (list) => [...list].sort((a, b) => (b.propia - a.propia) || (a.nombre || '').localeCompare(b.nombre || '', 'es'));

function partyBadges(p) {
  return `${p.propia ? '<span class="badge grupo">Grupo</span>' : '<span class="badge contraparte">Contraparte</span>'}
    ${p.activa ? '' : '<span class="badge inactiva">Inactiva</span>'}`;
}

function renderCatalog() {
  setNav('catalog');
  const q = state.partyQuery;
  const activas = state.parties.filter((p) => p.activa);
  const groups = {
    todas: activas,
    grupo: activas.filter((p) => p.propia),
    contrapartes: activas.filter((p) => !p.propia),
    inactivas: state.parties.filter((p) => !p.activa),
  };
  const list = sortParties(groups[state.partyFilter].filter((p) => matchesQuery(p, q)));

  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow">Datos de las partes</p>
        <h1>Catálogo</h1>
      </div>
      <div class="row">
        <button class="btn" id="cat-export">${icon('download')}<span class="hide-xs">Exportar Excel</span></button>
        <label class="btn">${icon('upload')}<span class="hide-xs">Importar Excel</span><input type="file" id="cat-import" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
        <button class="btn" id="cat-pdf" title="Constancias fiscales, escrituras constitutivas o poderes de varias empresas">${icon('upload')}<span class="hide-xs">Alta desde PDFs</span></button>
        <button class="btn primary" id="cat-new">${icon('plus')} Nueva</button>
      </div>
    </header>
    ${state.parties.length ? `
      <div class="toolbar">
        <label class="search">${icon('search')}<input id="cat-q" type="search" placeholder="Buscar por nombre o RFC" value="${esc(q)}"></label>
        <div class="chips">
          ${[['todas', 'Activas'], ['grupo', 'Empresas del grupo'], ['contrapartes', 'Contrapartes'], ['inactivas', 'Inactivas']].map(([k, l]) =>
            `<button class="chip ${state.partyFilter === k ? 'on' : ''}" data-pf="${k}">${l} <span>${groups[k].length}</span></button>`).join('')}
        </div>
      </div>
      ${list.length ? `
      <div class="card lotes-list party-list">
        <div class="ll-row ll-head"><span>Nombre</span><span>RFC</span><span>Clasificación</span><span>Apoderados</span><span>Datos</span><span></span></div>
        ${list.map((p) => {
          const gaps = partyGaps(p);
          const apos = p.apoderados.filter((a) => a.vigente).length;
          return `
        <div class="ll-row" data-id="${esc(p.id)}" tabindex="0" role="link">
          <span><strong>${esc(p.nombre || 'Sin nombre')}</strong><span class="muted small">${PARTY_KINDS[p.kind]}</span></span>
          <span class="mono small">${esc(p.rfc || 'Sin RFC')}</span>
          <span>${partyBadges(p)}</span>
          <span>${p.kind === 'pm' ? `${apos} vigente${apos === 1 ? '' : 's'}` : '<span class="muted">—</span>'}</span>
          <span>${rfcDuplicado(p.rfc, state.parties, p.id) ? '<span class="warn-text" title="Otra ficha tiene el mismo RFC: elimina la que sobre">RFC repetido</span>' : gaps.length ? `<span class="warn-text" title="${esc(gaps.join(', '))}">Faltan ${gaps.length} dato${gaps.length === 1 ? '' : 's'}</span>` : '<span class="ok-text">Completos</span>'}</span>
          <span class="ll-acts">
            <button class="icon-btn sm" data-act="view" title="Visualizar" aria-label="Visualizar">${icon('eye')}</button>
            <button class="icon-btn sm" data-act="edit" title="Editar" aria-label="Editar">${icon('pen')}</button>
            <button class="icon-btn sm danger" data-act="del" title="Eliminar del catálogo" aria-label="Eliminar">${icon('trash')}</button>
          </span>
        </div>`;
        }).join('')}
      </div>` : '<p class="empty-inline">Sin resultados.</p>'}` : `
      <section class="empty">
        <div class="empty-art">${icon('users')}</div>
        <h2>Arma tu catálogo de partes</h2>
        <p>Captura las empresas del grupo y las contrapartes una sola vez: razón social, RFC, escritura constitutiva, apoderados y accionistas. Después llénalas en cualquier contrato con un clic.</p>
        <p class="small muted">También puedes descargar la plantilla de Excel (botón “Exportar Excel”), llenarla y volver a importarla.</p>
      </section>`}`;

  $('#cat-q')?.addEventListener('input', (e) => {
    state.partyQuery = e.target.value;
    const pos = e.target.selectionStart;
    renderCatalog();
    const el = $('#cat-q'); el.focus(); el.setSelectionRange(pos, pos);
  });
  $$('[data-pf]').forEach((b) => b.addEventListener('click', () => { state.partyFilter = b.dataset.pf; renderCatalog(); }));
  $$('.party-list .ll-row[data-id]').forEach((row) => {
    const p = state.parties.find((x) => x.id === row.dataset.id);
    row.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'view') return viewParty(p);
      if (act === 'del') { if (await deleteParty(p)) renderCatalog(); return; }
      go(`#/catalogo/${p.id}`);
    });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) go(`#/catalogo/${p.id}`); });
  });
  $('#cat-new').addEventListener('click', () => createParty());
  $('#cat-pdf').addEventListener('click', conAviso(altaDesdePdfs));
  $('#cat-export').addEventListener('click', exportCatalog);
  $('#cat-import').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = ''; // para poder elegir otra vez el mismo archivo
    if (f) importCatalog(f);
  });
}

/** Ficha de solo lectura con los datos de la parte. */
async function viewParty(p) {
  const row = (label, v) => `<tr><th>${label}</th><td>${v ? esc(v) : '<span class="muted">—</span>'}</td></tr>`;
  const gaps = partyGaps(p);
  const apos = p.apoderados;
  const body = `
    <p>${partyBadges(p)} <span class="muted small">${PARTY_KINDS[p.kind]}</span></p>
    ${gaps.length ? `<div class="banner warn">${icon('alert')} <span>Faltan: ${gaps.map(esc).join(', ')}</span></div>` : ''}
    <table class="ficha">
      ${row('Nombre', p.nombre)}${row('RFC', p.rfc)}
      ${p.kind === 'pf' ? row('CURP', p.curp) + row('Nacionalidad', p.nacionalidad) + row('Estado civil', p.estadoCivil) + row('Ocupación', p.ocupacion) + row('Identificación', p.identificacion) : ''}
      ${row('Domicilio', p.domicilio)}${row('Correo', p.correo)}${row('Teléfono', p.telefono)}
      ${p.kind === 'pm' ? row('Escritura constitutiva', [p.escrituraNumero && `núm. ${p.escrituraNumero}`, fmtLongDate(p.escrituraFecha)].filter(Boolean).join(' del ')) +
        row('Notario', [p.notario, p.notariaNumero && `Notaría ${p.notariaNumero}`, p.notariaCiudad].filter(Boolean).join(', ')) +
        row('Folio mercantil', [p.folioMercantil, fmtLongDate(p.folioFecha), p.folioLugar].filter(Boolean).join(' · ')) + row('Objeto social', p.objetoSocial) : ''}
      ${row('Expediente', p.expediente)}${row('Notas', p.notas)}
    </table>
    ${p.kind === 'pm' ? `
      <h4 class="sub">Apoderados (${apos.length})</h4>
      ${apos.length ? `<ul class="ficha-list">${apos.map((a) => `<li><strong>${esc(a.nombre || 'Sin nombre')}</strong> ${a.vigente ? '' : '<span class="badge inactiva">No vigente</span>'}<br><span class="muted small">${esc(a.cargo || '')}${a.poderNumero ? ` · Escritura ${esc(a.poderNumero)}${a.poderFecha ? ` del ${esc(fmtLongDate(a.poderFecha))}` : ''}` : ''}${a.facultades ? ` · ${esc(a.facultades)}` : ''}</span></li>`).join('')}</ul>` : '<p class="muted small">Sin apoderados.</p>'}
      ${p.accionistas.length ? `<h4 class="sub">Accionistas (${p.accionistas.length})</h4><ul class="ficha-list">${p.accionistas.map((a) => `<li>${esc(a.nombre)}${a.acciones ? ` <span class="muted small">· ${esc(a.acciones)} acciones${a.serie ? ` serie ${esc(a.serie)}` : ''}</span>` : ''}</li>`).join('')}</ul>` : ''}` : ''}
    <h4 class="sub">Declaraciones</h4>
    <p class="decl-preview">${esc(declaracionesText(p, apos.find((a) => a.vigente)))}</p>`;
  const r = await modal({ title: p.nombre || 'Sin nombre', body, wide: true, actions: [{ label: 'Cerrar', value: '', kind: 'ghost' }, { label: 'Editar', value: 'edit', kind: 'primary' }] });
  if (r.value === 'edit') go(`#/catalogo/${p.id}`);
}

async function deleteParty(p) {
  const used = state.contracts.filter((c) => c.signers.some((s) => s.party?.id === p.id)).length;
  if (!(await confirmDialog('Eliminar del catálogo', `¿Eliminar "${p.nombre || 'esta parte'}"? ${used ? `Está vinculada a ${used} contrato(s); sus datos ya escritos se conservan. ` : ''}Si solo dejó de usarse, mejor desmarca "Activa".`, 'Eliminar'))) return false;
  await removeParty(p);
  toast('Eliminada del catálogo');
  return true;
}

async function removeParty(p) {
  await db.remove('parties', p.id);
  await sync.markDeleted('parties', p.id);
  scheduleSync();
  state.parties = state.parties.filter((x) => x.id !== p.id);
}

/** Ficha recién creada sin datos propios (se puede descartar al ir a la que ya existe). */
const fichaVacia = (p) => !p.nombre?.trim() && !p.rfc?.trim()
  && !p.apoderados.some((a) => a.nombre?.trim()) && !(p.accionistas || []).some((a) => a.nombre?.trim());

/**
 * Evita dos fichas con el mismo RFC. Devuelve la ficha existente si el usuario decide ir a ella
 * (la actual se descarta si estaba vacía), o null si decide corregir el RFC.
 */
async function avisoRfcDuplicado(p, rfc, otra, { vacia, conDatos } = {}) {
  const r = await modal({
    title: 'RFC ya registrado',
    body: `<p>El RFC <strong class="mono">${esc(rfc)}</strong> ya es de <strong>${esc(otra.nombre || 'otra parte')}</strong>${otra.activa === false ? ' (inactiva)' : ''}. No se pueden tener dos fichas con el mismo RFC.</p>
      ${conDatos ? '<p class="muted small">Los datos marcados se aplicarán a esa ficha.</p>' : ''}
      ${vacia ? '<p class="muted small">Esta ficha nueva está vacía y se descartará.</p>' : ''}`,
    actions: [
      { label: conDatos ? 'Cancelar' : 'Corregir el RFC', value: '', kind: 'ghost' },
      { label: conDatos ? 'Aplicar a la existente' : 'Abrir la existente', value: 'ok', kind: 'primary' },
    ],
  });
  if (r.value !== 'ok') return null;
  if (vacia) await removeParty(p);
  return otra;
}

async function createParty(defaults = {}) {
  const r = await modal({
    title: 'Nueva parte',
    body: `<div class="menu-list">
      <button value="pm-grupo" class="menu-item">${icon('building')} Empresa del grupo (persona moral)</button>
      <button value="pm" class="menu-item">${icon('building')} Contraparte: persona moral</button>
      <button value="pf" class="menu-item">${icon('user')} Contraparte: persona física</button>
    </div>`,
  });
  if (!r.value) { state.returnTo = null; return null; }
  const p = newParty(r.value.startsWith('pm') ? 'pm' : 'pf', r.value === 'pm-grupo');
  Object.assign(p, defaults);
  await saveParty(p);
  go(`#/catalogo/${p.id}`);
  return p;
}

async function exportCatalog() {
  try {
    const ExcelJS = await loadExcel();
    const buf = await catalogToXlsx(ExcelJS, state.parties);
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    download(blob, state.parties.length ? `catalogo-partes-${todayISO()}.xlsx` : 'catalogo-partes-plantilla.xlsx');
    toast(state.parties.length ? 'Catálogo exportado' : 'Plantilla de Excel descargada', 'ok');
  } catch (err) {
    console.error(err);
    toast('No se pudo generar el Excel', 'error');
  }
}

async function importCatalog(file) {
  if (!file) return;
  let res;
  try {
    const ExcelJS = await loadExcel();
    res = await xlsxToCatalog(ExcelJS, await file.arrayBuffer(), state.parties);
  } catch (err) {
    console.error(err);
    return toast(err.message?.startsWith('El archivo') ? err.message : 'No se pudo leer el Excel', 'error');
  }
  if (!res.parties.length) return toast('El Excel no tiene empresas ni personas capturadas', 'error');
  const r = await modal({
    title: 'Importar catálogo',
    body: `
      <p><strong>${res.created}</strong> nueva(s) y <strong>${res.updated}</strong> actualizada(s). Las partes que no estén en el Excel se conservan sin cambios.</p>
      ${res.warnings.length ? `<div class="banner warn">${icon('alert')} <span>${res.warnings.length} aviso(s)</span></div>
        <ul class="small muted warn-list">${res.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`,
    actions: [{ label: 'Cancelar', value: '', kind: 'ghost' }, { label: 'Importar', value: 'ok', kind: 'primary' }],
  });
  if (r.value !== 'ok') return;
  for (const [oldId, newId] of res.renamed) {
    await db.remove('parties', oldId);
    await sync.markDeleted('parties', oldId);
    state.parties = state.parties.filter((x) => x.id !== oldId);
    await remapPartyId(oldId, newId);
  }
  for (const p of res.parties) await saveParty(p);
  await propagarCatalogo();
  if (res.renamed.length) await loadAll();
  toast('Catálogo actualizado', 'ok');
  renderCatalog();
}

// --- Ficha de una parte ---
const PARTY_FIELDS = {
  general: [['nombre', 'Nombre o razón social'], ['rfc', 'RFC'], ['domicilio', 'Domicilio', 'address'], ['correo', 'Correo', 'email'], ['telefono', 'Teléfono']],
  pm: [['escrituraNumero', 'Escritura constitutiva núm.'], ['escrituraFecha', 'Fecha de constitución', 'date'], ['notario', 'Notario (con título)', 'text', 'Lic. Juan Pérez López'],
    ['notariaNumero', 'Notaría núm.'], ['notariaCiudad', 'Ciudad de la notaría', 'text', 'la Ciudad de México'], ['folioMercantil', 'Folio mercantil electrónico'],
    ['folioFecha', 'Fecha de inscripción del folio', 'date'], ['folioLugar', 'Lugar de inscripción', 'text', 'Ciudad de México'], ['objetoSocial', 'Objeto social (resumen)', 'address']],
  pf: [['curp', 'CURP'], ['nacionalidad', 'Nacionalidad'], ['sexo', 'Sexo'], ['estadoCivil', 'Estado civil'], ['ocupacion', 'Ocupación'], ['identificacion', 'Identificación', 'text', 'credencial para votar con clave de elector …']],
  apoderado: [['nombre', 'Nombre'], ['cargo', 'Cargo'], ['correo', 'Correo (firma remota)', 'email'], ['poderNumero', 'Escritura de poder núm.'], ['poderFecha', 'Fecha del poder', 'date'],
    ['notario', 'Notario (con título)'], ['notariaNumero', 'Notaría núm.'], ['notariaCiudad', 'Ciudad de la notaría'], ['facultades', 'Facultades', 'text', 'administración, dominio, títulos de crédito…'],
    ['identificacion', 'Identificación (INE)', 'text', 'credencial para votar … con clave de elector …'], ['identificacionVigencia', 'Vigencia de la INE (año)', 'text', '2031']],
};

function fieldHTML(obj, [key, label, type = 'text', ph = ''], attrs = '') {
  const v = esc(obj[key] ?? '');
  const a = `data-k="${key}" ${attrs} ${ph ? `placeholder="${esc(ph)}"` : ''}`;
  const input = type === 'address'
    ? `<textarea rows="2" ${a}>${v}</textarea>`
    : `<input type="${type === 'date' ? 'date' : type === 'email' ? 'email' : 'text'}" ${a} value="${v}">`;
  return `<label class="field"><span>${esc(label)}</span>${input}</label>`;
}

function renderPartyEditor(id) {
  setNav('catalog');
  const p = state.parties.find((x) => x.id === id);
  if (!p) { toast('No se encontró en el catálogo', 'error'); return go('#/catalogo'); }
  const ret = state.returnTo;
  const totalAcc = p.accionistas.reduce((s, a) => s + (Number(String(a.acciones).replace(/[^0-9.]/g, '')) || 0), 0);
  const pct = (a) => {
    const n = Number(String(a.acciones).replace(/[^0-9.]/g, '')) || 0;
    return totalAcc ? `${(n / totalAcc * 100).toLocaleString('es-MX', { maximumFractionDigits: 2 })} %` : '';
  };
  const gaps = partyGaps(p);

  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow"><a href="#/catalogo">Catálogo</a> · ${PARTY_KINDS[p.kind]}</p>
        <h1>${esc(p.nombre || 'Nueva parte')}</h1>
      </div>
      <div class="row">
        <button type="button" class="btn sm" id="party-extract" title="Lee una constancia fiscal, escritura constitutiva o poder (PDF con texto)">${icon('upload')} Llenar desde PDF</button>
        <span id="party-save" class="muted small">Guardado</span>
      </div>
    </header>
    ${ret ? `<div class="banner info">${icon('link')} <span>Al terminar, úsala en el contrato.</span><button class="btn sm primary" id="use-in-contract">Usar en el contrato</button></div>` : ''}
    ${gaps.length ? `<div class="banner warn">${icon('alert')} <span>Faltan: ${esc(gaps.join(', '))}. En el contrato aparecerán como [falta: …].</span></div>` : ''}
    <form class="party-form" id="party-form" autocomplete="off">
      <section class="card form-block">
        <div class="row">
          <label class="field inline"><span>Tipo</span>
            <select data-k="kind">${Object.entries(PARTY_KINDS).map(([k, l]) => `<option value="${k}" ${p.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </label>
          <label class="check"><input type="checkbox" data-k="propia" ${p.propia ? 'checked' : ''}> Empresa del grupo</label>
          <label class="check"><input type="checkbox" data-k="activa" ${p.activa ? 'checked' : ''}> Activa</label>
        </div>
        <div class="form-grid">${PARTY_FIELDS.general.map((f) => fieldHTML(p, f)).join('')}</div>
      </section>
      ${p.kind === 'pm' ? `
      <section class="card form-block">
        <h3>Escritura constitutiva</h3>
        <div class="form-grid">${PARTY_FIELDS.pm.map((f) => fieldHTML(p, f)).join('')}</div>
      </section>
      <section class="card form-block">
        <h3>Apoderados <span class="muted small">(en cada contrato se pregunta quién firma)</span></h3>
        ${p.apoderados.map((a, i) => `
          <div class="sub-item" data-list="apoderados" data-i="${i}">
            <div class="form-grid">${PARTY_FIELDS.apoderado.map((f) => fieldHTML(a, f)).join('')}</div>
            <div class="row end">
              <label class="check"><input type="checkbox" data-k="vigente" ${a.vigente ? 'checked' : ''}> Poder vigente</label>
              <button type="button" class="link danger" data-act="del-item">Quitar</button>
            </div>
          </div>`).join('') || '<p class="muted small">Sin apoderados.</p>'}
        <button type="button" class="btn sm" data-act="add-apoderado">${icon('plus')} Agregar apoderado</button>
      </section>
      <section class="card form-block">
        <h3>Accionistas</h3>
        ${p.accionistas.length ? `
        <div class="acc-table">
          <span class="muted small">Accionista</span><span class="muted small">Acciones</span><span class="muted small">Serie</span><span class="muted small">%</span><span></span>
          ${p.accionistas.map((a, i) => `
            <input data-list="accionistas" data-i="${i}" data-k="nombre" value="${esc(a.nombre)}" aria-label="Accionista">
            <input data-list="accionistas" data-i="${i}" data-k="acciones" value="${esc(a.acciones)}" inputmode="numeric" aria-label="Acciones">
            <input data-list="accionistas" data-i="${i}" data-k="serie" value="${esc(a.serie)}" aria-label="Serie">
            <span class="small acc-pct">${pct(a)}</span>
            <button type="button" class="icon-btn sm danger" data-list="accionistas" data-i="${i}" data-act="del-item" aria-label="Quitar">${icon('trash')}</button>`).join('')}
        </div>
        <p class="muted small">Total: ${totalAcc.toLocaleString('es-MX')} acciones</p>` : '<p class="muted small">Sin accionistas.</p>'}
        <button type="button" class="btn sm" data-act="add-accionista">${icon('plus')} Agregar accionista</button>
      </section>` : `
      <section class="card form-block">
        <h3>Datos personales</h3>
        <div class="form-grid">${PARTY_FIELDS.pf.map((f) => fieldHTML(p, f)).join('')}</div>
      </section>`}
      <section class="card form-block">
        <h3>Expediente y notas</h3>
        <div class="form-grid">
          <div class="field-with-btn">
            ${fieldHTML(p, ['expediente', 'Carpeta del expediente en Dropbox', 'text', '/Corporativo/Empresa/…'])}
            <button type="button" class="btn" data-act="browse-exp" ${dbx.isConnected() ? '' : 'disabled title="Conecta Dropbox en Ajustes"'}>${icon('folder')} Explorar</button>
          </div>
          ${fieldHTML(p, ['notas', 'Notas', 'address'])}
        </div>
      </section>
      <section class="card form-block">
        <h3>Vista previa de declaraciones</h3>
        <p class="muted small">Así se insertará con la variable de declaraciones${p.kind === 'pm' ? ' (con el primer apoderado vigente)' : ''}.</p>
        <p class="decl-preview">${esc(declaracionesText(p, p.apoderados.find((a) => a.vigente)))}</p>
      </section>
      <div class="row">
        <button type="button" class="btn ghost danger" data-act="delete">${icon('trash')} Eliminar del catálogo</button>
      </div>
    </form>`;

  const form = $('#party-form');
  const status = (t) => { const el = $('#party-save'); if (el) el.textContent = t; };
  const persist = debounce(async () => { await saveParty(p); status('Guardado'); }, 400);
  const target = (el) => (el.dataset.list ? p[el.dataset.list][Number(el.dataset.i)]
    : el.closest('[data-list]') ? p[el.closest('[data-list]').dataset.list][Number(el.closest('[data-list]').dataset.i)] : p);

  form.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k || e.target.type === 'checkbox' || k === 'kind') return;
    target(e.target)[k] = k === 'rfc' || k === 'curp' ? e.target.value.toUpperCase() : e.target.value;
    status('Guardando…');
    persist();
  });
  form.addEventListener('change', async (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    if (e.target.type === 'checkbox') target(e.target)[k] = e.target.checked;
    else if (k === 'kind') p.kind = e.target.value;
    else if (k === 'rfc' || k === 'curp') e.target.value = e.target.value.toUpperCase();
    const otra = k === 'rfc' && e.target.closest('[data-list]') == null && rfcDuplicado(p.rfc, state.parties, p.id);
    if (otra) {
      const rfc = p.rfc;
      p.rfc = '';
      await saveParty(p);
      const ir = await avisoRfcDuplicado(p, rfc, otra, { vacia: fichaVacia(p) && !p.nombre?.trim() });
      if (ir) return go(`#/catalogo/${ir.id}`);
      return renderPartyEditor(p.id);
    }
    await saveParty(p);
    // Redibuja para recalcular faltantes, porcentajes y la vista previa (si seguimos en la ficha)
    if (location.hash !== `#/catalogo/${p.id}`) return;
    const y = window.scrollY;
    renderPartyEditor(p.id);
    window.scrollTo(0, y);
  });
  form.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const y = window.scrollY;
    switch (btn.dataset.act) {
      case 'add-apoderado': p.apoderados.push(newApoderado()); break;
      case 'add-accionista': p.accionistas.push(newAccionista()); break;
      case 'del-item': {
        const holder = btn.dataset.list ? btn : btn.closest('[data-list]');
        p[holder.dataset.list].splice(Number(holder.dataset.i), 1);
        break;
      }
      case 'browse-exp': {
        const folder = await browseDropbox({ mode: 'folder', start: p.expediente || (p.propia ? sync.expedientesRoot() : sync.clientesRoot()), title: `Expediente de ${p.nombre || 'la parte'}` });
        if (!folder) return;
        p.expediente = folder;
        break;
      }
      case 'delete': {
        if (await deleteParty(p)) go('#/catalogo');
        return;
      }
      default: return;
    }
    await saveParty(p);
    renderPartyEditor(p.id);
    window.scrollTo(0, y);
  });
  $('#party-extract').addEventListener('click', conAviso(async () => {
    const res = await extraerDePdf(p);
    if (!res || res === 'otra') return;
    const y = window.scrollY;
    renderPartyEditor(p.id);
    window.scrollTo(0, y);
  }));
  $('#use-in-contract')?.addEventListener('click', async () => {
    await saveParty(p);
    const { contractId, signerId } = state.returnTo;
    state.returnTo = null;
    const c = state.contracts.find((x) => x.id === contractId);
    const sg = c?.signers.find((s) => s.id === signerId);
    if (!sg) return go('#/catalogo');
    state.current = c;
    if (await linkPartyToSigner(sg, p)) await saveContract(c);
    go(`#/c/${c.id}/variables`);
  });
}

// --- Llenar la ficha desde un PDF del expediente (#8) ---
// Campos que puede llenar cada tipo de documento: [campo, etiqueta, tipo]
const CAMPOS_PDF = {
  csf: [['nombre', 'Nombre o razón social'], ['rfc', 'RFC'], ['curp', 'CURP'], ['domicilio', 'Domicilio', 'address'], ['correo', 'Correo']],
  acta: [['nombre', 'Razón social (sin tipo de sociedad)'], ...PARTY_FIELDS.pm.map(([k, l, t]) => [k, l, t])],
  poder: PARTY_FIELDS.apoderado.filter(([k]) => !['cargo', 'identificacion', 'identificacionVigencia'].includes(k)).map(([k, l, t]) => [k, l, t]),
  rpp: [['nombre', 'Razón social (sin tipo de sociedad)'], ['folioMercantil', 'Folio mercantil electrónico'], ['folioFecha', 'Fecha de inscripción del folio', 'date'], ['folioLugar', 'Lugar de inscripción']],
  // INE: en una persona moral va al apoderado; en una persona física, a la ficha
  ine: [['nombre', 'Nombre del apoderado'], ['identificacion', 'Identificación (INE)'], ['identificacionVigencia', 'Vigencia de la INE (año)']],
  inePf: [['nombre', 'Nombre'], ['curp', 'CURP'], ['identificacion', 'Identificación'], ['sexo', 'Sexo']],
};
/** El documento se aplica a un apoderado (poder, o INE de una persona moral). */
const vaAlApoderado = (tipo, p) => tipo === 'poder' || (tipo === 'ine' && p.kind === 'pm');

/** Elige uno o varios PDF del expediente en Dropbox o del equipo. Devuelve [{name, data}] (vacío si se cancela). */
async function elegirPdfs(p, { titulo = 'Llenar desde PDF', texto } = {}) {
  const ia = (await estadoIA()).activa;
  const r = await modal({
    title: titulo,
    body: `
      <p class="muted small">${texto || `Constancia de situación fiscal, escritura constitutiva, escritura de poder, boleta del Registro Público o INE del apoderado; puedes elegir varios a la vez. ${ia ? 'Los escaneados se leen con IA.' : 'Solo PDFs con texto: los escaneados se capturan a mano.'} Antes de aplicar, revisas cada dato.`}</p>
      <div class="menu-list">
        <button value="dbx" class="menu-item">${icon('folder')} <span>Del expediente en Dropbox${dbx.isConnected() ? '' : '<span class="muted small"> · no conectado en este navegador</span>'}</span></button>
        <button value="local" class="menu-item">${icon('upload')} Desde este equipo</button>
      </div>`,
  });
  if (r.value === 'dbx' && !dbx.isConnected()) {
    toast('Dropbox no está conectado en este navegador: conéctalo en Ajustes o usa “Desde este equipo”', 'error');
    return [];
  }
  if (r.value === 'dbx') {
    const start = p ? (p.expediente || (p.nombre ? expedienteOf(p) : sync.expedientesRoot())) : sync.expedientesRoot();
    let files = await browseDropbox({ start, title: 'Elegir los PDF', shortcuts: [{ label: 'Expedientes del grupo', path: sync.expedientesRoot() }, { label: 'Clientes', path: sync.clientesRoot() }] });
    files = files?.filter((f) => /\.pdf$/i.test(f.name));
    if (!files) return [];
    if (!files.length) { toast('Elige al menos un archivo PDF', 'error'); return []; }
    toast(`Descargando ${files.length} PDF…`);
    const out = [];
    for (const f of files) out.push({ name: f.name, data: (await dbx.download(f.path_lower || f.path_display)).data });
    return out;
  }
  if (r.value === 'local') {
    const files = await new Promise((resolve) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.pdf,application/pdf', multiple: true });
      input.addEventListener('change', () => resolve([...input.files]));
      input.addEventListener('cancel', () => resolve([]));
      input.click();
    });
    return Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
  }
  return [];
}

/** Lee uno o varios PDF de la misma parte y los revisa uno por uno. true si cambió la ficha; 'otra' si se fue a otra ficha. */
async function extraerDePdf(p) {
  const pdfs = await elegirPdfs(p);
  let cambio = false;
  for (let i = 0; i < pdfs.length; i++) {
    const r = await revisarPdf(p, pdfs[i], pdfs.length > 1 ? `${i + 1} de ${pdfs.length}: ` : '');
    if (r === 'otra') return 'otra';
    cambio ||= r;
  }
  return cambio;
}

/** Muestra lo encontrado en un PDF para revisión y aplica lo marcado. true si cambió la ficha. */
async function revisarPdf(p, pdf, prefijo = '') {
  toast(`Leyendo ${pdf.name}…`);
  const text = await pdfText(pdf.data);
  let ia = null;
  const escaneado = sinTexto(text);
  const aviso = (msg) => modal({
    title: 'PDF sin texto',
    body: `<p><strong>${esc(pdf.name)}</strong> parece escaneado (es una imagen, no tiene texto que leer). ${msg}</p>`,
    actions: [{ label: 'Entendido', value: '', kind: 'primary' }],
  });
  // Con IA encendida también se usa cuando el texto del PDF no alcanza (p. ej. escaneado con una capa de texto pobre)
  const tipoTxt = escaneado ? null : detectarTipo(text);
  const pobre = escaneado || lecturaPobre(tipoTxt, tipoTxt ? extraer(tipoTxt, text) : {});
  if (pobre && (await estadoIA()).activa) {
    toast(`Leyendo ${pdf.name} con IA (puede tardar hasta un minuto)…`);
    try {
      ia = await leerConIA(pdf);
      if (ia.tipo === 'otro' || !Object.keys(ia.datos).length) ia = null;
    } catch (err) {
      if (escaneado) { await aviso(`No se pudo leer con IA: ${esc(err.message)}`); return false; }
      toast(`No se pudo leer con IA (${err.message}); se muestra lo leído del texto`, 'error');
    }
    if (!ia && escaneado) {
      await aviso('La IA no lo reconoció como constancia fiscal, escritura constitutiva, poder, boleta del Registro Público ni INE. Captura los datos a mano.');
      return false;
    }
  } else if (escaneado) {
    await aviso('Captura los datos a mano: la lectura con IA está apagada.');
    return false;
  }
  const detectado = ia ? ia.tipo : detectarTipo(text);
  let tipo = detectado || (p.kind === 'pm' ? 'acta' : 'csf');
  if (p.kind === 'pf' && ['acta', 'rpp'].includes(tipo)) tipo = 'csf';
  const sugerirApo = (nombre) => p.apoderados.map((a) => ({ a, s: parecido(nombre || '', a.nombre) })).filter((x) => x.s >= 0.8).sort((x, y) => y.s - x.s)[0]?.a;

  // apoId: undefined = el apoderado que más se parece al del poder; '' = nuevo
  const filas = (t, apoId) => {
    // Lo leído con IA vale para cualquier tipo elegido (los campos de cada tipo son distintos)
    const data = ia ? { ...ia.datos, kind: ia.kind || undefined } : extraer(t, text);
    const campos = CAMPOS_PDF[t === 'ine' && p.kind === 'pf' ? 'inePf' : t].filter(([k]) => k !== 'curp' || p.kind === 'pf');
    const alApo = vaAlApoderado(t, p);
    const apo = !alApo ? null : apoId === undefined ? sugerirApo(data.nombre) : p.apoderados.find((a) => a.id === apoId);
    const actualDe = (k, destino) => String((destino ?? p)[k] ?? '');
    const hall = campos.filter(([k]) => data[k]);
    const faltan = campos.filter(([k]) => !data[k]).map(([, l]) => l);
    const vencida = t === 'ine' && Number(data.identificacionVigencia) && Number(data.identificacionVigencia) < new Date().getFullYear();
    const aviso = t === 'csf' && data.kind && data.kind !== p.kind
      ? `<div class="banner warn">${icon('alert')} <span>La constancia es de una ${data.kind === 'pm' ? 'persona moral' : 'persona física'} y esta ficha es de ${PARTY_KINDS[p.kind].toLowerCase()}.</span></div>`
      : vencida ? `<div class="banner warn">${icon('alert')} <span>La INE venció en ${esc(data.identificacionVigencia)}: pide una vigente antes de firmar.</span></div>` : '';
    return `
      ${aviso}
      ${alApo ? `
        <label class="field"><span>Aplicar al apoderado</span>
          <select name="apo" id="ex-apo">
            <option value="">Nuevo apoderado</option>
            ${p.apoderados.map((a) => `<option value="${esc(a.id)}" ${a === apo ? 'selected' : ''}>${esc(a.nombre || 'Sin nombre')}</option>`).join('')}
          </select>
        </label>` : ''}
      ${hall.length ? `
      <div class="ll-row ll-head ex-row"><span></span><span>Dato</span><span>Encontrado en el PDF (puedes corregirlo)</span></div>
      ${hall.map(([k, l, ty]) => {
        const actual = alApo ? (apo ? actualDe(k, apo) : '') : actualDe(k);
        const v = data[k];
        const igual = folderKey(actual) === folderKey(v); // sin acentos, signos ni mayúsculas
        const input = ty === 'address' || k === 'objetoSocial'
          ? `<textarea name="v_${k}" rows="${k === 'objetoSocial' ? 4 : 2}">${esc(v)}</textarea>`
          : `<input name="v_${k}" type="${ty === 'date' ? 'date' : 'text'}" value="${esc(v)}">`;
        return `
        <div class="ll-row ex-row">
          <span><input type="checkbox" name="u_${k}" ${!actual.trim() ? 'checked' : ''} aria-label="Aplicar ${esc(l)}"></span>
          <span><strong class="small">${esc(l)}</strong>${actual.trim() ? `<span class="muted small clamp">Actual: ${esc(ty === 'date' ? fmtLongDate(actual) : actual)}</span>` : '<span class="muted small">Vacío</span>'}
            ${actual.trim() && !igual ? '<span class="badge borrador">Distinto</span>' : ''}${igual ? '<span class="badge final">Igual</span>' : ''}</span>
          <span>${input}</span>
        </div>`;
      }).join('')}` : '<p class="muted">No encontré datos de este tipo de documento. Revisa el tipo o captura a mano.</p>'}
      ${faltan.length && hall.length ? `<p class="muted small">No encontrados: ${esc(faltan.join(', '))}.</p>` : ''}`;
  };

  const r = await modal({
    title: `${prefijo}Datos de ${pdf.name}`,
    wide: true,
    body: `
      <label class="field inline"><span>Tipo de documento</span>
        <select name="tipo" id="ex-tipo">${Object.entries(TIPOS).filter(([k]) => !['acta', 'rpp'].includes(k) || p.kind === 'pm').map(([k, l]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${l}${k === detectado ? ' (detectado)' : ''}</option>`).join('')}</select>
      </label>
      <p class="muted small">Marcados = se aplican. Los datos que ya tienes vienen sin marcar: márcalos solo si el PDF es más reciente o correcto.</p>
      ${ia ? `<div class="banner warn">${icon('alert')} <span>Documento escaneado leído con IA: compara cada dato con el PDF antes de aplicarlo.</span></div>` : ''}
      <div id="ex-filas">${filas(tipo)}</div>`,
    actions: [{ label: prefijo ? 'Omitir este' : 'Cancelar', value: '', kind: 'ghost', formnovalidate: true }, { label: 'Aplicar marcados', value: 'ok', kind: 'primary' }],
    onOpen: (dlg) => {
      $('#ex-tipo', dlg).addEventListener('change', (e) => { tipo = e.target.value; $('#ex-filas', dlg).innerHTML = filas(tipo); });
      // Al cambiar de apoderado se recalcula "Actual" y qué viene marcado
      dlg.addEventListener('change', (e) => {
        if (e.target.id === 'ex-apo') $('#ex-filas', dlg).innerHTML = filas(tipo, e.target.value);
      });
    },
  });
  if (r.value !== 'ok') return false;
  const usar = Object.keys(r.data).filter((k) => k.startsWith('u_')).map((k) => k.slice(2));
  if (!usar.length) { toast('No marcaste ningún dato'); return false; }
  // Si el RFC de la constancia ya es de otra ficha, los datos van a esa (no se duplica)
  if (usar.includes('rfc') && !vaAlApoderado(r.data.tipo, p)) {
    const rfc = String(r.data.v_rfc ?? '').trim().toUpperCase();
    const otra = rfcDuplicado(rfc, state.parties, p.id);
    if (otra) {
      const ir = await avisoRfcDuplicado(p, rfc, otra, { vacia: fichaVacia(p), conDatos: true });
      if (!ir) return false;
      for (const k of usar) {
        const v = String(r.data[`v_${k}`] ?? '').trim();
        ir[k] = k === 'rfc' || k === 'curp' ? v.toUpperCase() : v;
      }
      await saveParty(ir);
      toast(`${usar.length} dato${usar.length === 1 ? '' : 's'} aplicado${usar.length === 1 ? '' : 's'} a ${ir.nombre || 'la ficha existente'}`, 'ok');
      go(`#/catalogo/${ir.id}`);
      return 'otra';
    }
  }
  let destino = p;
  if (vaAlApoderado(r.data.tipo, p)) {
    destino = p.apoderados.find((a) => a.id === r.data.apo);
    if (!destino) { destino = newApoderado(); p.apoderados.push(destino); }
  }
  for (const k of usar) {
    const v = String(r.data[`v_${k}`] ?? '').trim();
    destino[k] = k === 'rfc' || k === 'curp' ? v.toUpperCase() : v;
  }
  await saveParty(p);
  toast(`${usar.length} dato${usar.length === 1 ? '' : 's'} aplicado${usar.length === 1 ? '' : 's'}`, 'ok');
  return true;
}

/** Alta o complemento de varias fichas a la vez desde PDF; se revisa todo en una tabla antes de guardar. */
async function altaDesdePdfs() {
  const pdfs = await elegirPdfs(null, {
    titulo: 'Alta desde PDFs',
    texto: 'Elige las constancias fiscales, escrituras constitutivas, poderes, boletas del Registro Público e INE de los apoderados de una o varias empresas. Se crea una ficha por empresa (las que ya existen solo se completan, sin borrar datos). Antes de guardar revisas la lista.',
  });
  if (!pdfs.length) return;
  const docs = [];
  const conIA = (await estadoIA()).activa;
  for (let i = 0; i < pdfs.length; i++) {
    toast(`Leyendo ${i + 1} de ${pdfs.length}: ${pdfs[i].name}`);
    const d = { name: pdfs[i].name, text: '' };
    try {
      d.text = await pdfText(pdfs[i].data);
    } catch (err) {
      console.error(err);
    }
    const escaneado = sinTexto(d.text);
    const tipoTxt = escaneado ? null : detectarTipo(d.text);
    // También va a la IA el PDF con texto del que no se pudo sacar el dato principal
    if (conIA && (escaneado || lecturaPobre(tipoTxt, tipoTxt ? extraer(tipoTxt, d.text) : {}))) {
      toast(`Leyendo con IA ${i + 1} de ${pdfs.length}: ${pdfs[i].name}`);
      try {
        const ia = await leerConIA(pdfs[i]);
        // Con texto, si la IA no lo reconoce se queda lo leído del texto
        if (escaneado || ia.tipo !== 'otro') d.ia = ia;
      } catch (err) {
        if (escaneado) d.errorIA = `Escaneado: no se pudo leer con IA (${err.message}).`;
      }
    }
    docs.push(d);
  }
  const { filas, omitidos } = planAlta(docs, state.parties);
  const TIPO_CORTO = { csf: 'Constancia', acta: 'Constitutiva', poder: 'Poder', rpp: 'RPP', ine: 'INE' };
  const r = await modal({
    title: `Alta desde ${pdfs.length} PDF`,
    wide: true,
    body: `
      ${filas.length ? `
      <p class="muted small">Marcadas = se guardan. En fichas que ya existen solo se llenan datos vacíos.${filas.some((f) => f.docs.some((d) => d.ia)) ? ' Los marcados “IA” eran escaneados: revisa esas fichas contra el PDF después de guardar.' : ''}</p>
      <label class="field inline"><span>Las fichas nuevas son</span>
        <select name="propia"><option value="no">Contrapartes (clientes, proveedores)</option><option value="si">Empresas del grupo</option></select></label>
      <div class="card lotes-list alta-list">
        <div class="ll-row ll-head"><span></span><span>Empresa o persona</span><span>RFC</span><span>Documentos</span><span>Acción</span></div>
        ${filas.map((f, i) => `
        <div class="ll-row">
          <span><input type="checkbox" name="f_${i}" ${f.nueva || f.llenos ? 'checked' : ''} aria-label="Guardar ${esc(f.party.nombre)}"></span>
          <span><strong>${esc(f.party.nombre || 'Sin nombre')}</strong>${f.party.apoderados.length ? `<span class="muted small">Apoderados: ${esc(f.party.apoderados.map((a) => a.nombre).filter(Boolean).join(', '))}</span>` : ''}</span>
          <span class="mono small">${esc(f.party.rfc || '—')}</span>
          <span class="small">${f.docs.map((d) => `${TIPO_CORTO[d.tipo]}: ${esc(d.name)}${d.ia ? ' <span class="badge revision">IA</span>' : ''}`).join('<br>')}</span>
          <span class="small">${f.nueva ? '<span class="badge final">Nueva</span>' : f.llenos ? `<span class="badge revision">Completa ${f.llenos} dato${f.llenos === 1 ? '' : 's'}</span>` : '<span class="muted">Sin cambios</span>'}</span>
        </div>`).join('')}
      </div>` : '<p>No encontré datos para dar de alta.</p>'}
      ${omitidos.length ? `<h4 class="sub">No se usaron (${omitidos.length})</h4><ul class="err-list small">${omitidos.map((o) => `<li><strong>${esc(o.name)}</strong>: ${esc(o.motivo)}</li>`).join('')}</ul>` : ''}`,
    actions: filas.length
      ? [{ label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true }, { label: 'Guardar marcadas', value: 'ok', kind: 'primary' }]
      : [{ label: 'Cerrar', value: '', kind: 'primary' }],
  });
  if (r.value !== 'ok') return;
  const elegidas = filas.filter((f, i) => r.data[`f_${i}`]);
  for (const f of elegidas) {
    if (f.nueva) f.party.propia = r.data.propia === 'si';
    await saveParty(f.party);
  }
  await propagarCatalogo();
  const nuevas = elegidas.filter((f) => f.nueva).length;
  toast(`${nuevas} ficha${nuevas === 1 ? '' : 's'} nueva${nuevas === 1 ? '' : 's'} y ${elegidas.length - nuevas} completada${elegidas.length - nuevas === 1 ? '' : 's'}`, 'ok');
  renderCatalog();
}

// --- Partes dentro del contrato (pestaña Variables) ---
function partiesBlock(c) {
  if (!c.signers.length) return '';
  const linked = c.signers.filter((s) => s.party);
  const hasDecl = c.sections.some((s) => /declaraciones/i.test(s.title));
  return `
    <section class="card parties-box">
      <div class="parties-head">
        <strong>Partes del contrato</strong>
        <span class="muted small">Elige del catálogo y se llenan nombre, RFC, domicilio, representante, escritura y declaraciones.</span>
      </div>
      ${c.signers.map((sg) => {
        const p = sg.party && state.parties.find((x) => x.id === sg.party.id);
        const apo = p?.apoderados.find((a) => a.id === sg.party.apoderadoId);
        return `
        <div class="party-slot" data-sid="${esc(sg.id)}">
          <div class="party-slot-info">
            <span class="muted small">${esc(sg.role)}</span>
            <strong>${sg.party ? esc(p?.nombre || 'Parte eliminada del catálogo') : '<span class="muted">Sin vincular</span>'}</strong>
            ${apo ? `<span class="small">Firma: ${esc(apo.nombre)} · ${esc(apo.cargo)}</span>` : ''}
            ${sg.party ? `<span class="small muted">Variables: <code>{{${esc(sg.party.prefix)}_…}}</code></span>` : ''}
          </div>
          <div class="party-slot-actions">
            ${sg.party ? `
              ${p ? '<button class="btn sm" data-pact="refresh" title="Volver a copiar los datos del catálogo">Actualizar</button>' : ''}
              <button class="btn sm" data-pact="pick">Cambiar</button>
              <button class="link danger" data-pact="unlink">Desvincular</button>`
              : `<button class="btn sm primary" data-pact="pick">${icon('users')} Elegir del catálogo</button>`}
          </div>
        </div>`;
      }).join('')}
      ${linked.length && !hasDecl ? `<button class="btn sm" data-pact="decl">${icon('plus')} Agregar sección de Declaraciones</button>` : ''}
    </section>`;
}

async function pickParty(sg) {
  const c = state.current;
  const list = sortParties(state.parties.filter((p) => p.activa));
  const item = (p) => `
    <button value="${esc(p.id)}" class="menu-item party-pick" data-search="${esc(`${p.nombre} ${p.rfc}`.toLowerCase())}">
      ${icon(p.kind === 'pm' ? 'building' : 'user')}
      <span><strong>${esc(p.nombre || 'Sin nombre')}</strong><span class="muted small mono">${esc(p.rfc)}</span></span>
    </button>`;
  const grupo = list.filter((p) => p.propia);
  const otras = list.filter((p) => !p.propia);
  const r = await modal({
    title: `Elegir parte: ${sg.role}`,
    body: `
      <label class="search">${icon('search')}<input id="pick-q" type="search" placeholder="Buscar por nombre o RFC" autofocus></label>
      ${grupo.length ? `<h4 class="sub">Empresas del grupo</h4><div class="menu-list">${grupo.map(item).join('')}</div>` : ''}
      ${otras.length ? `<h4 class="sub">Contrapartes</h4><div class="menu-list">${otras.map(item).join('')}</div>` : ''}
      ${list.length ? '' : '<p class="muted">El catálogo está vacío.</p>'}`,
    actions: [{ label: 'Capturar nueva en el catálogo', value: '__new', kind: 'ghost' }],
    wide: true,
    onOpen: (dlg) => {
      $('#pick-q', dlg).addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        $$('.party-pick', dlg).forEach((b) => { b.hidden = q && !b.dataset.search.includes(q); });
      });
    },
  });
  if (!r.value) return;
  if (r.value === '__new') {
    await saveNow();
    state.returnTo = { contractId: c.id, signerId: sg.id };
    return createParty();
  }
  const p = state.parties.find((x) => x.id === r.value);
  if (await linkPartyToSigner(sg, p)) renderVariables();
}

/** Pregunta quién firma (personas morales) y escribe los datos en el contrato. */
async function linkPartyToSigner(sg, p, apoderadoId) {
  const c = state.current;
  let apo = null;
  if (p.kind === 'pm') {
    if (apoderadoId === undefined) {
      const apos = p.apoderados.filter((a) => a.nombre.trim());
      const r = await modal({
        title: `¿Quién firma por ${p.nombre}?`,
        body: apos.length ? `<div class="radio-list">${apos.map((a, i) => `
          <label class="radio-item ${a.vigente ? '' : 'off'}">
            <input type="radio" name="apo" value="${esc(a.id)}" ${i === 0 && a.vigente ? 'checked' : ''} required>
            <span><span><strong>${esc(a.nombre)}</strong> · ${esc(a.cargo)}${a.vigente ? '' : ' · <span class="warn-text">poder no vigente</span>'}</span>
            <span class="muted small">${a.poderNumero ? `Escritura ${esc(a.poderNumero)}${a.poderFecha ? ` del ${esc(fmtLongDate(a.poderFecha))}` : ''}` : 'Sin datos del poder'}${a.facultades ? ` · ${esc(a.facultades)}` : ''}</span></span>
          </label>`).join('')}
          <label class="radio-item"><input type="radio" name="apo" value="none"> <span>Sin representante por ahora</span></label></div>`
          : `<p class="muted">Esta empresa no tiene apoderados en el catálogo. Se vinculará sin representante; agrégalo en el catálogo y pulsa “Actualizar”.</p><input type="hidden" name="apo" value="none">`,
        actions: [{ label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true }, { label: 'Usar', value: 'ok', kind: 'primary' }],
      });
      if (r.value !== 'ok') return false;
      apoderadoId = r.data.apo === 'none' ? null : r.data.apo;
    }
    apo = p.apoderados.find((a) => a.id === apoderadoId) || null;
  }
  applyParty(c, sg, p, apo);
  syncVarDefs(c);
  touched({ log: `Vinculó a ${p.nombre} como ${sg.role}${apo ? ` (firma ${apo.nombre})` : ''}` });
  toast('Datos del catálogo aplicados', 'ok');
  return true;
}

async function partyAction(act, sg) {
  const c = state.current;
  if (act === 'pick') return pickParty(sg);
  if (act === 'refresh') {
    const p = state.parties.find((x) => x.id === sg.party.id);
    const keep = p.apoderados.some((a) => a.id === sg.party.apoderadoId) ? sg.party.apoderadoId : undefined;
    if (await linkPartyToSigner(sg, p, keep)) renderVariables();
    return;
  }
  if (act === 'unlink') {
    delete sg.party;
    touched({ log: `Desvinculó del catálogo a ${sg.role}`, content: false });
    toast('Desvinculado. Los datos ya escritos se conservan.');
    return renderVariables();
  }
  if (act === 'decl') {
    const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    const body = c.signers.filter((s) => s.party).map((s, i) =>
      `${roman[i] || i + 1}. Declara ${/^(el|la|los|las)\s/i.test(s.role) ? s.role.replace(/^\S+/, (m) => m.toLowerCase()) : `la ${s.role}`}, ${c.varDefs.some((d) => d.key === `${s.party.prefix}_representante`) && c.variables[`${s.party.prefix}_representante`] ? `por conducto de su representante, ` : ''}bajo protesta de decir verdad:\n{{${s.party.prefix}_declaraciones}}`).join('\n');
    const idx = c.sections.findIndex((s) => /^partes$/i.test(s.title.trim()));
    c.sections.splice(idx >= 0 ? idx + 1 : 0, 0, { id: uid(), title: 'Declaraciones', body });
    syncVarDefs(c);
    touched({ log: 'Agregó la sección de Declaraciones' });
    toast('Sección de Declaraciones agregada', 'ok');
    return renderVariables();
  }
}

// ---------- Dropbox: sincronización ----------
const syncOpts = {
  loadExcel,
  catalog: { toXlsx: catalogToXlsx, fromXlsx: xlsxToCatalog },
  who: whoAmI,
  onPartyRenamed: remapPartyId,
};

/** Actualiza los contratos que apuntaban a una parte cuyo ID cambió. */
async function remapPartyId(oldId, newId) {
  for (const c of await db.getAll('contracts')) {
    const hits = c.signers.filter((sg) => sg.party?.id === oldId);
    if (!hits.length) continue;
    hits.forEach((sg) => { sg.party.id = newId; });
    await db.put('contracts', c);
    await sync.markDirty('contracts', c.id);
  }
}
let syncTimer = null;
let syncError = '';

function scheduleSync(ms = 4000) {
  if (!dbx.isConnected()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, ms);
}

function setSyncPill(mode, title = '') {
  const pill = $('#sync-pill');
  if (!pill) return;
  pill.hidden = !dbx.isConnected();
  pill.className = `sync-pill ${mode}`;
  pill.title = title;
  $('span', pill).textContent = { busy: 'Sincronizando…', ok: 'Dropbox', error: 'Sin sincronizar', pending: 'Cambios por subir' }[mode];
}

async function runSync({ manual = false } = {}) {
  if (!dbx.isConnected()) return;
  clearTimeout(syncTimer);
  await saveNow();
  setSyncPill('busy');
  try {
    const report = await sync.syncAll(syncOpts);
    syncError = '';
    setSyncPill('ok', `Última sincronización: ${fmtDateTime(Date.now())}`);
    await applySyncReport(report);
    if (manual) toast('Sincronizado con Dropbox', 'ok');
    // Lo editado mientras corría la sincronización (y las copias por conflicto) se sube en la siguiente vuelta
    if ((await sync.syncInfo()).pending) scheduleSync();
  } catch (err) {
    console.error(err);
    syncError = err.message || 'Error al sincronizar';
    setSyncPill(dbx.isConnected() ? 'error' : 'ok', syncError);
    if (manual || err.status === 401) toast(syncError, 'error');
  }
}

async function applySyncReport({ changed, conflicts }) {
  const any = changed.contracts.size || changed.templates.size || changed.parties.size || changed.lotes?.size;
  if (!any) return;
  const openId = state.current?.id;
  await loadAll();
  if (openId && changed.contracts.has(openId)) {
    const fresh = state.contracts.find((c) => c.id === openId);
    if (!fresh) {
      toast('Este contrato se eliminó en otro equipo', 'error');
      state.current = null;
      return go('#/');
    }
    state.current = fresh;
    syncVarDefs(fresh);
    toast(`${fresh.updatedBy || 'Otro usuario'} actualizó este contrato`);
  } else if (openId) {
    state.current = state.contracts.find((c) => c.id === openId) || state.current;
  }
  for (const cf of conflicts) {
    toast(`"${cf.title}" se editó en otro equipo al mismo tiempo; tu versión quedó como copia`, 'error');
  }
  // Redibuja la vista actual salvo que el usuario esté escribiendo en una ficha del catálogo
  const typing = document.activeElement?.matches?.('input, textarea, select') &&
    (location.hash.startsWith('#/catalogo/') || (location.hash.startsWith('#/c/') && !changed.contracts.has(openId)));
  if (!typing) route({ keepScroll: true });
}

// ---------- Dropbox: explorador ----------
/**
 * Explora Dropbox. mode 'files' → devuelve [entries] seleccionados; 'folder' → devuelve la ruta elegida.
 * `shortcuts` = [{label, path}] accesos rápidos (p. ej. expedientes de las partes del contrato).
 */
async function browseDropbox({ start, mode = 'files', title, shortcuts = [] }) {
  let path = dbx.normalizePath(start || dbx.config().folder);
  const selected = new Map();
  const r = await modal({
    title: title || (mode === 'folder' ? 'Elegir carpeta de Dropbox' : 'Elegir archivos de Dropbox'),
    wide: true,
    body: `
      ${shortcuts.length ? `<div class="chips scroll">${shortcuts.map((s, i) => `<button type="button" class="chip" data-short="${i}">${esc(s.label)}</button>`).join('')}</div>` : ''}
      <nav class="crumbs" id="dbx-crumbs"></nav>
      <div class="menu-list dbx-list" id="dbx-list"></div>
      <p class="muted small" id="dbx-sel"></p>`,
    actions: [
      { label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true },
      { label: mode === 'folder' ? 'Elegir esta carpeta' : 'Agregar seleccionados', value: 'ok', kind: 'primary' },
    ],
    onOpen: (dlg) => {
      const list = $('#dbx-list', dlg);
      const load = async (p) => {
        path = dbx.normalizePath(p);
        const parts = path.split('/').filter(Boolean);
        $('#dbx-crumbs', dlg).innerHTML = [`<button type="button" class="link" data-go="">Dropbox</button>`,
          ...parts.map((seg, i) => `<span>/</span><button type="button" class="link" data-go="/${esc(parts.slice(0, i + 1).join('/'))}">${esc(seg)}</button>`)].join('');
        list.innerHTML = '<p class="muted">Cargando…</p>';
        try {
          const entries = (await dbx.listFolder(path))
            .filter((e) => mode === 'files' || e['.tag'] === 'folder')
            .sort((a, b) => (a['.tag'] === 'folder' ? 0 : 1) - (b['.tag'] === 'folder' ? 0 : 1) || a.name.localeCompare(b.name, 'es'));
          list.innerHTML = entries.map((e) => e['.tag'] === 'folder'
            ? `<button type="button" class="menu-item" data-go="${esc(e.path_display)}">${icon('folder')} <span>${esc(e.name)}</span></button>`
            : `<label class="menu-item file-item"><input type="checkbox" data-file="${esc(e.path_display)}" ${selected.has(e.path_display) ? 'checked' : ''}> ${icon('doc')} <span>${esc(e.name)}</span><span class="muted small">${fmtSize(e.size)}</span></label>`).join('')
            || '<p class="muted">Carpeta vacía.</p>';
          list._entries = entries;
        } catch (err) {
          list.innerHTML = `<p class="error-text">${esc(err.message)}</p>`;
        }
      };
      dlg.addEventListener('click', (e) => {
        const goBtn = e.target.closest('[data-go]');
        if (goBtn) { e.preventDefault(); return load(goBtn.dataset.go); }
        const sc = e.target.closest('[data-short]');
        if (sc) { e.preventDefault(); load(shortcuts[Number(sc.dataset.short)].path); }
      });
      list.addEventListener('change', (e) => {
        const p = e.target.dataset.file;
        if (!p) return;
        if (e.target.checked) selected.set(p, list._entries.find((x) => x.path_display === p)); else selected.delete(p);
        $('#dbx-sel', dlg).textContent = selected.size ? `${selected.size} archivo(s) seleccionado(s)` : '';
      });
      load(path);
    },
  });
  if (r.value !== 'ok') return null;
  return mode === 'folder' ? path : [...selected.values()];
}

const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);

// Carpetas que ya existen en la raíz de expedientes del grupo y en la de clientes (se leen al abrir Anexos)
let expedienteFolders = [];
let clienteFolders = [];
const folderKey = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function loadExpedienteFolders() {
  try {
    expedienteFolders = (await dbx.listFolder(sync.expedientesRoot())).filter((e) => e['.tag'] === 'folder');
  } catch (err) {
    console.warn(err);
  }
  try {
    clienteFolders = (await dbx.listFolder(sync.clientesRoot())).filter((e) => e['.tag'] === 'folder');
  } catch {
    clienteFolders = []; // todavía no existe: se crea con el primer contrato
  }
}

/**
 * Carpeta del expediente de una parte: la guardada en el catálogo; si no hay, la carpeta existente
 * cuyo nombre coincide (p. ej. "MERCASA DEL BAJIO" ↔ "Mercasa del Bajío, S.A. de C.V."); si tampoco,
 * una nueva con el nombre de la parte. Las empresas del grupo viven en EXPEDIENTES CORPORATIVOS y los
 * clientes y contrapartes en EXPEDIENTES CLIENTES.
 */
function expedienteOf(p) {
  if (p.expediente) return dbx.normalizePath(p.expediente);
  const raiz = p.propia ? sync.expedientesRoot() : sync.clientesRoot();
  if (!p.propia) {
    // Clientes: misma carpeta con o sin tipo de sociedad ("SEGURIDOC" = "Seguridoc, S.A. de C.V."), pero sin
    // confundir nombres que solo empiezan igual ("BETA" ≠ "BETA LOGÍSTICA")
    const k = nucleo(p.nombre);
    const igual = k && clienteFolders.find((f) => nucleo(f.name) === k);
    if (igual) return igual.path_display;
    return dbx.joinPath(raiz, (p.nombre || 'Sin nombre').replace(/[\\/:*?"<>|]/g, '').trim());
  }
  const key = folderKey(p.nombre);
  const match = key.length >= 5 && expedienteFolders
    .filter((f) => { const k = folderKey(f.name); return k.length >= 5 && (key.startsWith(k) || k.startsWith(key)); })
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (match) return match.path_display;
  const name = (p.nombre || 'Sin nombre').replace(/[\\/:*?"<>|]/g, '').trim();
  return dbx.joinPath(raiz, name);
}

async function openDropboxFile(path) {
  // Se abre la pestaña antes de esperar la liga para que el navegador no la bloquee
  const win = window.open('about:blank', '_blank');
  try {
    const link = await dbx.temporaryLink(path);
    if (win) win.location = link; else location.assign(link);
  } catch (err) {
    win?.close();
    toast(err.message, 'error');
  }
}

// --- Pestaña: Anexos ---
function renderAnexos() {
  const c = state.current;
  c.anexos ||= [];
  const box = tabBox();
  const linked = c.signers.map((sg) => ({ sg, p: sg.party && state.parties.find((x) => x.id === sg.party.id) })).filter((x) => x.p);
  const connected = dbx.isConnected();
  box.innerHTML = `
    ${connected ? '' : `<div class="banner warn">${icon('alert')} <span>Conecta Dropbox en <a href="#/ajustes">Ajustes</a> para adjuntar documentos de las partes.</span></div>`}
    <div class="card soft sign-summary">
      <div>
        <strong>${c.anexos.length} anexo(s)</strong>
        <p class="muted small">Documentos de las partes guardados en Dropbox (identificaciones, actas, poderes, comprobantes). Se listan al final del PDF.</p>
      </div>
      <div class="row">
        <button class="btn" data-act="upload" ${connected ? '' : 'disabled'}>${icon('upload')} Subir archivo</button>
        <button class="btn primary" data-act="pick" ${connected ? '' : 'disabled'}>${icon('folder')} Agregar desde Dropbox</button>
      </div>
    </div>
    <div class="anexos">
      ${c.anexos.map((a, i) => `
        <div class="card anexo" data-i="${i}">
          <span class="sec-num">${i + 1}</span>
          <div class="anexo-main">
            <input data-f="title" value="${esc(a.title || a.name)}" aria-label="Descripción del anexo">
            <span class="muted small mono">${esc(a.path)}</span>
          </div>
          <div class="sec-actions">
            <button class="icon-btn sm" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Subir">${icon('up')}</button>
            <button class="icon-btn sm" data-act="down" ${i === c.anexos.length - 1 ? 'disabled' : ''} aria-label="Bajar">${icon('down')}</button>
            <button class="btn sm" data-act="open" ${connected ? '' : 'disabled'}>Abrir</button>
            <button class="icon-btn sm danger" data-act="del" aria-label="Quitar">${icon('trash')}</button>
          </div>
        </div>`).join('') || '<p class="empty-inline">Sin anexos.</p>'}
    </div>
    <input type="file" id="anexo-file" multiple hidden>`;

  box.addEventListener('input', (e) => {
    if (e.target.dataset.f !== 'title') return;
    c.anexos[Number(e.target.closest('.anexo').dataset.i)].title = e.target.value;
    touched({ log: 'Editó la descripción de un anexo', groupKey: 'anexo-title' });
  });
  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const i = Number(btn.closest('.anexo')?.dataset.i);
    switch (btn.dataset.act) {
      case 'pick': {
        await loadExpedienteFolders();
        const shortcuts = [
          ...linked.map(({ sg, p }) => ({ label: `${sg.role}: ${p.nombre}`, path: expedienteOf(p) })),
          { label: 'Expedientes del grupo', path: sync.expedientesRoot() },
          { label: 'Clientes', path: sync.clientesRoot() },
        ];
        const files = await browseDropbox({ start: shortcuts[0].path, shortcuts });
        if (!files?.length) return;
        for (const f of files) {
          if (c.anexos.some((a) => a.path.toLowerCase() === f.path_display.toLowerCase())) continue;
          c.anexos.push({ id: uid(), name: f.name, title: f.name.replace(/\.[^.]+$/, ''), path: f.path_display, size: f.size, addedAt: Date.now() });
        }
        touched({ log: `Agregó ${files.length} anexo(s)` });
        return renderAnexos();
      }
      case 'upload': return uploadAnexos(linked);
      case 'open': return openDropboxFile(c.anexos[i].path);
      case 'del':
        touched({ log: `Quitó el anexo "${c.anexos[i].title || c.anexos[i].name}"` });
        c.anexos.splice(i, 1);
        return renderAnexos();
      case 'up':
      case 'down': {
        const j = btn.dataset.act === 'up' ? i - 1 : i + 1;
        [c.anexos[i], c.anexos[j]] = [c.anexos[j], c.anexos[i]];
        touched({ log: 'Reordenó los anexos' });
        return renderAnexos();
      }
    }
  });
}

async function uploadAnexos(linked) {
  const c = state.current;
  await loadExpedienteFolders();
  // Elegir a qué expediente va el archivo
  const r = await modal({
    title: 'Subir archivo a Dropbox',
    body: `
      <p class="muted small">El archivo se guarda en el expediente de la parte y queda como anexo del contrato.</p>
      <div class="radio-list">
        ${linked.map(({ sg, p }, i) => `<label class="radio-item"><input type="radio" name="dest" value="${esc(p.id)}" ${i === 0 ? 'checked' : ''} required><span><strong>${esc(p.nombre)}</strong><span class="muted small">${esc(sg.role)} · ${esc(expedienteOf(p))}</span></span></label>`).join('')}
        <label class="radio-item"><input type="radio" name="dest" value="__other" ${linked.length ? '' : 'checked'}><span><strong>Otra carpeta…</strong></span></label>
      </div>`,
    actions: [{ label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true }, { label: 'Elegir archivo', value: 'ok', kind: 'primary' }],
  });
  if (r.value !== 'ok') return;
  let folder;
  let party = null;
  if (r.data.dest === '__other') {
    folder = await browseDropbox({ mode: 'folder', start: sync.expedientesRoot() });
    if (!folder) return;
  } else {
    party = state.parties.find((p) => p.id === r.data.dest);
    folder = expedienteOf(party);
  }
  const input = $('#anexo-file');
  input.value = '';
  const files = await new Promise((resolve) => {
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
  if (!files.length) return;
  toast(`Subiendo ${files.length} archivo(s)…`);
  let subidos = 0;
  try {
    for (const f of files) {
      const meta = await dbx.upload(dbx.joinPath(folder, f.name), f, { autorename: true });
      c.anexos.push({ id: uid(), name: meta.name, title: meta.name.replace(/\.[^.]+$/, ''), path: meta.path_display, size: meta.size, addedAt: Date.now() });
      subidos++;
    }
    if (party && !party.expediente) {
      party.expediente = folder;
      await saveParty(party);
    }
    toast('Archivo(s) subido(s) y agregado(s) como anexo', 'ok');
  } catch (err) {
    console.error(err);
    toast(`${err.message || 'No se pudo subir el archivo'}${subidos ? ` (se subieron ${subidos} de ${files.length})` : ''}`, 'error');
  } finally {
    // Lo que sí se subió queda guardado y a la vista aunque otro archivo haya fallado
    if (subidos) {
      touched({ log: `Subió ${subidos} anexo(s) a Dropbox` });
      renderAnexos();
    }
  }
}

// --- Ajustes: bloque de Dropbox ---
function docusignSettingsHTML() {
  if (ds.isGlobal()) return docusignGlobalHTML();
  const cfg = ds.config();
  const conn = ds.isConnected();
  const faltan = ds.estadoGlobal()?.faltan;
  return `
    <section class="card settings-block" id="ds-block">
      <h3>DocuSign (firma remota)</h3>
      ${faltan?.length ? `<div class="banner warn">${icon('alert')} <span>Conexión del despacho incompleta en Cloudflare: falta ${esc(faltan.join(', '))}. Mientras tanto, cada quien se conecta con su usuario.</span></div>` : ''}
      ${ds.isLinked() ? `
        <p>${conn ? 'Conectado' : 'Sesión vencida'} como <strong>${esc(cfg.user?.name || '')}</strong> <span class="muted">${esc(cfg.user?.email || '')}</span></p>
        <p class="muted small">Cuenta: ${esc(cfg.account?.name || '')} · ${esc(ds.ENVS[cfg.env])}</p>
        <p class="muted small">${cfg.refreshToken ? 'La sesión se renueva sola; si DocuSign la cierra, se vuelve a conectar aquí.' : 'DocuSign pide volver a entrar cada 8 horas.'} Los contratos ya enviados no se afectan.</p>
        <div class="row wrap">
          ${conn ? '' : '<button class="btn primary" data-ds="connect">Volver a conectar</button>'}
          <button class="btn ghost danger" data-ds="disconnect">Desconectar</button>
        </div>` : `
        <p class="muted">Envía los contratos de prestación de servicios aprobados para que las partes los firmen por correo con DocuSign.</p>
        <div class="form-grid full">
          <label class="field"><span>Integration Key</span><input id="ds-key" value="${esc(cfg.key || '')}" placeholder="p. ej. 1a2b3c4d-…" autocomplete="off"></label>
          <label class="field"><span>Ambiente</span><select id="ds-env">${Object.entries(ds.ENVS).map(([k, l]) => `<option value="${k}" ${k === cfg.env ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <details class="new-var">
          <summary>Cómo obtener el Integration Key (una sola vez)</summary>
          <ol class="small muted steps">
            <li>Entra a <a href="https://developers.docusign.com" target="_blank" rel="noopener">developers.docusign.com</a> y crea una cuenta de desarrollador (gratis, ambiente de pruebas).</li>
            <li>En <em>Settings → Apps and Keys</em> pulsa <em>Add App and Integration Key</em> y ponle “Documentos Legales”.</li>
            <li>En <em>Authentication</em>, a “Is your application able to securely store a client secret?” responde <b>No</b> y deja <em>Authorization Code Grant</em> (con PKCE). No generes <em>secret key</em>.</li>
            <li>En <em>Redirect URIs</em> agrega exactamente: <code>${esc(ds.redirectUri())}</code></li>
            <li>En <em>CORS configuration</em> agrega el origen <code>${esc(location.origin)}</code> y permite GET, POST y PUT.</li>
            <li>Copia el <em>Integration Key</em> aquí (o en <code>js/config.js</code> para que nadie lo capture). No uses ni compartas el <em>secret key</em>.</li>
          </ol>
        </details>
        <button class="btn primary" data-ds="connect">${icon('link')} Conectar con DocuSign</button>`}
    </section>`;
}

/** Conexión del despacho (servidor): nadie se conecta; solo se muestra el estado. */
function docusignGlobalHTML() {
  const g = ds.estadoGlobal();
  return `
    <section class="card settings-block" id="ds-block">
      <h3>DocuSign (firma remota)</h3>
      ${g.conectada ? `
        <p><span class="badge final">Conectado</span> Conexión del despacho: los sobres se envían desde <strong>${esc(g.remitente?.name || '')}</strong> <span class="muted">${esc(g.remitente?.email || '')}</span></p>
        <p class="muted small">Cuenta: ${esc(g.cuenta?.name || '')} · ${esc(ds.ENVS[g.env] || g.env)}. Nadie tiene que conectarse: todos los abogados envían y ven el estado de todos los contratos. La app registra quién envió cada uno.</p>`
      : `
        <div class="banner warn">${icon('alert')} <span>La conexión del despacho no está lista: ${esc(g.error || 'sin respuesta de DocuSign')}</span></div>
        ${g.consentimiento ? `
          <p class="small">Falta autorizarla una sola vez. Abre este enlace <strong>con el usuario de DocuSign que envía los contratos</strong> y acepta:</p>
          <div class="row wrap">
            <a class="btn primary" href="${esc(g.consentimiento)}" target="_blank" rel="noopener">${icon('link')} Autorizar en DocuSign</a>
            <button class="btn" data-ds="recheck">Ya autoricé, revisar</button>
          </div>`
        : `<p class="muted small">${g.admin ? 'Revisa las variables DOCUSIGN_* en Cloudflare.' : 'Avísale al administrador.'}</p>
          <button class="btn" data-ds="recheck">Revisar de nuevo</button>`}`}
    </section>`;
}

function bindDocusignSettings() {
  const box = $('#ds-block');
  if (!box) return;
  box.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-ds]')?.dataset.ds;
    if (!act) return;
    try {
      if (act === 'recheck') {
        await ds.cargarGlobal();
        toast(ds.isConnected() ? 'DocuSign del despacho conectado' : 'Todavía no está lista', ds.isConnected() ? 'ok' : 'error');
        return renderSettings();
      }
      if (act === 'connect') {
        if ($('#ds-key')) await ds.setOptions({ key: $('#ds-key').value, env: $('#ds-env').value });
        return await ds.startAuth();
      }
      if (act === 'disconnect') {
        if (!(await confirmDialog('Desconectar DocuSign', 'Los contratos ya enviados siguen su curso en DocuSign; para ver su estado tendrás que volver a conectar.', 'Desconectar'))) return;
        await ds.disconnect();
        toast('DocuSign desconectado');
        return renderSettings();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function dropboxSettingsHTML() {
  const cfg = dbx.config();
  const info = await sync.syncInfo();
  if (dbx.isConnected()) {
    return `
    <section class="card settings-block" id="dbx-block">
      <h3>Dropbox</h3>
      <p>Conectado como <strong>${esc(cfg.account?.name || '')}</strong> <span class="muted">${esc(cfg.account?.email || '')}</span></p>
      <p class="muted small">Carpeta compartida: <code>${esc(cfg.folder)}</code>${dbx.rootLabel() ? ` (${esc(dbx.rootLabel())})` : ''} · ${info.lastSync ? `Última sincronización ${fmtRelative(info.lastSync)}` : 'Aún sin sincronizar'}${info.pending ? ` · ${info.pending} cambio(s) por subir` : ''}</p>
      ${syncError ? `<p class="error-text">${esc(syncError)}</p>` : ''}
      <p class="muted small">El catálogo se guarda como <code>${esc(sync.CATALOG_FILE)}</code> en esa carpeta: se puede abrir y editar en Excel; los cambios entran a la app en la siguiente sincronización.</p>
      <div class="row wrap">
        <button class="btn primary" data-dbx="sync">Sincronizar ahora</button>
        <button class="btn" data-dbx="open-catalog">Abrir catálogo en Excel</button>
        <button class="btn ghost danger" data-dbx="disconnect">Desconectar</button>
      </div>
    </section>`;
  }
  return `
    <section class="card settings-block" id="dbx-block">
      <h3>Dropbox</h3>
      <p class="muted">Conecta la carpeta compartida del equipo para que los 3 usuarios vean los mismos contratos, catálogo y expedientes.</p>
      <div class="form-grid full">
        <label class="field"><span>App key de Dropbox</span><input id="dbx-key" value="${esc(cfg.appKey || '')}" placeholder="p. ej. a1b2c3d4e5f6g7h" autocomplete="off"></label>
        <label class="field"><span>Carpeta compartida</span><input id="dbx-folder" value="${esc(cfg.folder)}" placeholder="/Contratos App"></label>
      </div>
      <details class="new-var">
        <summary>Cómo obtener la App key (una sola vez, la persona con acceso a la cuenta)</summary>
        <ol class="small muted steps">
          <li>Entra a <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener">dropbox.com/developers/apps</a> → <em>Create app</em>.</li>
          <li>Elige <em>Scoped access</em> y <em>Full Dropbox</em> (para leer los expedientes existentes). Ponle un nombre, p. ej. “Contratos Legales”.</li>
          <li>En <em>Permissions</em> marca: <code>files.metadata.read</code>, <code>files.content.read</code>, <code>files.content.write</code> y guarda (Submit).</li>
          <li>En <em>Settings → OAuth 2 → Redirect URIs</em> agrega exactamente: <code>${esc(dbx.redirectUri())}</code></li>
          <li>En <em>Settings → Development users</em> pulsa <em>Enable additional users</em> para que entren los 3 usuarios.</li>
          <li>Copia la <em>App key</em> aquí (o en <code>js/config.js</code> para que nadie la capture).</li>
        </ol>
      </details>
      <button class="btn primary" data-dbx="connect">${icon('link')} Conectar con Dropbox</button>
    </section>`;
}

function bindDropboxSettings() {
  const block = $('#dbx-block');
  block?.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-dbx]')?.dataset.dbx;
    if (!act) return;
    if (act === 'connect') {
      const appKey = $('#dbx-key').value.trim();
      const folder = $('#dbx-folder').value;
      if (!appKey) return toast('Escribe la App key de Dropbox', 'error');
      if (!dbx.normalizePath(folder)) return toast('Escribe la carpeta compartida', 'error');
      // Solo se olvida el estado de sincronización si cambia la app o la carpeta; al reconectar
      // a lo mismo se conservan los borrados y cambios pendientes (si no, lo borrado volvería)
      const prev = dbx.config() || {};
      const changed = prev.appKey !== appKey || dbx.normalizePath(prev.folder) !== dbx.normalizePath(folder);
      await dbx.setOptions({ appKey, folder });
      if (changed) await sync.resetState();
      try { await dbx.startAuth(); } catch (err) { toast(err.message, 'error'); }
    } else if (act === 'sync') {
      await runSync({ manual: true });
      renderSettings();
    } else if (act === 'open-catalog') {
      openDropboxFile(dbx.joinPath(dbx.config().folder, sync.CATALOG_FILE));
    } else if (act === 'disconnect') {
      if (!(await confirmDialog('Desconectar Dropbox', 'Los datos se quedan en este equipo y en Dropbox; solo se deja de sincronizar. Los cambios aún no subidos se subirán al volver a conectar.', 'Desconectar'))) return;
      await dbx.disconnect();
      setSyncPill('ok');
      renderSettings();
    }
  });
}

// ---------- Aprobación y firma: flujo 1. Documento → 2. Aprobación → 3. Firma ----------
let docxReady;
function loadDocx() {
  if (window.docx) return Promise.resolve(window.docx);
  docxReady ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: 'vendor/docx.iife.js' });
    s.onload = () => resolve(window.docx);
    s.onerror = () => { docxReady = null; reject(new Error('No se pudo cargar el módulo de Word')); };
    document.head.appendChild(s);
  });
  return docxReady;
}

const safeName = (s) => String(s || 'Documento').replace(/[\\/:*?"<>|]/g, '').replace(/\s*·\s*/g, ' - ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Documento';

const categoriaDe = (c) => allTemplates().find((t) => t.id === c.templateId)?.category;

/** Parte a cuyo expediente va el contrato: el cliente o contraparte; en trabajo y comisión, la empresa (ver carpetas.js). */
function clientParty(c) {
  const partes = c.signers.map((sg) => ({ sg, p: sg.party && state.parties.find((p) => p.id === sg.party.id) })).filter((x) => x.p);
  return duenoCarpeta(c, partes, categoriaDe(c));
}

/** Carpeta de Dropbox donde se guardan Word y PDF: <expediente>/<tipo de contrato>/<título>. */
function contractFolder(c) {
  if (c.carpeta) return c.carpeta;
  const p = clientParty(c);
  const base = p ? expedienteOf(p) : dbx.joinPath(sync.clientesRoot(), 'SIN CLIENTE');
  return dbx.joinPath(base, subcarpetaDe(c, categoriaDe(c)), safeName(nombreDe(c)));
}

/** Sube a Dropbox (si está conectado) y descarga en este equipo. Devuelve el registro del documento. */
/** `reemplazar` → sobrescribe el archivo del mismo nombre (p. ej. el APROBADO al volver a aprobar) en lugar de crear "(1)". */
async function deliverFile(c, blob, filename, kind, { descargar = true, reemplazar = false } = {}) {
  let path = null;
  if (dbx.isConnected()) {
    await loadExpedienteFolders();
    const folder = contractFolder(c);
    const meta = await dbx.upload(dbx.joinPath(folder, filename), blob, reemplazar ? { reemplazar } : { autorename: true });
    path = meta.path_display;
    // Si la carpeta de la empresa se creó ahora, queda guardada en su ficha del catálogo
    const p = clientParty(c);
    if (p && !p.expediente && !c.carpeta) { p.expediente = expedienteOf(p); await saveParty(p); }
  }
  if (descargar) download(blob, filename);
  const rec = { id: uid(), kind, name: path ? path.split('/').pop() : filename, path, date: Date.now(), by: cuenta(), status: c.status };
  // Un archivo reemplazado no se lista dos veces
  const viejo = (d) => reemplazar && path && d.path?.toLowerCase() === path.toLowerCase();
  c.documentos = [rec, ...(c.documentos || []).filter((d) => !viejo(d))];
  return rec;
}

// ---------- Firma remota con DocuSign (contratos de prestación de servicios) ----------
const esServicios = esContratoServicios;
const ENVIO_ABIERTO = ['created', 'sent', 'delivered', 'signed'];
const revisando = new Set(); // contratos cuyo estado se está consultando
const ultimaRevision = new Map(); // id → última consulta automática
const envioActivo = (c) => !!c.docusign && ENVIO_ABIERTO.includes(c.docusign.status);

/** Persona que firma por un firmante: el apoderado elegido (persona moral) o la persona física. */
function firmantePersona(c, sg) {
  const p = sg.party && state.parties.find((x) => x.id === sg.party.id);
  const apo = p?.apoderados?.find((a) => a.id === sg.party.apoderadoId);
  return {
    nombre: apo?.nombre || (p?.kind === 'pf' ? p.nombre : '') || fill(c, sg.name).split(',')[0],
    correo: apo?.correo || p?.correo || '',
    propia: !!p?.propia,
  };
}

function envioHTML(c) {
  const e = c.docusign;
  const abierto = envioActivo(c);
  const cambio = abierto && e.hash && e.hash !== contentHash(c);
  return `
    <section class="card form-block" id="ds-envio">
      <h3>${icon('mail')} Firma con DocuSign · <span class="badge ${e.status === 'completed' ? 'final' : ['declined', 'voided'].includes(e.status) ? 'invalid' : 'revision'}">${esc(ds.statusLabel(e.status))}</span></h3>
      <p class="muted small">Enviado por ${esc(e.sentBy || '—')} el ${fmtDateTime(e.sentAt)} · ${esc(ds.ENVS[e.env] || '')}${e.checkedAt ? ` · revisado ${fmtRelative(e.checkedAt)}` : ''}</p>
      ${cambio ? `<div class="banner warn">${icon('alert')} <span>El contrato cambió después de enviarlo: en DocuSign se firma la versión enviada. Cancela el envío y vuelve a enviarlo.</span></div>` : ''}
      ${e.status === 'declined' ? `<div class="banner warn">${icon('alert')} <span>Un firmante rechazó firmar${e.recipients.find((r) => r.declinedReason) ? `: “${esc(e.recipients.find((r) => r.declinedReason).declinedReason)}”` : ''}.</span></div>` : ''}
      ${e.status === 'voided' && e.voidedReason ? `<p class="muted small">Motivo de cancelación: ${esc(e.voidedReason)}</p>` : ''}
      <div class="doc-list">${e.recipients.map((r) => `
        <div class="doc-item">
          <span class="badge ${r.status === 'completed' ? 'final' : r.status === 'declined' ? 'invalid' : 'revision'}">${esc(r.status === 'completed' ? 'Firmó' : r.status === 'declined' ? 'Rechazó' : r.status === 'delivered' ? 'Lo abrió' : 'Pendiente')}</span>
          <div class="anexo-main"><strong>${esc(r.name)}</strong><span class="muted small">${esc(r.email)}${r.signedAt ? ` · ${fmtDateTime(r.signedAt)}` : ''}</span></div>
        </div>`).join('')}
        ${(e.enApp || []).map((n) => `<div class="doc-item"><span class="badge final">En la app</span><div class="anexo-main"><strong>${esc(n)}</strong><span class="muted small">Firmó en la app antes del envío</span></div></div>`).join('')}
      </div>
      <div class="row wrap">
        ${abierto ? `
          ${ds.isConnected() ? '<button class="btn" data-wf="ds-refresh">Actualizar estado</button>' : '<button class="btn" data-wf="ds-settings">Conectar DocuSign para ver el estado</button>'}
          <button class="btn ghost danger" data-wf="ds-void">Cancelar envío</button>`
        : e.status !== 'completed' && c.status === 'aprobado' ? '<button class="btn primary" data-wf="ds-reset">Preparar un nuevo envío</button>' : ''}
      </div>
    </section>`;
}

async function enviarDocuSign(c) {
  if (!ds.isConnected() && ds.isGlobal()) {
    if (await confirmDialog('DocuSign no está listo', 'La conexión de DocuSign del despacho no está lista. Revisa Ajustes → DocuSign.', 'Ir a Ajustes', 'primary')) go('#/ajustes');
    return;
  }
  if (!ds.isConnected()) {
    if (await confirmDialog('Conectar DocuSign', ds.isLinked() ? 'La sesión de DocuSign venció. ¿Conectar de nuevo?' : 'Primero conecta la cuenta de DocuSign en Ajustes.', ds.isLinked() ? 'Conectar' : 'Ir a Ajustes', 'primary')) {
      return ds.isLinked() ? await ds.startAuth() : go('#/ajustes');
    }
    return;
  }
  // Con formato propio (Word original) las firmas hechas en la app no van en el documento: firman todos en DocuSign
  const pendientes = c.signers.filter((sg) => c.conMolde || !c.signatures[sg.id]);
  if (!pendientes.length) return toast('Todos los firmantes ya firmaron en la app', 'error');
  // Word subido como plantilla: DocuSign necesita en el Word la marca de firma {{_ds_<parte>}} de cada firmante
  const firmasDS = c.conMolde && allTemplates().find((t) => t.id === c.templateId)?.firmasDS;
  const sinMarca = firmasDS ? pendientes.filter((sg) => !firmasDS.includes(sg.bind?.prefix)) : [];
  if (sinMarca.length) return toast(`El Word de la plantilla no tiene dónde firmar ${sinMarca.map((sg) => fill(c, sg.role)).join(', ')}: agrega ${sinMarca.map((sg) => `{{_ds_${sg.bind?.prefix || 'parte'}}}`).join(', ')} en el Word y vuelve a subir la plantilla, o fírmalo en papel.`, 'error');
  const firmados = c.signers.filter((sg) => !c.conMolde && c.signatures[sg.id]);
  const r = await modal({
    title: 'Enviar a firma con DocuSign',
    wide: true,
    body: `
      <p class="muted small">Cada firmante recibe un correo de DocuSign con el ${c.conMolde ? 'Word' : 'PDF'} aprobado; todos firman a la vez.</p>
      ${pendientes.map((sg) => {
        const f = firmantePersona(c, sg);
        return `
        <fieldset class="card soft ds-rcpt">
          <legend><strong>${esc(sg.role)}</strong>${f.propia ? ' <span class="badge grupo">Nuestra parte</span>' : ''}</legend>
          <div class="form-grid">
            <label class="field"><span>Nombre de quien firma</span><input name="n_${esc(sg.id)}" value="${esc(f.nombre)}" required></label>
            <label class="field"><span>Correo</span><input name="e_${esc(sg.id)}" type="email" value="${esc(f.correo)}" required></label>
          </div>
        </fieldset>`;
      }).join('')}
      ${firmados.length ? `<p class="muted small">Ya firmaron en la app: ${firmados.map((sg) => esc(fill(c, sg.name) || sg.role)).join(', ')}.</p>` : ''}
      <label class="field"><span>Mensaje para los firmantes (opcional)</span><textarea name="msg" rows="2" maxlength="1000"></textarea></label>
      <label class="check"><input type="checkbox" name="guardar" checked> Guardar los correos en el catálogo</label>`,
    actions: [{ label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true }, { label: 'Enviar', value: 'ok', kind: 'primary' }],
  });
  if (r.value !== 'ok') return;
  if (state.current !== c) return toast('El contrato se actualizó desde otro equipo; vuelve a intentarlo', 'error');
  const anchors = {};
  const recipients = pendientes.map((sg, i) => {
    anchors[sg.id] = ds.anchorOf(i + 1);
    return { signerId: sg.id, name: String(r.data[`n_${sg.id}`]).trim(), email: String(r.data[`e_${sg.id}`]).trim(), anchor: anchors[sg.id], ...(c.conMolde ? { yOffset: '-36' } : {}) };
  });
  toast('Enviando a DocuSign…');
  const base = safeName(nombreDe(c));
  // Formato propio: va el Word del formato (DocuSign lo convierte a PDF respetando su estilo), con las marcas
  // invisibles de firma que trae el molde en el bloque de firmas de cada parte
  const porRol = Object.fromEntries(pendientes.filter((sg) => sg.bind?.prefix).map((sg) => [sg.bind.prefix, anchors[sg.id]]));
  const res = await ds.sendEnvelope({
    subject: `Firma: ${nombreDe(c)}`,
    message: r.data.msg,
    pdf: c.conMolde ? await wordDe(c, '', { anchors: porRol }) : buildPdf(c, { anchors }).blob,
    fileName: `${base}.${c.conMolde ? 'docx' : 'pdf'}`,
    recipients,
  });
  if (r.data.guardar) await guardarCorreos(c, pendientes, recipients);
  c.docusign = {
    envelopeId: res.envelopeId, status: res.status || 'sent', env: ds.config().env,
    // Con la conexión del despacho, el remitente en DocuSign es siempre el mismo: se registra quién lo envió desde la app
    sentAt: Date.now(), sentBy: (ds.isGlobal() ? cuenta() || ds.config().user?.name : ds.config().user?.name || cuenta()), hash: contentHash(c),
    recipients: recipients.map(({ signerId, name, email }) => ({ signerId, name, email, status: 'sent' })),
    enApp: firmados.map((sg) => fill(c, sg.name) || sg.role),
  };
  logChange(c, `Envió el contrato a firma con DocuSign a ${recipients.map((x) => `${x.name} <${x.email}>`).join(', ')}`);
  await saveContract(c);
  renderDocumento();
  toast('Enviado a firma: cada firmante recibirá un correo de DocuSign', 'ok');
}

/** Guarda en el catálogo el correo usado para cada firmante (apoderado o persona física). */
async function guardarCorreos(c, signers, recipients) {
  for (const sg of signers) {
    const p = sg.party && state.parties.find((x) => x.id === sg.party.id);
    const email = recipients.find((x) => x.signerId === sg.id)?.email;
    if (!p || !email) continue;
    const apo = p.apoderados?.find((a) => a.id === sg.party.apoderadoId);
    const target = apo || p;
    if (target.correo === email) continue;
    target.correo = email;
    await saveParty(p);
  }
}

/** Consulta DocuSign; si ya firmaron todos, guarda el PDF firmado y el certificado y marca el contrato firmado. */
async function revisarEnvio(c, { aviso = false } = {}) {
  const e = c.docusign;
  if (!envioActivo(c) || !ds.isConnected()) return;
  if (e.env !== ds.config().env) { if (aviso) toast('El envío se hizo en otro ambiente de DocuSign', 'error'); return; }
  let st;
  try {
    st = await ds.envelopeStatus(e.envelopeId);
  } catch (err) {
    if (aviso) toast(err.status === 404 || err.status === 403 ? 'Tu usuario de DocuSign no puede ver este envío; consúltalo quien lo envió' : err.message, 'error');
    return;
  }
  const antes = JSON.stringify([e.status, e.recipients.map((r) => r.status)]);
  e.status = st.status;
  e.voidedReason = st.voidedReason;
  e.checkedAt = Date.now();
  for (const r of e.recipients) {
    const s = st.signers.find((x) => x.email.toLowerCase() === r.email.toLowerCase() && x.name === r.name) || st.signers.find((x) => x.email.toLowerCase() === r.email.toLowerCase());
    if (s) Object.assign(r, { status: s.status, signedAt: s.signedAt, declinedReason: s.declinedReason });
  }
  const cambio = antes !== JSON.stringify([e.status, e.recipients.map((r) => r.status)]);
  if (st.status === 'completed' && !e.files) {
    const { signed, certificate } = await ds.signedFiles(e.envelopeId);
    const base = safeName(nombreDe(c));
    const descargar = !dbx.isConnected(); // sin Dropbox, la única copia es la descarga
    const f1 = await deliverFile(c, signed, `${base} - FIRMADO DocuSign.pdf`, 'pdf', { descargar });
    const f2 = await deliverFile(c, certificate, `${base} - certificado DocuSign.pdf`, 'pdf', { descargar });
    e.files = [f1.id, f2.id];
    e.completedAt = st.completedAt || Date.now();
    c.status = 'final';
    delete c.firmadoPapel;
    addVersion(c, 'Firmado en DocuSign');
    logChange(c, 'Todas las partes firmaron en DocuSign; se guardaron el PDF firmado y el certificado');
    await saveContract(c);
    if (state.current === c) renderEditorHeader();
    toast(`“${nombreDe(c)}” quedó firmado en DocuSign${dbx.isConnected() ? '; PDF firmado guardado en Dropbox' : ''}`, 'ok');
    return;
  }
  if (cambio) {
    if (['declined', 'voided'].includes(st.status)) logChange(c, st.status === 'declined' ? 'Un firmante rechazó firmar en DocuSign' : 'El envío a DocuSign se canceló');
    await saveContract(c);
  } else if (aviso) toast('Sin cambios en DocuSign');
}

async function cancelarEnvio(c) {
  const r = await modal({
    title: 'Cancelar envío',
    body: `<p>Los firmantes recibirán un aviso de DocuSign y ya no podrán firmar este envío.</p>
      <label class="field"><span>Motivo</span><input name="motivo" value="Se enviará una versión corregida" required maxlength="200"></label>`,
    actions: [{ label: 'Volver', value: '', kind: 'ghost', formnovalidate: true }, { label: 'Cancelar envío', value: 'ok', kind: 'danger' }],
  });
  if (r.value !== 'ok') return;
  if (!ds.isConnected()) return toast('Conecta DocuSign en Ajustes para cancelar el envío', 'error');
  await ds.voidEnvelope(c.docusign.envelopeId, r.data.motivo);
  Object.assign(c.docusign, { status: 'voided', voidedReason: r.data.motivo, checkedAt: Date.now() });
  logChange(c, `Canceló el envío a DocuSign: ${r.data.motivo}`);
  await saveContract(c);
  renderDocumento();
  toast('Envío cancelado', 'ok');
}

/** Revisa en segundo plano los envíos abiertos (cada 5 minutos, con DocuSign conectado). */
async function revisarEnvios() {
  if (!ds.isConnected()) return;
  for (const c of state.contracts.filter(envioActivo)) {
    // Si el contrato está abierto se actualiza esa copia, para que el autoguardado no regrese el estado anterior
    const obj = state.current?.id === c.id ? state.current : c;
    if (revisando.has(obj.id)) continue;
    revisando.add(obj.id);
    try { await revisarEnvio(obj); } catch (err) { console.warn('DocuSign', err); } finally { revisando.delete(obj.id); }
  }
}

const PASOS = ['Documento', 'Aprobación', 'Firma'];

/** Paso del flujo: 0 completar datos, 1 aprobar, 2 enviar a firma, 3 firmado. */
function pasoDe(c) {
  if (c.status === 'final') return 3;
  if (c.status === 'aprobado') return 2;
  return missingVariables(c).length ? 0 : 1;
}

function renderDocumento() {
  const c = state.current;
  c.documentos ||= [];
  const box = tabBox();
  const connected = dbx.isConnected();
  const missing = missingVariables(c).length;
  const paso = pasoDe(c);
  const conflicto = conflictoFormato(c, state.contracts);
  const descargarFinal = c.conMolde
    ? `<button class="btn" data-wf="word">${icon('doc')} Descargar Word final</button>`
    : `<button class="btn" data-wf="pdf">${icon('pdf')} Descargar PDF final</button>`;
  box.innerHTML = `
    <ol class="stepper">
      ${PASOS.map((l, i) => `<li class="${i < paso ? 'done' : i === paso ? 'on' : ''}"><span>${i + 1}</span>${l}</li>`).join('')}
    </ol>
    ${conflicto ? `<div class="banner danger">${icon('alert')} <span>${esc(conflicto)} No se puede aprobar así.</span></div>` : ''}
    ${avisoMolde(c)}
    <section class="card form-block">
      ${paso === 0 ? `
        <h3>1. Completa el documento</h3>
        <p class="muted">Faltan <strong>${missing} dato${missing === 1 ? '' : 's'}</strong>. Mientras falten no se puede aprobar.</p>
        <div class="row wrap">
          <a class="btn primary" href="#/c/${c.id}/variables">${icon('pen')} Completar datos</a>
          <a class="btn" href="#/c/${c.id}/vista">${icon('eye')} Vista previa</a>
        </div>`
      : paso === 1 ? `
        <h3>2. Revisa y aprueba</h3>
        <p class="muted">Revisa el contrato en la Vista previa; si hay que cambiar algo, corrígelo en Secciones o Variables. Al aprobar se ${c.conMolde ? 'genera el Word final del formato' : 'generan el Word y el PDF finales'}${connected ? ' y se guardan en Dropbox' : ''}.</p>
        <div class="row wrap">
          <a class="btn" href="#/c/${c.id}/vista">${icon('eye')} Vista previa</a>
          <button class="btn primary" data-wf="approve" ${conflicto ? 'disabled' : ''}>${icon('check')} Aprobar</button>
        </div>`
      : paso === 2 ? `
        <h3>3. Envía a firma</h3>
        <p class="muted">${c.aprobado ? `Aprobado por ${esc(c.aprobado.by || '—')} el ${fmtDateTime(c.aprobado.date).replace(/\.$/, '')}. ` : ''}${envioActivo(c) ? 'Está en DocuSign: abajo ves quién ya firmó; cuando firmen todos queda firmado solo.' : 'Envíalo por DocuSign o, si se firmó en papel, sube el PDF escaneado.'} Si hay que corregir algo, edítalo: el contrato regresa al paso 2.</p>
        <div class="row wrap">
          ${envioActivo(c) ? '' : `
          <button class="btn primary" data-wf="ds-send">${icon('mail')} Enviar a firma (DocuSign)</button>
          <button class="btn" data-wf="papel">${icon('upload')} Firmado en papel</button>`}
          ${descargarFinal}
        </div>`
      : `
        <h3>Firmado</h3>
        <p class="muted">El contrato está firmado${c.firmadoPapel ? ' (en papel)' : c.docusign?.status === 'completed' ? ' en DocuSign' : ''}. Cualquier edición lo regresa a borrador.</p>
        <div class="row">${descargarFinal}</div>`}
      <button class="link" data-wf="word">Descargar Word de trabajo (sin guardar en Dropbox)</button>
    </section>
    ${c.docusign ? envioHTML(c) : ''}
    <section class="card form-block">
      <h3>Dónde se guarda</h3>
      ${connected ? `
        <p class="muted small">En Dropbox, dentro del expediente de ${clientParty(c) ? `<strong>${esc(clientParty(c).nombre)}</strong>` : 'el cliente (vincula una parte en Variables)'}. Si la carpeta no existe, se crea sola.</p>
        <p><code id="doc-folder">${esc(contractFolder(c))}</code></p>
        <div class="row">
          <button class="btn sm" data-wf="folder">${icon('folder')} Cambiar carpeta</button>
          ${c.carpeta ? '<button class="link" data-wf="folder-reset">Usar la carpeta automática</button>' : ''}
        </div>`
      : `<p class="muted">Sin Dropbox conectado: los archivos solo se descargan en este equipo. Conéctalo en <a href="#/ajustes">Ajustes</a>.</p>`}
    </section>
    <section class="card form-block">
      <h3>Documentos generados</h3>
      ${c.documentos.length ? `<div class="doc-list">${c.documentos.map((d) => `
        <div class="doc-item" data-id="${esc(d.id)}">
          <span class="badge ${d.kind === 'pdf' ? 'final' : 'revision'}">${d.kind === 'pdf' ? 'PDF' : 'Word'}</span>
          <div class="anexo-main"><strong>${esc(d.name)}</strong><span class="muted small">${fmtDateTime(d.date)}${d.by ? ` · ${esc(d.by)}` : ''}${d.path ? '' : ' · solo descargado'}</span></div>
          ${d.path && connected ? '<button class="btn sm" data-wf="open">Abrir</button>' : ''}
        </div>`).join('')}</div>` : '<p class="muted small">Aún no se ha generado ningún documento.</p>'}
    </section>`;

  if (envioActivo(c) && ds.isConnected() && !revisando.has(c.id) && Date.now() - (ultimaRevision.get(c.id) || 0) > 60000) {
    // Al abrir la pestaña se consulta el estado en DocuSign (sin servidor no hay aviso automático), máximo una vez por minuto
    revisando.add(c.id);
    ultimaRevision.set(c.id, Date.now());
    revisarEnvio(c).catch((err) => console.warn('DocuSign', err)).finally(() => {
      revisando.delete(c.id);
      if (state.current === c && state.tab === 'documento') renderDocumento();
    });
  }
  if (connected && !c.carpeta) {
    // Al leer las carpetas existentes puede reconocerse la del expediente (p. ej. "MERCASA DEL BAJIO")
    loadExpedienteFolders().then(() => { const el = $('#doc-folder'); if (el) el.textContent = contractFolder(c); });
  }

  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-wf]');
    if (!btn) return;
    const act = btn.dataset.wf;
    try {
      if (act === 'approve') return await approve(c, btn);
      if (act === 'papel') return await firmadoEnPapel(c);
      if (act === 'pdf') return exportPdf(c);
      if (act === 'word') return downloadWord(c);
      if (act === 'ds-send') return await enviarDocuSign(c);
      if (act === 'ds-refresh') { btn.disabled = true; await revisarEnvio(c, { aviso: true }); return renderDocumento(); }
      if (act === 'ds-void') return await cancelarEnvio(c);
      if (act === 'ds-reset') {
        delete c.docusign;
        touched({ log: 'Descartó el envío a DocuSign para enviarlo de nuevo', content: false });
        return renderDocumento();
      }
      if (act === 'ds-settings') return go('#/ajustes');
      if (act === 'open') return openDropboxFile(c.documentos.find((d) => d.id === btn.closest('.doc-item').dataset.id).path);
      if (act === 'folder') {
        await loadExpedienteFolders();
        const p = clientParty(c);
        const folder = await browseDropbox({ mode: 'folder', start: p ? expedienteOf(p) : sync.expedientesRoot(), title: 'Carpeta para los documentos del contrato' });
        if (!folder) return;
        c.carpeta = folder;
        touched({ log: `Cambió la carpeta de documentos a ${folder}`, content: false });
        return renderDocumento();
      }
      if (act === 'folder-reset') {
        delete c.carpeta;
        touched({ log: 'Volvió a la carpeta automática de documentos', content: false });
        return renderDocumento();
      }
    } catch (err) {
      console.error(err);
      toast(err.message || 'No se pudo generar el documento', 'error');
      btn.disabled = false;
    }
  });
}

async function approve(c, btn) {
  const missing = missingVariables(c).length;
  if (missing) return toast(`Faltan ${missing} dato(s): complétalos antes de aprobar`, 'error');
  if (!(await confirmDialog('Aprobar contrato', `${c.conMolde ? `Se generará el Word final ${c.formato ? `del formato ${c.formato}` : 'de la plantilla'} (el PDF se saca desde Word)` : 'Se generarán el Word y el PDF finales (sin leyendas)'} y el contrato quedará aprobado.`, 'Aprobar', 'primary'))) return;
  btn.disabled = true;
  await approveContract(c);
  renderEditorHeader();
  renderDocumento();
  toast(`Contrato aprobado${dbx.isConnected() ? `; ${c.conMolde ? 'Word guardado' : 'Word y PDF guardados'} en Dropbox` : ''}`, 'ok');
}

/** Firmado en papel: guarda el PDF escaneado como "… - FIRMADO.pdf" en la carpeta del contrato y lo marca firmado. */
async function firmadoEnPapel(c) {
  const r = await modal({
    title: 'Firmado en papel',
    body: `
      <p class="muted small">Sube el PDF escaneado con todas las firmas. ${dbx.isConnected() ? 'Se guarda en la carpeta del contrato en Dropbox' : 'Sin Dropbox conectado solo se descarga en este equipo'} como “${esc(safeName(nombreDe(c)))} - FIRMADO.pdf” y el contrato queda firmado.</p>
      <label class="field"><span>PDF firmado</span><input type="file" name="pdf" accept="application/pdf,.pdf" required></label>`,
    actions: [{ label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true }, { label: 'Guardar y marcar firmado', value: 'ok', kind: 'primary' }],
  });
  const file = r.data?.pdf;
  if (r.value !== 'ok' || !file?.size) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return toast('El archivo debe ser PDF', 'error');
  await deliverFile(c, file, `${safeName(nombreDe(c))} - FIRMADO.pdf`, 'pdf', { descargar: !dbx.isConnected(), reemplazar: true });
  c.status = 'final';
  c.firmadoPapel = { by: cuenta(), date: Date.now() };
  addVersion(c, 'Firmado en papel');
  logChange(c, 'Subió el PDF firmado en papel y marcó el contrato como firmado');
  await saveContract(c);
  renderEditorHeader();
  renderDocumento();
  toast(`Contrato firmado${dbx.isConnected() ? '; PDF guardado en Dropbox' : ''}`, 'ok');
}

/** Genera Word y PDF finales, los guarda en Dropbox (si hay conexión) y marca el contrato como aprobado. */
/** Word y PDF finales (sin leyendas) de un contrato aprobado. */
async function finalFiles(c, D) {
  const base = safeName(nombreDe(c));
  return [
    { name: `${base} - APROBADO.docx`, blob: c.conMolde ? await wordDe(c) : await buildDocxBlob(D, c, { label: '' }), kind: 'docx' },
    // Con formato propio el PDF lo saca el abogado desde Word: el generador de la app no reproduce su estilo
    ...(c.conMolde ? [] : [{ name: `${base} - APROBADO.pdf`, blob: buildPdf(c).blob, kind: 'pdf' }]),
  ];
}

async function approveContract(c, { descargar = true } = {}) {
  // Regla de formatos por cliente: puede romperse si se cambió el prestador o el cliente a mano
  const conflicto = conflictoFormato(c, state.contracts);
  if (conflicto) throw new Error(conflicto);
  // No se aprueba un contrato con datos pendientes: saldrían entre corchetes
  const faltan = missingVariables(c).length;
  if (faltan) throw new Error(`a “${nombreDe(c)}” le faltan ${faltan} dato(s)`);
  const prev = { status: c.status, documentos: c.documentos };
  c.status = 'aprobado';
  let files;
  try {
    // Primero se generan ambos archivos; así un error en el PDF no deja un Word "aprobado" huérfano
    files = await finalFiles(c, await loadDocx());
    // Al volver a aprobar se reemplaza el APROBADO anterior: queda un solo archivo vigente
    for (const f of files) await deliverFile(c, f.blob, f.name, f.kind, { descargar, reemplazar: true });
  } catch (err) {
    Object.assign(c, prev);
    throw err;
  }
  c.aprobado = { by: cuenta(), date: Date.now() };
  addVersion(c, 'Aprobado');
  logChange(c, `Aprobó el contrato${c.aprobado.by ? ` (${c.aprobado.by})` : ''}`);
  await saveContract(c);
}

// ---------- Editor de plantillas ----------
// Las plantillas de la app se editan como una copia propia que la reemplaza ("replaces"); se puede
// restaurar la original. Los contratos ya creados no cambian al editar una plantilla.
async function saveTemplate(t) {
  t.updatedAt = Date.now();
  await db.put('templates', structuredClone(t));
  await sync.markDirty('templates', t.id);
  scheduleSync();
  const i = state.userTemplates.findIndex((x) => x.id === t.id);
  if (i >= 0) state.userTemplates[i] = t; else state.userTemplates.unshift(t);
}

async function editTemplate(t) {
  if (!t.custom) {
    // Plantilla de la app: se crea su versión editable
    const copy = { ...structuredClone(t), id: `u-${t.id}`, custom: true, replaces: t.id, createdAt: Date.now() };
    await saveTemplate(copy);
    t = copy;
  }
  go(`#/plantilla/${t.id}`);
}

function renderTemplateEditor(id) {
  setNav('templates');
  const t = state.userTemplates.find((x) => x.id === id);
  if (!t) { toast('Plantilla no encontrada', 'error'); return go('#/plantillas'); }
  const original = t.replaces && TEMPLATES.find((x) => x.id === t.replaces);
  const tplNums = sectionNumbers(t);
  const keysInText = () => {
    const used = new Set();
    const scan = (txt) => { for (const m of String(txt || '').matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) used.add(m[1]); };
    t.sections.forEach((s) => { scan(s.title); scan(s.body); });
    t.signers.forEach((sg) => scan(sg.name));
    return used;
  };
  const usedKeys = keysInText();
  const undefinedKeys = () => [...keysInText()].filter((k) => !t.vars.some(([key]) => key === k));
  const missingHTML = () => {
    const keys = undefinedKeys();
    return keys.length ? `<div class="banner warn">${icon('alert')} <span>Hay ${keys.length} variable(s) en el texto sin definir: ${keys.map((k) => `<code>{{${esc(k)}}}</code>`).join(' ')}</span><button type="button" class="btn sm" data-act="add-missing">Agregarlas</button></div>` : '';
  };

  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow"><a href="#/plantillas">Plantillas</a> · ${original ? 'Plantilla de la app modificada' : 'Plantilla propia'}</p>
        <h1>${esc(t.name)}</h1>
      </div>
      <span id="tpl-save" class="muted small">Guardado</span>
    </header>
    <div class="banner info">${icon('alert')} <span>Los cambios aplican a los contratos nuevos. Los contratos ya creados no se modifican.</span></div>
    ${t.molde ? `<div class="banner warn">${icon('doc')} <span>Esta plantilla genera el Word desde el formato original (${esc(t.molde.nombre || 'molde')}). Las secciones de aquí solo sirven para la vista previa y para saber qué datos pide: cambiar su texto no cambia el Word.</span></div>` : ''}
    <form class="party-form" id="tpl-form" autocomplete="off">
      <section class="card form-block">
        <div class="form-grid">
          <label class="field"><span>Nombre</span><input data-k="name" value="${esc(t.name)}"></label>
          <label class="field"><span>Categoría</span><select data-k="category">
            ${[...CATEGORIES, { id: 'mis', label: 'Mis plantillas' }].map((c) => `<option value="${esc(c.id)}" ${t.category === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select></label>
        </div>
        <label class="field"><span>Descripción</span><input data-k="description" value="${esc(t.description || '')}"></label>
        ${isServiciosTemplate(t) ? `<label class="field"><span>Código de formato (F1, F2…; solo en la app, no aparece en el documento)</span><input data-k="formato" value="${esc(t.formato || '')}" maxlength="8" placeholder="Sin código"></label>` : ''}
      </section>
      <section class="card form-block">
        <h3>Secciones</h3>
        <p class="muted small">Usa <code>{{variable}}</code> para los datos que se llenan en cada contrato. Las secciones de “texto sin número” sirven para proemio, declaraciones y cierre.</p>
        ${numberingControls(t)}
        ${t.sections.map((s, i) => `
          <div class="sub-item" data-list="sections" data-i="${i}">
            <div class="sec-head">
              <span class="sec-num">${esc(tplNums[i])}</span>
              <input class="sec-title" data-k="title" value="${esc(s.title)}" aria-label="Título de la sección">
              <select class="sec-kind" data-k="kind" aria-label="Tipo de sección">
                <option value="clausula" ${s.kind !== 'texto' ? 'selected' : ''}>Cláusula</option>
                <option value="texto" ${s.kind === 'texto' ? 'selected' : ''}>Texto sin número</option>
              </select>
              <div class="sec-actions">
                <button type="button" class="icon-btn sm" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Subir">${icon('up')}</button>
                <button type="button" class="icon-btn sm" data-act="down" ${i === t.sections.length - 1 ? 'disabled' : ''} aria-label="Bajar">${icon('down')}</button>
                <button type="button" class="icon-btn sm danger" data-act="del" aria-label="Eliminar">${icon('trash')}</button>
              </div>
            </div>
            <textarea data-k="body" rows="4">${esc(s.body)}</textarea>
          </div>`).join('')}
        <div class="row">
          <button type="button" class="btn sm" data-act="add-section">${icon('plus')} Sección en blanco</button>
          <button type="button" class="btn sm" data-act="add-clause">${icon('library')} Desde biblioteca de cláusulas</button>
        </div>
      </section>
      <section class="card form-block">
        <h3>Variables</h3>
        <div id="tpl-missing">${missingHTML()}</div>
        <div class="var-table">
          <span class="muted small">Clave</span><span class="muted small">Etiqueta</span><span class="muted small">Tipo</span><span class="muted small">Valor por defecto</span><span></span>
          ${t.vars.map(([key, label, type, def], i) => `
            <input data-list="vars" data-i="${i}" data-k="0" value="${esc(key)}" aria-label="Clave" class="mono">
            <input data-list="vars" data-i="${i}" data-k="1" value="${esc(label)}" aria-label="Etiqueta">
            <select data-list="vars" data-i="${i}" data-k="2" aria-label="Tipo">${Object.entries(VAR_TYPES).map(([k, l]) => `<option value="${k}" ${type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <input data-list="vars" data-i="${i}" data-k="3" value="${esc(def ?? '')}" aria-label="Valor por defecto">
            <button type="button" class="icon-btn sm danger" data-list="vars" data-i="${i}" data-act="del-var" aria-label="Quitar" ${usedKeys.has(key) ? 'disabled title="Se usa en el texto"' : ''}>${icon('trash')}</button>`).join('')}
        </div>
        <button type="button" class="btn sm" data-act="add-var">${icon('plus')} Agregar variable</button>
      </section>
      <section class="card form-block">
        <h3>Firmantes</h3>
        ${t.signers.map((sg, i) => `
          <div class="row" data-list="signers" data-i="${i}">
            <label class="field"><span>Rol</span><input data-k="role" value="${esc(sg.role)}"></label>
            <label class="field"><span>Nombre (admite variables)</span><input data-k="name" value="${esc(sg.name)}"></label>
            <button type="button" class="icon-btn sm danger" data-act="del-signer" aria-label="Quitar">${icon('trash')}</button>
          </div>`).join('')}
        <button type="button" class="btn sm" data-act="add-signer">${icon('plus')} Agregar firmante</button>
      </section>
      <div class="row">
        ${original
          ? '<button type="button" class="btn ghost danger" data-act="restore">Restaurar la plantilla original</button>'
          : '<button type="button" class="btn ghost danger" data-act="delete">Eliminar plantilla</button>'}
        <button type="button" class="btn" data-act="use">${icon('plus')} Crear contrato con esta plantilla</button>
      </div>
    </form>`;

  const form = $('#tpl-form');
  $$('textarea', form).forEach(autosize);
  const status = (txt) => { const el = $('#tpl-save'); if (el) el.textContent = txt; };
  const persist = debounce(async () => {
    await saveTemplate(t);
    status('Guardado');
    const box = $('#tpl-missing');
    if (box) box.innerHTML = missingHTML(); // se actualiza sin redibujar para no perder el foco
  }, 500);
  const rerender = async () => { await saveTemplate(t); const y = window.scrollY; renderTemplateEditor(t.id); window.scrollTo(0, y); };
  const holder = (el) => el.dataset.list ? el : el.closest('[data-list]');

  form.addEventListener('change', (e) => {
    // Al terminar de editar una clave o un texto se recalculan las variables detectadas.
    // Un solo escucha: antes había dos y los select guardaban y redibujaban dos veces.
    const num = e.target.dataset.num;
    if (num) t[num] = e.target.value;
    if (e.target.dataset.k === 'kind') {
      const sec = t.sections[Number(holder(e.target).dataset.i)];
      if (e.target.value === 'texto') sec.kind = 'texto'; else delete sec.kind;
    }
    if (num || e.target.dataset.k === '0' || e.target.tagName === 'SELECT') rerender();
  });
  form.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (k === undefined || k === 'kind') return;
    const h = holder(e.target);
    if (!h) t[k] = e.target.value;
    else if (h.dataset.list === 'vars') t.vars[Number(h.dataset.i)][Number(k)] = k === '0' ? slugify(e.target.value) : e.target.value;
    else t[h.dataset.list][Number(h.dataset.i)][k] = e.target.value;
    if (e.target.tagName === 'TEXTAREA') autosize(e.target);
    status('Guardando…');
    persist();
  });
  form.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const h = holder(btn);
    const i = h ? Number(h.dataset.i) : -1;
    switch (btn.dataset.act) {
      case 'up': [t.sections[i - 1], t.sections[i]] = [t.sections[i], t.sections[i - 1]]; break;
      case 'down': [t.sections[i + 1], t.sections[i]] = [t.sections[i], t.sections[i + 1]]; break;
      case 'del':
        if (!(await confirmDialog('Eliminar sección', `¿Eliminar "${t.sections[i].title}" de la plantilla?`, 'Eliminar'))) return;
        t.sections.splice(i, 1);
        break;
      case 'add-section': t.sections.push({ title: 'Nueva sección', body: '' }); break;
      case 'add-clause': {
        const r = await modal({
          title: 'Biblioteca de cláusulas',
          wide: true,
          body: `<div class="clause-list">${CLAUSES.map((cl, n) => `<button value="${n}" class="clause-item"><strong>${esc(cl.title)}</strong><span>${esc(cl.body)}</span></button>`).join('')}</div>`,
        });
        if (r.value === '') return;
        const cl = CLAUSES[Number(r.value)];
        t.sections.push({ title: cl.title, body: cl.body });
        break;
      }
      case 'add-missing': undefinedKeys().forEach((k) => t.vars.push([k, humanize(k), 'text'])); break;
      case 'add-var': t.vars.push([`variable_${t.vars.length + 1}`, 'Nueva variable', 'text']); break;
      case 'del-var': t.vars.splice(i, 1); break;
      case 'add-signer': t.signers.push({ role: 'Firmante', name: '' }); break;
      case 'del-signer': t.signers.splice(i, 1); break;
      case 'use': {
        await saveTemplate(t);
        const c = newContractFromTemplate(t);
        await saveContract(c);
        return go(`#/c/${c.id}/variables`);
      }
      case 'restore':
      case 'delete': {
        const restoring = btn.dataset.act === 'restore';
        if (!(await confirmDialog(restoring ? 'Restaurar original' : 'Eliminar plantilla',
          restoring ? 'Se descartan los cambios hechos a esta plantilla y vuelve la versión original de la app. Los contratos ya creados no cambian.' : `¿Eliminar "${t.name}"? Los contratos creados con ella no se modifican.`,
          restoring ? 'Restaurar' : 'Eliminar'))) return;
        await db.remove('templates', t.id);
        await sync.markDeleted('templates', t.id);
        scheduleSync();
        state.userTemplates = state.userTemplates.filter((x) => x.id !== t.id);
        toast(restoring ? 'Plantilla original restaurada' : 'Plantilla eliminada', 'ok');
        return go('#/plantillas');
      }
      default: return;
    }
    rerender();
  });
}

// ---------- Ajustes ----------
async function renderSettings() {
  setNav('settings');
  await ds.cargarGlobal();
  let usage = '';
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) usage = `${(est.usage / 1024 / 1024).toFixed(2)} MB usados en este dispositivo`;
  } catch { /* opcional */ }
  const persisted = await navigator.storage?.persisted?.().catch(() => false);

  app.innerHTML = `
    <header class="page-head"><div><p class="eyebrow">Crear Contratos</p><h1>Ajustes</h1></div></header>
    <section class="card settings-block">
      <h3>Instalar la app</h3>
      <p class="muted">Instálala en tu teléfono o computadora para abrirla como una app y usarla sin conexión.</p>
      <button class="btn primary" id="install" ${state.installPrompt ? '' : 'hidden'}>Instalar</button>
      <p class="small muted" ${state.installPrompt ? 'hidden' : ''}>En iPhone: toca Compartir y luego “Agregar a inicio”. En Chrome o Edge: usa el ícono de instalar en la barra de direcciones.</p>
    </section>
    ${await dropboxSettingsHTML()}
    ${docusignSettingsHTML()}
    ${await iaSettingsHTML()}
    <section class="card settings-block">
      <h3>Vencimientos</h3>
      <p class="muted">Avisar de los contratos de trabajo por tiempo determinado que terminan dentro de estos días. Se guarda en este equipo.</p>
      <div class="row">
        <label class="field inline"><span>Anticipación</span><input id="pref-dias" type="number" min="1" max="365" value="${state.prefs.anticipacion}" style="width:90px"></label>
        <span class="muted small">días (por omisión ${DIAS_DEFAULT})</span>
      </div>
    </section>
    <section class="card settings-block">
      <h3>Tus datos</h3>
      <p class="muted">${dbx.isConnected() ? 'Tus contratos se guardan en este dispositivo y se sincronizan con la carpeta de Dropbox.' : 'Tus contratos se guardan solo en este dispositivo (no hay servidor ni cuenta).'} ${usage ? esc(usage) + '.' : ''} ${persisted ? 'El almacenamiento está protegido contra limpieza automática.' : ''}</p>
      <p class="muted small">${state.contracts.length} contratos · ${state.userTemplates.length} plantillas propias · ${state.parties.length} partes en el catálogo · ${state.lotes.length} lotes</p>
      <div class="row wrap">
        <button class="btn" id="export">${icon('pdf')} Exportar respaldo (.json)</button>
        <label class="btn">Importar respaldo<input type="file" id="import" accept="application/json,.json" hidden></label>
        <button class="btn ghost danger" id="wipe">Borrar todos los datos</button>
      </div>
    </section>
    <section class="card settings-block">
      <h3>Aviso legal</h3>
      <p class="muted">Crear Contratos ofrece plantillas y herramientas de redacción con fines informativos. No es un despacho jurídico ni proporciona asesoría legal. Antes de firmar documentos importantes, consulta con un abogado.</p>
    </section>`;

  bindDropboxSettings();
  bindDocusignSettings();
  bindIaSettings();
  $('#pref-dias').addEventListener('change', async (e) => {
    const n = Math.round(Number(e.target.value));
    if (!(n >= 1 && n <= 365)) { e.target.value = state.prefs.anticipacion; return toast('Escribe un número de días entre 1 y 365', 'error'); }
    state.prefs.anticipacion = n;
    await db.put('meta', { id: 'prefs', ...state.prefs });
    updateVencBadge();
    toast(`Se avisará con ${n} días de anticipación`, 'ok');
  });
  $('#install')?.addEventListener('click', async () => {
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    renderSettings();
  });
  $('#export').addEventListener('click', () => {
    const data = { app: 'crear-contratos', version: 1, exportedAt: new Date().toISOString(), contracts: state.contracts, templates: state.userTemplates, parties: state.parties, lotes: state.lotes };
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `respaldo-contratos-${new Date().toISOString().slice(0, 10)}.json`);
    toast('Respaldo descargado', 'ok');
  });
  $('#import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'crear-contratos') throw new Error('formato');
      const n = (data.contracts || []).length;
      if (!(await confirmDialog('Importar respaldo', `Se importarán ${n} contratos, ${(data.templates || []).length} plantillas, ${(data.parties || []).length} partes del catálogo y ${(data.lotes || []).length} lotes. Los que tengan el mismo identificador se reemplazarán.`, 'Importar', 'primary'))) return;
      for (const c of data.contracts || []) { await db.put('contracts', c); await sync.markDirty('contracts', c.id); }
      for (const l of data.lotes || []) { await db.put('lotes', l); await sync.markDirty('lotes', l.id); }
      for (const t of data.templates || []) { await db.put('templates', t); await sync.markDirty('templates', t.id); }
      for (const p of data.parties || []) { await db.put('parties', p); await sync.markDirty('parties', p.id); }
      scheduleSync();
      await loadAll();
      toast('Respaldo importado', 'ok');
      renderSettings();
    } catch {
      toast('El archivo no es un respaldo válido', 'error');
    }
  });
  $('#wipe').addEventListener('click', async () => {
    if (!(await confirmDialog('Borrar todos los datos', `Se eliminarán todos los contratos, versiones, firmas, plantillas propias, el catálogo de partes y los lotes de este dispositivo.${dbx.isConnected() ? ' También se desconectará Dropbox; lo que está en Dropbox no se borra.' : ''} Exporta un respaldo antes si lo necesitas.`, 'Borrar todo'))) return;
    if (dbx.isConnected()) await dbx.disconnect();
    await sync.resetState();
    await db.clear('contracts');
    await db.clear('templates');
    await db.clear('parties');
    await db.clear('lotes');
    Object.assign(state, { current: null, loteDraft: null, servDraft: null, returnTo: null });
    await loadAll();
    toast('Datos eliminados');
    renderSettings();
  });
}

// --- Lectura con IA de PDFs escaneados: el interruptor solo lo cambia el administrador (lo valida el servidor) ---
async function iaSettingsHTML() {
  const e = await estadoIA(true);
  if (!e.disponible) return '';
  const estadoTxt = e.activa
    ? `Encendida${e.hasta ? ` hasta el ${esc(fmtLongDate(e.hasta))}` : ''}.`
    : e.vencida ? `Apagada: el periodo terminó el ${esc(fmtLongDate(e.hasta))}.` : 'Apagada.';
  return `
    <section class="card settings-block" id="ia-box">
      <h3>Lectura con IA</h3>
      <p class="muted">Lee constancias, escrituras y poderes escaneados (imagen) al usar “Llenar desde PDF” o “Alta desde PDFs”. Los escaneados se envían a la IA de Anthropic; los PDF con texto se siguen leyendo en este equipo.</p>
      <p><span class="badge ${e.activa ? 'final' : 'borrador'}">${e.activa ? 'Encendida' : 'Apagada'}</span> <span class="small">${estadoTxt}</span></p>
      ${e.admin ? `
        ${e.faltan?.length ? `<div class="banner warn">${icon('alert')} <span>Falta configurar en Cloudflare: ${esc(e.faltan.join(', '))}.</span></div>` : ''}
        <div class="row wrap">
          <label class="field inline"><span>Encendida hasta</span><input type="date" id="ia-hasta" value="${esc(e.programada ? e.hasta : '')}"></label>
          <span class="muted small">vacío = sin fecha de fin</span>
        </div>
        <div class="row wrap">
          ${e.programada && !e.vencida ? '<button class="btn" id="ia-guardar">Cambiar fecha</button><button class="btn danger" id="ia-off">Apagar</button>' : '<button class="btn primary" id="ia-on">Encender</button>'}
        </div>
        <p class="muted small">Solo tú ves estos botones; el servidor rechaza el cambio si lo intenta otro usuario.</p>`
        : '<p class="muted small">Solo el administrador puede encenderla o apagarla.</p>'}
    </section>`;
}

function bindIaSettings() {
  const box = $('#ia-box');
  if (!box) return;
  box.addEventListener('click', async (ev) => {
    const b = ev.target.closest('#ia-on, #ia-off, #ia-guardar');
    if (!b) return;
    const hasta = $('#ia-hasta', box)?.value || '';
    if (b.id !== 'ia-off' && hasta && hasta < new Date().toLocaleDateString('en-CA')) return toast('La fecha ya pasó', 'error');
    b.disabled = true;
    try {
      const e = await cambiarIA({ activa: b.id !== 'ia-off', hasta: b.id === 'ia-off' ? '' : hasta });
      toast(e.activa ? 'Lectura con IA encendida' : 'Lectura con IA apagada', 'ok');
      renderSettings();
    } catch (err) {
      toast(err.message, 'error');
      b.disabled = false;
    }
  });
}

// ---------- Arranque ----------
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installPrompt = e; });
window.addEventListener('hashchange', route);
window.addEventListener('online', () => $('#offline')?.setAttribute('hidden', ''));
window.addEventListener('offline', () => $('#offline')?.removeAttribute('hidden'));
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

// ---------- Lotes: contratos de trabajo desde el Excel P1 ----------
// Una empresa y una plantilla (determinado o indeterminado) por lote. El lote queda "En revisión"
// hasta que cualquiera de los usuarios lo aprueba; ya aprobado se descarga un .zip con un Word por trabajador.
const LOTE_STATUS = { revision: 'En revisión', aprobado: 'Aprobado' };
const loteTemplates = () => allTemplates().filter(isLoteTemplate);

async function saveLote(l, log) {
  l.updatedAt = Date.now();
  l.updatedBy = whoAmI();
  if (log) l.history = [{ date: Date.now(), by: l.updatedBy, text: log }, ...(l.history || [])];
  await db.put('lotes', structuredClone(l));
  await sync.markDirty('lotes', l.id);
  scheduleSync();
  const i = state.lotes.findIndex((x) => x.id === l.id);
  if (i >= 0) state.lotes[i] = l; else state.lotes.unshift(l);
}

function renderLotes() {
  setNav('lotes');
  const q = state.loteQuery.trim().toLowerCase();
  const list = [...state.lotes].sort((a, b) => b.createdAt - a.createdAt)
    .filter((l) => !q || [l.cliente, l.empresa?.nombre, l.title].some((v) => String(v || '').toLowerCase().includes(q)));
  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow">Contratos de trabajo y de comisión mercantil</p>
        <h1>Lotes</h1>
      </div>
      <div class="row">
        <button class="btn" id="p1-blank">${icon('download')}<span class="hide-xs">Descargar P1</span></button>
        <a class="btn primary" href="#/lotes/nuevo">${icon('plus')} Nuevo lote</a>
      </div>
    </header>
    ${vencBanner()}
    ${state.lotes.length ? `
      <div class="toolbar">
        <label class="search">${icon('search')}<input id="lote-q" type="search" placeholder="Buscar por cliente o empresa" value="${esc(state.loteQuery)}"></label>
      </div>` : ''}
    ${list.length ? `
      <div class="card lotes-list lote-list">
        <div class="ll-row ll-head"><span>Cliente</span><span>Empresa</span><span>Tipo</span><span>Contratos</span><span>Estado</span><span>Creado</span><span></span></div>
        ${list.map((l) => `
        <div class="ll-row" data-id="${esc(l.id)}" tabindex="0" role="link">
          <span><strong>${l.cliente ? esc(l.cliente) : '<span class="muted">—</span>'}</strong></span>
          <span><strong>${esc(l.empresa?.nombre || l.title)}</strong><span class="muted small">${esc(fmtLongDate(l.trabajadores[0]?.firma) || fmtDateTime(l.createdAt))}</span></span>
          <span>${esc(TIPO_LOTE[l.tipo] || l.tipo)}</span>
          <span>${l.trabajadores.length}${l.excluidos?.length ? `<span class="warn-text small">${l.excluidos.length} con errores</span>` : ''}</span>
          <span><span class="badge ${l.status}">${LOTE_STATUS[l.status]}</span>${l.status === 'aprobado' ? `<span class="muted small">${esc(l.approvedBy || '')} · ${firmadosLote(l)}/${l.trabajadores.length} firmados</span>` : ''}</span>
          <span class="small">${esc(l.createdBy || '')}<span class="muted">${fmtRelative(l.createdAt)}</span></span>
          <span class="ll-acts">
            <button class="icon-btn sm" data-act="view" title="Visualizar resumen y contratos" aria-label="Visualizar">${icon('eye')}</button>
            <button class="icon-btn sm" data-act="print" title="Imprimir resumen y contratos" aria-label="Imprimir">${icon('print')}</button>
            ${l.status === 'aprobado'
              ? `<button class="icon-btn sm" data-act="zip" title="Descargar .zip con los contratos" aria-label="Descargar .zip">${icon('download')}</button>`
              : `<button class="icon-btn sm" disabled title="El .zip se descarga cuando el lote esté aprobado" aria-label="Descargar .zip (requiere aprobación)">${icon('download')}</button>`}
            <button class="icon-btn sm danger" data-act="del" title="Eliminar lote" aria-label="Eliminar">${icon('trash')}</button>
          </span>
        </div>`).join('')}
      </div>` : state.lotes.length ? '<p class="empty-inline">No hay lotes que coincidan.</p>' : `
      <section class="empty">
        <div class="empty-art">${icon('users')}</div>
        <h2>Contratos en lote</h2>
        <p>Sube tu Excel P1 (una fila por persona), elige la empresa, quién firma y la plantilla (trabajo o comisión mercantil). La app revisa los datos, genera un contrato por persona y, cuando alguien del equipo aprueba el lote, descargas todos en un .zip.</p>
        <a class="btn primary" href="#/lotes/nuevo">${icon('plus')} Nuevo lote</a>
      </section>`}`;
  $('#lote-q')?.addEventListener('input', (e) => {
    state.loteQuery = e.target.value;
    const pos = e.target.selectionStart;
    renderLotes();
    const el = $('#lote-q'); el.focus(); el.setSelectionRange(pos, pos);
  });
  $$('.ll-row[data-id]').forEach((row) => {
    const l = state.lotes.find((x) => x.id === row.dataset.id);
    row.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'view') return viewLote(l);
      if (act === 'print') return printLote(l);
      if (act === 'zip') return downloadLoteZip(l);
      if (act === 'del') return deleteLote(l).then((ok) => ok && renderLotes());
      go(`#/lotes/${l.id}`);
    });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) go(`#/lotes/${l.id}`); });
  });
  $('#p1-blank').addEventListener('click', downloadP1);
}

// Plantilla oficial del P1 en Dropbox; se puede editar ahí sin tocar la app
const P1_PATH = 'PLANTILLAS MARCO/P1 - plantilla.xlsx';
async function downloadP1() {
  if (dbx.isConnected()) {
    try {
      const { data } = await dbx.download(dbx.joinPath(dbx.config().folder, P1_PATH));
      return download(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'P1 - plantilla.xlsx');
    } catch (err) {
      if (!err.notFound) { toast(err.message, 'error'); return; }
      toast(`No está ${P1_PATH} en Dropbox; se descarga uno solo con encabezados`);
    }
  }
  return downloadP1Columns();
}

/** Excel vacío con las columnas que lee la app (las nuevas resaltadas). */
async function downloadP1Columns() {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('P1');
  const cols = P1_COLUMNS.filter((c) => c.key !== 'nombreCompleto' && c.key !== 'sd');
  ws.addRow(cols.map((c) => c.label));
  cols.forEach((c, i) => {
    const cell = ws.getRow(1).getCell(i + 1);
    cell.font = { bold: true };
    if (c.nueva) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    ws.getColumn(i + 1).width = Math.max(14, c.label.length + 2);
  });
  download(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'P1 - columnas.xlsx');
}

// --- Nuevo lote ---
function renderNuevoLote() {
  setNav('lotes');
  const d = (state.loteDraft ||= { cliente: '', templateId: '', empresaId: '', apoderadoId: '', periodicidad: '', file: null, workers: null, errors: null, rawMissing: [] });
  const tpls = loteTemplates();
  const empresas = sortParties(state.parties.filter((p) => p.activa && p.propia && p.kind === 'pm'));
  const emp = empresas.find((p) => p.id === d.empresaId);
  const apos = emp ? emp.apoderados.filter((a) => a.nombre.trim()) : [];
  const tpl = tpls.find((t) => t.id === d.templateId);
  // Si no hay empresas que elegir, se explica por qué en lugar de dejar la lista vacía
  const sinEmpresas = empresas.length ? '' : !state.parties.length
    ? (dbx.isConnected()
      ? 'El catálogo está vacío en este equipo. Pulsa sincronizar (arriba) o captura las empresas en Catálogo.'
      : 'Este equipo no está conectado a Dropbox, por eso no tiene el catálogo. Conéctalo en <a href="#/ajustes">Ajustes</a>.')
    : 'Ninguna empresa del catálogo es persona moral activa marcada como “Empresa del grupo”. Márcala así en <a href="#/catalogo">Catálogo</a>.';
  // Fecha de terminación solo hace falta en contratos por tiempo determinado
  const comision = !!tpl && esComision(tpl);
  // Lugar de firma: solo si la plantilla lo tiene como variable; arranca con el de la plantilla
  const lugarVar = tpl?.vars.find(([k]) => k === 'lugar_firma');
  if (lugarVar && d.lugarTpl !== tpl.id) { d.lugarFirma = lugarVar[3] || ''; d.lugarTpl = tpl.id; }
  d.missing = d.rawMissing.filter((c) => (c.key !== 'fin' || (tpl && tipoDePlantilla(tpl) === 'DETERMINADO')) && (!tpl || usaColumna(tpl, c.key)));
  const nErr = d.errors ? d.errors.filter((e) => e.length).length : 0;
  const nOk = d.workers ? d.workers.length - nErr : 0;
  // Se genera con los trabajadores correctos; los que tienen errores quedan fuera y se reportan
  const ok = nOk > 0 && !d.missing.length;
  // Todo listo salvo, quizá, el cliente (que se escribe sin redibujar la pantalla)
  const listo = ok && !!tpl && !!emp && (comision || !!d.periodicidad);
  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow"><a href="#/lotes">Lotes</a></p>
        <h1>Nuevo lote</h1>
      </div>
    </header>
    <section class="card settings-block lote-form">
      <label class="field"><span>Cliente</span>
        <input id="l-cli" list="l-cli-list" value="${esc(d.cliente || '')}" placeholder="Nombre del cliente" autocomplete="off">
        <datalist id="l-cli-list">${[...new Set(state.lotes.map((l) => l.cliente).filter(Boolean))].sort().map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <div class="row wrap">
        <label class="field"><span>Plantilla</span>
          <select id="l-tpl"><option value="">Elige…</option>${tpls.map((t) => `<option value="${esc(t.id)}" ${t.id === d.templateId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
        <label class="field" ${comision ? 'hidden' : ''}><span>Periodicidad de pago</span>
          <select id="l-per"><option value="">Elige…</option>${PERIODICIDADES.map((p) => `<option ${p === d.periodicidad ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        ${lugarVar ? `<label class="field"><span>Lugar de firma</span><input id="l-lugar" value="${esc(d.lugarFirma || '')}" placeholder="Ciudad de México"></label>` : ''}
      </div>
      ${tpls.length ? '' : '<p class="warn-text small">No hay plantillas con firmantes “patrón” y “trabajador” o “comitente” y “comisionista”. Sincroniza para traer las plantillas marco.</p>'}
      ${sinEmpresas ? `<div class="banner warn">${icon('alert')} <span>${sinEmpresas}</span></div>` : ''}
      <div class="row wrap">
        <label class="field"><span>Empresa (${comision ? 'comitente' : 'patrón'})</span>
          <select id="l-emp"><option value="">Elige…</option>${empresas.map((p) => `<option value="${esc(p.id)}" ${p.id === d.empresaId ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>
        <label class="field"><span>Firma por la empresa</span>
          <select id="l-apo" ${emp ? '' : 'disabled'}><option value="">${emp ? (apos.length ? 'Elige…' : 'Sin apoderados en el catálogo') : 'Primero elige la empresa'}</option>
          ${apos.map((a) => `<option value="${esc(a.id)}" ${a.id === d.apoderadoId ? 'selected' : ''}>${esc(a.nombre)}${a.vigente ? '' : ' (poder no vigente)'}</option>`).join('')}</select></label>
      </div>
      <label class="btn">${icon('upload')} ${d.file ? `Cambiar Excel (${esc(d.file)})` : 'Subir Excel P1'}<input type="file" id="l-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
      <p class="muted small">${comision
        ? 'Una fila por comisionista. De tu P1 se usan nombre, RFC, CURP (de ahí sale la nacionalidad), domicilio y <strong>Fecha de Firma</strong>; las demás columnas no se piden.'
        : 'Una fila por trabajador. Además de las columnas de siempre, el P1 debe traer <strong>Lugar de Trabajo</strong>, <strong>Fecha de Firma</strong> y, para tiempo determinado, <strong>Fecha de Terminación</strong>. El género de nacionalidad y estado civil se ajusta según el sexo.'}</p>
    </section>
    ${d.missing.length ? `<div class="banner danger">${icon('alert')} <span>Al Excel le faltan columnas: ${d.missing.map((c) => esc(c.label)).join(', ')}.</span></div>` : ''}
    ${d.workers ? `
      ${tpl ? '' : `<div class="banner warn">${icon('alert')} <span>Elige la plantilla para revisar los datos.</span></div>`}
      ${d.workers.length ? `
        <div class="banner ${nErr ? 'danger' : 'info'}">${icon(nErr ? 'alert' : 'check')} <span>${d.workers.length} ${comision ? `comisionista${d.workers.length === 1 ? '' : 's'}` : `trabajador${d.workers.length === 1 ? '' : 'es'}`}${nErr ? ` · ${nErr} con errores: no se generará su contrato (quedan en la lista de errores del lote)` : ' · datos completos'}</span></div>
        <div class="card lote-table">
          <div class="lt-row lt-head"><span>Fila</span><span>${comision ? 'Comisionista' : 'Trabajador'}</span><span>${comision ? 'RFC' : 'Puesto'}</span><span>${comision ? 'Fecha de firma' : 'Salario diario'}</span><span>Revisión</span></div>
          ${d.workers.map((w, i) => `
            <div class="lt-row ${d.errors[i].length ? 'bad' : ''}">
              <span class="muted">${w.fila}</span>
              <span><strong>${esc(w.nombre || '(sin nombre)')}</strong><span class="muted small mono">${esc(w.curp)}</span></span>
              ${comision ? `<span class="mono small">${esc(w.rfc)}</span><span>${esc(fmtLongDate(w.firma)) || '—'}</span>` : `<span>${esc(w.puesto)}</span>
              <span>${w.sd === null ? '—' : esc(formatValue({ type: 'money' }, w.sd).split(' (')[0])}</span>`}
              <span class="lt-rev">${d.errors[i].length ? `<span class="error-text small">${d.errors[i].map(esc).join('<br>')}</span>` : `<span class="ok-text">Listo${d.editadas?.has(i) ? ' · corregido aquí' : ''}</span>`}
                <button class="btn sm ${d.errors[i].length ? 'primary' : 'ghost'}" data-edit="${i}">${icon('pen')} ${d.errors[i].length ? 'Corregir' : 'Editar'}</button></span>
            </div>`).join('')}
        </div>` : '<div class="banner warn">No se encontraron trabajadores en el Excel.</div>'}` : ''}
    <div class="row wrap lote-actions">
      <a class="btn ghost" href="#/lotes">Cancelar</a>
      <button class="btn primary" id="l-create" ${listo && d.cliente?.trim() && (!lugarVar || d.lugarFirma?.trim()) ? '' : 'disabled'} data-ready="${listo ? 1 : ''}" data-lugar="${lugarVar ? 1 : ''}">${icon('check')} Enviar a revisión${d.workers && nErr ? ` (${nOk} contrato${nOk === 1 ? '' : 's'})` : ''}</button>
    </div>`;

  const revalidate = () => {
    const t = loteTemplates().find((x) => x.id === d.templateId);
    if (d.workers) d.errors = t ? validateWorkers(d.workers, t, { periodicidad: d.periodicidad || 'X' }) : d.workers.map(() => []);
    renderNuevoLote();
  };
  // Sin re-render al escribir para no perder el foco; solo se habilita o no el botón
  const habilitar = () => {
    const b = $('#l-create');
    b.disabled = !(b.dataset.ready && d.cliente?.trim() && (!b.dataset.lugar || d.lugarFirma?.trim()));
  };
  $('#l-cli').addEventListener('input', (e) => { d.cliente = e.target.value; habilitar(); });
  $('#l-tpl').addEventListener('change', (e) => { d.templateId = e.target.value; revalidate(); });
  $('#l-per').addEventListener('change', (e) => { d.periodicidad = e.target.value; renderNuevoLote(); });
  $('#l-lugar')?.addEventListener('input', (e) => { d.lugarFirma = e.target.value.trim(); habilitar(); });
  $('#l-emp').addEventListener('change', (e) => {
    d.empresaId = e.target.value;
    const p = state.parties.find((x) => x.id === d.empresaId);
    const vig = p?.apoderados.filter((a) => a.nombre.trim() && a.vigente) || [];
    d.apoderadoId = vig.length === 1 ? vig[0].id : '';
    renderNuevoLote();
  });
  $('#l-apo').addEventListener('change', (e) => { d.apoderadoId = e.target.value; });
  $('#l-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const ExcelJS = await loadExcel();
      const wb = new ExcelJS.Workbook();
      const buf = await f.arrayBuffer();
      await wb.xlsx.load(buf);
      const { rows, missing, sheetIndex, header } = readP1(wb);
      // Se guardan el archivo y los valores originales para armar el P1 final con las correcciones
      Object.assign(d, { fileBuf: buf, sheetIndex, header, raw0: structuredClone(rows) });
      d.rawMissing = missing;
      d.file = f.name;
      d.raw = rows;
      d.editadas = new Set();
      d.workers = rows.map(normalizeRow);
      revalidate();
    } catch (err) {
      console.error(err);
      toast(`No se pudo leer el Excel: ${err.message}`, 'error');
    }
  });
  $('#l-create').addEventListener('click', sinRepetir('lote', createLote));
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => editLoteRow(Number(b.dataset.edit))));
}

// Campos del P1 que se pueden corregir en la plataforma (los demás no los usa el contrato)
const P1_EDIT = ['nombre', 'apPaterno', 'apMaterno', 'nombreCompleto', 'curp', 'rfc', 'nacionalidad', 'sexo', 'estadoCivil', 'calle', 'noExt', 'noInt',
  'colonia', 'municipio', 'cp', 'sueldo', 'sd', 'puesto', 'lugar', 'diasPago', 'antiguedad', 'ingreso', 'fin', 'firma'];

/** Corrige una fila del P1 sin salir de la plataforma; el Excel original no se modifica. */
async function editLoteRow(i) {
  const d = state.loteDraft;
  const raw = d.raw[i];
  const errs = d.errors[i];
  const tpl = loteTemplates().find((x) => x.id === d.templateId);
  const determinado = tpl && tipoDePlantilla(tpl) === 'DETERMINADO';
  const cols = P1_COLUMNS.filter((c) => P1_EDIT.includes(c.key)
    && (c.key in raw || !['nombreCompleto', 'sd', 'sexo'].includes(c.key))
    && !(c.key === 'nombreCompleto' && 'nombre' in raw)
    && !(c.key === 'fin' && !determinado)
    && (!tpl || usaColumna(tpl, c.key)));
  // Lo que muestra cada campo: los montos sin "$" ni comas (un input numérico borraría "$12,500.00")
  const val = (c) => {
    if (DATE_KEYS.has(c.key)) return toISODate(raw[c.key]);
    if (['sueldo', 'sd'].includes(c.key)) {
      const n = typeof raw[c.key] === 'number' ? raw[c.key] : Number(String(raw[c.key] ?? '').replace(/[^0-9.]/g, ''));
      return raw[c.key] === undefined || raw[c.key] === '' || !Number.isFinite(n) ? '' : String(n);
    }
    return raw[c.key] ?? '';
  };
  const field = (c) => {
    const id = `p1-${c.key}`;
    const type = DATE_KEYS.has(c.key) ? 'date' : ['sueldo', 'sd'].includes(c.key) ? 'number' : 'text';
    const input = `<input name="${c.key}" id="${id}" type="${type}" ${type === 'number' ? 'step="0.01" min="0"' : ''} value="${esc(val(c))}">`;
    return `<label class="field"><span>${esc(c.label)}</span>${input}</label>`;
  };
  const r = await modal({
    title: `Corregir fila ${raw.fila}${d.workers[i].nombre ? `: ${d.workers[i].nombre}` : ''}`,
    wide: true,
    body: `
      ${errs.length ? `<div class="banner danger">${icon('alert')} <span>${errs.map(esc).join('<br>')}</span></div>` : ''}
      <p class="muted small">La corrección se usa en este lote; el Excel no se modifica. Sexo y nacionalidad se calculan con la CURP y el salario diario con el sueldo mensual.</p>
      <div class="p1-grid">${cols.map(field).join('')}</div>`,
    actions: [{ label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true }, { label: 'Guardar corrección', value: 'ok', kind: 'primary' }],
  });
  if (r.value !== 'ok') return;
  const next = { ...raw };
  for (const c of cols) {
    const v = (r.data[c.key] ?? '').trim();
    // Solo se reemplaza lo que el usuario cambió; lo demás conserva el valor original del Excel
    if (v === String(val(c)).trim()) continue;
    next[c.key] = ['sueldo', 'sd'].includes(c.key) ? (v === '' ? '' : Number(v)) : v;
  }
  d.raw[i] = next;
  d.workers[i] = normalizeRow(next);
  d.editadas.add(i);
  const t = loteTemplates().find((x) => x.id === d.templateId);
  if (t) d.errors = validateWorkers(d.workers, t, { periodicidad: d.periodicidad || 'X' });
  const quedan = d.errors[i]?.length;
  toast(quedan ? `La fila ${raw.fila} aún tiene ${quedan} error(es)` : `Fila ${raw.fila} corregida`, quedan ? 'error' : 'ok');
  renderNuevoLote();
}

async function createLote() {
  const d = state.loteDraft;
  if (!d) return;
  const tpl = loteTemplates().find((t) => t.id === d.templateId);
  const emp = state.parties.find((p) => p.id === d.empresaId);
  const apo = emp?.apoderados.find((a) => a.id === d.apoderadoId) || null;
  const tipo = tipoDePlantilla(tpl);
  if (!apo && !(await confirmDialog('Sin representante', `No elegiste quién firma por ${emp.nombre}. Los contratos saldrán sin representante ${tipo === 'COMISION' ? 'del comitente' : 'del patrón'}. ¿Continuar?`, 'Continuar', 'primary'))) return;
  const validos = d.workers.filter((w, i) => !d.errors[i].length);
  const excluidos = d.workers.map((w, i) => ({ fila: w.fila, nombre: w.nombre, curp: w.curp, errores: d.errors[i] })).filter((x) => x.errores.length);
  const fecha = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  const cliente = d.cliente.trim().replace(/\s+/g, ' ');
  // Se guardan copias de la plantilla y de la empresa: lo que se aprueba es exactamente lo que se revisó
  const l = {
    id: uid(),
    cliente,
    title: `${cliente} · ${emp.nombre} · ${validos.length} contrato${validos.length === 1 ? '' : 's'} · ${fecha}`,
    tipo,
    status: 'revision',
    periodicidad: tipo === 'COMISION' ? '' : d.periodicidad,
    ...(tpl.vars.some(([k]) => k === 'lugar_firma') ? { lugarFirma: d.lugarFirma } : {}),
    archivo: d.file,
    p1: await p1DelLote(d),
    plantilla: structuredClone(tpl),
    empresa: structuredClone(emp),
    apoderado: apo ? structuredClone(apo) : null,
    trabajadores: validos,
    excluidos,
    createdAt: Date.now(),
    createdBy: whoAmI(),
    history: [],
  };
  await saveLote(l, `Creó el lote con ${validos.length} ${tipo === 'COMISION' ? 'comisionistas' : 'trabajadores'} (${d.file})${d.editadas?.size ? `; ${d.editadas.size} fila(s) corregida(s) en la plataforma` : ''}${excluidos.length ? `; ${excluidos.length} quedaron fuera por errores` : ''}`);
  state.loteDraft = null;
  toast('Lote enviado a revisión', 'ok');
  go(`#/lotes/${l.id}`);
  if (excluidos.length) alertExcluidos(l);
}

// --- Detalle del lote ---
function renderLote(id) {
  setNav('lotes');
  const l = state.lotes.find((x) => x.id === id);
  if (!l) { toast('Lote no encontrado', 'error'); return go('#/lotes'); }
  const gaps = missingVariables(workerContract(l, l.trabajadores[0] || {}));
  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow"><a href="#/lotes">Lotes</a> · <span class="badge ${l.status}">${LOTE_STATUS[l.status]}</span></p>
        <h1>${esc(l.title)}</h1>
      </div>
      <div class="row">
        ${l.status === 'revision'
          ? `<button class="btn primary" id="lote-approve">${icon('check')} Aprobar lote</button>`
          : `<button class="btn primary" id="lote-zip">${icon('download')} Descargar .zip</button>`}
        <button class="icon-btn" id="lote-view" title="Visualizar resumen y contratos" aria-label="Visualizar">${icon('eye')}</button>
        <button class="icon-btn" id="lote-print" title="Imprimir resumen y contratos" aria-label="Imprimir">${icon('print')}</button>
        <button class="icon-btn" id="lote-del" title="Eliminar lote" aria-label="Eliminar lote">${icon('trash')}</button>
      </div>
    </header>
    <section class="card settings-block">
      ${l.cliente ? `<p><strong>Cliente:</strong> ${esc(l.cliente)}</p>` : ''}
      <p><strong>Plantilla:</strong> ${esc(l.plantilla.name)}</p>
      <p><strong>${l.tipo === 'COMISION' ? 'Comitente' : 'Patrón'}:</strong> ${esc(l.empresa?.nombre || '')}${l.apoderado ? `, representada por ${esc(l.apoderado.nombre)}` : ' <span class="warn-text">(sin representante)</span>'}</p>
      <p>${l.periodicidad ? `<strong>Periodicidad de pago:</strong> ${esc(l.periodicidad)} · ` : ''}${l.lugarFirma ? `<strong>Lugar de firma:</strong> ${esc(l.lugarFirma)} · ` : ''}<strong>Excel:</strong> ${esc(l.archivo || '')}${l.p1 ? ` <button class="btn sm ghost" id="lote-p1">${icon('download')} ${l.p1.corregido ? 'P1 corregido' : 'P1'}</button>` : ''}</p>
      <p class="muted small">Creado por ${esc(l.createdBy || '')} el ${fmtDateTime(l.createdAt)}${l.status === 'aprobado' ? ` · Aprobado por ${esc(l.approvedBy || '')} el ${fmtDateTime(l.approvedAt)}` : ''}</p>
      ${l.status === 'aprobado' ? (l.dropbox
        ? `<p class="small"><strong>En Dropbox:</strong> <code>${esc(l.dropbox.carpeta)}</code></p>`
        : dbx.isConnected()
          ? `<p class="small"><span class="warn-text">Aún no está en Dropbox.</span> Se guardará en <code id="lote-dbx-dest">${esc(loteFolder(l))}</code> <button class="btn sm" id="lote-dbx">${icon('folder')} Guardar en Dropbox</button></p>`
          : '<p class="muted small">Conecta Dropbox en Ajustes para guardar los contratos en el expediente del cliente.</p>') : ''}
    </section>
    ${l.status === 'aprobado' ? `<p class="small"><strong>Firmados:</strong> ${firmadosLote(l)} de ${l.trabajadores.length}${firmadosLote(l) < l.trabajadores.length ? ' · imprime, firma en persona y sube el PDF escaneado de cada uno con “Subir firmado”.' : ''}</p>` : ''}
    ${gaps.length ? `<div class="banner warn">${icon('alert')} <span>Faltan datos en los contratos: ${gaps.map(esc).join(', ')}. Si son de la empresa, complétalos en el catálogo y vuelve a crear el lote.</span></div>` : ''}
    ${l.status === 'revision' ? `<div class="banner info">${icon('doc')} <span>Revisa los Word (cada uno sale marcado “EN REVISIÓN”). Cuando estén bien, cualquiera del equipo puede aprobar el lote.</span></div>` : ''}
    <div class="card lote-table">
      <div class="lt-row lt-head"><span>#</span><span>${l.tipo === 'COMISION' ? 'Comisionista' : 'Trabajador'}</span><span>${l.tipo === 'COMISION' ? 'RFC' : 'Puesto'}</span><span>Firma</span><span></span></div>
      ${l.trabajadores.map((w, i) => `
        <div class="lt-row">
          <span class="muted">${i + 1}</span>
          <span><strong>${esc(w.nombre)}</strong><span class="muted small mono">${esc(w.curp)}</span></span>
          <span${l.tipo === 'COMISION' ? ' class="mono small"' : ''}>${esc(l.tipo === 'COMISION' ? w.rfc : w.puesto)}</span>
          <span>${esc(fmtLongDate(w.firma))}</span>
          <span class="row wrap">
            <button class="btn sm" data-word="${i}">${icon('doc')} Word</button>
            ${l.status !== 'aprobado' ? '' : w.firmado
              ? `<span class="badge final" title="Subido por ${esc(w.firmado.by || '')} el ${fmtDateTime(w.firmado.at)}">Firmado</span>${dbx.isConnected() ? `<button class="btn sm" data-firmado-abrir="${i}">Abrir</button>` : ''}`
              : `<button class="btn sm" data-firmado="${i}">${icon('upload')} Subir firmado</button>`}
          </span>
        </div>`).join('')}
    </div>
    ${l.excluidos?.length ? `
      <h4 class="sub">Sin contrato por errores (${l.excluidos.length})</h4>
      <div class="banner danger">${icon('alert')} <span>Estos trabajadores no tienen contrato en el lote. Corrige sus datos en el P1 y genera un lote nuevo solo con ellos.</span></div>
      <div class="card lote-table">
        <div class="lt-row lt-head"><span>Fila</span><span>Trabajador</span><span>CURP</span><span></span><span>Error</span></div>
        ${l.excluidos.map((x) => `
          <div class="lt-row bad">
            <span class="muted">${x.fila}</span>
            <span><strong>${esc(x.nombre || '(sin nombre)')}</strong></span>
            <span class="mono small">${esc(x.curp)}</span><span></span>
            <span class="error-text small">${x.errores.map(esc).join('<br>')}</span>
          </div>`).join('')}
      </div>
      <button class="btn" id="lote-err-word">${icon('doc')} Word con la lista de errores</button>` : ''}
    ${l.history?.length ? `<h4 class="sub">Historial</h4><ul class="history">${l.history.map((h) => `<li><span class="muted small">${fmtDateTime(h.date)}</span> ${esc(h.by || '')}: ${esc(h.text)}</li>`).join('')}</ul>` : ''}`;

  $$('[data-firmado]').forEach((b) => b.addEventListener('click', conAviso(async () => {
    if (await subirFirmadoLote(l, Number(b.dataset.firmado))) renderLote(id);
  })));
  $$('[data-firmado-abrir]').forEach((b) => b.addEventListener('click', conAviso(() => openDropboxFile(l.trabajadores[Number(b.dataset.firmadoAbrir)].firmado.path))));
  $$('[data-word]').forEach((b) => b.addEventListener('click', conAviso(async () => {
    const i = Number(b.dataset.word);
    const D = await loadDocx();
    const c = workerContract(l, l.trabajadores[i]);
    download(await buildDocxBlob(D, c, { label: l.status === 'aprobado' ? '' : 'EN REVISIÓN' }), fileNameFor(i, l.trabajadores[i]));
  })));
  $('#lote-approve')?.addEventListener('click', async () => {
    if (gaps.length && !(await confirmDialog('Faltan datos', `Los contratos tienen datos vacíos (${gaps.join(', ')}). ¿Aprobar de todos modos?`, 'Aprobar', 'primary'))) return;
    if (!gaps.length && !(await confirmDialog('Aprobar lote', `Se aprobarán ${l.trabajadores.length} contratos. Después podrás descargar el .zip con las versiones finales.`, 'Aprobar', 'primary'))) return;
    l.status = 'aprobado';
    l.approvedBy = whoAmI();
    l.approvedAt = Date.now();
    await saveLote(l, 'Aprobó el lote');
    toast('Lote aprobado', 'ok');
    if (dbx.isConnected()) {
      try {
        toast('Guardando los contratos en Dropbox…');
        await guardarLoteDropbox(l);
        toast('Contratos guardados en Dropbox', 'ok');
      } catch (err) {
        console.error(err);
        toast(`No se pudieron guardar en Dropbox: ${err.message}. Usa “Guardar en Dropbox”.`, 'error');
      }
    }
    renderLote(l.id);
  });
  $('#lote-zip')?.addEventListener('click', () => downloadLoteZip(l));
  $('#lote-dbx')?.addEventListener('click', conAviso(async () => {
    toast('Guardando los contratos en Dropbox…');
    await guardarLoteDropbox(l);
    toast('Contratos guardados en Dropbox', 'ok');
    renderLote(l.id);
  }));
  // La ruta sugerida se afina al leer las carpetas que ya existen en Dropbox
  if ($('#lote-dbx-dest')) loadExpedienteFolders().then(() => { const el = $('#lote-dbx-dest'); if (el) el.textContent = loteFolder(l); });
  $('#lote-p1')?.addEventListener('click', () => download(p1Blob(l), l.p1.name));
  $('#lote-err-word')?.addEventListener('click', async () => {
    const D = await loadDocx();
    download(await buildErroresDocxBlob(D, l), erroresFileName(l));
  });
  $('#lote-view').addEventListener('click', () => viewLote(l));
  $('#lote-print').addEventListener('click', () => printLote(l));
  $('#lote-del').addEventListener('click', async () => { if (await deleteLote(l)) go('#/lotes'); });
}

async function deleteLote(l) {
  const aviso = l.status === 'aprobado' ? ' El lote ya está aprobado; si necesitas los contratos, descarga antes el .zip.' : '';
  if (!(await confirmDialog('Eliminar lote', `Se eliminará "${l.title}" con los datos de sus ${l.trabajadores.length} trabajadores, en este equipo y en Dropbox.${aviso}`, 'Eliminar'))) return false;
  await db.remove('lotes', l.id);
  await sync.markDeleted('lotes', l.id);
  scheduleSync();
  state.lotes = state.lotes.filter((x) => x.id !== l.id);
  toast('Lote eliminado');
  return true;
}

/** Documento HTML con una hoja de resumen del lote y después cada contrato en página nueva. */
function loteHTML(l, { toolbar = false } = {}) {
  const enRevision = l.status !== 'aprobado';
  const com = l.tipo === 'COMISION';
  const filas = l.trabajadores.map((w, i) => `<tr><td>${i + 1}</td><td>${esc(w.nombre)}</td><td>${esc(w.curp)}</td><td>${esc(com ? w.rfc : w.puesto)}</td><td>${esc(fmtLongDate(w.firma))}</td></tr>`).join('');
  const resumen = `
    <section class="pg">
      <h1>${esc(l.title)}</h1>
      <table class="kv">
        ${l.cliente ? `<tr><th>Cliente</th><td>${esc(l.cliente)}</td></tr>` : ''}
        <tr><th>${com ? 'Comitente' : 'Patrón'}</th><td>${esc(l.empresa?.nombre || '')}${l.apoderado ? `, representada por ${esc(l.apoderado.nombre)}` : ''}</td></tr>
        <tr><th>Tipo</th><td>${esc(TIPO_LOTE[l.tipo] || l.tipo)}</td></tr>
        <tr><th>Plantilla</th><td>${esc(l.plantilla?.name || '')}</td></tr>
        ${l.periodicidad ? `<tr><th>Periodicidad de pago</th><td>${esc(l.periodicidad)}</td></tr>` : ''}
        ${l.lugarFirma ? `<tr><th>Lugar de firma</th><td>${esc(l.lugarFirma)}</td></tr>` : ''}
        <tr><th>Excel</th><td>${esc(l.archivo || '')}${l.p1?.corregido ? ' (corregido en la plataforma)' : ''}</td></tr>
        <tr><th>Estado</th><td>${LOTE_STATUS[l.status]}</td></tr>
        <tr><th>Creado</th><td>${esc(l.createdBy || '')}, ${fmtDateTime(l.createdAt)}</td></tr>
        ${l.status === 'aprobado' ? `<tr><th>Aprobado</th><td>${esc(l.approvedBy || '')}, ${fmtDateTime(l.approvedAt)}</td></tr>` : ''}
      </table>
      <h2>Contratos (${l.trabajadores.length})</h2>
      <table class="grid"><thead><tr><th>#</th><th>${com ? 'Comisionista' : 'Trabajador'}</th><th>CURP</th><th>${com ? 'RFC' : 'Puesto'}</th><th>Firma</th></tr></thead><tbody>${filas}</tbody></table>
      ${l.excluidos?.length ? `
        <h2>Sin contrato por errores (${l.excluidos.length})</h2>
        <table class="grid"><thead><tr><th>Fila</th><th>Trabajador</th><th>CURP</th><th>Error</th></tr></thead><tbody>
          ${l.excluidos.map((x) => `<tr><td>${x.fila}</td><td>${esc(x.nombre || '(sin nombre)')}</td><td>${esc(x.curp)}</td><td>${x.errores.map(esc).join('<br>')}</td></tr>`).join('')}
        </tbody></table>` : ''}
    </section>`;
  const contratos = l.trabajadores.map((w) => `
    <section class="pg doc">${enRevision ? '<p class="label">EN REVISIÓN</p>' : ''}${documentHTML(workerContract(l, w))}</section>`).join('');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(l.title)}</title><style>
    @page { size: letter; margin: 2.5cm 3cm; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 10pt/1.4 Arial, Helvetica, sans-serif; color: #000; }
    .pg + .pg { break-before: page; }
    h1 { font-size: 13pt; margin: 0 0 12pt; }
    h2 { font-size: 11pt; margin: 14pt 0 6pt; }
    table { border-collapse: collapse; width: 100%; }
    .kv th { text-align: left; width: 34%; padding: 3pt 6pt 3pt 0; vertical-align: top; }
    .kv td { padding: 3pt 0; }
    .grid th, .grid td { border: .5pt solid #999; padding: 3pt 5pt; text-align: left; vertical-align: top; font-size: 9pt; }
    .grid thead { display: table-header-group; } .grid tr { break-inside: avoid; }
    .label { text-align: right; font-weight: bold; letter-spacing: .1em; margin: 0 0 8pt; }
    .watermark { display: none; }
    .doc .doc-h1 { text-align: center; font-size: 11pt; text-transform: uppercase; letter-spacing: .12em; margin: 0 0 14pt; }
    .doc h2 { font-size: 10pt; text-transform: uppercase; margin: 12pt 0 6pt; } .doc h2.center { text-align: center; }
    .doc p { text-align: justify; margin: 0 0 6pt; }
    .doc .v { font-weight: bold; } .doc .v.missing { font-style: italic; }
    .doc-signs { display: grid; grid-template-columns: 1fr 1fr; gap: 28pt 40pt; margin-top: 36pt; break-inside: avoid; }
    .doc-sign { display: flex; flex-direction: column; align-items: center; text-align: center; }
    .sig-img { height: 50pt; display: flex; align-items: flex-end; } .sig-img img { max-height: 50pt; }
    .sig-line { width: 100%; border-top: .75pt solid #000; margin-bottom: 4pt; }
    @media screen {
      html { background: #e5e7eb; }
      body { padding: 64px 12px 24px; }
      .pg { background: #fff; max-width: 21.59cm; margin: 0 auto 16px; padding: 2.5cm 3cm; box-shadow: 0 1px 6px rgba(0,0,0,.2); }
      .bar { position: fixed; inset: 0 0 auto; display: flex; gap: 12px; align-items: center; padding: 10px 16px; background: #111827; color: #fff; font-size: 14px; }
      .bar span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .bar button { font: 600 14px Arial, sans-serif; padding: 8px 16px; border: 0; border-radius: 8px; background: #93c5fd; color: #111827; cursor: pointer; }
    }
    @media screen and (max-width: 700px) { .pg { padding: 24px 16px; } }
    @media print { .bar { display: none; } }
  </style></head><body>${toolbar ? `<div class="bar"><span>${esc(l.title)}</span><button onclick="print()">Imprimir</button></div>` : ''}${resumen}${contratos}</body></html>`;
  return html;
}

/** Abre el resumen y los contratos en una pestaña nueva para revisarlos en pantalla. */
function viewLote(l) {
  const url = URL.createObjectURL(new Blob([loteHTML(l, { toolbar: true })], { type: 'text/html' }));
  if (!window.open(url, '_blank')) toast('El navegador bloqueó la ventana; permite ventanas emergentes para esta página', 'error');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function printLote(l) {
  const html = loteHTML(l);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.append(frame);
  // El escucha de afterprint se agrega ya cargado el documento (document.open() lo borraría) y el
  // marco se quita al terminar, para no dejar copias ocultas del lote en la página
  frame.addEventListener('load', () => {
    const w = frame.contentWindow;
    const quitar = () => setTimeout(() => frame.remove(), 500);
    w.addEventListener('afterprint', quitar);
    w.focus();
    w.print();
    setTimeout(() => frame.isConnected && frame.remove(), 60000);
  }, { once: true });
  frame.srcdoc = html;
}

const erroresFileName = (l) => `00 - Errores (${l.excluidos.length} sin contrato).docx`;

/** Aviso con los trabajadores que quedaron fuera del lote y su error. */
function alertExcluidos(l) {
  return modal({
    title: `${l.excluidos.length} persona${l.excluidos.length === 1 ? "" : "s"} sin contrato`,
    body: `<p>Se generó el lote con ${l.trabajadores.length} contrato${l.trabajadores.length === 1 ? '' : 's'}. Estos trabajadores quedaron fuera por errores en el P1:</p>
      <ul class="err-list">${l.excluidos.map((x) => `<li><strong>${esc(x.nombre || `Fila ${x.fila}`)}</strong> <span class="muted small">(fila ${x.fila})</span><br><span class="error-text small">${x.errores.map(esc).join('; ')}</span></li>`).join('')}</ul>
      <p class="muted small">La lista también se descarga en Word desde el lote y va dentro del .zip.</p>`,
    actions: [{ label: 'Entendido', value: 'ok', kind: 'primary' }],
  });
}

/** P1 que se usó en el lote: el original o, si se corrigió en la plataforma, con las correcciones. */
async function p1DelLote(d) {
  if (!d.fileBuf) return null;
  try {
    const bytes = await p1Final(await loadExcel(), d.fileBuf, d);
    const base = d.file.replace(/\.xlsx$/i, '');
    return { name: `${base}${d.editadas?.size ? ' (corregido)' : ''}.xlsx`, corregido: !!d.editadas?.size, data: toBase64(bytes) };
  } catch (err) {
    // Si no se pudieron aplicar las correcciones, se guarda el original y se avisa
    console.error(err);
    toast(`No se pudieron aplicar las correcciones al P1 (${err.message}); se guarda el original`, 'error');
    return { name: d.file.replace(/\.xlsx$/i, ' (original, sin correcciones).xlsx'), corregido: false, data: toBase64(new Uint8Array(d.fileBuf)) };
  }
}
const p1Blob = (l) => new Blob([fromBase64(l.p1.data)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

/** Archivos finales del lote: un Word por persona, la lista de errores (si hubo) y el P1. */
const firmadosLote = (l) => l.trabajadores.filter((w) => w.firmado).length;

/** Sube el PDF escaneado del contrato firmado de un trabajador a la carpeta del lote. true si se guardó. */
async function subirFirmadoLote(l, i) {
  if (!dbx.isConnected()) { toast('Conecta Dropbox en Ajustes para guardar el contrato firmado', 'error'); return false; }
  const w = l.trabajadores[i];
  const nombre = fileNameFor(i, w).replace(/\.docx$/i, '') + ' - FIRMADO.pdf';
  const r = await modal({
    title: `Contrato firmado · ${w.nombre}`,
    body: `
      <p class="muted small">Sube el PDF escaneado del contrato firmado. Se guarda en la carpeta del lote como “${esc(nombre)}”.</p>
      <label class="field"><span>PDF firmado</span><input type="file" name="pdf" accept="application/pdf,.pdf" required></label>`,
    actions: [{ label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true }, { label: 'Guardar', value: 'ok', kind: 'primary' }],
  });
  const file = r.data?.pdf;
  if (r.value !== 'ok' || !file?.size) return false;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { toast('El archivo debe ser PDF', 'error'); return false; }
  await loadExpedienteFolders();
  const meta = await dbx.upload(dbx.joinPath(loteFolder(l), nombre), file, { reemplazar: true });
  w.firmado = { path: meta.path_display, at: Date.now(), by: whoAmI() };
  await saveLote(l, `Subió el contrato firmado de ${w.nombre}`);
  toast('Contrato firmado guardado en Dropbox', 'ok');
  return true;
}

async function archivosLote(l) {
  const D = await loadDocx();
  const files = [];
  for (const [i, w] of l.trabajadores.entries()) {
    const blob = await buildDocxBlob(D, workerContract(l, w), { label: '' });
    files.push({ name: fileNameFor(i, w), data: new Uint8Array(await blob.arrayBuffer()) });
  }
  if (l.excluidos?.length) {
    const blob = await buildErroresDocxBlob(D, l);
    files.push({ name: erroresFileName(l), data: new Uint8Array(await blob.arrayBuffer()) });
  }
  if (l.p1) files.push({ name: `00 - P1 - ${l.p1.name}`, data: fromBase64(l.p1.data) });
  return files;
}

const downloadLoteZip = conAviso(async (l) => {
  if (l.status !== 'aprobado') return toast('El lote aún no está aprobado', 'error');
  download(new Blob([buildZip(await archivosLote(l))], { type: 'application/zip' }), `${safeName(l.title)}.zip`);
});

/**
 * Carpeta de Dropbox del lote: expediente del cliente del lote (el de la ficha si está en el catálogo; si no,
 * una carpeta con su nombre en EXPEDIENTES CLIENTES) / CONTRATOS DE TRABAJO/<DETERMINADOS|INDETERMINADOS>
 * (o CONTRATOS DE COMISIÓN MERCANTIL) / <lote>.
 */
function loteFolder(l) {
  if (l.dropbox?.carpeta) return l.dropbox.carpeta;
  const nombre = String(l.cliente || '').trim();
  const k = nucleo(nombre);
  // Con o sin tipo de sociedad: primero el mismo núcleo del nombre; si no, uno muy parecido
  const clientes = state.parties.filter((p) => !p.propia);
  const ficha = nombre && (clientes.find((p) => k && nucleo(p.nombre) === k) || clientes.find((p) => parecido(nombre, p.nombre) >= 0.9));
  const base = expedienteOf(ficha || { nombre: nombre || 'SIN CLIENTE', propia: false });
  return dbx.joinPath(base, subcarpetaLote(l.tipo), safeName(l.title));
}

/** Sube a Dropbox los contratos finales del lote. Devuelve la carpeta, o null si Dropbox no está conectado. */
async function guardarLoteDropbox(l) {
  if (!dbx.isConnected() || l.status !== 'aprobado') return null;
  await loadExpedienteFolders();
  const carpeta = loteFolder(l);
  for (const f of await archivosLote(l)) {
    await dbx.upload(dbx.joinPath(carpeta, f.name), new Blob([f.data]), { reemplazar: true });
  }
  l.dropbox = { carpeta, at: Date.now(), by: whoAmI() };
  await saveLote(l, `Guardó los contratos en Dropbox (${carpeta})`);
  return carpeta;
}

(async function init() {
  await loadAll();
  await dbx.loadConfig();
  await ds.loadConfig();
  db.requestPersistence();
  if (!navigator.onLine) $('#offline')?.removeAttribute('hidden');
  try {
    if (await dbx.handleRedirect()) toast(`Conectado a Dropbox como ${dbx.config().account?.name}`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
  try {
    if (await ds.handleRedirect()) toast(`Conectado a DocuSign como ${ds.config().user?.name}`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
  route();
  $('#sync-pill')?.addEventListener('click', () => runSync({ manual: true }));
  if (dbx.isConnected()) {
    setSyncPill('ok');
    runSync();
    setInterval(() => { if (!document.hidden) runSync(); }, 60 * 1000);
  }
  if (ds.isConnected()) {
    setTimeout(revisarEnvios, 5000);
    setInterval(() => { if (!document.hidden) revisarEnvios(); }, 5 * 60 * 1000);
  }
  window.addEventListener('focus', () => scheduleSync(500));
  window.addEventListener('online', () => scheduleSync(500));
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW', err));
  }
})();

