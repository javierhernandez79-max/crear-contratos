// Contratos individuales de trabajo en lote a partir del Excel "P1" (una fila = un trabajador).
// Los trabajadores no entran al catálogo: viven solo en el lote.
import { newContractFromTemplate } from './model.js';
import { applyParty } from './parties.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Columnas del P1. `aliases` = encabezados aceptados (sin acentos ni puntuación). */
export const P1_COLUMNS = [
  { key: 'nombre', label: 'Nombre', aliases: ['nombre', 'nombres', 'nombre s'] },
  { key: 'apPaterno', label: 'Apellido Paterno', aliases: ['apellido paterno'] },
  { key: 'apMaterno', label: 'Apellido Materno', aliases: ['apellido materno'] },
  { key: 'nombreCompleto', label: 'NOMBRE COMPLETO', aliases: ['nombre completo'] },
  // Nacionalidad y salario diario los calcula la app (CURP y sueldo mensual); la columna de nacionalidad solo hace falta para extranjeros
  { key: 'nacionalidad', label: 'Nacionalidad (solo extranjeros)', aliases: ['nacionalidad', 'nacionalidad solo extranjeros'], opcional: true },
  { key: 'rfc', label: 'RFC con Homoclave', aliases: ['rfc con homoclave', 'rfc'] },
  { key: 'curp', label: 'CURP', aliases: ['curp'] },
  // El sexo sale de la CURP (posición 11: H/M); la columna solo se usa si la CURP no lo indica
  { key: 'sexo', label: 'Sexo', aliases: ['sexo'], opcional: true },
  { key: 'estadoCivil', label: 'Estado Civil', aliases: ['estado civil'] },
  { key: 'calle', label: 'Calle', aliases: ['calle'] },
  { key: 'noExt', label: 'No. Ext.', aliases: ['no ext', 'numero exterior', 'num ext'] },
  { key: 'noInt', label: 'No. Int.', aliases: ['no int', 'numero interior', 'num int'] },
  { key: 'colonia', label: 'Colonia', aliases: ['colonia'] },
  { key: 'municipio', label: 'Alcaldía/municipio', aliases: ['alcaldia municipio', 'municipio', 'alcaldia'] },
  { key: 'cp', label: 'CP', aliases: ['cp', 'c p', 'codigo postal'] },
  { key: 'sueldo', label: 'Sueldo Mensual Bruto', aliases: ['sueldo mensual bruto', 'sueldo mensual'] },
  { key: 'sd', label: 'SD', aliases: ['sd', 'salario diario'], opcional: true },
  { key: 'puesto', label: 'Puesto', aliases: ['puesto'] },
  { key: 'antiguedad', label: 'Fecha de Antigüedad', aliases: ['fecha de antiguedad'] },
  { key: 'tipo', label: 'Tipo de Contrato', aliases: ['tipo de contrato'] },
  { key: 'diasPago', label: 'Días de Pago', aliases: ['dias de pago'] },
  { key: 'ingreso', label: 'Fecha de Ingreso', aliases: ['fecha de ingreso'] },
  { key: 'lugar', label: 'Lugar de Trabajo', aliases: ['lugar de trabajo'], nueva: true },
  { key: 'fin', label: 'Fecha de Terminación', aliases: ['fecha de terminacion'], nueva: true },
  { key: 'firma', label: 'Fecha de Firma', aliases: ['fecha de firma'], nueva: true },
];
export const DATE_KEYS = new Set(['antiguedad', 'ingreso', 'fin', 'firma']);

export const PERIODICIDADES = ['SEMANAL', 'CATORCENAL', 'QUINCENAL', 'MENSUAL'];

