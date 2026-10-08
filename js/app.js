import * as db from './db.js';
import { TEMPLATES, CLAUSES, CATEGORIES } from './templates.js';
import {
  uid, VAR_TYPES, slugify, newContractFromTemplate, syncVarDefs, usedVariables, fill,
  missingVariables, contentHash, addVersion, restoreVersion, logChange, duplicateContract,
  contractToTemplate, fmtDateTime, fmtRelative, formatValue, canonicalText, brokenEfirmas, hasEfirma,
} from './model.js';
import { readCertificate, readPrivateKey, signText, verifySignature, base64ToBlob, loadForge } from './efirma.js';
import { buildPdf, shareOrDownload, download } from './pdf.js';
import { createSignaturePad } from './signature.js';

// ---------- Estado ----------
const state = {
  contracts: [],
  userTemplates: [],
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
}

async function saveContract(c) {
  c.updatedAt = Date.now();
  await db.put('contracts', structuredClone(c));
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
function route() {
  const [, view, id, tab] = location.hash.split('/');
  saveNow();
  if (view === 'c' && id) return openEditor(id, tab || 'secciones');
  state.current = null;
  document.body.classList.remove('in-editor');
  if (view === 'plantillas') return renderTemplates();
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
    state.userTemplates.unshift(tpl);
    toast('Plantilla guardada en "Mis plantillas"', 'ok');
    return;
  }
  if (act === 'del') {
    if (!(await confirmDialog('Eliminar contrato', `Se eliminará "${fill(c, c.title)}" con todas sus versiones y firmas. Esta acción no se puede deshacer.`, 'Eliminar'))) return;
    await db.remove('contracts', c.id);
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
  ({ secciones: renderSections, variables: () => renderVariables(focusVar), vista: renderPreviewTab, firmas: renderSigners, versiones: renderVersions })[state.tab]();
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
  const unused = defs.filter((d) => !used.has(d.key));
  const missing = missingVariables(c).length;
  const box = tabBox();
  box.innerHTML = `
    ${efirmaEditBanner(c)}
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
    <section class="card settings-block">
      <h3>Tus datos</h3>
      <p class="muted">Tus contratos se guardan solo en este dispositivo (no hay servidor ni cuenta). ${usage ? esc(usage) + '.' : ''} ${persisted ? 'El almacenamiento está protegido contra limpieza automática.' : ''}</p>
      <p class="muted small">${state.contracts.length} contratos · ${state.userTemplates.length} plantillas propias</p>
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

  $('#install')?.addEventListener('click', async () => {
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    renderSettings();
  });
  $('#export').addEventListener('click', () => {
    const data = { app: 'crear-contratos', version: 1, exportedAt: new Date().toISOString(), contracts: state.contracts, templates: state.userTemplates };
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
      if (!(await confirmDialog('Importar respaldo', `Se importarán ${n} contratos y ${(data.templates || []).length} plantillas. Los que tengan el mismo identificador se reemplazarán.`, 'Importar', 'primary'))) return;
      for (const c of data.contracts || []) await db.put('contracts', c);
      for (const t of data.templates || []) await db.put('templates', t);
      await loadAll();
      toast('Respaldo importado', 'ok');
      renderSettings();
    } catch {
      toast('El archivo no es un respaldo válido', 'error');
    }
  });
  $('#wipe').addEventListener('click', async () => {
    if (!(await confirmDialog('Borrar todos los datos', 'Se eliminarán todos los contratos, versiones, firmas y plantillas propias de este dispositivo. Exporta un respaldo antes si lo necesitas.', 'Borrar todo'))) return;
    await db.clear('contracts');
    await db.clear('templates');
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
  db.requestPersistence();
  if (!navigator.onLine) $('#offline')?.removeAttribute('hidden');
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW', err));
  }
})();

