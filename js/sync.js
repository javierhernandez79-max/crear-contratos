// Sincronización con la carpeta compartida de Dropbox.
//
//   <carpeta>/catalogo-partes.xlsx        catálogo (se puede editar a mano en Excel)
//   <carpeta>/expedientes/…               documentos de las partes (anexos)
//   <carpeta>/datos-app/contratos/*.json  un archivo por contrato
//   <carpeta>/datos-app/plantillas/*.json plantillas propias
//
// Cada equipo recuerda la versión (rev) de Dropbox de cada elemento y qué cambió localmente.
// Se sube con "rev" para no pisar cambios ajenos: si otro usuario modificó el mismo contrato,
// se conserva la versión de Dropbox y la local se guarda como copia.
import * as db from './db.js';
import * as dbx from './dropbox.js';
import { uid } from './model.js';

export const CATALOG_FILE = 'catalogo-partes.xlsx';
const COLLECTIONS = { contracts: 'datos-app/contratos', templates: 'datos-app/plantillas' };

let state = null; // { id:'sync', items:{contracts:{}, templates:{}}, catalog:{rev, known:[], dirty:[], deleted:[]}, lastSync }

async function loadState() {
  state ??= (await db.get('meta', 'sync')) || null;
  if (!state) state = { id: 'sync' };
  state.items ||= {};
  for (const k of Object.keys(COLLECTIONS)) state.items[k] ||= {};
  state.catalog ||= { rev: null, known: [], dirty: [], deleted: [] };
  return state;
}
const saveState = () => db.put('meta', structuredClone(state));

export async function syncInfo() {
  await loadState();
  const pending = Object.values(state.items).reduce((n, m) => n + Object.values(m).filter((x) => x.dirty || x.deleted).length, 0) +
    state.catalog.dirty.length + state.catalog.deleted.length;
  return { lastSync: state.lastSync || null, pending };
}

/** Olvida todo el estado de sincronización (al desconectar o cambiar de carpeta). */
export async function resetState() {
  state = { id: 'sync' };
  await loadState();
  await saveState();
}

// ---------- Marcas de cambios locales ----------
export async function markDirty(store, id) {
  await loadState();
  if (store === 'parties') {
    const c = state.catalog;
    if (!c.dirty.includes(id)) c.dirty.push(id);
    c.deleted = c.deleted.filter((x) => x !== id);
  } else {
    const m = state.items[store];
    m[id] = { ...m[id], dirty: true, deleted: false };
  }
  await saveState();
}

export async function markDeleted(store, id) {
  await loadState();
  if (store === 'parties') {
    const c = state.catalog;
    c.dirty = c.dirty.filter((x) => x !== id);
    if (c.known.includes(id) && !c.deleted.includes(id)) c.deleted.push(id);
  } else {
    const m = state.items[store];
    if (m[id]?.rev) m[id] = { ...m[id], dirty: false, deleted: true }; else delete m[id];
  }
  await saveState();
}

// ---------- Sincronización ----------
let running = null;

/**
 * Sincroniza todo. `opts.loadExcel` carga ExcelJS; `opts.catalog` = { toXlsx, fromXlsx }.
 * Devuelve { changed: {contracts:Set, templates:Set, parties:Set}, conflicts:[{store,title}] }.
 */
export function syncAll(opts) {
  running ??= (async () => {
    try {
      await loadState();
      const root = dbx.config().folder;
      const report = { changed: { contracts: new Set(), templates: new Set(), parties: new Set() }, conflicts: [] };
      await syncCatalog(root, opts, report);
      for (const store of Object.keys(COLLECTIONS)) await syncCollection(store, dbx.joinPath(root, COLLECTIONS[store]), report, opts);
      state.lastSync = Date.now();
      await saveState();
      return report;
    } finally {
      running = null;
    }
  })();
  return running;
}

const enc = (obj) => new TextEncoder().encode(JSON.stringify(obj));
const dec = (buf) => JSON.parse(new TextDecoder().decode(buf));

