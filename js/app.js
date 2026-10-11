import * as db from './db.js';
import { TEMPLATES, CLAUSES, CATEGORIES } from './templates.js';
import {
  uid, VAR_TYPES, slugify, humanize, newContractFromTemplate, syncVarDefs, usedVariables, fill,
  missingVariables, contentHash, addVersion, layoutSections, ordinal, restoreVersion, logChange, duplicateContract,
  contractToTemplate, fmtDateTime, fmtRelative, formatValue, canonicalText, brokenEfirmas, hasEfirma, todayISO,
} from './model.js';
import {
  PARTY_KINDS, newParty, newApoderado, newAccionista, partyGaps, declaracionesText, applyParty, matchesQuery, fmtLongDate,
} from './parties.js';
import { catalogToXlsx, xlsxToCatalog } from './catalog-xlsx.js';
import * as dbx from './dropbox.js';
import * as sync from './sync.js';
import { readCertificate, readPrivateKey, signText, verifySignature, base64ToBlob, loadForge } from './efirma.js';
import { buildPdf, shareOrDownload, download } from './pdf.js';
import { buildDocxBlob, buildErroresDocxBlob } from './docx-export.js';
import { createSignaturePad } from './signature.js';
import { P1_COLUMNS, PERIODICIDADES, readP1, normalizeRow, toISODate, p1Final, toBase64, fromBase64, validateWorkers, isLoteTemplate, tipoDePlantilla, workerContract, contractGaps, fileNameFor } from './lote.js';
import { buildZip } from './zip.js';
import { DIAS_DEFAULT, SEGUIMIENTO, listaVencimientos, porAtender, textoDias } from './vencimientos.js';

// ---------- Estado ----------
const state = {
  contracts: [],
  userTemplates: [],
  parties: [],
  lotes: [],
  loteDraft: null,
  loteQuery: '',
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

const STATUS = { borrador: 'Borrador', revision: 'En revisión', aprobado: 'Aprobado', final: 'Firmado' };
const statusBadge = (c) => `<span class="badge ${c.status}">${STATUS[c.status] || c.status}</span>`;

const app = document.getElementById('app');
const nav = document.getElementById('bottom-nav');

// ---------- Utilidades ----------
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
  state.prefs = { anticipacion: DIAS_DEFAULT, ...((await db.get('meta', 'prefs')) || {}) };
}