// ---------- Lectura del Excel ----------
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Valor útil de una celda de ExcelJS: fórmulas (su resultado), texto enriquecido, ligas; errores (#N/A) → null. */
export function cellValue(v) {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (v.error) return null;
    if ('formula' in v || 'sharedFormula' in v || 'result' in v) return v.result === undefined ? null : cellValue(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return cellValue(v.text);
    return null; // objeto desconocido: mejor vacío que "[object Object]" en un contrato
  }
  return v;
}

/** Fecha de Excel (Date, número de serie o texto dd/mm/aaaa) → "aaaa-mm-dd"; '' si no se entiende. */
export function toISODate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : isoOf(v);
  if (typeof v === 'number') return isoOf(new Date(Math.round((v - 25569) * 86400000)));
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valida(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return valida(m[3], m[2], m[1]);
  return '';
}

// Rechaza fechas imposibles (31/02) y las capturadas mes/día (12/25/2024): antes pasaban y en el
// contrato aparecía otra fecha
function valida(y, mo, d) {
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return dt.getUTCMonth() === Number(mo) - 1 && dt.getUTCDate() === Number(d) ? isoOf(dt) : '';
}

const text = (v) => (v === null || v === undefined ? '' : String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim());

/**
 * Lee la primera hoja con encabezados reconocibles. Devuelve { rows, missing, sheet } donde rows son
 * los datos crudos por fila (con su número de renglón) y missing las columnas que no se encontraron.
 */
export function readP1(workbook) {
  for (const ws of workbook.worksheets) {
    const header = {};
    ws.getRow(1).eachCell((cell, col) => {
      const h = norm(cellValue(cell.value));
      const c = P1_COLUMNS.find((x) => x.aliases.includes(h));
      if (c && !header[c.key]) header[c.key] = col;
    });
    if (!header.curp && !header.rfc) continue;
    const rows = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const raw = { fila: n };
      for (const [key, col] of Object.entries(header)) {
        const v = cellValue(row.getCell(col).value);
        raw[key] = DATE_KEYS.has(key) || key === 'sd' || key === 'sueldo' ? v : text(v);
      }
      // Solo cuentan los renglones con trabajador (debajo puede haber tablas auxiliares)
      if (text(raw.curp) || text(raw.rfc) || text(raw.nombre) || text(raw.nombreCompleto)) rows.push(raw);
    });
    const missing = P1_COLUMNS.filter((c) => !header[c.key] && !c.opcional && !['nombreCompleto', 'noInt', 'tipo'].includes(c.key)
      && !(c.key === 'sueldo' && header.sd)
      && !(c.key === 'nombre' && header.nombreCompleto) && !(['apPaterno', 'apMaterno'].includes(c.key) && header.nombreCompleto));
    return { rows, missing, sheet: ws.name.trim(), sheetIndex: workbook.worksheets.indexOf(ws), header };
  }
  return { rows: [], missing: P1_COLUMNS.filter((c) => ['curp', 'rfc'].includes(c.key)), sheet: null };
}

// ---------- Normalización ----------
/** Clave de la entidad de nacimiento en la CURP (posiciones 12-13); "NE" = nacido en el extranjero. */
export const entidadNacimiento = (curp) => (/^[A-Z]{4}\d{6}[HM]([A-Z]{2})/.exec(curp || '') || [])[1] || '';

/** Nacidos en México: MEXICANO(A). Nacidos en el extranjero: la nacionalidad capturada en el P1. */
export function nacionalidadDe(curp, capturada) {
  const ent = entidadNacimiento(curp);
  const cap = text(capturada).toUpperCase();
  if (ent && ent !== 'NE') return 'MEXICANO(A)';
  return /^EXTRANJER/.test(cap) ? '' : cap;
}

/** Sexo según la CURP: la posición 11 es H (hombre) o M (mujer). '' si no se puede leer. */
export function sexoDeCurp(curp) {
  const m = /^[A-Z]{4}\d{6}([HM])/.exec(curp || '');
  if (!m) return '';
  return m[1] === 'M' ? 'F' : 'M';
}

export function sexoDe(v) {
  const s = norm(v).toUpperCase();
  if (/^(F|MUJ)/.test(s)) return 'F';
  if (/^(M|H)/.test(s)) return 'M';
  return '';
}

/** "MEXICANO(A)" → "MEXICANA" / "MEXICANO" según el sexo. */
export function nacionalidadSegunSexo(v, sexo) {
  let s = text(v).toUpperCase();
  if (!s || !sexo) return s;
  if (/\(A\)$/.test(s)) return sexo === 'F' ? s.replace(/O?\(A\)$/, 'A') : s.replace(/\(A\)$/, '');
  if (sexo === 'F') return s.replace(/O$/, 'A');
  return s.replace(/ANA$/, 'ANO');
}

const ESTADOS = ['SOLTER', 'CASAD', 'DIVORCIAD', 'VIUD', 'SEPARAD'];
/** "CASADO" → "CASADA" si es mujer (y al revés); otros valores quedan igual. */
export function estadoCivilSegunSexo(v, sexo) {
  const s = text(v).toUpperCase().replace(/\(A\)$/, '');
  const base = ESTADOS.find((e) => s.startsWith(e) && s.length <= e.length + 1);
  if (!base || !sexo) return s;
  return base + (sexo === 'F' ? 'A' : 'O');
}

function domicilio(r) {
  const cp = text(r.cp);
  const parts = [
    [text(r.calle), text(r.noExt)].filter(Boolean).join(' ') + (text(r.noInt) ? ` INT. ${text(r.noInt)}` : ''),
    text(r.colonia) && `COL. ${text(r.colonia)}`,
    text(r.municipio),
    cp && `C.P. ${/^\d{1,5}$/.test(cp) ? cp.padStart(5, '0') : cp}`,
  ];
  return parts.filter(Boolean).join(', ');
}

