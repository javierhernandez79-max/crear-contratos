// Catálogo de partes: empresas del grupo y contrapartes (personas morales y físicas).
// Al vincular una parte a un firmante del contrato se generan sus variables con un prefijo
// (p. ej. {{cliente_rfc}}, {{cliente_declaraciones}}) y se llenan las de la plantilla.
import { uid, slugify } from './model.js';

export const PARTY_KINDS = { pm: 'Persona moral', pf: 'Persona física' };

export function newParty(kind = 'pm', propia = false) {
  const now = Date.now();
  return {
    id: uid(), kind, propia, activa: true,
    nombre: '', rfc: '', domicilio: '', correo: '', telefono: '',
    // Persona moral: escritura constitutiva
    escrituraNumero: '', escrituraFecha: '', notario: '', notariaNumero: '', notariaCiudad: '', folioMercantil: '', folioFecha: '', objetoSocial: '',
    // Persona física
    curp: '', nacionalidad: 'mexicana', sexo: '', estadoCivil: '', ocupacion: '', identificacion: '',
    expediente: '', notas: '',
    apoderados: [], accionistas: [],
    createdAt: now, updatedAt: now,
  };
}

export const newApoderado = () => ({
  id: uid(), nombre: '', cargo: 'Apoderado legal',
  poderNumero: '', poderFecha: '', notario: '', notariaNumero: '', notariaCiudad: '',
  facultades: '', vigente: true,
});

export const newAccionista = () => ({ id: uid(), nombre: '', acciones: '', serie: '' });

export const fmtLongDate = (iso) => {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
};

const val = (v, label) => (String(v ?? '').trim() || `[falta: ${label}]`);

/** "escritura pública número X de fecha Y, otorgada ante la fe de Z, titular de la Notaría Pública número N de C" */
function escrituraText(numero, fecha, notario, notariaNumero, ciudad) {
  return `la escritura pública número ${val(numero, 'número de escritura')} de fecha ${val(fmtLongDate(fecha), 'fecha de escritura')}, ` +
    `otorgada ante la fe de ${val(notario, 'notario')}, titular de la Notaría Pública número ${val(notariaNumero, 'número de notaría')} de ${val(ciudad, 'ciudad de la notaría')}`;
}

export const constitucionText = (p) =>
  `${escrituraText(p.escrituraNumero, p.escrituraFecha, p.notario, p.notariaNumero, p.notariaCiudad)}, ` +
  `inscrita en el Registro Público de Comercio bajo el folio mercantil electrónico número ${val(p.folioMercantil, 'folio mercantil')}`;

export const poderText = (a) => escrituraText(a.poderNumero, a.poderFecha, a.notario, a.notariaNumero, a.notariaCiudad);

/** Párrafo de declaraciones listo para insertar en el contrato. */
export function declaracionesText(p, apoderado) {
  if (p.kind === 'pf') {
    return `Que es una persona física de nacionalidad ${val(p.nacionalidad, 'nacionalidad')}, mayor de edad, ` +
      `con estado civil ${val(p.estadoCivil, 'estado civil')} y ocupación ${val(p.ocupacion, 'ocupación')}, ` +
      `que se identifica con ${val(p.identificacion, 'identificación')}, con Clave Única de Registro de Población ${val(p.curp, 'CURP')} ` +
      `y Registro Federal de Contribuyentes ${val(p.rfc, 'RFC')}. Que señala como domicilio para todos los efectos de este instrumento el ubicado en ${val(p.domicilio, 'domicilio')}.`;
  }
  const rep = apoderado
    ? ` Que su representante, ${val(apoderado.nombre, 'nombre del apoderado')}, cuenta con las facultades suficientes para obligarla en los términos del presente instrumento, ` +
      `según consta en ${poderText(apoderado)}, mismas que a la fecha no le han sido revocadas, modificadas ni limitadas en forma alguna.`
    : ' Que su representante cuenta con las facultades suficientes para obligarla en los términos del presente instrumento. [falta: apoderado]';
  return `Que es una sociedad mercantil legalmente constituida conforme a las leyes de los Estados Unidos Mexicanos, según consta en ${constitucionText(p)}.` +
    rep +
    ` Que su Registro Federal de Contribuyentes es ${val(p.rfc, 'RFC')}. Que señala como domicilio para todos los efectos de este instrumento el ubicado en ${val(p.domicilio, 'domicilio')}.`;
}

/** Campos clave que faltan, para avisar en el catálogo. */
export function partyGaps(p) {
  const req = p.kind === 'pm'
    ? [['nombre', 'Razón social'], ['rfc', 'RFC'], ['domicilio', 'Domicilio'], ['escrituraNumero', 'Escritura'], ['escrituraFecha', 'Fecha de constitución'], ['notario', 'Notario'], ['folioMercantil', 'Folio mercantil']]
    : [['nombre', 'Nombre'], ['rfc', 'RFC'], ['curp', 'CURP'], ['domicilio', 'Domicilio'], ['identificacion', 'Identificación']];
  const gaps = req.filter(([k]) => !String(p[k] ?? '').trim()).map(([, l]) => l);
  if (p.kind === 'pm' && !p.apoderados.some((a) => a.vigente && a.nombre.trim())) gaps.push('Apoderado vigente');
  return gaps;
}

