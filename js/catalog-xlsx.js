// Catálogo de partes ⇄ Excel (.xlsx). Recibe ExcelJS como parámetro para usarse en el
// navegador (vendor/exceljs.min.js, carga diferida) y en Node (generar la plantilla).
import { newParty, newApoderado, newAccionista, partyKey } from './parties.js';
import { cellValue, toISODate } from './lote.js';

const SI = 'Sí';
const NO = 'No';

// Formato de una sola hoja ("Catálogo"), con las columnas en el orden que usa el despacho:
// una fila por empresa o persona con UN apoderado (los demás se capturan en la app).
// [encabezado, campo, tipo, ancho, sección] — tipo: text | bool | date | kind; sección: p (parte) | a (apoderado)
const CATALOGO = [
  ['Tipo (Moral/Física)', 'kind', 'kind', 14, 'p'],
  ['Empresa del grupo (Sí/No)', 'propia', 'bool', 14, 'p'],
  ['Activa (Sí/No)', 'activa', 'bool', 10, 'p'],
  ['Nombre o razón social', 'nombre', 'text', 42, 'p'],
  ['RFC', 'rfc', 'text', 16, 'p'],
  ['Domicilio', 'domicilio', 'text', 48, 'p'],
  ['Correo', 'correo', 'text', 28, 'p'],
  ['Teléfono', 'telefono', 'text', 16, 'p'],
  ['Escritura constitutiva núm.', 'escrituraNumero', 'text', 14, 'p'],
  ['Fecha de constitución', 'escrituraFecha', 'date', 14, 'p'],
  ['Notario (con título)', 'notario', 'text', 30, 'p'],
  ['Notaría núm.', 'notariaNumero', 'text', 10, 'p'],
  ['Ciudad de la notaría', 'notariaCiudad', 'text', 22, 'p'],
  ['Folio mercantil', 'folioMercantil', 'text', 16, 'p'],
  ['Fecha de inscripción del folio', 'folioFecha', 'date', 14, 'p'],
  ['Objeto social', 'objetoSocial', 'text', 40, 'p'],
  ['Lugar de inscripción', 'folioLugar', 'text', 22, 'p'],
  ['CURP (persona física)', 'curp', 'text', 22, 'p'],
  ['Nacionalidad', 'nacionalidad', 'text', 14, 'p'],
  ['Estado civil', 'estadoCivil', 'text', 14, 'p'],
  ['Ocupación', 'ocupacion', 'text', 18, 'p'],
  ['Identificación', 'identificacion', 'text', 30, 'p'],
  ['Carpeta del expediente (Dropbox)', 'expediente', 'text', 36, 'p'],
  ['Notas', 'notas', 'text', 36, 'p'],
  ['ID (no modificar)', 'id', 'text', 12, 'p'],
  ['Nombre del apoderado', 'nombre', 'text', 32, 'a'],
  ['Cargo', 'cargo', 'text', 22, 'a'],
  ['Escritura de poder núm.', 'poderNumero', 'text', 14, 'a'],
  ['Fecha del poder', 'poderFecha', 'date', 14, 'a'],
  ['Notario (con título)', 'notario', 'text', 30, 'a'],
  ['Notaría núm.', 'notariaNumero', 'text', 10, 'a'],
  ['Ciudad de la notaría', 'notariaCiudad', 'text', 22, 'a'],
  // Datos que la app usa y que el formato del despacho no traía: van al final
  ['Correo del apoderado', 'correo', 'text', 28, 'a'],
  ['Poder vigente (Sí/No)', 'vigente', 'bool', 10, 'a'],
  ['Facultades', 'facultades', 'text', 40, 'a'],
  ['Sexo (persona física)', 'sexo', 'text', 12, 'p'],
  ['INE del apoderado', 'identificacion', 'text', 36, 'a'],
  ['Vigencia INE del apoderado (año)', 'identificacionVigencia', 'text', 12, 'a'],
];
const ACCIONISTAS = [
  ['Empresa (RFC o razón social)', '_empresa', 'text', 30],
  ['Accionista', 'nombre', 'text', 36],
  ['Número de acciones', 'acciones', 'text', 14],
  ['Serie o clase', 'serie', 'text', 12],
];

