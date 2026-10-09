import * as db from './db.js';
import { TEMPLATES, CLAUSES, CATEGORIES } from './templates.js';
import {
  uid, VAR_TYPES, slugify, newContractFromTemplate, syncVarDefs, usedVariables, fill,
  missingVariables, contentHash, addVersion, restoreVersion, logChange, duplicateContract,
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
import { createSignaturePad } from './signature.js';

// ---------- Estado ----------
const state = {
  contracts: [],
  userTemplates: [],
  parties: [],
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

const app = document.getElementById('app');
const nav = document.getElementById('bottom-nav');

// ---------- Utilidades ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const allTemplates = () => [...state.userTemplates, ...TEMPLATES];
const go = (hash) => { location.hash = hash; };

const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
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
  if (content && c.status === 'final') {
    c.status = 'borrador';
    logChange(c, 'El contrato volvió a borrador por una edición');
    toast('El contrato volvió a borrador');
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
  if (view === 'catalogo') return id ? renderPartyEditor(id) : renderCatalog();
  if (view === 'ajustes') return renderSettings();
  return renderHome();
}

function setNav(active) {
  $$('a', nav).forEach((a) => a.classList.toggle('active', a.dataset.nav === active));
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
  const counts = {
    todos: state.contracts.length,
    borrador: state.contracts.filter((c) => c.status === 'borrador').length,
    final: state.contracts.filter((c) => c.status === 'final').length,
  };

  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow">Crear Contratos</p>
        <h1>Mis contratos</h1>
      </div>
      <a href="#/plantillas" class="btn primary hide-sm">${icon('plus')} Nuevo contrato</a>
    </header>
    ${state.contracts.length ? `
      <div class="toolbar">
        <label class="search">${icon('search')}<input id="home-q" type="search" placeholder="Buscar contrato" value="${esc(state.homeQuery)}"></label>
        <div class="chips" role="tablist">
          ${[['todos', 'Todos'], ['borrador', 'Borradores'], ['final', 'Finales']].map(([k, l]) =>
            `<button class="chip ${state.homeFilter === k ? 'on' : ''}" data-filter="${k}">${l} <span>${counts[k]}</span></button>`).join('')}
        </div>
      </div>
      <div class="grid contracts">
        ${list.map(contractCard).join('') || '<p class="empty-inline">No hay contratos que coincidan.</p>'}
      </div>` : `
      <section class="empty">
        <div class="empty-art">${icon('doc')}</div>
        <h2>Crea tu primer contrato</h2>
        <p>Elige una plantilla, completa las variables y exporta un PDF listo para firmar. Todo se guarda solo en este dispositivo.</p>
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
  $$('.contract-card').forEach((card) => {
    const id = card.dataset.id;
    card.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return go(`#/c/${id}`);
      e.stopPropagation();
      contractAction(act, state.contracts.find((c) => c.id === id));
    });
  });
}

