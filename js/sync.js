// Sincronización con la carpeta compartida de Dropbox.
//
//   <carpeta>/catalogo-partes.xlsx        catálogo (se puede editar a mano en Excel)
//   <carpeta>/expedientes/…               documentos de las partes (anexos)
//   <carpeta>/datos-app/contratos/*.json  un archivo por contrato
//   <carpeta>/datos-app/plantillas/*.json plantillas propias
//   <carpeta>/datos-app/lotes/*.json      lotes de contratos de trabajo (con los datos de los trabajadores)
//   <carpeta>/datos-app/papelera/*.json   lo borrado en los últimos 30 días (se puede restaurar)
//
// Cada equipo recuerda la versión (rev) de Dropbox de cada elemento y qué cambió localmente.
// Se sube con "rev" para no pisar cambios ajenos: si otro usuario modificó el mismo contrato,
// se conserva la versión de Dropbox y la local se guarda como copia.
import * as db from './db.js';
import * as dbx from './dropbox.js';
import { uid } from './model.js';
import { DROPBOX_EXPEDIENTES, DROPBOX_CORP_CLIENTES, DROPBOX_GENERADOS } from './config.js';

export const CATALOG_FILE = 'catalogo-partes.xlsx';
const COLLECTIONS = { contracts: 'datos-app/contratos', templates: 'datos-app/plantillas', lotes: 'datos-app/lotes', papelera: 'datos-app/papelera' };

// { id:'sync', items:{contracts:{}, templates:{}, lotes:{}}, catalog:{rev, known:[], dirty:[], deleted:[], seq}, lastSync }
// items[store][id] = { rev, dirty, deleted, seq }; seq sube con cada cambio local para detectar
// ediciones hechas mientras una sincronización está en curso.
let state = null;
let loading = null;

async function loadState() {
  // Una sola lectura aunque varias llamadas lleguen a la vez (si no, la segunda pisaría a la primera)
  if (!state) state = await (loading ??= db.get('meta', 'sync').then((s) => s || { id: 'sync' }));
  state.items ||= {};
  for (const k of Object.keys(COLLECTIONS)) state.items[k] ||= {};
  state.catalog ||= { rev: null, known: [], dirty: [], deleted: [] };
  state.catalog.seq ||= 0;
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
  loading = null;
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
    c.seq++;
  } else {
    const m = state.items[store];
    m[id] = { ...m[id], dirty: true, deleted: false, seq: (m[id]?.seq || 0) + 1 };
  }
  await saveState();
}

