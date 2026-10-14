// Plantillas nuevas a partir de un Word (.docx) con marcas {{dato}}: el Word se guarda como molde (conserva
// letra y formato) y de su texto salen las secciones de la vista previa, los datos y los firmantes.
import { readZip } from './molde.js';
import { buildZip } from './zip.js';
import { DATOS_PARTE } from './parties.js';

const td = new TextDecoder();
const te = new TextEncoder();
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const MARCA = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const PARRAFO = /<w:p[\s>][\s\S]*?<\/w:p>/g;
const TEXTO = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;
const PARTES = /^word\/(document|header\d*|footer\d*)\.xml$/;
// Partes de contrato con prefijo conocido; también se reconoce cualquier prefijo que lleve {{prefijo_nombre}}
const SUFIJOS = [...DATOS_PARTE].sort((a, b) => b[0].length - a[0].length);

/**
 * Word suele partir el texto en varios fragmentos (<w:t>) por ortografía o formato, y una marca escrita como
 * {{cliente_nombre}} puede quedar repartida. Aquí cada marca se junta en el fragmento donde empieza.
 */
export function unirMarcas(xml) {
  return xml.replace(PARRAFO, (p) => {
    if (!p.includes('{')) return p;
    const nodos = [...p.matchAll(TEXTO)].map((m) => unesc(m[2]));
    const texto = nodos.join('');
    const dueño = [];
    nodos.forEach((t, i) => { for (let k = 0; k < t.length; k++) dueño.push(i); });
    let partida = false;
    for (const m of texto.matchAll(MARCA)) {
      const ini = m.index;
      for (let k = ini; k < ini + m[0].length; k++) {
        if (dueño[k] !== dueño[ini]) partida = true;
        dueño[k] = dueño[ini];
      }
    }
    if (!partida) return p;
    const nuevos = nodos.map(() => '');
    for (let k = 0; k < texto.length; k++) nuevos[dueño[k]] += texto[k];
    let i = 0;
    return p.replace(TEXTO, (m, abre, _t, cierra) => {
      const t = nuevos[i++];
      const a = /xml:space=/.test(abre) ? abre : abre.replace('<w:t', '<w:t xml:space="preserve"');
      return `${a}${esc(t)}${cierra}`;
    });
  });
}