function contractCard(c) {
  const { missing, signed, total } = contractProgress(c);
  const tpl = allTemplates().find((t) => t.id === c.templateId);
  return `
    <article class="card contract-card" data-id="${c.id}" tabindex="0">
      <div class="card-top">
        <span class="badge ${c.status}">${c.status === 'final' ? 'Final' : 'Borrador'}</span>
        <button class="icon-btn sm" data-act="menu" aria-label="Más acciones">${icon('more')}</button>
      </div>
      <h3>${esc(fill(c, c.title))}</h3>
      <p class="muted small">${esc(tpl?.name || 'Documento personalizado')}</p>
      <div class="meta">
        <span>${icon('clock', 'xs')} ${fmtRelative(c.updatedAt)}</span>
        <span>${c.sections.length} secciones</span>
        ${missing ? `<span class="warn-text">${missing} por completar</span>` : '<span class="ok-text">Variables completas</span>'}
        ${total ? `<span>${signed}/${total} firmas</span>` : ''}
        ${c.updatedBy ? `<span>por ${esc(c.updatedBy)}</span>` : ''}
      </div>
    </article>`;
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
  if (act === 'pdf') return exportPdf(c);
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
      <div class="chips scroll">
        ${cats.map((c) => `<button class="chip ${state.tplCategory === c.id ? 'on' : ''}" data-cat="${c.id}">${esc(c.label)}</button>`).join('')}
      </div>
    </div>
    <div class="grid templates">
      ${list.map((t) => `
        <article class="card tpl-card" data-id="${t.id}" tabindex="0">
          <span class="tpl-cat">${esc(t.custom ? 'Mis plantillas' : CATEGORIES.find((c) => c.id === t.category)?.label)}</span>
          <h3>${esc(t.name)}</h3>
          <p class="muted">${esc(t.description)}</p>
          <p class="small muted">${t.sections.length} secciones · ${t.vars.length} variables</p>
        </article>`).join('') || '<p class="empty-inline">Sin resultados.</p>'}
    </div>
    <p class="disclaimer">Las plantillas son modelos generales de referencia y no sustituyen la asesoría de un abogado. Revisa que el contenido se ajuste a tu caso y a la legislación aplicable.</p>
  `;
  $('#tpl-q').addEventListener('input', (e) => {
    state.tplQuery = e.target.value;
    const pos = e.target.selectionStart;
    renderTemplates();
    const el = $('#tpl-q'); el.focus(); el.setSelectionRange(pos, pos);
  });
  $$('[data-cat]').forEach((b) => b.addEventListener('click', () => { state.tplCategory = b.dataset.cat; renderTemplates(); }));
  $$('.tpl-card').forEach((card) => card.addEventListener('click', () => previewTemplate(allTemplates().find((t) => t.id === card.dataset.id))));
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
      ...(t.custom ? [{ label: 'Eliminar plantilla', value: 'del', kind: 'ghost danger' }] : []),
      { label: 'Usar plantilla', value: 'use', kind: 'primary' },
    ],
  });
  if (r.value === 'use') {
    const c = newContractFromTemplate(t);
    await saveContract(c);
    go(`#/c/${c.id}/variables`);
    toast('Contrato creado. Empieza completando los datos.', 'ok');
  } else if (r.value === 'del') {
    if (!(await confirmDialog('Eliminar plantilla', `¿Eliminar "${t.name}"? Los contratos creados con ella no se modifican.`, 'Eliminar'))) return;
    await db.remove('templates', t.id);
    await sync.markDeleted('templates', t.id);
    scheduleSync();
    state.userTemplates = state.userTemplates.filter((x) => x.id !== t.id);
    renderTemplates();
  }
}

