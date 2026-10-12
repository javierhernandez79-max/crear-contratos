// Contratos que salen del Word original de un formato ("molde"): la app solo sustituye los marcadores
// {{variable}} que lleva el .docx y deja intactos letra, márgenes, encabezados y demás formato.
// El molde viaja dentro de la plantilla (base64), así que se sincroniza con ella y no vive en el repositorio.
import { buildZip } from './zip.js';
import { fill } from './model.js';

const td = new TextDecoder();
const te = new TextEncoder();

/** .zip → [{ name, data: Uint8Array }] (descomprime "deflate" con el navegador). */
export async function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El molde no es un archivo de Word válido');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = [];
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('El molde está dañado');
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else throw new Error(`El molde usa una compresión no soportada (${method})`);
    files.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Saltos de línea dentro de un dato (p. ej. un domicilio en dos renglones) → salto de línea de Word
const textoXml = (s) => esc(s).split('\n').join('</w:t><w:br/><w:t xml:space="preserve">');

const MARCA = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const PARRAFO = /<w:p[\s>][\s\S]*?<\/w:p>/g;

/**
 * Llena los marcadores de una parte del Word (documento, encabezado o pie). Cada párrafo se llena con
 * `fill` sobre su texto, así un dato en un párrafo escrito en mayúsculas sale en mayúsculas, igual que en la app.
 * `anchors` = { prestador: '~dsf1~', … }: marcas invisibles para DocuSign; sin ellas, las marcas se borran.
 */
export function llenarXml(xml, c, { anchors = {} } = {}) {
  xml = xml.replace(/\{\{_ds_([a-z]+)\}\}/g, (_, rol) => esc(anchors[rol] || ''));
  return xml.replace(PARRAFO, (p) => {
    if (!p.includes('{{')) return p;
    const texto = [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unesc(m[1])).join('');
    const valores = fill(c, texto, 'parts').filter((x) => x.var).map((x) => x.text);
    let k = 0;
    return p.replace(MARCA, (m) => (k < valores.length ? textoXml(valores[k++]) : m));
  });
}

const base64ABytes = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

/** Word del contrato a partir del molde de su plantilla. */
export async function moldeDocx(c, molde, opts = {}) {
  const files = await readZip(base64ABytes(molde.data));
  for (const f of files) {
    if (/^word\/(document|header\d*|footer\d*)\.xml$/.test(f.name)) f.data = te.encode(llenarXml(td.decode(f.data), c, opts));
  }
  return new Blob([buildZip(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