async function saveContract(c) {
  c.updatedAt = Date.now();
  if (dbx.isConnected()) c.updatedBy = dbx.config().account?.name;
  await db.put('contracts', structuredClone(c));
  await sync.markDirty('contracts', c.id);
  scheduleSync();
  const i = state.contracts.findIndex((x) => x.id === c.id);
  if (i >= 0) state.contracts[i] = c; else state.contracts.unshift(c);
  state.contracts.sort((a, b) => b.updatedAt - a.updatedAt);
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
    toast('El contrato volvió a borrador: genera una nueva versión para revisión');
    renderEditorHeader();
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

function routeView() {
  const [, view, id, tab] = location.hash.split('/');
  saveNow();
  if (view === 'c' && id) return openEditor(id, tab || 'secciones');
  state.current = null;
  document.body.classList.remove('in-editor');
  if (view === 'plantillas') return renderTemplates();
  if (view === 'plantilla' && id) return renderTemplateEditor(id);
  if (view === 'catalogo') return id ? renderPartyEditor(id) : renderCatalog();
  if (view === 'lotes') return id === 'nuevo' ? renderNuevoLote() : id ? renderLote(id) : renderLotes();
  if (view === 'ajustes') return renderSettings();
  if (view === 'vencimientos') return renderVencimientos();
  return renderHome();
}

function setNav(active) {
  $$('a', nav).forEach((a) => a.classList.toggle('active', a.dataset.nav === active));
  updateVencBadge();
}

// ---------- Vencimientos ----------
const vencimientos = () => listaVencimientos(state.lotes, { hoy: todayISO(), anticipacion: state.prefs.anticipacion });

function updateVencBadge() {
  const dot = $('#venc-badge');
  if (!dot) return;
  const n = porAtender(vencimientos()).length;
  dot.textContent = n > 99 ? '99+' : n || '';
  dot.hidden = !n;
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
  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow">Contratos de trabajo por tiempo determinado</p>
        <h1>Vencimientos</h1>
      </div>
    </header>
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
  const signed = c.signers.filter((s) => c.signatures[s.id]).length;
  return { missing, signed, total: c.signers.length };
}

function renderHome() {
  setNav('home');
  const q = state.homeQuery.toLowerCase();
  const list = state.contracts.filter((c) =>
    (state.homeFilter === 'todos' || c.status === state.homeFilter) &&
    (!q || fill(c, c.title).toLowerCase().includes(q)));
  const counts = { todos: state.contracts.length };
  for (const k of Object.keys(STATUS)) counts[k] = state.contracts.filter((c) => c.status === k).length;

  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow">Crear Contratos</p>
        <h1>Mis contratos</h1>
      </div>
      <a href="#/plantillas" class="btn primary hide-sm">${icon('plus')} Nuevo contrato</a>
    </header>
    ${vencBanner()}
    ${state.contracts.length ? `
      <div class="toolbar">
        <label class="search">${icon('search')}<input id="home-q" type="search" placeholder="Buscar contrato" value="${esc(state.homeQuery)}"></label>
        <div class="chips" role="tablist">
          ${[['todos', 'Todos'], ['borrador', 'Borradores'], ['revision', 'En revisión'], ['aprobado', 'Aprobados'], ['final', 'Firmados']].map(([k, l]) =>
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
        <div class="ll-row" data-id="${c.id}" tabindex="0" role="link">
          <span><strong>${esc(fill(c, c.title))}</strong><span class="muted small">${esc(tpl?.name || 'Documento personalizado')}</span></span>
          <span>${statusBadge(c)}</span>
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
      title: fill(c, c.title),
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
    const r = await modal({ title: fill(c, c.title), wide: true, body: `<div class="paper">${documentHTML(c)}</div>`,
      actions: [{ label: 'Cerrar', value: '', kind: 'ghost' }, { label: 'Exportar PDF', value: 'pdf', kind: 'ghost' }, { label: 'Abrir y editar', value: 'open', kind: 'primary' }] });
    if (r.value) return contractAction(r.value, c);
    return;
  }
  if (act === 'pdf') return exportPdf(c);
  if (act === 'word') return downloadWord(c);
  if (act === 'download') {
    const r = await modal({
      title: `Descargar: ${fill(c, c.title)}`,
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
    if (!(await confirmDialog('Eliminar contrato', `Se eliminará "${fill(c, c.title)}" con todas sus versiones y firmas. Esta acción no se puede deshacer.`, 'Eliminar'))) return;
    await db.remove('contracts', c.id);
    await sync.markDeleted('contracts', c.id);
    scheduleSync();
    state.contracts = state.contracts.filter((x) => x.id !== c.id);
    toast('Contrato eliminado');
    if (state.current?.id === c.id) { state.current = null; go('#/'); } else renderHome();
  }
}

async function downloadWord(c) {
  const D = await loadDocx();
  download(await buildDocxBlob(D, c, { label: c.status === 'aprobado' || c.status === 'final' ? '' : 'BORRADOR' }), `${safeName(fill(c, c.title))}.docx`);
  toast('Word descargado', 'ok');
}

async function exportPdf(c) {
  const missing = missingVariables(c);
  if (missing.length) {
    const ok = await confirmDialog('Faltan datos',
      `Hay ${missing.length} variable(s) sin completar. Aparecerán entre corchetes en el PDF. ¿Exportar de todos modos?`, 'Exportar', 'primary');
    if (!ok) return;
  }
  try {
    const { blob, filename } = buildPdf(c);
    const res = await shareOrDownload(blob, filename, fill(c, c.title));
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
  const list = allTemplates().filter((t) =>
    (state.tplCategory === 'todas' || t.category === state.tplCategory) &&
    (!q || (t.name + ' ' + t.description).toLowerCase().includes(q)));

  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow">Biblioteca</p>
        <h1>Plantillas</h1>
      </div>
    </header>
    <div class="toolbar">
      <label class="search">${icon('search')}<input id="tpl-q" type="search" placeholder="Buscar plantilla" value="${esc(state.tplQuery)}"></label>
      <div class="chips">
        ${cats.map((c) => `<button class="chip ${state.tplCategory === c.id ? 'on' : ''}" data-cat="${c.id}">${esc(c.label)}</button>`).join('')}
      </div>
    </div>
    ${list.length ? `
    <div class="card lotes-list tpl-list">
      <div class="ll-row ll-head"><span>Plantilla</span><span>Categoría</span><span>Secciones</span><span>Variables</span><span>Origen</span><span></span></div>
      ${list.map((t) => `
      <div class="ll-row" data-id="${t.id}" tabindex="0" role="button">
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
    <p class="disclaimer">Las plantillas son modelos generales de referencia y no sustituyen la asesoría de un abogado. Revisa que el contenido se ajuste a tu caso y a la legislación aplicable.</p>
  `;
  $('#tpl-q').addEventListener('input', (e) => {
    state.tplQuery = e.target.value;
    const pos = e.target.selectionStart;
    renderTemplates();
    const el = $('#tpl-q'); el.focus(); el.setSelectionRange(pos, pos);
  });
  $$('[data-cat]').forEach((b) => b.addEventListener('click', () => { state.tplCategory = b.dataset.cat; renderTemplates(); }));
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
  ['documento', 'Word y PDF'],
  ['firmas', 'Firmas'],
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
        <span id="save-status" class="muted small">Guardado</span>
      </div>
    </div>
    <a class="btn primary" href="#/c/${c.id}/documento">${icon('doc')}<span class="hide-xs">Word y PDF</span></a>
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
    ${!['aprobado', 'final'].includes(c.status) ? `<div class="watermark">${c.status === 'revision' ? 'REVISIÓN' : 'BORRADOR'}</div>` : ''}
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
    <article class="card sec-card ${s.kind === 'texto' ? 'is-texto' : ''}" data-id="${s.id}">
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
  $(`.sec-card[data-id="${sec.id}"]`)?.classList.add('flash');
}

function enableDrag(list) {
  let dragId = null;
  list.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.sec-card');
    if (card) card.draggable = !!e.target.closest('.grip');
  });
  list.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.sec-card');
    dragId = card.dataset.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const over = e.target.closest('.sec-card');
    $$('.sec-card', list).forEach((c) => c.classList.toggle('drop-target', c === over && over.dataset.id !== dragId));
  });
  list.addEventListener('drop', (e) => {
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
  if (!hasSigs || !c.signedHash || c.signedHash === contentHash(c)) return '';
  return `<div class="banner danger">${icon('alert')} <span>El contenido cambió después de que se firmó. Considera solicitar las firmas de nuevo.</span></div>`;
}

/** Aviso en las pestañas de edición cuando hay firmas electrónicas avanzadas vigentes. */
function efirmaEditBanner(c) {
  if (brokenEfirmas(c).length) return signedChangedBanner(c);
  if (!hasEfirma(c)) return '';
  return `<div class="banner info">${icon('shield')} <span>Este contrato tiene firmas electrónicas avanzadas. Cualquier cambio en el texto, los datos o los firmantes las invalidará.</span></div>`;
}

// --- Pestaña: Firmas ---
function renderSigners() {
  const c = state.current;
  const signed = c.signers.filter((s) => c.signatures[s.id]).length;
  const box = tabBox();
  box.innerHTML = `
    ${signedChangedBanner(c)}
    <div class="card soft sign-summary">
      <div>
        <strong>${signed} de ${c.signers.length} firmas</strong>
        <p class="muted small">Elige por firmante: <b>firma autógrafa</b> (dibujada) o <b>firma electrónica avanzada</b> con e.firma del SAT.</p>
        ${hasEfirma(c) ? `<button class="link" data-act="signed-txt">${icon('doc', 'xs')} Descargar texto firmado (.txt) para verificación</button>` : ''}
      </div>
      ${c.status === 'final'
        ? `<button class="btn" data-act="draft">Volver a borrador</button>`
        : `<button class="btn primary" data-act="final" ${missingVariables(c).length ? 'title="Hay datos pendientes"' : ''}>${icon('check')} Marcar como firmado</button>`}
    </div>
    <div class="signers">
      ${c.signers.map((sg) => {
        const sig = c.signatures[sg.id];
        return `
        <div class="card signer" data-id="${sg.id}">
          <div class="row">
            <label class="field role"><span>Rol</span><input data-f="role" value="${esc(sg.role)}"></label>
            <label class="field grow"><span>Nombre (admite variables)</span><input data-f="name" value="${esc(sg.name)}" placeholder="{{nombre}} o texto"></label>
          </div>
          <p class="muted small">Se mostrará como: <strong>${esc(fill(c, sg.name)) || '—'}</strong></p>
          ${sig?.type === 'efirma' ? efirmaBox(c, sig) : `
          <div class="sig-box ${sig ? 'has' : ''}">
            ${sig ? `<img src="${esc(sig.image)}" alt="Firma de ${esc(fill(c, sg.name))}"><span class="muted small">Firma autógrafa · ${fmtDateTime(sig.date)}</span>` : '<span class="muted">Sin firma</span>'}
          </div>`}
          <div class="row end">
            <button class="link danger" data-act="remove-signer">Quitar firmante</button>
            ${sig ? '<button class="btn sm" data-act="clear-sig">Borrar firma</button>' : ''}
            ${sig?.type === 'efirma' ? `
              <button class="btn sm" data-act="verify">${icon('check')} Verificar</button>
              <button class="btn sm" data-act="p7s">Descargar .p7s</button>` : ''}
          </div>
          ${sig ? '' : `
          <div class="sign-options">
            <button class="btn" data-act="sign">${icon('pen')} Firma autógrafa</button>
            <button class="btn primary" data-act="efirma">${icon('shield')} Firmar con e.firma</button>
          </div>`}
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
      case 'sign': return signFor(sg);
      case 'efirma': return signWithEfirma(sg);
      case 'verify': return verifyEfirma(sg);
      case 'p7s': {
        const sig = c.signatures[id];
        download(base64ToBlob(sig.p7s, 'application/pkcs7-signature'), `firma-${slugify(sig.info.rfc || sig.info.name)}.p7s`);
        return toast('Firma .p7s descargada', 'ok');
      }
      case 'signed-txt': {
        const sig = Object.values(c.signatures).find((x) => x.type === 'efirma');
        download(new Blob([sig.signedText], { type: 'text/plain;charset=utf-8' }), `${slugify(fill(c, c.title)).slice(0, 50)}-texto-firmado.txt`);
        return toast('Texto firmado descargado', 'ok');
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
      case 'final': {
        const pending = c.signers.length - c.signers.filter((s) => c.signatures[s.id]).length;
        const missing = missingVariables(c).length;
        if (missing || pending) {
          const msg = [missing && `${missing} dato(s) sin completar`, pending && `${pending} firma(s) pendiente(s)`].filter(Boolean).join(' y ');
          if (!(await confirmDialog('Marcar como firmado', `Hay ${msg}. ¿Marcar como firmado de todos modos?`, 'Marcar firmado', 'primary'))) return;
        }
        c.status = 'final';
        addVersion(c, 'Versión firmada');
        logChange(c, 'Marcó el contrato como firmado');
        await saveContract(c);
        renderEditorHeader();
        toast('Contrato marcado como firmado y versión guardada', 'ok');
        return renderSigners();
      }
      case 'draft':
        c.status = 'borrador';
        touched({ log: 'Regresó el contrato a borrador', content: false });
        renderEditorHeader();
        return renderSigners();
    }
  });
}

