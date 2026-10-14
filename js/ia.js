// Lectura con IA de PDFs escaneados: la app llama a la función del servidor (/api), que guarda la llave.
// Si la app corre sin servidor (copia local, otro hosting), todo queda como "no disponible".
import { identificacionINE } from './extraccion.js';

let cache = null;

/** { disponible, configurada, activa, programada, hasta, vencida, admin, faltan } */
export async function estadoIA(forzar = false) {
  if (cache && !forzar && Date.now() - cache.at < 60e3) return cache.e;
  let e = { disponible: false, activa: false, admin: false };
  try {
    const r = await fetch('api/ia', { cache: 'no-store', credentials: 'same-origin' });
    if (r.ok && /json/.test(r.headers.get('content-type') || '')) e = { disponible: true, ...(await r.json()) };
  } catch { /* sin servidor o sin conexión */ }
  cache = { e, at: Date.now() };
  return e;
}

/** Solo administradores (el servidor lo verifica). */
export async function cambiarIA({ activa, hasta = '' }) {
  const r = await fetch('api/ia', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activa, hasta }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'No se pudo cambiar');
  cache = { e: { disponible: true, ...d }, at: Date.now() };
  return cache.e;
}

const aBase64 = async (data) => {
  const url = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(new Blob([data], { type: 'application/pdf' }));
  });
  return String(url).slice(String(url).indexOf(',') + 1);
};

/** Lee un PDF escaneado. Devuelve { tipo: 'csf'|'acta'|'poder'|'rpp'|'ine'|'otro', kind, empresa, datos }. */
export async function leerConIA({ name, data }) {
  if (data.byteLength > 20 * 1024 * 1024) throw new Error(`${name} pasa de 20 MB: no se puede leer con IA.`);
  let r;
  try {
    r = await fetch('api/leer-pdf', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: name, pdf: await aBase64(data) }),
    });
  } catch {
    throw new Error('Sin conexión: la lectura con IA necesita internet.');
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (d.apagada) cache = null;
    throw new Error(d.error || `La IA no pudo leer ${name}.`);
  }
  // La INE llega como clave de elector y vigencia; la ficha guarda el texto de la identificación
  const { claveElector, vigencia, ...datos } = d.datos || {};
  if (d.tipo === 'ine') {
    datos.identificacion = identificacionINE(claveElector);
    if (/^\d{4}$/.test(vigencia || '')) datos.identificacionVigencia = vigencia;
  }
  return { ...d, datos };
}

/** Propone los datos variables de un Word (solo se manda el texto de sus párrafos). Devuelve { titulo, partes, campos, firmas }. */
export async function detectarCampos({ name, parrafos }) {
  let r;
  try {
    r = await fetch('api/plantilla-ia', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: name, parrafos }),
    });
  } catch {
    throw new Error('Sin conexión: la detección con IA necesita internet.');
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (d.apagada) cache = null;
    throw new Error(d.error || 'La IA no pudo leer el Word.');
  }
  return d;
}