export async function markDeleted(store, id) {
  await loadState();
  if (store === 'parties') {
    const c = state.catalog;
    c.dirty = c.dirty.filter((x) => x !== id);
    if (c.known.includes(id) && !c.deleted.includes(id)) c.deleted.push(id);
    c.seq++;
  } else {
    // La marca se guarda aunque nunca se haya subido: una subida en curso podría registrarlo después
    const m = state.items[store];
    m[id] = { ...m[id], dirty: false, deleted: true, seq: (m[id]?.seq || 0) + 1 };
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
      await dbx.ensureAccount();
      let root = dbx.config().folder;
      // Nunca crear la carpeta en otro lugar: si no existe donde se espera, se detiene con un aviso
      const rootMeta = await dbx.getMetadata(root);
      if (!rootMeta || rootMeta['.tag'] !== 'folder') {
        // Compartida desde otro equipo: vive en la carpeta personal del usuario
        const alt = await dbx.findInHome(root);
        if (!alt) {
          throw new dbx.DropboxError(`No se encontró la carpeta "${root}" en Dropbox (${dbx.rootLabel() || 'raíz desconocida'}). Si te la compartieron, acepta la invitación en dropbox.com y vuelve a sincronizar; si no, revisa la ruta en Ajustes.`);
        }
        await dbx.setOptions({ folder: alt });
        root = alt;
      }
      const report = { changed: { contracts: new Set(), templates: new Set(), parties: new Set(), lotes: new Set(), papelera: new Set() }, conflicts: [] };
      await aplicarLimpieza(root, report);
      // Tras un borrado de datos de prueba no se sincroniza nada más: la app cierra la sesión de este equipo
      if (report.limpieza) return report;
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

// Borrado de datos de prueba: el aviso en Dropbox obliga a cada equipo a descartar sus contratos, lotes y
// papelera locales (aunque tengan cambios sin subir) y a cerrar su sesión de Dropbox, para que nadie vuelva a subir lo borrado
const LIMPIEZA = 'datos-app/limpieza.json';

/** Lo llama quien borró, ya sincronizado: los demás equipos lo aplican en su siguiente sincronización. */
export async function avisarLimpieza(by) {
  await loadState();
  const at = Date.now();
  await dbx.upload(dbx.joinPath(dbx.config().folder, LIMPIEZA), enc({ at, by }), { reemplazar: true });
  state.limpiezaVista = at;
  await saveState();
}

async function aplicarLimpieza(root, report) {
  let file;
  try {
    file = await dbx.download(dbx.joinPath(root, LIMPIEZA));
  } catch (err) {
    if (err.notFound) return;
    throw err;
  }
  const { at, by } = dec(file.data);
  if (!at || at <= (state.limpiezaVista || 0)) return;
  state.limpiezaVista = at;
  // Un equipo que nunca había sincronizado no trae datos de prueba: solo registra el aviso
  if (state.lastSync) {
    for (const store of ['contracts', 'lotes', 'papelera']) {
      for (const x of await db.getAll(store)) report.changed[store].add(x.id);
      await db.clear(store);
      state.items[store] = {};
    }
    report.limpieza = { at, by };
  }
  await saveState();
}
const dec = (buf) => JSON.parse(new TextDecoder().decode(buf));

async function syncCollection(store, folder, report, opts) {
  const meta = state.items[store];
  const remote = new Map();
  for (const e of await dbx.listFolder(folder)) {
    if (e['.tag'] === 'file' && e.name.endsWith('.json')) remote.set(e.name.slice(0, -5), e);
  }
  const local = new Map((await db.getAll(store)).map((x) => [x.id, x]));
  const fileOf = (id) => dbx.joinPath(folder, `${id}.json`);

  // Tras subir o bajar, el estado se decide con lo que pasó localmente durante la operación
  const settle = (id, seq0, rev) => {
    const cur = meta[id] || {};
    if (cur.deleted) meta[id] = { rev, deleted: true, seq: cur.seq };
    else if ((cur.seq || 0) !== seq0) meta[id] = { rev, dirty: true, seq: cur.seq };
    else meta[id] = { rev, seq: cur.seq };
  };
  const pull = async (id, file) => {
    const seq0 = meta[id]?.seq || 0;
    let got = file;
    if (!got) {
      try {
        got = await dbx.download(fileOf(id));
      } catch (err) {
        if (!err.notFound) throw err;
        return null; // se borró entre el listado y la descarga; la siguiente sincronización lo resuelve
      }
    }
    const { data, meta: m } = got;
    const item = dec(data);
    const cur = meta[id] || {};
    if (cur.deleted) { meta[id] = { rev: m.rev, deleted: true, seq: cur.seq }; return null; }
    if ((cur.seq || 0) !== seq0) {
      // Se editó aquí mientras se descargaba: la versión local queda como copia, como en cualquier conflicto
      const mine = await db.get(store, id);
      if (mine) await saveConflictCopy(store, mine, report, opts);
    }
    await db.put(store, item);
    meta[id] = { rev: m.rev, seq: cur.seq };
    report.changed[store].add(id);
    return item;
  };
  const push = async (item) => {
    const st = meta[item.id] || {};
    const seq0 = st.seq || 0;
    const res = await dbx.upload(fileOf(item.id), enc(item), { rev: st.rev && remote.has(item.id) ? st.rev : undefined });
    settle(item.id, seq0, res.rev);
  };

  // Tombstones: borrados aquí → se borran en Dropbox, salvo que otro equipo lo haya cambiado después
  for (const [id, st] of Object.entries(meta)) {
    if (!st.deleted) continue;
    const r = remote.get(id);
    if (r && st.rev && r.rev !== st.rev) {
      // Otro usuario lo editó: se conserva su versión en lugar de borrarla
      delete meta[id];
      continue;
    }
    if (r) await dbx.remove(fileOf(id));
    remote.delete(id);
    if (meta[id]?.seq === st.seq) delete meta[id];
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
        const file = await dbx.download(fileOf(id));
        if ((dec(file.data).updatedAt || 0) >= (item.updatedAt || 0)) { await pull(id, file); continue; }
        meta[id] = { ...meta[id], rev: r.rev };
      }
      try {
        await push(item);
      } catch (err) {
        if (!err.conflict) throw err;
        await saveConflictCopy(store, item, report, opts);
        await pull(id);
      }
    } else if (!r) {
      // Se borró en otro equipo (salvo que aquí se haya editado mientras tanto)
      if ((meta[id]?.seq || 0) !== (st.seq || 0)) continue;
      await db.remove(store, id);
      delete meta[id];
      report.changed[store].add(id);
    } else if (r.rev !== st.rev) {
      await pull(id);
    }
  }
  for (const id of remote.keys()) if (!local.has(id) && !meta[id]?.deleted) await pull(id);
  await saveState();
}