/** Trabajador listo para el contrato. */
export function normalizeRow(r) {
  const curp = text(r.curp).toUpperCase().replace(/\s/g, '');
  const sexo = sexoDeCurp(curp) || sexoDe(r.sexo);
  const nombre = [r.nombre, r.apPaterno, r.apMaterno].map(text).filter(Boolean).join(' ') || text(r.nombreCompleto);
  const num = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.]/g, '')));
  // Salario diario = sueldo mensual bruto / 30 (si no hay sueldo, se usa la columna SD)
  const sueldo = num(r.sueldo);
  const sd = Number.isFinite(sueldo) && sueldo > 0 ? sueldo / 30 : num(r.sd);
  // Fechas que vienen capturadas pero no se entienden: se reportan en lugar de quedar vacías sin aviso
  const fechasInvalidas = [...DATE_KEYS].filter((k) => text(r[k]) && !toISODate(r[k]))
    .map((k) => `${P1_COLUMNS.find((c) => c.key === k).label} no válida (${text(r[k])})`);
  return {
    fila: r.fila,
    fechasInvalidas,
    nombre: nombre.toUpperCase(),
    sexo,
    nacionalidad: nacionalidadSegunSexo(nacionalidadDe(curp, r.nacionalidad), sexo),
    extranjero: entidadNacimiento(curp) === 'NE',
    estadoCivil: estadoCivilSegunSexo(r.estadoCivil, sexo),
    domicilio: domicilio(r).toUpperCase(),
    curp,
    rfc: text(r.rfc).toUpperCase().replace(/[\s-]/g, ''),
    puesto: text(r.puesto).toUpperCase(),
    lugar: text(r.lugar).toUpperCase(),
    sd: Number.isFinite(sd) && sd > 0 ? Math.round(sd * 100) / 100 : null,
    diasPago: text(r.diasPago),
    tipo: norm(r.tipo).toUpperCase(),
    antiguedad: toISODate(r.antiguedad),
    ingreso: toISODate(r.ingreso),
    fin: toISODate(r.fin),
    firma: toISODate(r.firma),
  };
}

// ---------- Plantilla y validación ----------
/** Plantillas aptas para lote: tienen firmantes "patron" y "trabajador". */
export const isLoteTemplate = (t) => {
  const p = new Set((t.signers || []).map((s) => s.bind?.prefix));
  return p.has('patron') && p.has('trabajador');
};
/** Contrato por tiempo determinado si la plantilla pide fecha de terminación. */
export const tipoDePlantilla = (t) => (t.vars.some(([k]) => k === 'fecha_fin') ? 'DETERMINADO' : 'INDETERMINADO');

/** Variables del trabajador y del lote, con el nombre que usan las plantillas marco. */
export function workerVariables(w, lote) {
  return {
    trabajador_nombre: w.nombre,
    trabajador_nacionalidad: w.nacionalidad,
    trabajador_sexo: w.sexo === 'F' ? 'FEMENINO' : w.sexo === 'M' ? 'MASCULINO' : '',
    trabajador_estado_civil: w.estadoCivil,
    trabajador_domicilio: w.domicilio,
    trabajador_curp: w.curp,
    trabajador_rfc: w.rfc,
    puesto: w.puesto,
    lugar_trabajo: w.lugar,
    salario_diario: w.sd === null ? '' : String(w.sd),
    periodicidad_pago: lote.periodicidad || '',
    dias_pago: w.diasPago,
    fecha_antiguedad: w.antiguedad,
    fecha_inicio: w.ingreso,
    fecha_fin: w.fin,
    fecha_firma: w.firma,
  };
}

const LABELS = {
  trabajador_nombre: 'Nombre', trabajador_nacionalidad: 'Nacionalidad', trabajador_sexo: 'Sexo', trabajador_estado_civil: 'Estado Civil',
  trabajador_domicilio: 'Domicilio (Calle, Colonia, Alcaldía/municipio, CP)', trabajador_curp: 'CURP', trabajador_rfc: 'RFC con Homoclave',
  puesto: 'Puesto', lugar_trabajo: 'Lugar de Trabajo', salario_diario: 'Sueldo Mensual Bruto', periodicidad_pago: 'Periodicidad de pago', dias_pago: 'Días de Pago',
  fecha_antiguedad: 'Fecha de Antigüedad', fecha_inicio: 'Fecha de Ingreso', fecha_fin: 'Fecha de Terminación', fecha_firma: 'Fecha de Firma',
};

const RFC_PF = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;
const CURP = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;

/**
 * Los 10 primeros caracteres de RFC y CURP coinciden, salvo por palabras altisonantes: RENAPO cambia la
 * 2ª letra por X y el SAT la 4ª; además la Ñ se escribe X en la CURP. Esas diferencias no son error.
 */
