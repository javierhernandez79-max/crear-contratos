// Detección con IA de los datos variables de un Word que se sube como plantilla. Llega solo el texto de los
// párrafos (numerados); la IA propone qué textos son datos (nombres, RFC, fechas, montos…), de qué parte son y
// dónde firma cada parte. La app muestra la propuesta para revisión y pone las marcas {{dato}} en el Word.
import { correoDe, estado, respuesta } from '../_lib/acceso.js';
import { pedirJSON } from '../_lib/claude.js';

const MAX_TEXTO = 300_000; // caracteres de todos los párrafos
const TIPOS = ['text', 'date', 'money', 'number', 'address', 'email'];

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titulo', 'partes', 'campos', 'firmas'],
  properties: {
    titulo: { type: 'string' },
    partes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['prefijo', 'rol', 'kind'],
        properties: { prefijo: { type: 'string' }, rol: { type: 'string' }, kind: { type: 'string', enum: ['pm', 'pf'] } },
      },
    },
    campos: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['texto', 'clave', 'etiqueta', 'tipo', 'parrafos'],
        properties: {
          texto: { type: 'string' },
          clave: { type: 'string' },
          etiqueta: { type: 'string' },
          tipo: { type: 'string', enum: TIPOS },
          parrafos: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
    firmas: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['prefijo', 'parrafo'],
        properties: { prefijo: { type: 'string' }, parrafo: { type: 'integer' } },
      },
    },
  },
};

const INSTRUCCIONES = `Preparas plantillas de contratos mexicanos para un despacho legal. Recibes el texto de un contrato en Word, párrafo por párrafo, cada uno con su número entre corchetes. El contrato puede venir lleno con los datos de un caso real o con espacios en blanco (____, [   ], XXXX, "…") donde van los datos.
Tu tarea: señalar los textos que cambian de un contrato a otro, para que la app los sustituya por campos. No reescribes nada.

titulo: el título del contrato tal como aparece (p. ej. "CONTRATO DE ARRENDAMIENTO"), o "" si no hay.

partes: cada parte que firma. prefijo = rol en minúsculas, sin artículo, sin acentos y con guion bajo (prestador, cliente, arrendador, arrendatario, comodante, patron, trabajador, vendedor, comprador…). rol = como lo nombra el contrato con artículo (El “Arrendador”). kind = "pm" si es una sociedad o persona moral, "pf" si es persona física.

campos: cada dato variable, UNA vez por valor distinto aunque se repita.
- texto: cópialo EXACTAMENTE como aparece (mismas mayúsculas, acentos, signos y espacios), completo pero sin texto fijo alrededor. Nombres completos de sociedades con su tipo ("ACME SERVICIOS, S.A. DE C.V."); fechas completas ("1 de octubre de 2026"); un monto con su cifra y su letra juntos si aparecen juntos ("$15,000.00 (QUINCE MIL PESOS 00/100 M.N.)"); domicilios completos.
- Si el dato es un espacio en blanco, texto = ese espacio tal cual (p. ej. "__________" o "[NOMBRE]").
- parrafos: números de TODOS los párrafos donde aparece ese texto como dato.
- clave: datos de una parte = "<prefijo>_<dato>" con uno de estos datos: nombre (razón social o nombre de la persona), representante (nombre de quien la representa), cargo_representante, identificacion_representante, rfc, curp, domicilio, correo, nacionalidad, estado_civil, ocupacion, escritura_numero, escritura_fecha, notario, notaria_numero, notaria_ciudad (de la escritura constitutiva), folio, folio_fecha, folio_lugar (inscripción en el Registro Público de Comercio), objeto_social, poder_numero, poder_fecha, poder_notario, poder_notaria_numero, poder_notaria_ciudad (de la escritura del poder del representante). Lugar y fecha de firma: ciudad_firma y fecha_firma. Cualquier otro dato: clave corta en español, minúsculas, sin acentos y con guion bajo (monto_renta, fecha_inicio, plazo_meses, descripcion_inmueble, uso_inmueble, deposito).
- etiqueta: nombre corto del dato para un formulario ("Monto de la renta mensual").
- tipo: date (fechas), money (montos de dinero), number (cantidades que no son dinero), address (domicilios), email (correos), text (lo demás).
NO son campos: el texto legal fijo, los títulos de las cláusulas, los artículos de ley, los nombres de los roles ("EL ARRENDADOR"), ni las líneas para firmar (renglones de guiones bajos del bloque de firmas al final).

firmas: para cada parte, el número del párrafo del bloque de firmas (al final del contrato) que la identifica: normalmente el renglón con su nombre o el de su representante, debajo de la línea para firmar.`;

export async function onRequestPost({ request, env }) {
  const correo = await correoDe(request, env).catch(() => null);
  if (!correo) return respuesta({ error: 'Sesión no válida: vuelve a entrar a la app.' }, 401);
  if (!env.ANTHROPIC_API_KEY) return respuesta({ error: 'La lectura con IA no está configurada (falta la llave en Cloudflare).' }, 503);
  if (!(await estado(env)).vigente) return respuesta({ error: 'La lectura con IA está apagada.', apagada: true }, 403);

  let body;
  try { body = await request.json(); } catch { return respuesta({ error: 'Solicitud inválida' }, 400); }
  const parrafos = Array.isArray(body.parrafos) ? body.parrafos.map((p) => String(p ?? '')) : [];
  if (!parrafos.some((p) => p.trim())) return respuesta({ error: 'El Word no tiene texto.' }, 400);
  const texto = parrafos.map((p, i) => (p.trim() ? `[${i}] ${p}` : '')).filter(Boolean).join('\n');
  if (texto.length > MAX_TEXTO) return respuesta({ error: 'El Word es demasiado largo para leerlo con IA.' }, 413);

  const r = await pedirJSON(env, {
    system: INSTRUCCIONES,
    schema: ESQUEMA,
    maxTokens: 16000,
    effort: 'medium',
    queLee: 'el Word',
    content: [{ type: 'text', text: `Archivo: ${String(body.nombre || 'contrato.docx').slice(0, 200)}\n\n${texto}` }],
  });
  if (r.error) return respuesta({ error: r.error }, r.status);
  const { out, uso } = r;
  const n = parrafos.length;
  const limpio = (s) => String(s ?? '').trim();
  const clave = (s) => limpio(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const partes = (out.partes || []).map((p) => ({ prefijo: clave(p.prefijo), rol: limpio(p.rol), kind: p.kind === 'pf' ? 'pf' : 'pm' })).filter((p) => p.prefijo);
  const campos = (out.campos || [])
    .map((c) => ({
      texto: String(c.texto ?? ''), clave: clave(c.clave), etiqueta: limpio(c.etiqueta), tipo: TIPOS.includes(c.tipo) ? c.tipo : 'text',
      parrafos: [...new Set((c.parrafos || []).filter((i) => Number.isInteger(i) && i >= 0 && i < n))],
    }))
    .filter((c) => c.texto.trim().length >= 2 && c.clave && c.parrafos.length);
  const firmas = (out.firmas || []).map((f) => ({ prefijo: clave(f.prefijo), parrafo: f.parrafo })).filter((f) => f.prefijo && Number.isInteger(f.parrafo) && f.parrafo >= 0 && f.parrafo < n);
  console.log('plantilla-ia', correo, campos.length, uso?.input_tokens, uso?.output_tokens);
  return respuesta({ titulo: limpio(out.titulo), partes, campos, firmas, uso });
}
