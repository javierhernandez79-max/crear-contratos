// Catálogo de partes ⇄ Excel (.xlsx). Recibe ExcelJS como parámetro para usarse en el
// navegador (vendor/exceljs.min.js, carga diferida) y en Node (generar la plantilla).
import { newParty, newApoderado, newAccionista, partyKey } from './parties.js';

const SI = 'Sí';
const NO = 'No';

// [encabezado, campo, tipo, ancho] — tipo: text | bool | date | kind
const PARTES = [
  ['Tipo (Moral/Física)', 'kind', 'kind', 14],
  ['Empresa del grupo (Sí/No)', 'propia', 'bool', 14],
  ['Activa (Sí/No)', 'activa', 'bool', 10],
  ['Nombre o razón social', 'nombre', 'text', 42],
  ['RFC', 'rfc', 'text', 16],
  ['Domicilio', 'domicilio', 'text', 48],
  ['Correo', 'correo', 'text', 28],
  ['Teléfono', 'telefono', 'text', 16],
  ['Escritura constitutiva núm.', 'escrituraNumero', 'text', 14],
  ['Fecha de constitución', 'escrituraFecha', 'date', 14],
  ['Notario (con título)', 'notario', 'text', 30],
  ['Notaría núm.', 'notariaNumero', 'text', 10],
  ['Ciudad de la notaría', 'notariaCiudad', 'text', 22],
  ['Folio mercantil', 'folioMercantil', 'text', 16],
  ['Fecha de inscripción del folio', 'folioFecha', 'date', 14],
  ['Objeto social', 'objetoSocial', 'text', 40],
  ['CURP (persona física)', 'curp', 'text', 22],
  ['Nacionalidad', 'nacionalidad', 'text', 14],
  ['Sexo (persona física)', 'sexo', 'text', 12],
  ['Estado civil', 'estadoCivil', 'text', 14],
  ['Ocupación', 'ocupacion', 'text', 18],
  ['Identificación', 'identificacion', 'text', 30],
  ['Carpeta del expediente (Dropbox)', 'expediente', 'text', 36],
  ['Notas', 'notas', 'text', 36],
  ['ID (no modificar)', 'id', 'text', 12],
];
const APODERADOS = [
  ['Empresa (RFC o razón social)', '_empresa', 'text', 30],
  ['Nombre del apoderado', 'nombre', 'text', 32],
  ['Cargo', 'cargo', 'text', 22],
  ['Escritura de poder núm.', 'poderNumero', 'text', 14],
  ['Fecha del poder', 'poderFecha', 'date', 14],
  ['Notario (con título)', 'notario', 'text', 30],
  ['Notaría núm.', 'notariaNumero', 'text', 10],
  ['Ciudad de la notaría', 'notariaCiudad', 'text', 22],
  ['Facultades', 'facultades', 'text', 40],
  ['Vigente (Sí/No)', 'vigente', 'bool', 10],
];
const ACCIONISTAS = [
  ['Empresa (RFC o razón social)', '_empresa', 'text', 30],
  ['Accionista', 'nombre', 'text', 36],
  ['Número de acciones', 'acciones', 'text', 14],
  ['Serie o clase', 'serie', 'text', 12],
];

const INSTRUCCIONES = [
  'Catálogo de partes – Crear Contratos',
  '',
  'Hoja "Partes": una fila por empresa o persona. Tipo = Moral o Física. Empresa del grupo = Sí para las empresas propias.',
  'Hoja "Apoderados": una fila por apoderado. En "Empresa" escribe el RFC (o la razón social exacta) de la hoja Partes.',
  'Hoja "Accionistas": una fila por accionista, ligada igual que los apoderados.',
  'Fechas en formato de fecha de Excel (o AAAA-MM-DD). Notario con su título, p. ej. "Lic. Juan Pérez López".',
  'Para dar de baja una empresa no borres la fila: pon Activa = No (así se conserva el historial).',
  'La columna ID la llena la app; déjala vacía en filas nuevas y no la modifiques en las existentes.',
  'Importar en la app: Catálogo → Importar Excel. Las filas se emparejan por ID, luego RFC, luego nombre.',
];

const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };

function addSheet(wb, name, cols, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map(([header, key, , width]) => ({ header, key, width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = HEAD_FILL;
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 32;
  for (const r of rows) ws.addRow(r);
  // Listas desplegables en columnas Sí/No y Tipo (hasta 500 filas)
  cols.forEach(([, , type], i) => {
    if (type !== 'bool' && type !== 'kind') return;
    const list = type === 'bool' ? `"${SI},${NO}"` : '"Moral,Física"';
    for (let r = 2; r <= 500; r++) {
      ws.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [list] };
    }
  });
  cols.forEach(([, , type], i) => { if (type === 'date') ws.getColumn(i + 1).numFmt = 'dd/mm/yyyy'; });
  return ws;
}

const toExcel = (type, v) => {
  if (type === 'bool') return v ? SI : NO;
  if (type === 'kind') return v === 'pf' ? 'Física' : 'Moral';
  if (type === 'date') {
    const [y, m, d] = String(v || '').split('-').map(Number);
    return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : (v || null);
  }
  return v ?? '';
};

const rowOf = (cols, obj) => Object.fromEntries(cols.map(([, key, type]) => [key, toExcel(type, obj[key])]));

/** Genera el libro de Excel del catálogo (sin partes = plantilla vacía). */
export async function catalogToXlsx(ExcelJS, parties) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Crear Contratos';
  const sorted = [...parties].sort((a, b) => (b.propia - a.propia) || a.nombre.localeCompare(b.nombre, 'es'));
  const ref = (p) => p.rfc || p.nombre;
  addSheet(wb, 'Partes', PARTES, sorted.map((p) => rowOf(PARTES, p)));
  addSheet(wb, 'Apoderados', APODERADOS, sorted.flatMap((p) => p.apoderados.map((a) => rowOf(APODERADOS, { ...a, _empresa: ref(p) }))));
  addSheet(wb, 'Accionistas', ACCIONISTAS, sorted.flatMap((p) => p.accionistas.map((a) => rowOf(ACCIONISTAS, { ...a, _empresa: ref(p) }))));
  const ins = wb.addWorksheet('Instrucciones');
  ins.getColumn(1).width = 120;
  INSTRUCCIONES.forEach((t, i) => { ins.getCell(i + 1, 1).value = t; });
  ins.getCell(1, 1).font = { bold: true, size: 14 };
  return wb.xlsx.writeBuffer();
}

// ---------- Lectura ----------
const cellText = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result); // fórmula
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text); // hipervínculo
  }
  return String(v).trim();
};