function rfcCoincideCurp(rfc, curp) {
  for (let i = 0; i < 10; i++) {
    const a = rfc[i], b = curp[i];
    if (a === b) continue;
    if (i < 4 && (a === 'X' || b === 'X')) continue;
    return false;
  }
  return true;
}

/** Errores de cada trabajador para la plantilla elegida (lista vacía = listo). */
export function validateWorkers(workers, tpl, lote) {
  const needed = new Set(tpl.vars.map(([k]) => k).filter((k) => k in LABELS));
  const tipo = tipoDePlantilla(tpl);
  const curps = new Map();
  return workers.map((w) => {
    const errs = [];
    const vars = workerVariables(w, lote);
    for (const k of needed) if (!vars[k] && !(k === 'trabajador_nacionalidad' && w.extranjero)) errs.push(`Falta ${LABELS[k]}`);
    if (!w.sexo) errs.push('No se pudo determinar el sexo: la CURP no lo indica (posición 11 H/M) y la columna Sexo está vacía');
    if (w.extranjero && !w.nacionalidad) errs.push('Nació en el extranjero (CURP con NE): captura su Nacionalidad');
    if (w.rfc && !RFC_PF.test(w.rfc)) errs.push(`RFC inválido (${w.rfc}): deben ser 13 caracteres`);
    if (w.curp && !CURP.test(w.curp)) errs.push(`CURP inválida (${w.curp})`);
    for (const f of w.fechasInvalidas || []) errs.push(`${f}: usa día/mes/año`);
    if (RFC_PF.test(w.rfc) && CURP.test(w.curp) && !rfcCoincideCurp(w.rfc, w.curp)) errs.push(`RFC y CURP no coinciden (${w.rfc.slice(0, 10)} / ${w.curp.slice(0, 10)})`);
    if (w.tipo && w.tipo !== tipo) errs.push(`Tipo de contrato "${w.tipo}" distinto a la plantilla (${tipo})`);
    if (tipo === 'DETERMINADO' && w.fin && w.ingreso && w.fin <= w.ingreso) errs.push('La fecha de terminación debe ser posterior a la de ingreso');
    if (w.curp) {
      if (curps.has(w.curp)) errs.push(`CURP repetida (fila ${curps.get(w.curp)})`);
      else curps.set(w.curp, w.fila);
    }
    return errs;
  });
}

// ---------- Contratos ----------
/** Contrato (en memoria) de un trabajador, con los datos de la empresa y su apoderado. */
export function workerContract(lote, w) {
  const tpl = lote.plantilla;
  const c = newContractFromTemplate(tpl);
  c.history = [];
  const patron = c.signers.find((s) => s.bind?.prefix === 'patron');
  if (patron && lote.empresa) applyParty(c, patron, lote.empresa, lote.apoderado || null);
  Object.assign(c.variables, workerVariables(w, lote));
  c.status = lote.status === 'aprobado' ? 'aprobado' : 'revision';
  return c;
}


export const fileNameFor = (i, w) => `${String(i + 1).padStart(2, '0')} - ${w.nombre.replace(/[\\/:*?"<>|]/g, '').slice(0, 80)}.docx`;

// ---------- P1 final (con las correcciones hechas en la plataforma) ----------
const sameValue = (a, b) => {
  const k = (v) => (v instanceof Date ? toISODate(v) : v === null || v === undefined ? '' : String(v).trim());
  return k(a) === k(b);
};

/**
 * Aplica al Excel original las correcciones hechas en la plataforma. Las celdas cambiadas quedan
 * resaltadas en amarillo. `editadas` = índices de filas; `raw`/`raw0` = valores corregidos/originales.
 */
export async function p1Final(ExcelJS, buffer, { sheetIndex, header, raw, raw0, editadas }) {
  if (!editadas?.size) return new Uint8Array(buffer);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[sheetIndex];
  for (const i of editadas) {
    const now = raw[i];
    const before = raw0[i];
    const row = ws.getRow(now.fila);
    for (const [key, col] of Object.entries(header)) {
      if (!(key in now) || sameValue(now[key], before[key])) continue;
      const cell = row.getCell(col);
      const v = now[key];
      const iso = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
      cell.value = v === '' ? null : iso ? new Date(`${v}T00:00:00Z`) : v;
      if (iso) cell.numFmt = 'dd/mm/yyyy'; // ExcelJS usaría el formato de EE. UU. (mm-dd-yy)
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    }
  }
  // Tablas guardadas por algunos programas (p. ej. LibreOffice) no traen estilo y ExcelJS no las puede escribir
  for (const sheet of wb.worksheets) {
    for (const t of Object.values(sheet.tables || {})) {
      const model = t.table || t.model;
      if (model && !model.style) model.style = { theme: 'TableStyleMedium2', showRowStripes: true };
    }
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export const toBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
