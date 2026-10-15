// Almacenamiento local en IndexedDB. Nada sale del dispositivo.
const DB_NAME = 'crear-contratos';
const DB_VERSION = 5;
export const STORES = ['contracts', 'templates', 'parties', 'lotes', 'meta', 'papelera'];

let dbPromise;
// Sin IndexedDB (p. ej. Chrome de iPhone en modo incógnito, o almacenamiento bloqueado) la app funciona igual,
// con los datos solo en memoria: se pierden al cerrarla y lo compartido se vuelve a bajar de Dropbox
let memoria = null;
export const soloMemoria = () => !!memoria;

function enMemoria(err) {
  console.warn('IndexedDB no disponible; datos solo en memoria', err);
  memoria = new Map(STORES.map((name) => [name, new Map()]));
  return null;
}

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        resolve(enMemoria(err));
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(enMemoria(req.error));
    });
  }
  return dbPromise;
}

const copia = (v) => (v === undefined ? v : structuredClone(v));

/** Las mismas operaciones sobre los mapas en memoria. */
function txMemoria(store, op, arg) {
  const m = memoria.get(store);
  if (op === 'getAll') return [...m.values()].map(copia);
  if (op === 'get') return copia(m.get(arg));
  if (op === 'put') { m.set(arg.id, copia(arg)); return arg.id; }
  if (op === 'delete') { m.delete(arg); return undefined; }
  m.clear();
  return undefined;
}

async function tx(store, mode, fn, op, arg) {
  const db = await open();
  if (!db) return txMemoria(store, op, arg);
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const getAll = (store) => tx(store, 'readonly', (s) => s.getAll(), 'getAll');
export const get = (store, id) => tx(store, 'readonly', (s) => s.get(id), 'get', id);
export const put = (store, value) => tx(store, 'readwrite', (s) => s.put(value), 'put', value);
export const remove = (store, id) => tx(store, 'readwrite', (s) => s.delete(id), 'delete', id);
export const clear = (store) => tx(store, 'readwrite', (s) => s.clear(), 'clear');

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* opcional */ }
}
