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

/** Etiqueta y tipo de un dato por su clave. */
function datoDe(clave, prefijos) {
  const suf = SUFIJOS.find(([k]) => clave.endsWith(`_${k}`) && prefijos.has(clave.slice(0, -k.length - 1)));
  if (suf) return [suf[1], suf[2], `(El ${capital(clave.slice(0, -suf[0].length - 1).replace(/_/g, ' '))})`];
  const tipo = /fecha/.test(clave) ? 'date'
    : /monto|importe|precio|salario|sueldo|honorario|renta|pago/.test(clave) ? 'money'
    : /domicilio|direccion/.test(clave) ? 'address'
    : /correo|email/.test(clave) ? 'email' : 'text';
  return [capital(clave.replace(/_/g, ' ')), tipo, ''];
}

// Encabezado de sección: renglón corto en mayúsculas sin marcas (CLÁUSULAS, DECLARACIONES, PRIMERA.- …)
const esTitulo = (t) => t.length <= 80 && !t.includes('{{') && /[A-ZÁÉÍÓÚÑ]/.test(t) && t === t.toUpperCase();

/**
 * Plantilla a partir de los bytes de un .docx. Devuelve { plantilla, avisos }.
 * `nombre` y `categoria` los elige el usuario; `archivo` es el nombre del Word.
 */
export async function plantillaDesdeWord(bytes, { nombre, categoria, archivo, id, ahora = Date.now() }) {
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
    const [etiqueta, tipo, parte] = datoDe(k, prefijos);
    return [k, parte ? `${etiqueta} ${parte}` : etiqueta, tipo];
  });
  const signers = [...prefijos].map((p) => ({
    role: `El “${capital(p.replace(/_/g, ' '))}”`,
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
