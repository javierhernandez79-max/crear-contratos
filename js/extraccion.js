// Extracción de datos de PDFs del expediente (con texto; los escaneados se capturan a mano):
// Constancia de Situación Fiscal, escritura constitutiva y escritura de poder.
// Todo es heurístico: lo encontrado se muestra para revisión y nada se aplica sin confirmarlo.

let pdfjsReady;
/** pdf.js se carga solo al usarse (vendor/pdfjs, ~1.8 MB). */
function loadPdfjs() {
  pdfjsReady ??= import('../vendor/pdfjs/pdf.min.mjs').then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    return m;
  }).catch((err) => { pdfjsReady = null; throw new Error('No se pudo cargar el lector de PDF', { cause: err }); });
  return pdfjsReady;
}

/** Texto del PDF, una línea por renglón. Vacío si es escaneado. */
export async function pdfText(data) {
  const pdfjs = await loadPdfjs();
  let doc;
  try {
    // Copia: pdf.js se queda con el búfer que recibe (lo vacía), y el original se usa después (p. ej. para la IA)
    doc = await pdfjs.getDocument({ data: new Uint8Array(data).slice(), isEvalSupported: false }).promise;
  } catch (err) {
    throw new Error(err?.name === 'PasswordException' ? 'El PDF está protegido con contraseña.' : 'El archivo no es un PDF válido.', { cause: err });
  }
  const pages = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 60); i++) {
      const { items } = await (await doc.getPage(i)).getTextContent();
      pages.push(items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
    }
  } finally {
    doc.destroy();
  }
  return pages.join('\n');
}