/** Copia local con nuevo ID para no perder cambios cuando hubo edición simultánea. */
async function saveConflictCopy(store, item, report, opts) {
  const copy = structuredClone(item);
  copy.id = (store === 'templates' ? 'u-' : '') + uid();
  const who = opts.who?.() || 'este equipo';
  if (store === 'contracts' || store === 'lotes') {
    copy.title = `${item.title} (copia en conflicto de ${who})`;
    copy.history = [{ date: Date.now(), text: 'Copia creada porque el contrato se editó en otro equipo al mismo tiempo' }, ...(copy.history || [])];
  } else copy.name = `${item.name} (copia en conflicto de ${who})`;
  await db.put(store, copy);
  state.items[store][copy.id] = { dirty: true, seq: 1 };
  report.changed[store].add(copy.id);
  report.conflicts.push({ store, title: store === 'templates' ? item.name : item.title, copyId: copy.id });
}

// ---------- Catálogo (Excel) ----------
async function syncCatalog(root, opts, report) {
  const st = state.catalog;
  const path = dbx.joinPath(root, CATALOG_FILE);
  for (let attempt = 0; attempt < 3; attempt++) {
    const meta = await dbx.getMetadata(path);
    let seq0 = st.seq;
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
        // Gana el cambio local pendiente, también el hecho mientras se descargaba el Excel
        if (dirty.has(rp.id) || deleted.has(rp.id) || st.dirty.includes(rp.id) || st.deleted.includes(rp.id)) continue;
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
      // Se suman (no se reemplazan) las marcas que llegaron durante la descarga
      st.dirty = [...new Set([...st.dirty.filter((id) => !renamedIds.has(id)), ...dirty])];
      seq0 = st.seq;
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
      // Si algo cambió mientras se armaba y subía el Excel, las marcas se quedan para la siguiente vez
      if (st.seq === seq0) { st.dirty = []; st.deleted = []; }
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
export const expedientesRoot = () => dbx.joinPath(dbx.config().folder, DROPBOX_EXPEDIENTES);
/** Raíz de los expedientes corporativos de clientes y contrapartes (las empresas del grupo siguen en expedientesRoot). */
export const clientesRoot = () => dbx.joinPath(dbx.config().folder, DROPBOX_CORP_CLIENTES);
/** Raíz de los documentos que genera la app: una carpeta por cliente o empresa dueña del contrato. */
export const generadosRoot = () => dbx.joinPath(dbx.config().folder, DROPBOX_GENERADOS);