// Formato anterior (hojas Partes y Apoderados): solo para leer archivos viejos
const PARTES_V1 = [
  ...CATALOGO.filter((c) => c[4] === 'p' && c[1] !== 'folioLugar'),
];
const APODERADOS_V1 = [
  ['Empresa (RFC o razón social)', '_empresa', 'text', 30],
  ['Nombre del apoderado', 'nombre', 'text', 32],
  ['Cargo', 'cargo', 'text', 22],
  ['Correo', 'correo', 'text', 28],
  ['Escritura de poder núm.', 'poderNumero', 'text', 14],
  ['Fecha del poder', 'poderFecha', 'date', 14],
  ['Notario (con título)', 'notario', 'text', 30],
  ['Notaría núm.', 'notariaNumero', 'text', 10],
  ['Ciudad de la notaría', 'notariaCiudad', 'text', 22],
  ['Facultades', 'facultades', 'text', 40],
  ['Vigente (Sí/No)', 'vigente', 'bool', 10],
];

const INSTRUCCIONES = [
  'Catálogo de partes – Crear Contratos',
  '',
  'Hoja "Catálogo": una fila por empresa o persona, con su apoderado (uno por fila; si una empresa tiene más, agrégalos en la app).',
  'Tipo = Moral o Física. Empresa del grupo = Sí para las empresas propias. Poder vigente vacío cuenta como Sí.',
  'Columnas "Notario", "Notaría núm." y "Ciudad de la notaría": las primeras son de la escritura constitutiva; las que están después de "Nombre del apoderado" son del poder.',
  'Hoja "Accionistas": una fila por accionista; en "Empresa" escribe el RFC (o la razón social exacta).',
  'Fechas en formato de fecha de Excel (o AAAA-MM-DD). Notario con su título, p. ej. "Lic. Juan Pérez López".',
  'Para dar de baja una empresa no borres la fila: pon Activa = No (así se conserva el historial).',
  'La columna ID la llena la app; déjala vacía en filas nuevas y no la modifiques en las existentes.',
  'Importar en la app: Catálogo → Importar Excel. Las filas se emparejan por ID, luego RFC, luego nombre. Los apoderados que no vengan en el Excel se conservan.',
];

const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
const APO_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6B5E' } };