// ---------- Editor ----------
const TABS = [
  ['secciones', 'Secciones'],
  ['variables', 'Variables'],
  ['vista', 'Vista previa'],
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
  ({ secciones: renderSections, variables: () => renderVariables(focusVar), vista: renderPreviewTab, firmas: renderSigners, anexos: renderAnexos, versiones: renderVersions })[state.tab]();
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
        <span class="badge ${c.status}">${c.status === 'final' ? 'Final' : 'Borrador'}</span>
        <span id="save-status" class="muted small">Guardado</span>
      </div>
    </div>
    <button class="btn primary" id="btn-pdf">${icon('share')}<span class="hide-xs">Exportar PDF</span></button>
    <button class="icon-btn" id="btn-more" aria-label="Más acciones">${icon('more')}</button>`;
  $('#doc-title').addEventListener('input', (e) => {
    c.title = e.target.value;
    touched({ log: 'Cambió el título', groupKey: 'title' });
  });
  $('#btn-pdf').addEventListener('click', () => exportPdf(c));
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
    ${c.status !== 'final' ? '<div class="watermark">BORRADOR</div>' : ''}
    <h1 class="doc-h1">${parts(c.title)}</h1>
    ${c.sections.map((s, i) => `
      <section class="doc-sec">
        <h2>${i + 1}. ${parts(s.title)}</h2>
        ${s.body.split(/\n/).filter((p) => p.trim()).map((p) => `<p>${parts(p)}</p>`).join('')}
      </section>`).join('')}
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
  box.innerHTML = `
    ${efirmaEditBanner(c)}
    <div class="sections" id="sections">
      ${c.sections.map((s, i) => sectionCard(s, i, c.sections.length)).join('')}
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
    if (!f) return;
    const sec = c.sections.find((s) => s.id === e.target.closest('.sec-card').dataset.id);
    sec[f] = e.target.value;
    if (f === 'body') autosize(e.target);
    syncVarDefs(c);
    touched({ log: `Editó la sección "${sec.title || 'sin título'}"`, groupKey: `sec-${sec.id}` });
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

function sectionCard(s, i, n) {
  return `
    <article class="card sec-card" data-id="${s.id}">
      <div class="sec-head">
        <span class="grip" title="Arrastra para reordenar" aria-hidden="true">${icon('grip')}</span>
        <span class="sec-num">${i + 1}</span>
        <input class="sec-title" data-field="title" value="${esc(s.title)}" aria-label="Título de la sección">
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
        : `<button class="btn primary" data-act="final" ${missingVariables(c).length ? 'title="Hay datos pendientes"' : ''}>${icon('check')} Marcar como final</button>`}
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
          if (!(await confirmDialog('Marcar como final', `Hay ${msg}. ¿Marcar como final de todos modos?`, 'Marcar final', 'primary'))) return;
        }
        c.status = 'final';
        addVersion(c, 'Versión final');
        logChange(c, 'Marcó el contrato como final');
        await saveContract(c);
        renderEditorHeader();
        toast('Contrato marcado como final y versión guardada', 'ok');
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
      <div class="grid">
        ${list.map((p) => {
          const gaps = partyGaps(p);
          const apos = p.apoderados.filter((a) => a.vigente).length;
          return `
          <article class="card party-card" data-id="${p.id}" tabindex="0">
            <div class="card-top"><span class="tpl-cat">${PARTY_KINDS[p.kind]}</span><span>${partyBadges(p)}</span></div>
            <h3>${esc(p.nombre || 'Sin nombre')}</h3>
            <p class="muted small mono">${esc(p.rfc || 'Sin RFC')}</p>
            <div class="meta">
              ${p.kind === 'pm' ? `<span>${apos} apoderado${apos === 1 ? '' : 's'} vigente${apos === 1 ? '' : 's'}</span>` : ''}
              ${gaps.length ? `<span class="warn-text" title="${esc(gaps.join(', '))}">Faltan ${gaps.length} dato${gaps.length === 1 ? '' : 's'}</span>` : '<span class="ok-text">Datos completos</span>'}
            </div>
          </article>`;
        }).join('') || '<p class="empty-inline">Sin resultados.</p>'}
      </div>` : `
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
  $$('.party-card').forEach((card) => card.addEventListener('click', () => go(`#/catalogo/${card.dataset.id}`)));
  $('#cat-new').addEventListener('click', () => createParty());
  $('#cat-export').addEventListener('click', exportCatalog);
  $('#cat-import').addEventListener('change', (e) => importCatalog(e.target.files[0]));
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
    ['notariaNumero', 'Notaría núm.'], ['notariaCiudad', 'Ciudad de la notaría', 'text', 'la Ciudad de México'], ['folioMercantil', 'Folio mercantil electrónico']],
  pf: [['curp', 'CURP'], ['nacionalidad', 'Nacionalidad'], ['estadoCivil', 'Estado civil'], ['ocupacion', 'Ocupación'], ['identificacion', 'Identificación', 'text', 'credencial para votar con clave de elector …']],
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
        const used = state.contracts.filter((c) => c.signers.some((s) => s.party?.id === p.id)).length;
        if (!(await confirmDialog('Eliminar del catálogo', `¿Eliminar "${p.nombre || 'esta parte'}"? ${used ? `Está vinculada a ${used} contrato(s); sus datos ya escritos se conservan. ` : ''}Si solo dejó de usarse, mejor desmarca "Activa".`, 'Eliminar'))) return;
        await db.remove('parties', p.id);
        await sync.markDeleted('parties', p.id);
        scheduleSync();
        state.parties = state.parties.filter((x) => x.id !== p.id);
        toast('Eliminada del catálogo');
        return go('#/catalogo');
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
  const any = changed.contracts.size || changed.templates.size || changed.parties.size;
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

/** Carpeta del expediente de una parte (la del catálogo o una nueva dentro de /expedientes). */
function expedienteOf(p) {
  return p.expediente ? dbx.normalizePath(p.expediente) : dbx.joinPath(sync.expedientesRoot(), slugify(p.nombre || 'sin-nombre'));
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
      <p class="muted small">Carpeta compartida: <code>${esc(cfg.folder)}</code> · ${info.lastSync ? `Última sincronización ${fmtRelative(info.lastSync)}` : 'Aún sin sincronizar'}${info.pending ? ` · ${info.pending} cambio(s) por subir` : ''}</p>
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