async function syncCollection(store, folder, report, opts) {
  const meta = state.items[store];
  const remote = new Map();
  for (const e of await dbx.listFolder(folder)) {
    if (e['.tag'] === 'file' && e.name.endsWith('.json')) remote.set(e.name.slice(0, -5), e);
  }
  const local = new Map((await db.getAll(store)).map((x) => [x.id, x]));
  const fileOf = (id) => dbx.joinPath(folder, `${id}.json`);

  const pull = async (id) => {
    const { data, meta: m } = await dbx.download(fileOf(id));
    const item = dec(data);
    await db.put(store, item);
    meta[id] = { rev: m.rev };
    report.changed[store].add(id);
    return item;
  };
  const push = async (item) => {
    const st = meta[item.id] || {};
    const res = await dbx.upload(fileOf(item.id), enc(item), { rev: st.rev && remote.has(item.id) ? st.rev : undefined });
    meta[item.id] = { rev: res.rev };
  };

  // Tombstones: borrados aquí → se borran en Dropbox
  for (const [id, st] of Object.entries(meta)) {
    if (!st.deleted) continue;
    if (remote.has(id)) await dbx.remove(fileOf(id));
    remote.delete(id);
    delete meta[id];
  }

  for (const [id, item] of local) {
    const st = meta[id] || {};
    const r = remote.get(id);
    const isDirty = st.dirty || !st.rev; // nunca subido = pendiente
    if (isDirty) {
      if (r && st.rev && r.rev !== st.rev) {
        // Ambos cambiaron: gana Dropbox, la versión local queda como copia
        await saveConflictCopy(store, item, report, opts);
        await pull(id);
        continue;
      }
      if (r && !st.rev) {
        // Existe en Dropbox pero aquí nunca se sincronizó (p. ej. respaldo importado en dos equipos):
        // se queda la versión más reciente
        const { data } = await dbx.download(fileOf(id));
        if ((dec(data).updatedAt || 0) >= (item.updatedAt || 0)) { await pull(id); continue; }
        meta[id] = { rev: r.rev };
      }
      try {
        await push(item);
      } catch (err) {
        if (!err.conflict) throw err;
        await saveConflictCopy(store, item, report, opts);
        await pull(id);
      }
    } else if (!r) {
      // Se borró en otro equipo
      await db.remove(store, id);
      delete meta[id];
      report.changed[store].add(id);
    } else if (r.rev !== st.rev) {
      await pull(id);
    }
  }
  for (const id of remote.keys()) if (!local.has(id)) await pull(id);
  await saveState();
}

/** Copia local con nuevo ID para no perder cambios cuando hubo edición simultánea. */
async function saveConflictCopy(store, item, report, opts) {
  const copy = structuredClone(item);
  copy.id = (store === 'templates' ? 'u-' : '') + uid();
  const who = opts.who?.() || 'este equipo';
  if (store === 'contracts') {
    copy.title = `${item.title} (copia en conflicto de ${who})`;
    copy.history = [{ date: Date.now(), text: 'Copia creada porque el contrato se editó en otro equipo al mismo tiempo' }, ...(copy.history || [])];
  } else copy.name = `${item.name} (copia en conflicto de ${who})`;
  await db.put(store, copy);
  state.items[store][copy.id] = { dirty: true };
  report.changed[store].add(copy.id);
  report.conflicts.push({ store, title: store === 'contracts' ? item.title : item.name, copyId: copy.id });
}

// ---------- Catálogo (Excel) ----------
async function syncCatalog(root, opts, report) {
  const st = state.catalog;
  const path = dbx.joinPath(root, CATALOG_FILE);
  for (let attempt = 0; attempt < 3; attempt++) {
    const meta = await dbx.getMetadata(path);
    let local = await db.getAll('parties');
    const dirty = new Set(st.dirty);
    const deleted = new Set(st.deleted);
    let forceUpload = false;

    if (meta && meta.rev !== st.rev) {
      const ExcelJS = await opts.loadExcel();
      const { data } = await dbx.download(path);
      const { parties: remote, renamed, missingIds } = await opts.catalog.fromXlsx(ExcelJS, data, local);
      const remoteIds = new Set(remote.map((p) => p.id));
      const known = new Set(st.known);
      // La misma parte tenía otro ID en este equipo: se adopta el del Excel
      for (const [oldId, newId] of renamed) {
        await db.remove('parties', oldId);
        dirty.delete(oldId);
        await opts.onPartyRenamed?.(oldId, newId);
        report.changed.parties.add(oldId);
      }
      if (missingIds) forceUpload = true; // escribir los ID nuevos en el Excel
      for (const rp of remote) {
        if (dirty.has(rp.id) || deleted.has(rp.id)) continue; // gana el cambio local pendiente
        await db.put('parties', rp);
        report.changed.parties.add(rp.id);
      }
      const renamedIds = new Set(renamed.map(([o]) => o));
      for (const p of local) {
        if (remoteIds.has(p.id) || dirty.has(p.id) || renamedIds.has(p.id)) continue;
        if (known.has(p.id)) {
          // Se quitó del Excel en Dropbox
          await db.remove('parties', p.id);
          report.changed.parties.add(p.id);
        } else dirty.add(p.id); // nunca sincronizada: hay que subirla
      }
      st.rev = meta.rev;
      st.known = [...remoteIds];
      st.dirty = [...dirty];
      local = await db.getAll('parties');
    }

    const needUpload = forceUpload || dirty.size || deleted.size || (!meta && local.length);
    if (!needUpload) break;
    const ExcelJS = await opts.loadExcel();
    const buf = await opts.catalog.toXlsx(ExcelJS, local);
    try {
      const res = await dbx.upload(path, buf, { rev: meta ? st.rev : undefined });
      st.rev = res.rev;
      st.known = local.map((p) => p.id);
      st.dirty = [];
      st.deleted = [];
      break;
    } catch (err) {
      if (!err.conflict) throw err;
      // Alguien guardó el Excel mientras tanto: se vuelve a leer y combinar
      st.rev = null;
    }
  }
  await saveState();
}

// ---------- Expedientes ----------
export const expedientesRoot = () => dbx.joinPath(dbx.config().folder, 'expedientes');