/** Pocas letras = PDF escaneado (imagen sin capa de texto). */
export const sinTexto = (text) => (String(text).match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length < 80;

// Misma longitud que el original (cada carácter da uno), para recortar el texto original con los
// índices encontrados en la versión normalizada
const plano = (s) => [...s].map((ch) => { const u = ch.normalize('NFD')[0].toUpperCase(); return u.length === 1 ? u : ch; }).join('');
/** Texto original del grupo k de una coincidencia (regex con bandera d) hecha sobre `plano(o)`. */
const grupo = (o, m, k = 1) => (m?.indices?.[k] ? limpio(o.slice(...m.indices[k])) : '');
const espacios = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const limpio = (s) => espacios(s).replace(/^[\s:.,;-]+|[\s:.,;-]+$/g, '');

export const TIPOS = { csf: 'Constancia de Situación Fiscal', acta: 'Escritura constitutiva', poder: 'Escritura de poder' };

export function detectarTipo(text) {
  const t = plano(espacios(text));
  const acta = /CONSTITUTIVA|CONSTITUCION DE (LA |UNA )?SOCIEDAD|CONSTITUIR (UNA )?SOCIEDAD|SE CONSTITUYE/.test(t);
  // Una escritura suele traer agregada la cédula fiscal: si es larga y es constitutiva, manda la escritura
  if (acta && t.length > 8000) return 'acta';
  if (/CONSTANCIA DE SITUACION FISCAL|CEDULA DE IDENTIFICACION FISCAL/.test(t)) return 'csf';
  if (acta) return 'acta';
  if (/\bPODER(ES)?\b/.test(t) && /OTORGA|CONFIERE|OTORGAMIENTO/.test(t)) return 'poder';
  return null;
}

// ---------- Constancia de Situación Fiscal ----------
const ETIQUETAS_CSF = [
  ['rfc', 'RFC'], ['curp', 'CURP'], ['nombres', 'Nombre (s)'], ['nombres', 'Nombre(s)'], ['ap1', 'Primer Apellido'], ['ap2', 'Segundo Apellido'],
  ['razon', 'Denominación/Razón Social'], ['razon', 'Denominación o Razón Social'], ['regimen', 'Régimen Capital'], ['comercial', 'Nombre Comercial'],
  [null, 'Fecha inicio de operaciones'], [null, 'Estatus en el padrón'], [null, 'Fecha de último cambio de estado'], [null, 'idCIF'],
  ['cp', 'Código Postal'], ['tipoVialidad', 'Tipo de Vialidad'], ['vialidad', 'Nombre de Vialidad'], ['ext', 'Número Exterior'], ['int', 'Número Interior'],
  ['colonia', 'Nombre de la Colonia'], ['localidad', 'Nombre de la Localidad'], ['municipio', 'Nombre del Municipio o Demarcación Territorial'],
  ['entidad', 'Nombre de la Entidad Federativa'], [null, 'Entre Calle'], [null, 'Y Calle'], ['correo', 'Correo Electrónico'], [null, 'Tel. Fijo Lada'],
  [null, 'Tel. Fijo Número'], [null, 'Tel. Móvil Lada'], [null, 'Tel. Móvil Número'], [null, 'Estado de la vialidad'], [null, 'Características Domicilio'],
  [null, 'Actividades Económicas'], [null, 'Regímenes'], [null, 'Obligaciones'], [null, 'Datos del domicilio registrado'], [null, 'Datos de Ubicación'],
  [null, 'Datos de Identificación del Contribuyente'], [null, 'Lugar y Fecha de Emisión'], [null, 'Página'],
];

const REGIMENES = [
  [/^SOCIEDAD ANONIMA PROMOTORA DE INVERSION DE CAPITAL VARIABLE$/, 'S.A.P.I. DE C.V.'],
  [/^SOCIEDAD ANONIMA PROMOTORA DE INVERSION$/, 'S.A.P.I.'],
  [/^SOCIEDAD ANONIMA BURSATIL DE CAPITAL VARIABLE$/, 'S.A.B. DE C.V.'],
  [/^SOCIEDAD ANONIMA DE CAPITAL VARIABLE$/, 'S.A. DE C.V.'],
  [/^SOCIEDAD ANONIMA$/, 'S.A.'],
  [/^SOCIEDAD DE RESPONSABILIDAD LIMITADA DE CAPITAL VARIABLE$/, 'S. DE R.L. DE C.V.'],
  [/^SOCIEDAD DE RESPONSABILIDAD LIMITADA$/, 'S. DE R.L.'],
  [/^SOCIEDAD POR ACCIONES SIMPLIFICADA( DE CAPITAL VARIABLE)?$/, 'S.A.S.'],
  [/^SOCIEDAD CIVIL$/, 'S.C.'],
  [/^ASOCIACION CIVIL$/, 'A.C.'],
];

/** "SOCIEDAD ANONIMA DE CAPITAL VARIABLE" → "S.A. DE C.V." (si no se reconoce, se deja completo). */
export function abreviarRegimen(r) {
  const t = plano(espacios(r));
  return REGIMENES.find(([re]) => re.test(t))?.[1] || espacios(r);
}

/** Recorta el valor de cada etiqueta hasta la siguiente etiqueta conocida. */
function porEtiquetas(text, etiquetas) {
  const orig = espacios(text);
  const t = plano(orig);
  const hits = [];
  for (const [campo, etq] of etiquetas) {
    const e = plano(etq);
    let i = t.indexOf(e);
    while (i >= 0) {
      // Debe ser la etiqueta completa ("Nombre (s)" no dentro de "Nombre Comercial"), seguida de ":"
      const fin = i + e.length;
      const ok = (i === 0 || !/[A-Z0-9]/.test(t[i - 1])) && /^\s*:/.test(t.slice(fin, fin + 3));
      if (ok) hits.push({ campo, i, fin: fin + t.slice(fin).indexOf(':') + 1 });
      i = t.indexOf(e, fin);
    }
  }
  // Etiquetas que son prefijo de otras ("Nombre (s)" / "Nombre de Vialidad"): gana la más larga en la misma posición
  hits.sort((a, b) => a.i - b.i || b.fin - a.fin);
  const unicos = hits.filter((h, k) => !hits.slice(0, k).some((o) => o.i <= h.i && h.i < o.fin));
  const out = {};
  unicos.forEach((h, k) => {
    if (!h.campo || out[h.campo]) return; // el primero (la cédula de la primera hoja) manda
    const v = limpio(orig.slice(h.fin, unicos[k + 1]?.i ?? h.fin + 200));
    if (v) out[h.campo] = v;
  });
  return out;
}

const RFC_RE = /\b([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/;
const CURP_RE = /\b([A-Z]{4}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d)\b/;

export function extraerCSF(text) {
  const v = porEtiquetas(text, ETIQUETAS_CSF);
  const t = plano(espacios(text));
  const rfc = (plano(v.rfc || '').match(RFC_RE) || t.match(RFC_RE) || [])[1] || '';
  const kind = rfc.length === 12 ? 'pm' : rfc.length === 13 ? 'pf' : (v.razon ? 'pm' : v.nombres ? 'pf' : null);
  const out = { kind, rfc };
  if (kind === 'pm' && v.razon) {
    const reg = v.regimen ? abreviarRegimen(v.regimen) : '';
    out.nombre = reg && !plano(v.razon).endsWith(plano(reg).replace(/\s+/g, ' ')) ? `${v.razon} ${reg}` : v.razon;
  } else if (v.nombres) {
    out.nombre = espacios([v.nombres, v.ap1, v.ap2].filter(Boolean).join(' '));
  }
  if (kind === 'pf') out.curp = (plano(v.curp || '').match(CURP_RE) || t.match(CURP_RE) || [])[1] || '';
  const tipo = (v.tipoVialidad || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const calle = espacios([/^(CALLE|NINGUNO)$/i.test(tipo) ? '' : tipo, v.vialidad].join(' '));
  const num = [v.ext && `NO. ${v.ext}`, v.int && `INT. ${v.int}`].filter(Boolean).join(' ');
  const dom = [
    espacios(`${calle} ${num}`),
    v.colonia && `COL. ${v.colonia}`,
    v.cp && `C.P. ${(v.cp.match(/\d{5}/) || [v.cp])[0]}`,
    v.municipio || v.localidad,
    v.entidad,
  ].filter(Boolean);
  if (calle || v.cp) out.domicilio = dom.join(', ');
  if (v.correo && /@/.test(v.correo)) out.correo = v.correo.split(/\s/)[0].toLowerCase();
  return out;
}

// ---------- Números y fechas escritos con letra ----------
const UNIDADES = { CERO: 0, UN: 1, UNO: 1, UNA: 1, PRIMERO: 1, DOS: 2, TRES: 3, CUATRO: 4, CINCO: 5, SEIS: 6, SIETE: 7, OCHO: 8, NUEVE: 9,
  DIEZ: 10, ONCE: 11, DOCE: 12, TRECE: 13, CATORCE: 14, QUINCE: 15, DIECISEIS: 16, DIECISIETE: 17, DIECIOCHO: 18, DIECINUEVE: 19,
  VEINTE: 20, VEINTIUN: 21, VEINTIUNO: 21, VEINTIUNA: 21, VEINTIDOS: 22, VEINTITRES: 23, VEINTICUATRO: 24, VEINTICINCO: 25, VEINTISEIS: 26,
  VEINTISIETE: 27, VEINTIOCHO: 28, VEINTINUEVE: 29, TREINTA: 30, CUARENTA: 40, CINCUENTA: 50, SESENTA: 60, SETENTA: 70, OCHENTA: 80, NOVENTA: 90,
  CIEN: 100, CIENTO: 100, DOSCIENTOS: 200, TRESCIENTOS: 300, CUATROCIENTOS: 400, QUINIENTOS: 500, SEISCIENTOS: 600, SETECIENTOS: 700,
  OCHOCIENTOS: 800, NOVECIENTOS: 900 };
const PALABRA_NUM = `(?:${Object.keys(UNIDADES).join('|')}|MIL|Y)`;

/** "DOS MIL DIEZ" → 2010; "DOCE MIL TRESCIENTOS CUARENTA Y CINCO" → 12345. null si no es un número. */
export function letrasANumero(s) {
  const ws = plano(espacios(s)).split(' ').filter(Boolean);
  if (!ws.length) return null;
  let total = 0, grupo = 0, alguno = false;
  for (const w of ws) {
    if (w === 'Y') continue;
    if (w === 'MIL') { total += (grupo || 1) * 1000; grupo = 0; alguno = true; continue; }
    if (!(w in UNIDADES)) return null;
    grupo += UNIDADES[w];
    alguno = true;
  }
  return alguno ? total + grupo : null;
}

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const MES_RE = `(${MESES.join('|')}|SETIEMBRE)`;
const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && y <= 2100 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
    ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
};
const mesNum = (m) => (m === 'SETIEMBRE' ? 9 : MESES.indexOf(m) + 1);

/** Primera fecha del texto (ya normalizado con `plano`), con número o con letra. Devuelve {fecha, i}. */
function primeraFecha(t) {
  const cands = [];
  const num = new RegExp(`\\b(\\d{1,2})\\s+(?:DE\\s+)?${MES_RE}\\s+(?:DE(?:L)?\\s+)?(?:ANO\\s+)?(\\d{4})\\b`, 'g');
  for (const m of t.matchAll(num)) cands.push({ fecha: iso(+m[3], mesNum(m[2]), +m[1]), i: m.index });
  const W = `${PALABRA_NUM}(?:\\s+${PALABRA_NUM})*`;
  const letra = new RegExp(`(?:A LOS|EL DIA|EL)\\s+(${W})\\s+(?:\\(\\d{1,2}\\)\\s+)?(?:DIAS?\\s+)?DEL?\\s+(?:MES\\s+DE\\s+)?${MES_RE}\\s+(?:DEL?\\s+)?(?:ANO\\s+)?(${W}|\\d{4})`, 'g');
  for (const m of t.matchAll(letra)) {
    const d = letrasANumero(m[1]);
    const y = /^\d+$/.test(m[3]) ? +m[3] : letrasANumero(m[3]);
    if (d && y) cands.push({ fecha: iso(y, mesNum(m[2]), d), i: m.index });
  }
  return cands.filter((c) => c.fecha).sort((a, b) => a.i - b.i)[0] || null;
}

// ---------- Escrituras (constitutiva y poder) ----------
const NUM_TXT = `(\\d[\\d.,]*|${PALABRA_NUM}(?:\\s+${PALABRA_NUM})*)`;
const numero = (s) => {
  if (!s) return '';
  if (/^\d/.test(s)) return s.replace(/[.,]$/, '');
  const n = letrasANumero(s);
  return n == null ? '' : n.toLocaleString('es-MX');
};

/** Datos comunes de una escritura: número, fecha, notario, notaría y ciudad. `t` normalizado; `o` el original con el mismo largo. */
function datosEscritura(o, t) {
  const out = {};
  const esc = t.match(new RegExp(`(?:ESCRITURA|INSTRUMENTO|POLIZA)(?:\\s+PUBLICA)?\\s+(?:NUMERO|NUM\\.?|NO\\.?|N[O°º]\\.?)\\s*${NUM_TXT}`));
  if (esc) out.numero = numero(esc[1]);
  const f = primeraFecha(t);
  if (f) out.fecha = f.fecha;
  const nt = t.match(new RegExp(`NOTARI[AO]\\s+(?:PUBLIC[AO]\\s+)?(?:NUMERO|NUM\\.?|NO\\.?|N[O°º]\\.?)\\s*${NUM_TXT}`));
  if (nt) {
    out.notariaNumero = numero(nt[1]).replace(/\D/g, '');
    // Ciudad: lo que sigue a la notaría ("… número 5 de la Ciudad de Querétaro, …")
    const resto = nt.index + nt[0].length;
    const c = t.slice(resto, resto + 160).match(/^[\s,]*(?:\([^)]*\)\s*)?(?:DEL?|EN)\s+(?:LA\s+|ESTA\s+)?((?:CIUDAD|MUNICIPIO|DISTRITO|ESTADO)?[^,.;(]{3,70})/d);
    if (c) out.notariaCiudad = grupo(o.slice(resto), c);
  }
  // Notario: título + nombre antes de "titular / notario / adscrito"
  const n = t.match(/\b(LICENCIAD[OA]|LIC\.|DOCTOR[A]?|DR[A]?\.|MAESTR[OA]|MTR[OA]\.)\s+([A-Z][A-Z.]*(?:\s+[A-Z][A-Z.]*){1,6}?)\s*,?\s+(?:TITULAR|NOTARIO|NOTARIA|ADSCRIT[OA]|SUPLENTE|EN SU CARACTER)/d);
  if (n) out.notario = limpio(o.slice(n.indices[1][0], n.indices[2][1]));
  return out;
}

export function extraerActa(text) {
  const o = espacios(text);
  const t = plano(o);
  const d = datosEscritura(o, t);
  const out = {
    escrituraNumero: d.numero, escrituraFecha: d.fecha, notario: d.notario,
    notariaNumero: d.notariaNumero, notariaCiudad: d.notariaCiudad,
  };
  const folio = t.match(/FOLIO\s+(?:MERCANTIL\s+)?(?:ELECTRONICO\s+)?(?:NUMERO|NUM\.?|NO\.?|N[O°º]\.?)?\s*:?\s*([N0-9][-0-9*]{3,})/);
  if (folio) {
    out.folioMercantil = folio[1].replace(/[-*]$/, '');
    const f = primeraFecha(t.slice(folio.index, folio.index + 400));
    if (f) out.folioFecha = f.fecha;
  }
  const den = t.match(/DENOMINA(?:CION|RA)(?:\s+SOCIAL)?(?:\s+DE\s+LA\s+SOCIEDAD)?\s+(?:SERA|ES|DE)?\s*:?\s*["“']([^"”']{3,120})["”']/d);
  if (den) out.nombre = grupo(o, den);
  // Objeto social: el texto de la cláusula hasta el siguiente artículo/cláusula
  const obj = t.match(/OBJETO(?:\s+SOCIAL)?(?:\s+DE\s+LA\s+SOCIEDAD)?\s+(?:SERA|ES|CONSISTE EN)\s*:?\s*/);
  if (obj) {
    const ini = obj.index + obj[0].length;
    const sig = t.slice(ini).search(/\b(ARTICULO|CLAUSULA)\s+[A-Z0-9]+[.\s-]/);
    const fin = ini + Math.min(sig > 0 ? sig : 1500, 1500);
    out.objetoSocial = limpio(o.slice(ini, fin));
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

export function extraerPoder(text) {
  const o = espacios(text);
  const t = plano(o);
  const d = datosEscritura(o, t);
  const out = { poderNumero: d.numero, poderFecha: d.fecha, notario: d.notario, notariaNumero: d.notariaNumero, notariaCiudad: d.notariaCiudad };
  const a = t.match(/(?:A|EN) FAVOR DE(?:L)?\s+(?:LOS\s+|LAS\s+|LA\s+)?(?:SENOR(?:ES|A|AS)?\s+|C\.\s*|CIUDADAN[OA]\s+|LICENCIAD[OA]\s+|LIC\.\s*|INGENIER[OA]\s+|ING\.\s*|CONTADOR(?:A)? PUBLIC[OA]\s+|C\.P\.\s*)*([A-Z]+(?:\s+(?!Y\b|PARA\b|QUIEN\b|QUIENES\b|CON\b|EN\b|A\b|EL\b|LA\b|LOS\b|DE\b|DEL\b)[A-Z]+){1,5})/d);
  if (a) out.nombre = grupo(o, a);
  const fac = [['pleitos y cobranzas', /PLEITOS Y COBRANZAS/], ['actos de administración', /ACTOS DE ADMINISTRACION/], ['actos de dominio', /ACTOS DE DOMINIO/],
    ['títulos de crédito', /TITULOS DE CREDITO/], ['materia laboral', /MATERIA LABORAL|ADMINISTRACION LABORAL/]];
  const f = fac.filter(([, re]) => re.test(t)).map(([l]) => l);
  if (f.length) out.facultades = f.join(', ');
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

/** Lo leído del texto no sirve (falta el dato que identifica el documento): conviene intentar con IA. */
export function lecturaPobre(tipo, data) {
  if (tipo === 'csf') return !data.rfc;
  if (tipo === 'acta') return !data.escrituraNumero && !data.nombre;
  if (tipo === 'poder') return !data.nombre;
  return true;
}

export function extraer(tipo, text) {
  return tipo === 'csf' ? extraerCSF(text) : tipo === 'acta' ? extraerActa(text) : tipo === 'poder' ? extraerPoder(text) : {};
}
