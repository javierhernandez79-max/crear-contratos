// Contratos de prestación de servicios desde el Excel "Sugerido de conceptos":
// arriba el nombre del cliente (o parte de él) y una tabla EMPRESA | CONCEPTO (| MONTO).
// Se genera un contrato por empresa del grupo con todos sus conceptos como objeto.
import { cellValue } from './lote.js';

const SUFIJOS = new Set(['S', 'A', 'SA', 'DE', 'C', 'V', 'CV', 'R', 'L', 'RL', 'P', 'I', 'SAPI', 'B', 'SAB', 'SAS', 'SC', 'AC', 'SRL', 'SPR', 'SOCIEDAD', 'ANONIMA', 'CAPITAL', 'VARIABLE']);

const base = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Palabras del nombre sin acentos, signos ni tipo de sociedad. */
function palabras(nombre) {
  const t = base(nombre).replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  while (t.length > 1 && SUFIJOS.has(t[t.length - 1])) t.pop();
  return t;
}

/** "IA TECH-SYSTEMS S.A DE C.V." → "IATECHSYSTEMS". */
const nucleo = (nombre) => palabras(nombre).join('');

const bigramas = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); } return m; };

/** Parecido entre dos nombres, de 0 a 1 (coeficiente de Dice sobre bigramas del núcleo). */
export function parecido(a, b) {
  const x = nucleo(a), y = nucleo(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // Un nombre que empieza con las mismas palabras completas que el otro ("GRUPO X" / "GRUPO X LOGÍSTICA")
  // vale según cuánto del nombre largo cubre. Antes cualquier subcadena daba 0.9 y "TECH" se tomaba por
  // "BIOTECHNOLOGIA AVANZADA"
  const [pc, pl] = [palabras(a), palabras(b)].sort((m, n) => m.join('').length - n.join('').length);
  if (pc.every((w, i) => pl[i] === w)) return 0.9 * (pc.join('').length / pl.join('').length);
  const A = bigramas(x), B = bigramas(y);
  let comun = 0;
  for (const [k, n] of A) comun += Math.min(n, B.get(k) || 0);
  return (2 * comun) / (x.length - 1 + y.length - 1 || 1);
}

/** Partes ordenadas de la más parecida a la menos (solo las que superan el umbral). */
export function candidatos(nombre, partes, umbral = 0.5) {
  return partes.map((p) => ({ p, score: parecido(nombre, p.nombre) }))
    .filter((x) => x.score >= umbral)
    .sort((a, b) => b.score - a.score);
}

/** Mejor coincidencia si es suficientemente clara para elegirla sola. */
export function mejorCoincidencia(nombre, partes) {
  const [a, b] = candidatos(nombre, partes, 0.72);
  if (!a) return null;
  if (b && b.score > a.score - 0.05 && a.score < 1) return null; // dos casi iguales: que elija la persona
  return a;
}

/** "92121700 - Servicios de sistemas de seguridad." → "Servicios de sistemas de seguridad" */
export const limpiarConcepto = (s) => String(s ?? '').replace(/^\s*\d{4,}\s*[-–—.:]*\s*/, '').replace(/\s+/g, ' ').replace(/[.;,\s]+$/, '').trim();

const texto = (v) => String(cellValue(v) ?? '').trim();

/** Lee la primera hoja con encabezados EMPRESA y CONCEPTO. */
export function readSugerido(wb) {
  for (const ws of wb.worksheets) {
    let head = null;
    const antes = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (head) return;
      const vals = row.values.map(texto);
      const iE = vals.findIndex((v) => base(v) === 'EMPRESA');
      const iC = vals.findIndex((v) => base(v).startsWith('CONCEPTO'));
      if (iE > 0 && iC > 0) head = { n, iE, iC };
      else antes.push(...vals.filter(Boolean));
    });
    if (!head) continue;
    const cliente = antes[0] || '';
    const empresas = [];
    let actual = null;
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n <= head.n) return;
      const vals = row.values.map(texto);
      // Renglones "Total por empresa": solo si la celda dice "Total…" y no hay concepto (una empresa
      // llamada "TOTAL PLAY" o un concepto "Totalidad de…" no son totales)
      if (vals.some((v) => /^TOTAL(ES)?\b/.test(base(v))) && !limpiarConcepto(vals[head.iC])) { actual = null; return; }
      const emp = vals[head.iE];
      const concepto = limpiarConcepto(vals[head.iC]);
      if (emp && (!actual || actual.nombre !== emp)) {
        actual = empresas.find((e) => e.nombre === emp) || null;
        if (!actual) { actual = { nombre: emp, conceptos: [], filas: [] }; empresas.push(actual); }
      }
      if (!actual || !concepto) return;
      if (!actual.conceptos.some((c) => base(c) === base(concepto))) actual.conceptos.push(concepto);
      actual.filas.push(n);
    });
    return { cliente, empresas: empresas.filter((e) => e.conceptos.length), hoja: ws.name };
  }
  return { cliente: '', empresas: [], hoja: null, error: 'No encontré una hoja con los encabezados EMPRESA y CONCEPTO.' };
}

/** "a) X; b) Y; y c) Z" (un solo servicio va sin inciso). */
export function listaServicios(conceptos) {
  if (conceptos.length === 1) return conceptos[0];
  const L = 'abcdefghijklmnopqrstuvwxyz';
  return conceptos.map((c, i) => `${i === conceptos.length - 1 ? 'y ' : ''}${L[i] || i + 1}) ${c}`).join('; ');
}

/** Plantillas aptas: tienen la variable {{servicios}} y firmantes con prefijo prestador y cliente. */
export const isServiciosTemplate = (t) =>
  t.vars?.some(([k]) => k === 'servicios') &&
  t.signers?.some((s) => s.bind?.prefix === 'prestador') && t.signers?.some((s) => s.bind?.prefix === 'cliente');