function addSheet(wb, name, cols, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map(([header, , , width]) => ({ header, width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 32;
  // Encabezados del apoderado en otro color: así se distinguen los "Notario" repetidos
  cols.forEach((c, i) => { head.getCell(i + 1).fill = c[4] === 'a' ? APO_FILL : HEAD_FILL; });
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

/** Apoderado que va en la fila: el primero vigente con nombre (o el primero con nombre). */
const apoderadoPrincipal = (p) => {
  const con = (p.apoderados || []).filter((a) => a.nombre?.trim());
  return con.find((a) => a.vigente) || con[0] || null;
};

/** Genera el libro de Excel del catálogo (sin partes = plantilla vacía). */
export async function catalogToXlsx(ExcelJS, parties) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Crear Contratos';
  const sorted = [...parties].sort((a, b) => (b.propia - a.propia) || a.nombre.localeCompare(b.nombre, 'es'));
  const ref = (p) => p.rfc || p.nombre;
  addSheet(wb, 'Catálogo', CATALOGO, sorted.map((p) => {
    const a = apoderadoPrincipal(p);
    // Sin apoderado, sus columnas quedan vacías (no "No" en Poder vigente)
    return CATALOGO.map(([, key, type, , sec]) => (sec === 'a' ? (a ? toExcel(type, a[key]) : null) : toExcel(type, p[key])));
  }));
  addSheet(wb, 'Accionistas', ACCIONISTAS, sorted.flatMap((p) => p.accionistas.map((a) => ACCIONISTAS.map(([, key, type]) => toExcel(type, key === '_empresa' ? ref(p) : a[key])))));
  const ins = wb.addWorksheet('Instrucciones');
  ins.getColumn(1).width = 120;
  INSTRUCCIONES.forEach((t, i) => { ins.getCell(i + 1, 1).value = t; });
  ins.getCell(1, 1).font = { bold: true, size: 14 };
  return wb.xlsx.writeBuffer();
}

// ---------- Lectura ----------
// Lectura de celdas y fechas compartida con el P1 (lote.js): fórmulas, errores (#N/A) y fechas imposibles
const cellText = (v) => {
  const x = cellValue(v);
  if (x === null || x === undefined) return '';
  return x instanceof Date ? toISODate(x) : String(x).trim();
};
// Si la fecha no se entiende se conserva el texto tal cual, para no perder el dato
const parseDate = (v) => toISODate(cellValue(v)) || cellText(v);

const fromExcel = (type, v, key) => {
  // "Empresa del grupo" vacía es No (una contraparte capturada a mano no debe volverse del grupo);
  // "Activa" y "Vigente" vacías siguen siendo Sí
  if (type === 'bool' && key === 'propia') return /^(s|si|sí|true|1|x)$/i.test(cellText(v));
  if (type === 'bool') return !/^(no|n|false|0)$/i.test(cellText(v));
  if (type === 'kind') return /^f/i.test(cellText(v)) ? 'pf' : 'pm';
  if (type === 'date') return parseDate(v);
  return cellText(v);
};

const norm = (h) => cellText(h).toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Lee una hoja ubicando columnas por encabezado (tolera columnas movidas). En la hoja "Catálogo" los
 * encabezados del notario se repiten: los que están a la derecha de "Nombre del apoderado" son del poder.
 */
function readSheet(ws, cols) {
  if (!ws) return [];
  const headers = [];
  ws.getRow(1).eachCell((cell, col) => { headers.push([norm(cell.value), col]); });
  const apoStart = headers.find(([h]) => h === 'nombre del apoderado')?.[1] ?? Infinity;
  const colOf = ([header, , , , sec]) => {
    const h = norm(header);
    const enRango = headers.filter(([x, c]) => x === h && (sec === 'a' ? c >= apoStart : c < apoStart));
    return (enRango[0] || headers.find(([x]) => x === h))?.[1];
  };
  const map = cols.map((c) => [c, colOf(c)]);
  const out = [];
  ws.eachRow((row, r) => {
    if (r === 1) return;
    const obj = { _row: r, _apo: {} };
    let any = false;
    for (const [[, key, type, , sec], col] of map) {
      const raw = col ? row.getCell(col).value : null;
      if (cellText(raw)) any = true;
      const v = col ? fromExcel(type, raw, key) : undefined;
      if (sec === 'a') obj._apo[key] = v; else obj[key] = v;
    }
    if (any) out.push(obj);
  });
  return out;
}

const hoja = (wb, name) => wb.worksheets.find((w) => norm(w.name) === norm(name));

/**
 * Lee el Excel y lo combina con el catálogo actual. Acepta la hoja "Catálogo" (o la primera hoja si
 * trae "Nombre o razón social") y el formato anterior (hojas Partes + Apoderados).
 * Devuelve { parties, created, updated, warnings, renamed, missingIds } — `parties` son solo las nuevas o actualizadas.
 */
export async function xlsxToCatalog(ExcelJS, buffer, current) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const v1 = hoja(wb, 'Partes');
  const tieneNombre = (ws) => { let ok = false; ws?.getRow(1).eachCell((c) => { if (norm(c.value) === 'nombre o razón social') ok = true; }); return ok; };
  const main = v1 || hoja(wb, 'Catálogo') || wb.worksheets.find(tieneNombre);
  if (!main || !tieneNombre(main)) throw new Error('El archivo no tiene la columna "Nombre o razón social". Descarga la plantilla desde la app.');
  const sheetName = main.name;
  const warnings = [];
  const apoV1 = v1 ? hoja(wb, 'Apoderados') : null;
  const accWs = hoja(wb, 'Accionistas');
  const byId = new Map(current.map((p) => [p.id, p]));
  const byKey = new Map(current.map((p) => [partyKey(p), p]));
  const result = [];
  const renamed = []; // [idLocal, idDelExcel]
  let missingIds = 0; // filas capturadas a mano en Excel, sin ID todavía
  let created = 0;
  let updated = 0;
  const mismoNombre = (a, b) => partyKey({ nombre: a }) === partyKey({ nombre: b });
  /** Agrega o actualiza un apoderado por nombre; los demás de la empresa se conservan. */
  const ponerApoderado = (p, data) => {
    if (!data?.nombre) return;
    let a = p.apoderados.find((x) => mismoNombre(x.nombre, data.nombre));
    if (!a) { a = newApoderado(); p.apoderados.push(a); }
    for (const [k, v] of Object.entries(data)) if (!k.startsWith('_') && v !== undefined) a[k] = v;
  };

  for (const row of readSheet(main, v1 ? PARTES_V1 : CATALOGO)) {
    if (!row.nombre) { warnings.push(`${sheetName}, fila ${row._row}: sin nombre, se omitió.`); continue; }
    // El ID viaja a la pantalla y a rutas: solo se acepta el formato que genera la app
    if (row.id && !/^[\w-]{1,64}$/.test(row.id)) {
      warnings.push(`${sheetName}, fila ${row._row}: el ID "${row.id}" no es válido, se asignó uno nuevo.`);
      row.id = '';
    }
    const existing = (row.id && byId.get(row.id)) || byKey.get(partyKey(row));
    const p = existing ? structuredClone(existing) : newParty(row.kind, row.propia);
    // El ID del Excel manda (lo escribió la app en algún equipo): así todos usan el mismo
    if (row.id && p.id !== row.id) {
      if (existing) renamed.push([existing.id, row.id]);
      p.id = row.id;
    }
    if (!row.id) missingIds++;
    for (const [, key, , , sec] of CATALOGO) if (sec === 'p' && key !== 'id' && row[key] !== undefined) p[key] = row[key];
    if (existing) {
      p._prevAcc = p.accionistas;
      if (accWs) p.accionistas = [];
      if (apoV1) { p._prevApo = p.apoderados; p.apoderados = []; }
      if (!result.some((x) => x.id === p.id)) updated++;
    } else created++;
    if (!v1) ponerApoderado(p, row._apo);
    p.updatedAt = Date.now();
    if (result.some((x) => x.id === p.id)) warnings.push(`${sheetName}, fila ${row._row}: "${row.nombre}" está repetida; se juntó con la fila anterior.`);
    // Filas repetidas sin ID (mismo RFC o nombre) deben caer en la misma parte, no crear otra
    byId.set(p.id, p);
    byKey.set(partyKey(p), p);
    result.push(p);
  }
  const final = new Map(result.map((p) => [p.id, p]));
  const findCompany = (ref) => {
    const k1 = partyKey({ rfc: ref });
    const k2 = partyKey({ nombre: ref });
    return [...final.values()].find((p) => partyKey(p) === k1 || partyKey({ nombre: p.nombre }) === k2);
  };
  // Formato anterior: hoja Apoderados (reconstruye la lista, conserva los ID por nombre)
  for (const row of readSheet(apoV1, APODERADOS_V1)) {
    const p = findCompany(row._empresa);
    if (!p) { warnings.push(`Apoderados, fila ${row._row}: no se encontró la empresa "${row._empresa}".`); continue; }
    const prev = p._prevApo?.find((x) => mismoNombre(x.nombre, row.nombre));
    // Lo que no venga en el Excel (p. ej. columnas nuevas en un archivo viejo) se conserva
    const item = { ...newApoderado(), ...(prev || {}) };
    for (const [, key] of APODERADOS_V1) if (!key.startsWith('_') && row[key] !== undefined) item[key] = row[key];
    p.apoderados.push(item);
  }
  for (const row of readSheet(accWs, ACCIONISTAS)) {
    const p = findCompany(row._empresa);
    if (!p) { warnings.push(`Accionistas, fila ${row._row}: no se encontró la empresa "${row._empresa}".`); continue; }
    const prev = p._prevAcc?.find((x) => mismoNombre(x.nombre, row.nombre));
    const item = { ...newAccionista(), ...(prev || {}) };
    for (const [, key] of ACCIONISTAS) if (!key.startsWith('_') && row[key] !== undefined) item[key] = row[key];
    p.accionistas.push(item);
  }
  for (const p of final.values()) { delete p._prevAcc; delete p._prevApo; }
  return { parties: [...final.values()], created, updated, warnings, renamed, missingIds };
}
