// Lectura con IA de PDFs escaneados: la app llama a la función del servidor (/api), que guarda la llave.
// Si la app corre sin servidor (copia local, otro hosting), todo queda como "no disponible".
import { identificacionINE, formatoDe } from './extraccion.js';

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

const aBase64 = async (data, type = 'application/pdf') => {
  const url = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(new Blob([data], { type }));
  });
  return String(url).slice(String(url).indexOf(',') + 1);
};

/** Foto o imagen a JPEG de hasta 2400 px por lado (la API acepta hasta 5 MB por imagen; las del celular pesan más). */
async function aJpeg(name, data) {
  let bmp;
  try { bmp = await createImageBitmap(new Blob([data])); } catch {
    throw new Error(`No se pudo abrir la imagen ${name}${/\.hei[cf]$/i.test(name) ? ' (HEIC del iPhone: ábrela en Safari o expórtala como JPG)' : ''}.`);
  }
  const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/jpeg', 0.85));
  return aBase64(await blob.arrayBuffer(), 'image/jpeg');
}

/** Lee un documento: PDF escaneado, imagen o el texto de un Word o .txt/.md (text). Devuelve { tipo: 'csf'|'acta'|'poder'|'rpp'|'ine'|'otro', kind, empresa, datos }. */
export async function leerConIA({ name, data }, text = '') {
  const f = formatoDe(name);
  if (f !== 'imagen' && data.byteLength > 20 * 1024 * 1024) throw new Error(`${name} pasa de 20 MB: no se puede leer con IA.`);
  const doc = f === 'imagen' ? { imagen: await aJpeg(name, data) }
    : f === 'pdf' ? { pdf: await aBase64(data) }
      : { texto: String(text).slice(0, 300000) };
  let r;
  try {
    r = await fetch('api/leer-pdf', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: name, ...doc }),
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