async function signFor(sg) {
  const c = state.current;
  let pad;
  const r = await modal({
    title: `Firma: ${fill(c, sg.name) || sg.role}`,
    body: `
      <p class="muted small">${esc(sg.role)} · Firma dentro del recuadro.</p>
      <div class="pad-wrap"><canvas class="sig-pad" aria-label="Área de firma"></canvas><span class="pad-hint">Firma aquí</span></div>
      <label class="check"><input type="checkbox" name="agree" required> Confirmo que he leído el contrato y estoy de acuerdo con su contenido.</label>`,
    actions: [
      { label: 'Limpiar', value: 'clear', kind: 'ghost', formnovalidate: true },
      { label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true },
      { label: 'Aceptar firma', value: 'ok', kind: 'primary' },
    ],
    onOpen: (dlg) => {
      const canvas = $('.sig-pad', dlg);
      pad = createSignaturePad(canvas);
      canvas.addEventListener('pointerdown', () => $('.pad-hint', dlg)?.remove(), { once: true });
      $('button[value="clear"]', dlg).addEventListener('click', (e) => { e.preventDefault(); pad.clear(); });
      $('button[value="ok"]', dlg).addEventListener('click', (e) => {
        if (pad.isEmpty()) { e.preventDefault(); toast('Dibuja tu firma primero', 'error'); }
      });
    },
  });
  if (r.value !== 'ok') return;
  if (!Object.keys(c.signatures).length) c.signedHash = contentHash(c);
  c.signatures[sg.id] = { image: pad.toDataURL(), date: Date.now() };
  touched({ log: `Firmó ${fill(c, sg.name) || sg.role}`, content: false });
  renderSigners();
  toast('Firma agregada', 'ok');
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

async function signWithEfirma(sg) {
  const c = state.current;
  const missing = missingVariables(c);
  if (missing.length) {
    toast(`Completa los ${missing.length} dato(s) pendientes antes de firmar con e.firma`, 'error');
    state.focusVar = missing[0];
    return go(`#/c/${c.id}/variables`);
  }
  loadForge().catch(() => {}); // precarga mientras se llenan los campos
  let loaded = null; // { cert, info }
  const r = await modal({
    title: `Firmar con e.firma: ${fill(c, sg.name) || sg.role}`,
    body: `
      <p class="muted small">Firma electrónica avanzada con los archivos de tu <b>e.firma del SAT</b> (también funciona con otro certificado X.509 RSA).
      Los archivos y la contraseña se usan solo en este dispositivo: <b>no se guardan ni se envían a ningún servidor</b>.</p>
      <label class="field"><span>Certificado (.cer)</span><input type="file" name="cer" accept=".cer,.crt,.pem" required></label>
      <div class="cert-preview" hidden></div>
      <label class="field"><span>Llave privada (.key)</span><input type="file" name="key" accept=".key,.pem" required></label>
      <label class="field"><span>Contraseña de la llave privada</span><input type="password" name="pass" autocomplete="off" required></label>
      <label class="check"><input type="checkbox" name="agree" required> He leído el contrato y lo firmo con mi firma electrónica avanzada, con la misma validez que mi firma autógrafa.</label>
      <p class="error-text" hidden></p>`,
    actions: [
      { label: 'Cancelar', value: '', kind: 'ghost', formnovalidate: true },
      { label: 'Firmar', value: 'ok', kind: 'primary' },
    ],
    onOpen: (dlg) => {
      const preview = $('.cert-preview', dlg);
      const err = $('.error-text', dlg);
      const showErr = (m) => { err.textContent = m; err.hidden = !m; };
      $('input[name=cer]', dlg).addEventListener('change', async (e) => {
        loaded = null;
        preview.hidden = true;
        showErr('');
        const file = e.target.files[0];
        if (!file) return;
        try {
          loaded = await readCertificate(file);
          const i = loaded.info;
          const now = Date.now();
          const expired = now > i.validTo || now < i.validFrom;
          const signerName = fill(c, sg.name).trim();
          const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          const mismatch = signerName && norm(signerName) !== norm(i.name);
          preview.innerHTML = `
            <strong>${esc(i.name)}</strong>
            <span>${i.rfc ? `RFC ${esc(i.rfc)} · ` : ''}Certificado ${esc(i.certNumber)}</span>
            <span>Emitido por ${esc(i.issuer)}</span>
            <span class="${expired ? 'warn-text' : 'ok-text'}">${expired ? 'Certificado NO vigente' : 'Vigente'} (${new Date(i.validFrom).toLocaleDateString('es-MX')} – ${new Date(i.validTo).toLocaleDateString('es-MX')})</span>
            ${i.isSAT ? '' : '<span class="warn-text">No es un certificado emitido por el SAT.</span>'}
            ${mismatch ? `<span class="warn-text">El titular no coincide con el firmante "${esc(signerName)}".</span>` : ''}`;
          preview.hidden = false;
          if (expired) { showErr('El certificado no está vigente; no se puede usar para firmar.'); loaded = null; }
        } catch (ex) {
          showErr(ex.message);
        }
      });
      $('button[value="ok"]', dlg).addEventListener('click', async (e) => {
        const form = $('form', dlg);
        if (!form.checkValidity()) return; // deja que el navegador marque los campos
        e.preventDefault();
        if (!loaded) return showErr(err.textContent || 'Selecciona un certificado .cer válido.');
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Firmando…';
        try {
          const key = await readPrivateKey($('input[name=key]', dlg).files[0], $('input[name=pass]', dlg).value, loaded.cert);
          const text = canonicalText(c);
          const result = await signText(text, loaded.cert, key);
          dlg.signed = { type: 'efirma', date: Date.now(), signedText: text, ...result };
          $('input[name=pass]', dlg).value = '';
          dlg.close('ok');
        } catch (ex) {
          showErr(ex.message || 'No se pudo firmar.');
          btn.disabled = false;
          btn.textContent = 'Firmar';
        }
      });
    },
  });
  const signed = r.value === 'ok' && r.dlg.signed;
  if (!signed) return;
  c.signatures[sg.id] = signed;
  if (!sg.name.trim()) sg.name = signed.info.name;
  touched({ log: `Firmó con e.firma ${signed.info.name}${signed.info.rfc ? ` (RFC ${signed.info.rfc})` : ''}, certificado ${signed.info.certNumber}`, content: false });
  renderSigners();
  toast('Firma electrónica avanzada agregada', 'ok');
}

async function verifyEfirma(sg) {
  const c = state.current;
  const sig = c.signatures[sg.id];
  const v = await verifySignature(sig, canonicalText(c));
  const line = (ok, yes, no) => `<li class="${ok ? 'ok-text' : 'warn-text'}">${icon(ok ? 'check' : 'alert', 'xs')} ${ok ? yes : no}</li>`;
  await modal({
    title: v.valid ? 'Firma válida' : 'La firma no es válida',
    body: `
      <ul class="verify-list">
        ${line(v.signatureOk, 'La firma criptográfica corresponde al certificado y al texto firmado.', 'La firma criptográfica no coincide con el texto o el certificado.')}
        ${line(v.unchanged, 'El contrato no ha cambiado desde que se firmó.', 'El contrato cambió después de la firma.')}
        ${line(v.certValidAtSigning, 'El certificado estaba vigente al momento de firmar.', 'El certificado no estaba vigente al momento de firmar.')}
      </ul>
      <p class="muted small">Titular: <b>${esc(sig.info.name)}</b>${sig.info.rfc ? ` · RFC ${esc(sig.info.rfc)}` : ''} · Certificado ${esc(sig.info.certNumber)}</p>
      <p class="muted small">Esta verificación no consulta si el SAT revocó el certificado después de su emisión. Para una validación oficial usa el servicio de verificación del SAT o un prestador de servicios de certificación.</p>`,
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
      <div class="list-item card" data-id="${v.id}">
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

async function saveParty(p) {
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
        <div class="ll-row" data-id="${p.id}" tabindex="0" role="link">
          <span><strong>${esc(p.nombre || 'Sin nombre')}</strong><span class="muted small">${PARTY_KINDS[p.kind]}</span></span>
          <span class="mono small">${esc(p.rfc || 'Sin RFC')}</span>
          <span>${partyBadges(p)}</span>
          <span>${p.kind === 'pm' ? `${apos} vigente${apos === 1 ? '' : 's'}` : '<span class="muted">—</span>'}</span>
          <span>${gaps.length ? `<span class="warn-text" title="${esc(gaps.join(', '))}">Faltan ${gaps.length} dato${gaps.length === 1 ? '' : 's'}</span>` : '<span class="ok-text">Completos</span>'}</span>
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
  $('#cat-export').addEventListener('click', exportCatalog);
  $('#cat-import').addEventListener('change', (e) => importCatalog(e.target.files[0]));
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
        row('Folio mercantil', [p.folioMercantil, fmtLongDate(p.folioFecha)].filter(Boolean).join(' · ')) + row('Objeto social', p.objetoSocial) : ''}
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
  await db.remove('parties', p.id);
  await sync.markDeleted('parties', p.id);
  scheduleSync();
  state.parties = state.parties.filter((x) => x.id !== p.id);
  toast('Eliminada del catálogo');
  return true;
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
  if (!r.value) return null;
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
  if (!res.parties.length) return toast('El Excel no tiene filas en la hoja "Partes"', 'error');
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
  if (res.renamed.length) await loadAll();
  toast('Catálogo actualizado', 'ok');
  renderCatalog();
}

// --- Ficha de una parte ---
const PARTY_FIELDS = {
  general: [['nombre', 'Nombre o razón social'], ['rfc', 'RFC'], ['domicilio', 'Domicilio', 'address'], ['correo', 'Correo', 'email'], ['telefono', 'Teléfono']],
  pm: [['escrituraNumero', 'Escritura constitutiva núm.'], ['escrituraFecha', 'Fecha de constitución', 'date'], ['notario', 'Notario (con título)', 'text', 'Lic. Juan Pérez López'],
    ['notariaNumero', 'Notaría núm.'], ['notariaCiudad', 'Ciudad de la notaría', 'text', 'la Ciudad de México'], ['folioMercantil', 'Folio mercantil electrónico'],
    ['folioFecha', 'Fecha de inscripción del folio', 'date'], ['objetoSocial', 'Objeto social (resumen)', 'address']],
  pf: [['curp', 'CURP'], ['nacionalidad', 'Nacionalidad'], ['sexo', 'Sexo'], ['estadoCivil', 'Estado civil'], ['ocupacion', 'Ocupación'], ['identificacion', 'Identificación', 'text', 'credencial para votar con clave de elector …']],
  apoderado: [['nombre', 'Nombre'], ['cargo', 'Cargo'], ['poderNumero', 'Escritura de poder núm.'], ['poderFecha', 'Fecha del poder', 'date'],
    ['notario', 'Notario (con título)'], ['notariaNumero', 'Notaría núm.'], ['notariaCiudad', 'Ciudad de la notaría'], ['facultades', 'Facultades', 'text', 'administración, dominio, títulos de crédito…']],
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
      <span id="party-save" class="muted small">Guardado</span>
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
        const folder = await browseDropbox({ mode: 'folder', start: p.expediente || sync.expedientesRoot(), title: `Expediente de ${p.nombre || 'la parte'}` });
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
        <div class="party-slot" data-sid="${sg.id}">
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
    <button value="${p.id}" class="menu-item party-pick" data-search="${esc(`${p.nombre} ${p.rfc}`.toLowerCase())}">
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
            <input type="radio" name="apo" value="${a.id}" ${i === 0 && a.vigente ? 'checked' : ''} required>
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
  who: () => dbx.config()?.account?.name || 'este equipo',
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
  const typing = document.activeElement?.matches?.('input, textarea, select') && location.hash.startsWith('#/catalogo/');
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

// Carpetas que ya existen en la raíz de expedientes (se leen al abrir Anexos)
let expedienteFolders = [];
const folderKey = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function loadExpedienteFolders() {
  try {
    expedienteFolders = (await dbx.listFolder(sync.expedientesRoot())).filter((e) => e['.tag'] === 'folder');
  } catch (err) {
    console.warn(err);
  }
}

/**
 * Carpeta del expediente de una parte: la guardada en el catálogo; si no hay, la carpeta existente
 * cuyo nombre coincide (p. ej. "MERCASA DEL BAJIO" ↔ "Mercasa del Bajío, S.A. de C.V."); si tampoco,
 * una nueva con el nombre de la parte.
 */
function expedienteOf(p) {
  if (p.expediente) return dbx.normalizePath(p.expediente);
  const key = folderKey(p.nombre);
  const match = key.length >= 5 && expedienteFolders
    .filter((f) => { const k = folderKey(f.name); return k.length >= 5 && (key.startsWith(k) || k.startsWith(key)); })
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (match) return match.path_display;
  const name = (p.nombre || 'Sin nombre').replace(/[\\/:*?"<>|]/g, '').trim();
  return dbx.joinPath(sync.expedientesRoot(), name);
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
          { label: 'Expedientes', path: sync.expedientesRoot() },
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
        ${linked.map(({ sg, p }, i) => `<label class="radio-item"><input type="radio" name="dest" value="${p.id}" ${i === 0 ? 'checked' : ''} required><span><strong>${esc(p.nombre)}</strong><span class="muted small">${esc(sg.role)} · ${esc(expedienteOf(p))}</span></span></label>`).join('')}
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
  try {
    for (const f of files) {
      const meta = await dbx.upload(dbx.joinPath(folder, f.name), f, { autorename: true });
      c.anexos.push({ id: uid(), name: meta.name, title: meta.name.replace(/\.[^.]+$/, ''), path: meta.path_display, size: meta.size, addedAt: Date.now() });
    }
    if (party && !party.expediente) {
      party.expediente = folder;
      await saveParty(party);
    }
    touched({ log: `Subió ${files.length} anexo(s) a Dropbox` });
    toast('Archivo(s) subido(s) y agregado(s) como anexo', 'ok');
    renderAnexos();
  } catch (err) {
    console.error(err);
    toast(err.message || 'No se pudo subir el archivo', 'error');
  }
}

// --- Ajustes: bloque de Dropbox ---
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
      await dbx.setOptions({ appKey, folder });
      await sync.resetState();
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

// ---------- Word y PDF: flujo Borrador → En revisión → Aprobado → Firmado ----------
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

const safeName = (s) => String(s || 'Documento').replace(/[\\/:*?"<>|]/g, '').replace(/\s*·\s*/g, ' - ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Documento';

/** Empresa a cuya carpeta va el contrato: la primera del grupo vinculada; si no, la primera parte vinculada. */
function clientParty(c) {
  const linked = c.signers.map((sg) => sg.party && state.parties.find((p) => p.id === sg.party.id)).filter(Boolean);
  return linked.find((p) => p.propia) || linked[0] || null;
}

/** Carpeta de Dropbox donde se guardan Word y PDF: <expediente de la empresa>/CONTRATOS/<título>. */
function contractFolder(c) {
  if (c.carpeta) return c.carpeta;
  const p = clientParty(c);
  const base = p ? expedienteOf(p) : dbx.joinPath(sync.expedientesRoot(), 'SIN EMPRESA');
  return dbx.joinPath(base, 'CONTRATOS', safeName(fill(c, c.title)));
}

/** Sube a Dropbox (si está conectado) y descarga en este equipo. Devuelve el registro del documento. */
async function deliverFile(c, blob, filename, kind) {
  let path = null;
  if (dbx.isConnected()) {
    await loadExpedienteFolders();
    const folder = contractFolder(c);
    const meta = await dbx.upload(dbx.joinPath(folder, filename), blob, { autorename: true });
    path = meta.path_display;
    // Si la carpeta de la empresa se creó ahora, queda guardada en su ficha del catálogo
    const p = clientParty(c);
    if (p && !p.expediente && !c.carpeta) { p.expediente = expedienteOf(p); await saveParty(p); }
  }
  download(blob, filename);
  const rec = { id: uid(), kind, name: path ? path.split('/').pop() : filename, path, date: Date.now(), by: dbx.config()?.account?.name || '', status: c.status };
  c.documentos = [rec, ...(c.documentos || [])];
  return rec;
}

const STATUS_STEPS = [['borrador', 'Borrador'], ['revision', 'En revisión'], ['aprobado', 'Aprobado'], ['final', 'Firmado']];

function renderDocumento() {
  const c = state.current;
  c.documentos ||= [];
  const box = tabBox();
  const connected = dbx.isConnected();
  const idx = STATUS_STEPS.findIndex(([k]) => k === c.status);
  const missing = missingVariables(c).length;
  const rev = c.revision || 0;
  box.innerHTML = `
    <ol class="stepper">
      ${STATUS_STEPS.map(([k, l], i) => `<li class="${i < idx ? 'done' : i === idx ? 'on' : ''}"><span>${i + 1}</span>${l}</li>`).join('')}
    </ol>
    ${missing ? `<div class="banner warn">${icon('alert')} <span>${missing} dato(s) sin completar: aparecerán entre corchetes en el documento.</span></div>` : ''}
    <section class="card form-block">
      ${c.status === 'borrador' ? `
        <h3>Enviar a revisión</h3>
        <p class="muted">Genera el Word ${rev ? `v${rev + 1}` : 'v1'} con la leyenda “EN REVISIÓN” para que los abogados lo revisen y anoten con control de cambios. Las correcciones se aplican aquí en la app (la plantilla no cambia).</p>
        <div class="row"><button class="btn primary" data-wf="review">${icon('doc')} Generar Word para revisión</button></div>`
      : c.status === 'revision' ? `
        <h3>En revisión · v${rev}</h3>
        <p class="muted">Si hay correcciones, edítalas en Secciones o Variables (el contrato regresa a borrador) y genera una nueva versión. Si todo está correcto, apruébalo: se generan el Word y el PDF finales sin leyendas.</p>
        <div class="row">
          <button class="btn" data-wf="review">${icon('doc')} Nueva versión v${rev + 1}</button>
          <button class="btn primary" data-wf="approve">${icon('check')} Aprobar y generar PDF</button>
        </div>`
      : c.status === 'aprobado' ? `
        <h3>Aprobado</h3>
        <p class="muted">${c.aprobado ? `Aprobado por ${esc(c.aprobado.by || '—')} el ${fmtDateTime(c.aprobado.date)}.` : ''} Recaba las firmas en la pestaña Firmas y márcalo como firmado.</p>
        <div class="row">
          <button class="btn" data-wf="pdf">${icon('pdf')} Descargar PDF final</button>
          <a class="btn primary" href="#/c/${c.id}/firmas">${icon('pen')} Ir a Firmas</a>
        </div>`
      : `
        <h3>Firmado</h3>
        <p class="muted">El contrato está firmado. Cualquier edición lo regresa a borrador.</p>
        <div class="row"><button class="btn" data-wf="pdf">${icon('pdf')} Descargar PDF</button></div>`}
      <button class="link" data-wf="word">Descargar Word de trabajo (sin guardar en Dropbox)</button>
    </section>
    <section class="card form-block">
      <h3>Dónde se guarda</h3>
      ${connected ? `
        <p class="muted small">En Dropbox, dentro del expediente de ${clientParty(c) ? `<strong>${esc(clientParty(c).nombre)}</strong>` : 'la empresa (vincula una parte en Variables)'}. Si la carpeta no existe, se crea sola.</p>
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
        <div class="doc-item" data-id="${d.id}">
          <span class="badge ${d.kind === 'pdf' ? 'final' : 'revision'}">${d.kind === 'pdf' ? 'PDF' : 'Word'}</span>
          <div class="anexo-main"><strong>${esc(d.name)}</strong><span class="muted small">${fmtDateTime(d.date)}${d.by ? ` · ${esc(d.by)}` : ''}${d.path ? '' : ' · solo descargado'}</span></div>
          ${d.path && connected ? '<button class="btn sm" data-wf="open">Abrir</button>' : ''}
        </div>`).join('')}</div>` : '<p class="muted small">Aún no se ha generado ningún documento.</p>'}
    </section>`;

  if (connected && !c.carpeta) {
    // Al leer las carpetas existentes puede reconocerse la del expediente (p. ej. "MERCASA DEL BAJIO")
    loadExpedienteFolders().then(() => { const el = $('#doc-folder'); if (el) el.textContent = contractFolder(c); });
  }

  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-wf]');
    if (!btn) return;
    const act = btn.dataset.wf;
    try {
      if (act === 'review') return await sendToReview(c, btn);
      if (act === 'approve') return await approve(c, btn);
      if (act === 'pdf') return exportPdf(c);
      if (act === 'word') return downloadWord(c);
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

async function sendToReview(c, btn) {
  const missing = missingVariables(c).length;
  if (missing && !(await confirmDialog('Faltan datos', `Hay ${missing} dato(s) sin completar; aparecerán entre corchetes. ¿Generar el Word de todos modos?`, 'Generar', 'primary'))) return;
  btn.disabled = true;
  const D = await loadDocx();
  const n = (c.revision || 0) + 1;
  const blob = await buildDocxBlob(D, c, { label: `EN REVISIÓN · v${n}` });
  c.revision = n;
  c.status = 'revision';
  await deliverFile(c, blob, `${safeName(fill(c, c.title))} - v${n} revision.docx`, 'docx');
  addVersion(c, `Revisión v${n}`);
  logChange(c, `Generó el Word de revisión v${n}`);
  await saveContract(c);
  renderEditorHeader();
  renderDocumento();
  toast(`Word v${n} generado${dbx.isConnected() ? ' y guardado en Dropbox' : ''}`, 'ok');
}

async function approve(c, btn) {
  const missing = missingVariables(c).length;
  if (!(await confirmDialog('Aprobar contrato', `${missing ? `Hay ${missing} dato(s) sin completar. ` : ''}Se generarán el Word y el PDF finales (sin leyendas) y el contrato quedará aprobado.`, 'Aprobar', 'primary'))) return;
  btn.disabled = true;
  const prev = c.status;
  c.status = 'aprobado';
  try {
    const D = await loadDocx();
    const base = safeName(fill(c, c.title));
    await deliverFile(c, await buildDocxBlob(D, c, { label: '' }), `${base} - APROBADO.docx`, 'docx');
    const { blob } = buildPdf(c);
    await deliverFile(c, blob, `${base} - APROBADO.pdf`, 'pdf');
  } catch (err) {
    c.status = prev;
    throw err;
  }
  c.aprobado = { by: dbx.config()?.account?.name || '', date: Date.now() };
  addVersion(c, 'Aprobado');
  logChange(c, `Aprobó el contrato${c.aprobado.by ? ` (${c.aprobado.by})` : ''}`);
  await saveContract(c);
  renderEditorHeader();
  renderDocumento();
  toast(`Contrato aprobado${dbx.isConnected() ? '; Word y PDF guardados en Dropbox' : ''}`, 'ok');
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
    <form class="party-form" id="tpl-form" autocomplete="off">
      <section class="card form-block">
        <div class="form-grid">
          <label class="field"><span>Nombre</span><input data-k="name" value="${esc(t.name)}"></label>
          <label class="field"><span>Categoría</span><select data-k="category">
            ${[...CATEGORIES, { id: 'mis', label: 'Mis plantillas' }].map((c) => `<option value="${c.id}" ${t.category === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select></label>
        </div>
        <label class="field"><span>Descripción</span><input data-k="description" value="${esc(t.description || '')}"></label>
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
    const num = e.target.dataset.num;
    if (num) { t[num] = e.target.value; rerender(); }
    if (e.target.dataset.k === 'kind') {
      const sec = t.sections[Number(holder(e.target).dataset.i)];
      if (e.target.value === 'texto') sec.kind = 'texto'; else delete sec.kind;
      rerender();
    }
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
  form.addEventListener('change', (e) => {
    // Al terminar de editar una clave o un texto se recalculan las variables detectadas
    if (e.target.dataset.k === '0' || e.target.tagName === 'SELECT') rerender();
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
      <p class="muted small">${state.contracts.length} contratos · ${state.userTemplates.length} plantillas propias · ${state.parties.length} partes en el catálogo</p>
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
    const data = { app: 'crear-contratos', version: 1, exportedAt: new Date().toISOString(), contracts: state.contracts, templates: state.userTemplates, parties: state.parties };
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
      if (!(await confirmDialog('Importar respaldo', `Se importarán ${n} contratos, ${(data.templates || []).length} plantillas y ${(data.parties || []).length} partes del catálogo. Los que tengan el mismo identificador se reemplazarán.`, 'Importar', 'primary'))) return;
      for (const c of data.contracts || []) { await db.put('contracts', c); await sync.markDirty('contracts', c.id); }
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
    if (!(await confirmDialog('Borrar todos los datos', `Se eliminarán todos los contratos, versiones, firmas, plantillas propias y el catálogo de partes de este dispositivo.${dbx.isConnected() ? ' También se desconectará Dropbox; lo que está en Dropbox no se borra.' : ''} Exporta un respaldo antes si lo necesitas.`, 'Borrar todo'))) return;
    if (dbx.isConnected()) await dbx.disconnect();
    await sync.resetState();
    await db.clear('contracts');
    await db.clear('templates');
    await db.clear('parties');
    await db.clear('lotes');
    await loadAll();
    toast('Datos eliminados');
    renderSettings();
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
const whoAmI = () => dbx.config()?.account?.name || 'este equipo';

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
        <p class="eyebrow">Contratos individuales de trabajo</p>
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
        <div class="ll-row ll-head"><span>Cliente</span><span>Empresa (patrón)</span><span>Tipo</span><span>Contratos</span><span>Estado</span><span>Creado</span><span></span></div>
        ${list.map((l) => `
        <div class="ll-row" data-id="${l.id}" tabindex="0" role="link">
          <span><strong>${l.cliente ? esc(l.cliente) : '<span class="muted">—</span>'}</strong></span>
          <span><strong>${esc(l.empresa?.nombre || l.title)}</strong><span class="muted small">${esc(fmtLongDate(l.trabajadores[0]?.firma) || fmtDateTime(l.createdAt))}</span></span>
          <span>${l.tipo === 'DETERMINADO' ? 'Determinado' : 'Indeterminado'}</span>
          <span>${l.trabajadores.length}${l.excluidos?.length ? `<span class="warn-text small">${l.excluidos.length} con errores</span>` : ''}</span>
          <span><span class="badge ${l.status}">${LOTE_STATUS[l.status]}</span>${l.status === 'aprobado' ? `<span class="muted small">${esc(l.approvedBy || '')}</span>` : ''}</span>
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
        <h2>Contratos de trabajo en lote</h2>
        <p>Sube tu Excel P1 (una fila por trabajador), elige la empresa, quién firma y la plantilla. La app revisa los datos, genera un contrato por trabajador y, cuando alguien del equipo aprueba el lote, descargas todos en un .zip.</p>
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
  d.missing = d.rawMissing.filter((c) => c.key !== 'fin' || (tpl && tipoDePlantilla(tpl) === 'DETERMINADO'));
  const nErr = d.errors ? d.errors.filter((e) => e.length).length : 0;
  const nOk = d.workers ? d.workers.length - nErr : 0;
  // Se genera con los trabajadores correctos; los que tienen errores quedan fuera y se reportan
  const ok = nOk > 0 && !d.missing.length;
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
          <select id="l-tpl"><option value="">Elige…</option>${tpls.map((t) => `<option value="${t.id}" ${t.id === d.templateId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Periodicidad de pago</span>
          <select id="l-per"><option value="">Elige…</option>${PERIODICIDADES.map((p) => `<option ${p === d.periodicidad ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      </div>
      ${tpls.length ? '' : '<p class="warn-text small">No hay plantillas de trabajo con firmantes “patrón” y “trabajador”. Sincroniza para traer las plantillas marco.</p>'}
      ${sinEmpresas ? `<div class="banner warn">${icon('alert')} <span>${sinEmpresas}</span></div>` : ''}
      <div class="row wrap">
        <label class="field"><span>Empresa (patrón)</span>
          <select id="l-emp"><option value="">Elige…</option>${empresas.map((p) => `<option value="${p.id}" ${p.id === d.empresaId ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>
        <label class="field"><span>Firma por la empresa</span>
          <select id="l-apo" ${emp ? '' : 'disabled'}><option value="">${emp ? (apos.length ? 'Elige…' : 'Sin apoderados en el catálogo') : 'Primero elige la empresa'}</option>
          ${apos.map((a) => `<option value="${a.id}" ${a.id === d.apoderadoId ? 'selected' : ''}>${esc(a.nombre)}${a.vigente ? '' : ' (poder no vigente)'}</option>`).join('')}</select></label>
      </div>
      <label class="btn">${icon('upload')} ${d.file ? `Cambiar Excel (${esc(d.file)})` : 'Subir Excel P1'}<input type="file" id="l-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
      <p class="muted small">Una fila por trabajador. Además de las columnas de siempre, el P1 debe traer <strong>Lugar de Trabajo</strong>, <strong>Fecha de Firma</strong> y, para tiempo determinado, <strong>Fecha de Terminación</strong>. El género de nacionalidad y estado civil se ajusta según el sexo.</p>
    </section>
    ${d.missing.length ? `<div class="banner danger">${icon('alert')} <span>Al Excel le faltan columnas: ${d.missing.map((c) => esc(c.label)).join(', ')}.</span></div>` : ''}
    ${d.workers ? `
      ${tpl ? '' : `<div class="banner warn">${icon('alert')} <span>Elige la plantilla para revisar los datos.</span></div>`}
      ${d.workers.length ? `
        <div class="banner ${nErr ? 'danger' : 'info'}">${icon(nErr ? 'alert' : 'check')} <span>${d.workers.length} trabajador${d.workers.length === 1 ? '' : 'es'}${nErr ? ` · ${nErr} con errores: no se generará su contrato (quedan en la lista de errores del lote)` : ' · datos completos'}</span></div>
        <div class="card lote-table">
          <div class="lt-row lt-head"><span>Fila</span><span>Trabajador</span><span>Puesto</span><span>Salario diario</span><span>Revisión</span></div>
          ${d.workers.map((w, i) => `
            <div class="lt-row ${d.errors[i].length ? 'bad' : ''}">
              <span class="muted">${w.fila}</span>
              <span><strong>${esc(w.nombre || '(sin nombre)')}</strong><span class="muted small mono">${esc(w.curp)}</span></span>
              <span>${esc(w.puesto)}</span>
              <span>${w.sd === null ? '—' : esc(formatValue({ type: 'money' }, w.sd).split(' (')[0])}</span>
              <span class="lt-rev">${d.errors[i].length ? `<span class="error-text small">${d.errors[i].map(esc).join('<br>')}</span>` : `<span class="ok-text">Listo${d.editadas?.has(i) ? ' · corregido aquí' : ''}</span>`}
                <button class="btn sm ${d.errors[i].length ? 'primary' : 'ghost'}" data-edit="${i}">${icon('pen')} ${d.errors[i].length ? 'Corregir' : 'Editar'}</button></span>
            </div>`).join('')}
        </div>` : '<div class="banner warn">No se encontraron trabajadores en el Excel.</div>'}` : ''}
    <div class="row wrap lote-actions">
      <a class="btn ghost" href="#/lotes">Cancelar</a>
      <button class="btn primary" id="l-create" ${ok && tpl && emp && d.periodicidad && d.cliente?.trim() ? '' : 'disabled'} data-ready="${ok && tpl && emp && d.periodicidad ? 1 : ''}">${icon('check')} Enviar a revisión${d.workers && nErr ? ` (${nOk} contrato${nOk === 1 ? '' : 's'})` : ''}</button>
    </div>`;

  const revalidate = () => {
    const t = loteTemplates().find((x) => x.id === d.templateId);
    if (d.workers) d.errors = t ? validateWorkers(d.workers, t, { periodicidad: d.periodicidad || 'X' }) : d.workers.map(() => []);
    renderNuevoLote();
  };
  // Sin re-render al escribir para no perder el foco; solo se habilita o no el botón
  $('#l-cli').addEventListener('input', (e) => {
    d.cliente = e.target.value;
    const b = $('#l-create');
    b.disabled = !(b.dataset.ready && d.cliente.trim());
  });
  $('#l-tpl').addEventListener('change', (e) => { d.templateId = e.target.value; revalidate(); });
  $('#l-per').addEventListener('change', (e) => { d.periodicidad = e.target.value; renderNuevoLote(); });
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
  $('#l-create').addEventListener('click', createLote);
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => editLoteRow(Number(b.dataset.edit))));
}

// Campos del P1 que se pueden corregir en la plataforma (los demás no los usa el contrato)
const P1_EDIT = ['nombre', 'apPaterno', 'apMaterno', 'nombreCompleto', 'curp', 'rfc', 'nacionalidad', 'sexo', 'estadoCivil', 'calle', 'noExt', 'noInt',
  'colonia', 'municipio', 'cp', 'sueldo', 'sd', 'puesto', 'lugar', 'diasPago', 'tipo', 'antiguedad', 'ingreso', 'fin', 'firma'];
const P1_DATES = new Set(['antiguedad', 'ingreso', 'fin', 'firma']);
const normP1 = (v) => String(v ?? '').trim().toUpperCase();

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
    && !(c.key === 'fin' && !determinado));
  const val = (c) => (P1_DATES.has(c.key) ? toISODate(raw[c.key]) : raw[c.key] ?? '');
  const field = (c) => {
    const id = `p1-${c.key}`;
    const type = P1_DATES.has(c.key) ? 'date' : ['sueldo', 'sd'].includes(c.key) ? 'number' : 'text';
    const input = c.key === 'tipo'
      ? `<select name="${c.key}" id="${id}"><option value=""></option>${['INDETERMINADO', 'DETERMINADO'].map((o) => `<option ${normP1(val(c)) === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
      : `<input name="${c.key}" id="${id}" type="${type}" ${type === 'number' ? 'step="0.01" min="0"' : ''} value="${esc(val(c))}">`;
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
  const tpl = loteTemplates().find((t) => t.id === d.templateId);
  const emp = state.parties.find((p) => p.id === d.empresaId);
  const apo = emp?.apoderados.find((a) => a.id === d.apoderadoId) || null;
  if (!apo && !(await confirmDialog('Sin representante', `No elegiste quién firma por ${emp.nombre}. Los contratos saldrán sin representante del patrón. ¿Continuar?`, 'Continuar', 'primary'))) return;
  const tipo = tipoDePlantilla(tpl);
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
    periodicidad: d.periodicidad,
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
  await saveLote(l, `Creó el lote con ${validos.length} trabajadores (${d.file})${d.editadas?.size ? `; ${d.editadas.size} fila(s) corregida(s) en la plataforma` : ''}${excluidos.length ? `; ${excluidos.length} quedaron fuera por errores` : ''}`);
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
  const gaps = contractGaps(workerContract(l, l.trabajadores[0] || {}));
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
      <p><strong>Patrón:</strong> ${esc(l.empresa?.nombre || '')}${l.apoderado ? `, representada por ${esc(l.apoderado.nombre)}` : ' <span class="warn-text">(sin representante)</span>'}</p>
      <p><strong>Periodicidad de pago:</strong> ${esc(l.periodicidad)} · <strong>Excel:</strong> ${esc(l.archivo || '')}${l.p1 ? ` <button class="btn sm ghost" id="lote-p1">${icon('download')} ${l.p1.corregido ? 'P1 corregido' : 'P1'}</button>` : ''}</p>
      <p class="muted small">Creado por ${esc(l.createdBy || '')} el ${fmtDateTime(l.createdAt)}${l.status === 'aprobado' ? ` · Aprobado por ${esc(l.approvedBy || '')} el ${fmtDateTime(l.approvedAt)}` : ''}</p>
    </section>
    ${gaps.length ? `<div class="banner warn">${icon('alert')} <span>Faltan datos en los contratos: ${gaps.map(esc).join(', ')}. Si son de la empresa, complétalos en el catálogo y vuelve a crear el lote.</span></div>` : ''}
    ${l.status === 'revision' ? `<div class="banner info">${icon('doc')} <span>Revisa los Word (cada uno sale marcado “EN REVISIÓN”). Cuando estén bien, cualquiera del equipo puede aprobar el lote.</span></div>` : ''}
    <div class="card lote-table">
      <div class="lt-row lt-head"><span>#</span><span>Trabajador</span><span>Puesto</span><span>Firma</span><span></span></div>
      ${l.trabajadores.map((w, i) => `
        <div class="lt-row">
          <span class="muted">${i + 1}</span>
          <span><strong>${esc(w.nombre)}</strong><span class="muted small mono">${esc(w.curp)}</span></span>
          <span>${esc(w.puesto)}</span>
          <span>${esc(fmtLongDate(w.firma))}</span>
          <span><button class="btn sm" data-word="${i}">${icon('doc')} Word</button></span>
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

  $$('[data-word]').forEach((b) => b.addEventListener('click', async () => {
    const i = Number(b.dataset.word);
    const D = await loadDocx();
    const c = workerContract(l, l.trabajadores[i]);
    download(await buildDocxBlob(D, c, { label: l.status === 'aprobado' ? '' : 'EN REVISIÓN' }), fileNameFor(i, l.trabajadores[i]));
  }));
  $('#lote-approve')?.addEventListener('click', async () => {
    if (gaps.length && !(await confirmDialog('Faltan datos', `Los contratos tienen datos vacíos (${gaps.join(', ')}). ¿Aprobar de todos modos?`, 'Aprobar', 'primary'))) return;
    if (!gaps.length && !(await confirmDialog('Aprobar lote', `Se aprobarán ${l.trabajadores.length} contratos. Después podrás descargar el .zip con las versiones finales.`, 'Aprobar', 'primary'))) return;
    l.status = 'aprobado';
    l.approvedBy = whoAmI();
    l.approvedAt = Date.now();
    await saveLote(l, 'Aprobó el lote');
    toast('Lote aprobado', 'ok');
    renderLote(l.id);
  });
  $('#lote-zip')?.addEventListener('click', () => downloadLoteZip(l));
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
  const filas = l.trabajadores.map((w, i) => `<tr><td>${i + 1}</td><td>${esc(w.nombre)}</td><td>${esc(w.curp)}</td><td>${esc(w.puesto)}</td><td>${esc(fmtLongDate(w.firma))}</td></tr>`).join('');
  const resumen = `
    <section class="pg">
      <h1>${esc(l.title)}</h1>
      <table class="kv">
        ${l.cliente ? `<tr><th>Cliente</th><td>${esc(l.cliente)}</td></tr>` : ''}
        <tr><th>Patrón</th><td>${esc(l.empresa?.nombre || '')}${l.apoderado ? `, representada por ${esc(l.apoderado.nombre)}` : ''}</td></tr>
        <tr><th>Tipo</th><td>Tiempo ${l.tipo === 'DETERMINADO' ? 'determinado' : 'indeterminado'}</td></tr>
        <tr><th>Plantilla</th><td>${esc(l.plantilla?.name || '')}</td></tr>
        <tr><th>Periodicidad de pago</th><td>${esc(l.periodicidad || '')}</td></tr>
        <tr><th>Excel</th><td>${esc(l.archivo || '')}${l.p1?.corregido ? ' (corregido en la plataforma)' : ''}</td></tr>
        <tr><th>Estado</th><td>${LOTE_STATUS[l.status]}</td></tr>
        <tr><th>Creado</th><td>${esc(l.createdBy || '')}, ${fmtDateTime(l.createdAt)}</td></tr>
        ${l.status === 'aprobado' ? `<tr><th>Aprobado</th><td>${esc(l.approvedBy || '')}, ${fmtDateTime(l.approvedAt)}</td></tr>` : ''}
      </table>
      <h2>Contratos (${l.trabajadores.length})</h2>
      <table class="grid"><thead><tr><th>#</th><th>Trabajador</th><th>CURP</th><th>Puesto</th><th>Firma</th></tr></thead><tbody>${filas}</tbody></table>
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
  frame.contentWindow.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 500));
  frame.contentDocument.open();
  frame.contentDocument.write(html);
  frame.contentDocument.close();
  setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); }, 200);
}

const erroresFileName = (l) => `00 - Errores (${l.excluidos.length} sin contrato).docx`;

/** Aviso con los trabajadores que quedaron fuera del lote y su error. */
function alertExcluidos(l) {
  return modal({
    title: `${l.excluidos.length} trabajador${l.excluidos.length === 1 ? '' : 'es'} sin contrato`,
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

async function downloadLoteZip(l) {
  if (l.status !== 'aprobado') return toast('El lote aún no está aprobado', 'error');
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
  download(new Blob([buildZip(files)], { type: 'application/zip' }), `${safeName(l.title)}.zip`);
}

(async function init() {
  await loadAll();
  await dbx.loadConfig();
  db.requestPersistence();
  if (!navigator.onLine) $('#offline')?.removeAttribute('hidden');
  try {
    if (await dbx.handleRedirect()) toast(`Conectado a Dropbox como ${dbx.config().account?.name}`, 'ok');
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
  window.addEventListener('focus', () => scheduleSync(500));
  window.addEventListener('online', () => scheduleSync(500));
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW', err));
  }
})();

