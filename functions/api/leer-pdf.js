// Lectura con IA de PDFs escaneados (constancia fiscal, escritura constitutiva, poder).
// El PDF va a la API de Claude y vuelven los datos de la ficha; la app los muestra para revisión
// antes de guardarlos. La llave (ANTHROPIC_API_KEY) es un secreto de Cloudflare: nunca llega al navegador.
import { correoDe, estado, respuesta } from '../_lib/acceso.js';
import { pedirJSON } from '../_lib/claude.js';

const MAX_PDF = 20 * 1024 * 1024; // bytes del PDF (la API acepta 32 MB por solicitud, ya en base64)

const CAMPOS = ['nombre', 'rfc', 'curp', 'domicilio', 'correo', 'escrituraNumero', 'escrituraFecha', 'notario', 'notariaNumero', 'notariaCiudad',
  'folioMercantil', 'folioFecha', 'folioLugar', 'objetoSocial', 'poderNumero', 'poderFecha', 'facultades',
  'claveElector', 'vigencia', 'sexo'];

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tipo', 'kind', 'empresa', 'datos'],
  properties: {
    tipo: { type: 'string', enum: ['csf', 'acta', 'poder', 'rpp', 'ine', 'otro'] },
    kind: { type: 'string', enum: ['pm', 'pf', ''] },
    empresa: { type: 'string' },
    datos: {
      type: 'object',
      additionalProperties: false,
      required: CAMPOS,
      properties: Object.fromEntries(CAMPOS.map((k) => [k, { type: 'string' }])),
    },
  },
};

const INSTRUCCIONES = `Lees documentos mexicanos escaneados para llenar la ficha de una empresa o persona en un catálogo de un despacho legal.
Clasifica el documento y extrae SOLO lo que se lee en él; si un dato no aparece o no se lee con seguridad, déjalo como "" (no inventes ni completes).

tipo: "csf" = Constancia de Situación Fiscal o Cédula de Identificación Fiscal del SAT; "acta" = escritura constitutiva de una sociedad; "poder" = escritura en la que una sociedad otorga poderes; "rpp" = boleta o constancia de inscripción en el Registro Público de Comercio (folio mercantil); "ine" = credencial para votar del INE (o del IFE); "otro" = cualquier otra cosa.
kind: "pm" persona moral, "pf" persona física ("" si no aplica).
empresa: denominación completa de la sociedad que otorga el poder (en "poder"), que se constituye (en "acta") o que se inscribe (en "rpp"); "" en otro caso.

Formato de cada dato (en "datos"):
- Fechas (escrituraFecha, folioFecha, poderFecha): AAAA-MM-DD, aunque el documento las escriba con letra.
- csf: nombre = razón social con el régimen abreviado al final ("ACME SERVICIOS S.A. DE C.V."; S.A.P.I. DE C.V., S. DE R.L. DE C.V., S.C., A.C., etc.) o, si es persona física, nombre(s) y apellidos; rfc y curp en mayúsculas; domicilio = "CALLE NO. 123 INT. 4, COL. COLONIA, C.P. 01234, MUNICIPIO, ENTIDAD" (omite partes vacías y el tipo de vialidad "CALLE"); correo en minúsculas.
- acta: nombre = denominación sin el tipo de sociedad; escrituraNumero = número de la escritura o póliza como en el documento ("12,345"); notario = título y nombre ("Licenciado Juan Pérez López"); notariaNumero = solo dígitos; notariaCiudad = ciudad o entidad de la notaría ("la Ciudad de México", "Monterrey, Nuevo León"); folioMercantil, folioFecha y folioLugar = datos de la inscripción en el Registro Público de Comercio, si aparecen; objetoSocial = resumen fiel del objeto social en uno o dos párrafos.
- rpp: nombre = denominación de la sociedad sin el tipo de sociedad; folioMercantil = número de folio mercantil electrónico tal como aparece (p. ej. "N-2019012345" o "12345*1"); folioFecha = fecha de inscripción o de registro; folioLugar = ciudad o entidad de la oficina registral ("Ciudad de México", "Querétaro, Querétaro").
- ine: nombre = nombre(s) y apellidos como aparecen en la credencial, en el orden nombre(s), primer apellido, segundo apellido; curp; claveElector = clave de elector (18 caracteres); vigencia = año final de la vigencia (4 dígitos, p. ej. "2031"); sexo = "masculino" o "femenino".
- poder: nombre = nombre completo del apoderado (si hay varios, el primero); poderNumero, poderFecha, notario, notariaNumero, notariaCiudad = de la escritura del poder; facultades = lista en minúsculas separada por comas con las que se otorgan, de entre: pleitos y cobranzas, actos de administración, actos de dominio, títulos de crédito, materia laboral.
Los campos que no correspondan al tipo van como "".`;

export async function onRequestPost({ request, env }) {
  const correo = await correoDe(request, env).catch(() => null);
  if (!correo) return respuesta({ error: 'Sesión no válida: vuelve a entrar a la app.' }, 401);
  if (!env.ANTHROPIC_API_KEY) return respuesta({ error: 'La lectura con IA no está configurada (falta la llave en Cloudflare).' }, 503);
  if (!(await estado(env)).vigente) return respuesta({ error: 'La lectura con IA está apagada.', apagada: true }, 403);

  let body;
  try { body = await request.json(); } catch { return respuesta({ error: 'Solicitud inválida' }, 400); }
  const pdf = String(body.pdf || '');
  if (!pdf || pdf.length * 0.75 > MAX_PDF) return respuesta({ error: 'El PDF está vacío o pasa de 20 MB.' }, 413);

  const r = await pedirJSON(env, {
    system: INSTRUCCIONES,
    schema: ESQUEMA,
    queLee: 'el PDF',
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
      { type: 'text', text: `Archivo: ${String(body.nombre || 'documento.pdf').slice(0, 200)}. Extrae los datos.` },
    ],
  });
  if (r.error) return respuesta({ error: r.error }, r.status);
  const { out, uso } = r;
  const datos = Object.fromEntries(Object.entries(out.datos || {}).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([k, v]) => CAMPOS.includes(k) && v));
  console.log('leer-pdf', correo, out.tipo, uso?.input_tokens, uso?.output_tokens);
  return respuesta({ tipo: out.tipo, kind: out.kind || '', empresa: String(out.empresa || '').trim(), datos, uso });
}
