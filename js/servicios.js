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

/** Contrato de prestación de servicios: tiene {{servicios}} o firmantes prestador y cliente. */
export const esContratoServicios = (c) => !!c.varDefs?.some((d) => d.key === 'servicios')
  || (c.signers?.some((s) => s.bind?.prefix === 'prestador') && c.signers?.some((s) => s.bind?.prefix === 'cliente'));

// ---------- Formatos (F1, F2…) ----------
// Cada plantilla de servicios puede llevar un código de formato. El código vive solo en la app (no se
// imprime). Con un mismo cliente, cada empresa del grupo queda amarrada a un formato y cada formato a
// una sola empresa; la regla sale de los contratos de servicios ya creados que llevan código.

/** "f1 " → "F1"; '' si no tiene. */
export const codigoFormato = (x) => String(x?.formato || '').trim().toUpperCase();

/** Orden natural: F2 antes que F10. */
export const ordenFormato = (a, b) => codigoFormato(a).localeCompare(codigoFormato(b), 'es', { numeric: true });

const firmante = (c, prefix) => c.signers?.find((s) => s.bind?.prefix === prefix);

/** Parte de un contrato en un rol: { id (catálogo) | null, nombre }. */
export function parteDe(c, prefix) {
  const sg = firmante(c, prefix);
  if (!sg) return null;
  return { id: sg.party?.id || null, nombre: c.variables?.[`${prefix}_nombre`] || '' };
}

/** ¿Es la misma parte? Por id del catálogo o, si alguno no lo tiene, por nombre sin tipo de sociedad. */
export function mismaParte(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id) return a.id === b.id;
  const na = nucleo(a.nombre);
  return !!na && na === nucleo(b.nombre);
}

/**
 * Formatos ya usados con un cliente (en contratos distintos de `exceptId`), del más antiguo al más nuevo.
 * Devuelve [{ formato, prestador: {id, nombre}, contrato }], uno por formato y uno por empresa (el primero manda).
 */
export function formatosDelCliente(contracts, cliente, exceptId) {
  const usados = [];
  const lista = contracts.filter((c) => c.id !== exceptId && codigoFormato(c) && esContratoServicios(c)).sort((a, b) => a.createdAt - b.createdAt);
  for (const c of lista) {
    if (!mismaParte(parteDe(c, 'cliente'), cliente)) continue;
    const prestador = parteDe(c, 'prestador');
    if (!prestador || !(prestador.id || prestador.nombre)) continue;
    const formato = codigoFormato(c);
    if (usados.some((u) => u.formato === formato || mismaParte(u.prestador, prestador))) continue;
    usados.push({ formato, prestador, contrato: c });
  }
  return usados;
}

/** Formato fijo de una empresa con el cliente, o null. */
export const formatoFijo = (usados, prestador) => usados.find((u) => mismaParte(u.prestador, prestador)) || null;

/** Quién ya tiene ese formato con el cliente (otra empresa), o null. */
export const formatoOcupado = (usados, formato, prestador) =>
  usados.find((u) => u.formato === formato && !mismaParte(u.prestador, prestador)) || null;

/** Motivo por el que un contrato rompe la regla de formatos, o ''. */
export function conflictoFormato(c, contracts) {
  const formato = codigoFormato(c);
  const cliente = parteDe(c, 'cliente');
  const prestador = parteDe(c, 'prestador');
  if (!formato || !esContratoServicios(c) || !(cliente?.id || cliente?.nombre) || !(prestador?.id || prestador?.nombre)) return '';
  const usados = formatosDelCliente(contracts, cliente, c.id);
  const fijo = formatoFijo(usados, prestador);
  if (fijo && fijo.formato !== formato) return `${prestador.nombre || 'Esta empresa'} ya tiene el formato ${fijo.formato} con este cliente; no puede usar el ${formato}.`;
  const otro = formatoOcupado(usados, formato, prestador);
  if (otro) return `El formato ${formato} ya se usó con este cliente para ${otro.prestador.nombre || 'otra empresa del grupo'}; elige otro formato.`;
  return '';
}