// Variables que genera cada parte vinculada: [sufijo, etiqueta, tipo, valor(p, apoderado)]
const PARTY_VARS = [
  ['nombre', 'Nombre o razón social', 'text', (p) => p.nombre],
  ['rfc', 'RFC', 'text', (p) => p.rfc],
  ['domicilio', 'Domicilio', 'address', (p) => p.domicilio],
  ['correo', 'Correo', 'email', (p) => p.correo],
  ['declaraciones', 'Declaraciones', 'text', (p, a) => declaracionesText(p, a)],
];
const PM_VARS = [
  ['representante', 'Representante legal', 'text', (p, a) => a?.nombre || ''],
  ['cargo_representante', 'Cargo del representante', 'text', (p, a) => a?.cargo || ''],
  ['constitucion', 'Datos de constitución', 'text', (p) => constitucionText(p)],
  ['poder', 'Datos del poder', 'text', (p, a) => (a ? poderText(a) : '')],
  // Datos sueltos para plantillas con redacción propia ("instrumento público número …, del …, pasado ante la fe del …")
  ['escritura_numero', 'Escritura constitutiva núm.', 'text', (p) => p.escrituraNumero],
  ['escritura_fecha', 'Fecha de la escritura constitutiva', 'text', (p) => fmtLongDate(p.escrituraFecha)],
  ['notario', 'Notario de la constitutiva', 'text', (p) => p.notario],
  ['notaria_numero', 'Notaría núm. de la constitutiva', 'text', (p) => p.notariaNumero],
  ['notaria_ciudad', 'Ciudad de la notaría de la constitutiva', 'text', (p) => p.notariaCiudad],
  ['folio', 'Folio mercantil', 'text', (p) => p.folioMercantil],
  ['folio_fecha', 'Fecha de inscripción del folio', 'text', (p) => fmtLongDate(p.folioFecha)],
  ['objeto_social', 'Objeto social', 'text', (p) => p.objetoSocial],
  ['poder_numero', 'Escritura del poder núm.', 'text', (p, a) => a?.poderNumero || ''],
  ['poder_fecha', 'Fecha del poder', 'text', (p, a) => fmtLongDate(a?.poderFecha)],
  ['poder_notario', 'Notario del poder', 'text', (p, a) => a?.notario || ''],
  ['poder_notaria_numero', 'Notaría núm. del poder', 'text', (p, a) => a?.notariaNumero || ''],
  ['poder_notaria_ciudad', 'Ciudad de la notaría del poder', 'text', (p, a) => a?.notariaCiudad || ''],
];
const PF_VARS = [
  ['curp', 'CURP', 'text', (p) => p.curp],
  ['nacionalidad', 'Nacionalidad', 'text', (p) => p.nacionalidad],
  ['sexo', 'Sexo', 'text', (p) => p.sexo],
  ['estado_civil', 'Estado civil', 'text', (p) => p.estadoCivil],
  ['ocupacion', 'Ocupación', 'text', (p) => p.ocupacion],
  ['identificacion', 'Identificación', 'text', (p) => p.identificacion],
];

/** Prefijo de variables para un firmante: el de la plantilla o uno derivado del rol, sin repetir. */
export function signerPrefix(c, sg) {
  if (sg.bind?.prefix) return sg.bind.prefix;
  if (sg.party?.prefix) return sg.party.prefix;
  const base = slugify(sg.role.replace(/^(el|la|los|las)\s+/i, '')) || 'parte';
  const taken = new Set(c.signers.filter((x) => x !== sg).map((x) => x.party?.prefix || x.bind?.prefix));
  let p = base;
  let n = 2;
  while (taken.has(p)) p = `${base}_${n++}`;
  return p;
}

/**
 * Llena el contrato con los datos de la parte para el firmante `sg`.
 * Devuelve la lista de variables escritas.
 */
export function applyParty(c, sg, party, apoderado) {
  const prefix = signerPrefix(c, sg);
  const written = [];
  const set = (key, label, type, value) => {
    if (!c.varDefs.some((d) => d.key === key)) c.varDefs.push({ key, label, type });
    c.variables[key] = value ?? '';
    written.push(key);
  };
  const defs = [...PARTY_VARS, ...(party.kind === 'pm' ? PM_VARS : PF_VARS)];
  for (const [suffix, label, type, fn] of defs) {
    set(`${prefix}_${suffix}`, `${label} (${sg.role})`, type, fn(party, apoderado));
  }
  // Variables propias de la plantilla (p. ej. {{cliente}}, {{domicilio_cliente}})
  for (const [field, key] of Object.entries(sg.bind || {})) {
    if (field === 'prefix') continue;
    const src = defs.find(([s]) => s === field);
    if (!src) continue;
    const def = c.varDefs.find((d) => d.key === key);
    set(key, def?.label || src[1], def?.type || src[2], src[3](party, apoderado));
  }
  // Nombre en el bloque de firma
  const nameVar = sg.bind?.nombre || `${prefix}_nombre`;
  const repVar = sg.bind?.representante || `${prefix}_representante`;
  if (!sg.name.trim() || !sg.name.includes(`{{${nameVar}}}`)) sg.name = `{{${nameVar}}}`;
  if (party.kind === 'pm' && apoderado && !sg.name.includes(`{{${repVar}}}`)) {
    sg.name = `{{${nameVar}}}, representada por {{${repVar}}}`;
  } else if (party.kind === 'pf' || !apoderado) {
    sg.name = sg.name.replace(new RegExp(`,\\s*representada por \\{\\{${repVar}\\}\\}`), '');
  }
  sg.party = { id: party.id, apoderadoId: apoderado?.id || null, prefix };
  return written;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const partyKey = (p) => (p.rfc ? 'RFC:' + norm(p.rfc) : 'N:' + norm(p.nombre));
export const matchesQuery = (p, q) => !q || norm(`${p.nombre} ${p.rfc}`).includes(norm(q));