const parseDate = (v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = cellText(v);
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return t;
};

const fromExcel = (type, v) => {
  if (type === 'bool') return !/^(no|n|false|0)$/i.test(cellText(v));
  if (type === 'kind') return /^f/i.test(cellText(v)) ? 'pf' : 'pm';
  if (type === 'date') return parseDate(v);
  return cellText(v);
};

function readSheet(wb, name, cols) {
  const ws = wb.getWorksheet(name);
  if (!ws) return [];
  // Ubica columnas por encabezado para tolerar columnas movidas
  const headers = {};
  ws.getRow(1).eachCell((cell, col) => { headers[cellText(cell.value).toLowerCase()] = col; });
  const out = [];
  ws.eachRow((row, r) => {
    if (r === 1) return;
    const obj = { _row: r };
    let any = false;
    for (const [header, key, type] of cols) {
      const col = headers[header.toLowerCase()];
      const raw = col ? row.getCell(col).value : null;
      if (cellText(raw)) any = true;
      obj[key] = col ? fromExcel(type, raw) : undefined;
    }
    if (any) out.push(obj);
  });
  return out;
}

/**
 * Lee el Excel y lo combina con el catálogo actual.
 * Devuelve { parties, created, updated, warnings, renamed, missingIds } — `parties` son solo las nuevas o actualizadas.
 */
export async function xlsxToCatalog(ExcelJS, buffer, current) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  if (!wb.getWorksheet('Partes')) throw new Error('El archivo no tiene la hoja "Partes". Descarga la plantilla desde la app.');
  const warnings = [];
  const hasApo = !!wb.getWorksheet('Apoderados');
  const hasAcc = !!wb.getWorksheet('Accionistas');
  const byId = new Map(current.map((p) => [p.id, p]));
  const byKey = new Map(current.map((p) => [partyKey(p), p]));
  const result = [];
  const renamed = []; // [idLocal, idDelExcel]
  let missingIds = 0; // filas capturadas a mano en Excel, sin ID todavía
  let created = 0;
  let updated = 0;

  for (const row of readSheet(wb, 'Partes', PARTES)) {
    if (!row.nombre) { warnings.push(`Partes, fila ${row._row}: sin nombre, se omitió.`); continue; }
    const existing = (row.id && byId.get(row.id)) || byKey.get(partyKey(row));
    const p = existing ? structuredClone(existing) : newParty(row.kind, row.propia);
    // El ID del Excel manda (lo escribió la app en algún equipo): así todos usan el mismo
    if (row.id && p.id !== row.id) {
      if (existing) renamed.push([existing.id, row.id]);
      p.id = row.id;
    }
    if (!row.id) missingIds++;
    for (const [, key] of PARTES) if (key !== 'id' && row[key] !== undefined) p[key] = row[key];
    if (existing) {
      // Las listas se reconstruyen desde sus hojas; se conservan los ID por nombre
      p._prev = { apoderados: p.apoderados, accionistas: p.accionistas };
      if (hasApo) p.apoderados = [];
      if (hasAcc) p.accionistas = [];
      updated++;
    } else created++;
    p.updatedAt = Date.now();
    if (result.some((x) => x.id === p.id)) { warnings.push(`Partes, fila ${row._row}: "${row.nombre}" está repetida, se usó la última.`); }
    result.push(p);
  }
  const final = new Map(result.map((p) => [p.id, p]));
  const findCompany = (ref) => {
    const k1 = partyKey({ rfc: ref });
    const k2 = partyKey({ nombre: ref });
    return [...final.values()].find((p) => partyKey(p) === k1 || partyKey({ nombre: p.nombre }) === k2);
  };
  for (const [sheet, cols, list, make] of [['Apoderados', APODERADOS, 'apoderados', newApoderado], ['Accionistas', ACCIONISTAS, 'accionistas', newAccionista]]) {
    for (const row of readSheet(wb, sheet, cols)) {
      const p = findCompany(row._empresa);
      if (!p) { warnings.push(`${sheet}, fila ${row._row}: no se encontró la empresa "${row._empresa}".`); continue; }
      const prev = p._prev?.[list].find((x) => partyKey({ nombre: x.nombre }) === partyKey({ nombre: row.nombre }));
      const item = { ...make(), ...(prev ? { id: prev.id } : {}) };
      for (const [, key] of cols) if (!key.startsWith('_') && row[key] !== undefined) item[key] = row[key];
      p[list].push(item);
    }
  }
  for (const p of final.values()) delete p._prev;
  return { parties: [...final.values()], created, updated, warnings, renamed, missingIds };
}