/** Texto de cada párrafo del documento, en orden (incluye tablas). */
export function parrafos(xml) {
  return [...xml.matchAll(PARRAFO)].map((m) => m[0]
    .replace(/<w:tab\/>/g, '<w:t>\t</w:t>')
    .replace(/<w:br\/>/g, '<w:t>\n</w:t>'))
    .map((p) => [...p.matchAll(TEXTO)].map((m) => unesc(m[2])).join('').replace(/\t/g, ' ').trim());
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Etiqueta, tipo y prefijo de parte (o '') de un dato por su clave. */
function datoDe(clave, prefijos) {
  const suf = SUFIJOS.find(([k]) => clave.endsWith(`_${k}`) && prefijos.has(clave.slice(0, -k.length - 1)));
  if (suf) return [suf[1], suf[2], clave.slice(0, -suf[0].length - 1)];
  const tipo = /fecha/.test(clave) ? 'date'
    : /monto|importe|precio|salario|sueldo|honorario|renta|pago/.test(clave) ? 'money'
    : /domicilio|direccion/.test(clave) ? 'address'
    : /correo|email/.test(clave) ? 'email' : 'text';
  return [capital(clave.replace(/_/g, ' ')), tipo, ''];
}

const rolDe = (p, partes) => partes[p]?.rol || `El ${capital(p.replace(/_/g, ' '))}`;

// Encabezado de sección: renglón corto en mayúsculas sin marcas (CLÁUSULAS, DECLARACIONES, PRIMERA.- …)
const esTitulo = (t) => t.length <= 80 && !t.includes('{{') && /[A-ZÁÉÍÓÚÑ]/.test(t) && t === t.toUpperCase();

/**
 * Plantilla a partir de los bytes de un .docx. Devuelve { plantilla, avisos }.
 * `nombre` y `categoria` los elige el usuario; `archivo` es el nombre del Word.
 */
export async function plantillaDesdeWord(bytes, { nombre, categoria, archivo, id, ahora = Date.now(), etiquetas = {}, partes = {} }) {
  let files;
  try { files = await readZip(bytes); } catch { throw new Error('El archivo no es un Word .docx. Si es .doc, ábrelo en Word y guárdalo como .docx.'); }
  if (!files.some((f) => f.name === 'word/document.xml')) throw new Error('El archivo no es un Word .docx. Si es .doc, ábrelo en Word y guárdalo como .docx.');
  const claves = [];
  let doc = '';
  for (const f of files) {
    if (!PARTES.test(f.name)) continue;
    const xml = unirMarcas(td.decode(f.data));
    f.data = te.encode(xml);
    if (f.name === 'word/document.xml') doc = xml;
    const texto = parrafos(xml).join('\n');
    for (const m of texto.matchAll(MARCA)) if (!claves.includes(m[1])) claves.push(m[1]);
  }
  const firmasDS = claves.filter((k) => k.startsWith('_ds_')).map((k) => k.slice(4));
  const datos = claves.filter((k) => !k.startsWith('_'));
  // Partes: prefijos con {{prefijo_nombre}} (o con otro dato de parte conocido, como cliente_rfc)
  const prefijos = new Set(datos.filter((k) => k.endsWith('_nombre')).map((k) => k.slice(0, -'_nombre'.length)));
  const vars = datos.map((k) => {
    const [etiqueta, tipo, prefijo] = datoDe(k, prefijos);
    if (prefijo) return [k, `${etiqueta} (${rolDe(prefijo, partes)})`, tipo];
    // Con IA llegan la etiqueta y el tipo propuestos (y revisados por el usuario)
    return [k, etiquetas[k]?.[0] || etiqueta, etiquetas[k]?.[1] || tipo];
  });
  const signers = [...prefijos].map((p) => ({
    role: partes[p]?.rol || `El “${capital(p.replace(/_/g, ' '))}”`,
    name: `{{${p}_nombre}}${datos.includes(`${p}_representante`) ? `, representada por {{${p}_representante}}` : ''}`,
    bind: { prefix: p },
  }));

  // Secciones para la vista previa: un renglón en mayúsculas abre sección; el resto es su texto
  const sections = [];
  let actual = null;
  for (const t of parrafos(doc).map((x) => x.replace(/\{\{\s*_ds_[a-z]+\s*\}\}/g, '').trim()).filter(Boolean)) {
    if (esTitulo(t)) { actual = { title: t, body: '', kind: 'texto' }; sections.push(actual); continue; }
    if (!actual) { actual = { title: '', body: '', kind: 'texto' }; sections.push(actual); }
    actual.body += (actual.body ? '\n\n' : '') + t;
  }
  const titulo = parrafos(doc).find((t) => /CONTRATO|CONVENIO|ACUERDO/i.test(t) && t.length <= 120 && !t.includes('{{')) || nombre;

  const avisos = [];
  if (!datos.length) avisos.push('No se encontró ninguna marca {{dato}}: el contrato saldrá con el texto fijo del Word.');
  if (!prefijos.size && datos.length) avisos.push('No hay partes reconocidas (marcas como {{cliente_nombre}}): los datos no se llenarán desde el catálogo y no hay firmantes; agrégalos en Firmantes si los necesitas.');
  const sinFirmaDS = [...prefijos].filter((p) => !firmasDS.includes(p));
  if (sinFirmaDS.length) avisos.push(`Para enviar por DocuSign falta la marca de firma de: ${sinFirmaDS.map((p) => `{{_ds_${p}}}`).join(', ')} (ponla en el Word donde va la firma).`);

  let b64 = '';
  const zip = buildZip(files);
  for (let i = 0; i < zip.length; i += 0x8000) b64 += String.fromCharCode(...zip.subarray(i, i + 0x8000));
  return {
    plantilla: {
      id, custom: true, category: categoria, name: nombre, titulo: nombre, title: titulo,
      description: `Subida desde el Word “${archivo}”.`, origen: archivo,
      vars, signers, sections: sections.length ? sections : [{ title: '', body: '', kind: 'texto' }],
      molde: { nombre: archivo, data: btoa(b64) }, firmasDS,
      createdAt: ahora, updatedAt: ahora,
    },
    avisos,
  };
}

// ---------- Word sin marcas: la IA propone los datos y aquí se ponen las marcas ----------

/** Párrafos del Word (documento, luego encabezados y pies), en el orden que se manda a la IA. */
export async function leerWord(bytes) {
  let files;
  try { files = await readZip(bytes); } catch { throw new Error('El archivo no es un Word .docx. Si es .doc, ábrelo en Word y guárdalo como .docx.'); }
  if (!files.some((f) => f.name === 'word/document.xml')) throw new Error('El archivo no es un Word .docx. Si es .doc, ábrelo en Word y guárdalo como .docx.');
  const orden = files.filter((f) => PARTES.test(f.name)).sort((a, b) => (a.name === 'word/document.xml' ? -1 : b.name === 'word/document.xml' ? 1 : a.name.localeCompare(b.name)));
  const parrafosW = [];
  let marcas = 0;
  for (const f of orden) {
    const ps = parrafos(unirMarcas(td.decode(f.data)));
    for (const t of ps) { parrafosW.push(t); marcas += (t.match(MARCA) || []).filter((m) => !m.includes('_ds_')).length; }
  }
  return { parrafos: parrafosW, marcas };
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Expresión para encontrar el texto de un campo: espacios flexibles; un blanco ("_____", "……") encaja con cualquier largo. */
export function buscador(texto) {
  const t = texto.trim();
  if (/^[_\s]+$/.test(t)) return /_{3,}/g;
  if (/^[.…\s]+$/.test(t)) return /(?:\.{3,}|…+)/g;
  return new RegExp(escRe(t).replace(/\s+/g, '\\s+'), 'g');
}

/** Coincidencias de `re` en `texto` que no caen dentro de una marca {{…}} ya puesta. */
function coincidencias(texto, re) {
  const marcas = [...texto.matchAll(/\{\{[^}]*\}\}/g)].map((m) => [m.index, m.index + m[0].length]);
  return [...texto.matchAll(re)].filter((m) => m[0] && !marcas.some(([a, b]) => m.index < b && m.index + m[0].length > a));
}

/** Cuántas veces aparece cada campo en sus párrafos (para avisar de los que no se encontraron). */
export function contarCampos(parrafosW, campos) {
  return campos.map((c) => c.parrafos.reduce((n, i) => n + coincidencias(parrafosW[i] || '', buscador(c.texto)).length, 0));
}

/** Sustituye en un párrafo del XML cada coincidencia de `re` por `reemplazo`, aunque el texto esté repartido en fragmentos. */
export function reemplazarEnParrafo(p, re, reemplazo) {
  const nodos = [...p.matchAll(TEXTO)].map((m) => unesc(m[2]));
  const texto = nodos.join('');
  const ms = coincidencias(texto, re);
  if (!ms.length) return [p, 0];
  const dueño = [];
  nodos.forEach((t, i) => { for (let k = 0; k < t.length; k++) dueño.push(i); });
  const nuevos = nodos.map(() => '');
  let k = 0;
  for (const m of ms) {
    for (; k < m.index; k++) nuevos[dueño[k]] += texto[k];
    nuevos[dueño[m.index]] += reemplazo;
    k = m.index + m[0].length;
  }
  for (; k < texto.length; k++) nuevos[dueño[k]] += texto[k];
  let i = 0;
  const out = p.replace(TEXTO, (_m, abre, _t, cierra) => `${/xml:space=/.test(abre) ? abre : abre.replace('<w:t', '<w:t xml:space="preserve"')}${esc(nuevos[i++])}${cierra}`);
  return [out, ms.length];
}

/**
 * Pone las marcas en el Word: cada campo {texto, clave, parrafos} se sustituye por {{clave}} en sus párrafos
 * (los más largos primero, para no partir un nombre que contiene a otro) y cada firma {prefijo, parrafo}
 * agrega {{_ds_prefijo}} al final de ese párrafo. Devuelve los bytes del Word nuevo.
 */
export async function marcarWord(bytes, { campos = [], firmas = [] }) {
  const files = await readZip(bytes);
  const orden = files.filter((f) => PARTES.test(f.name)).sort((a, b) => (a.name === 'word/document.xml' ? -1 : b.name === 'word/document.xml' ? 1 : a.name.localeCompare(b.name)));
  let base = 0;
  for (const f of orden) {
    const partesXml = [];
    let ult = 0;
    const xml = unirMarcas(td.decode(f.data));
    for (const m of xml.matchAll(PARRAFO)) { partesXml.push(xml.slice(ult, m.index), m[0]); ult = m.index + m[0].length; }
    partesXml.push(xml.slice(ult));
    const nP = (partesXml.length - 1) / 2;
    const enEste = (i) => i >= base && i < base + nP;
    for (const c of [...campos].sort((a, b) => b.texto.trim().length - a.texto.trim().length)) {
      for (const i of c.parrafos.filter(enEste)) {
        const j = 2 * (i - base) + 1;
        [partesXml[j]] = reemplazarEnParrafo(partesXml[j], buscador(c.texto), `{{${c.clave}}}`);
      }
    }
    for (const fi of firmas.filter((x) => enEste(x.parrafo))) {
      const j = 2 * (fi.parrafo - base) + 1;
      if (!partesXml[j].includes(`_ds_${fi.prefijo}`)) partesXml[j] = partesXml[j].replace(/<\/w:p>$/, `<w:r><w:rPr><w:color w:val="FFFFFF"/><w:sz w:val="4"/></w:rPr><w:t>{{_ds_${fi.prefijo}}}</w:t></w:r></w:p>`);
    }
    f.data = te.encode(partesXml.join(''));
    base += nP;
  }
  return buildZip(files);
}
