// Contratos de prestación de servicios desde el Excel "Sugerido de conceptos":
// arriba el nombre del cliente (o parte de él) y una tabla EMPRESA | CONCEPTO (| MONTO).
// Se genera un contrato por empresa del grupo con todos sus conceptos como objeto.

const SUFIJOS = new Set(['S', 'A', 'SA', 'DE', 'C', 'V', 'CV', 'R', 'L', 'RL', 'P', 'I', 'SAPI', 'B', 'SAB', 'SC', 'AC', 'SRL', 'SPR', 'SOCIEDAD', 'ANONIMA', 'CAPITAL', 'VARIABLE']);

const base = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Nombre sin acentos, signos ni tipo de sociedad: "IA TECH-SYSTEMS S.A DE C.V." → "IATECHSYSTEMS". */
export function nucleo(nombre) {
  const t = base(nombre).replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  while (t.length > 1 && SUFIJOS.has(t[t.length - 1])) t.pop();
  return t.join('');
}

const bigramas = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); } return m; };

/** Parecido entre dos nombres, de 0 a 1 (coeficiente de Dice sobre bigramas del núcleo). */
export function parecido(a, b) {
  const x = nucleo(a), y = nucleo(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return 0.9;
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

const texto = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return texto(v.result);
    if (v.text) return String(v.text);
  }
  return String(v).trim();
};

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
      if (vals.some((v) => /^TOTAL/.test(base(v)))) { actual = null; return; }
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
