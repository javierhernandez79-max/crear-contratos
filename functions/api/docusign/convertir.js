// Convierte un Word a PDF con DocuSign, que respeta el formato del Word (letra, márgenes, encabezados): se crea un
// sobre en borrador sin destinatarios (no se envía a nadie), se baja su documento ya convertido y el borrador se
// manda a la papelera de DocuSign.
import { correoDe, respuesta } from '../../_lib/acceso.js';
import { cuentaDS, faltantesDS, tokenDS, usuarioPara } from '../../_lib/docusign.js';

const MAX = 20 * 1024 * 1024;

const base64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function onRequestPost({ request, env }) {
  const correo = await correoDe(request, env).catch(() => null);
  if (!correo) return respuesta({ message: 'Sesión no válida: vuelve a entrar a la app.' }, 401);
  if (faltantesDS(env).length) return respuesta({ message: 'La conexión de DocuSign del despacho no está configurada.' }, 503);
  const docx = new Uint8Array(await request.arrayBuffer());
  if (!docx.length || docx.length > MAX) return respuesta({ message: 'El Word está vacío o pasa de 20 MB.' }, 400);
  const nombre = (() => { try { return decodeURIComponent(request.headers.get('X-Nombre') || ''); } catch { return ''; } })()
    .replace(/[\\/:*?"<>|]/g, '').slice(0, 150) || 'documento.docx';
  const sub = usuarioPara(env, correo);
  try {
    const c = await cuentaDS(env, sub);
    const url = `${c.baseUri}/restapi/v2.1/accounts/${c.id}`;
    const llamar = async (ruta, { method = 'GET', body, accept = 'application/json' } = {}, forzar = false) => {
      const r = await fetch(`${url}${ruta}`, {
        method,
        headers: { Authorization: `Bearer ${await tokenDS(env, forzar, sub)}`, Accept: accept, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return r.status === 401 && !forzar ? llamar(ruta, { method, body, accept }, true) : r;
    };
    const creado = await llamar('/envelopes', {
      method: 'POST',
      body: {
        status: 'created',
        emailSubject: `Conversión a PDF: ${nombre}`.slice(0, 100),
        documents: [{ documentId: '1', name: nombre.replace(/\.docx$/i, ''), fileExtension: 'docx', documentBase64: base64(docx) }],
      },
    });
    const sobre = await creado.json().catch(() => ({}));
    if (!creado.ok || !sobre.envelopeId) return respuesta({ message: `DocuSign no pudo convertir el Word (${sobre.message || sobre.errorCode || creado.status})` }, 502);
    try {
      const pdf = await llamar(`/envelopes/${sobre.envelopeId}/documents/1`, { accept: 'application/pdf' });
      if (!pdf.ok) return respuesta({ message: `DocuSign no entregó el PDF (${pdf.status})` }, 502);
      return new Response(await pdf.arrayBuffer(), { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' } });
    } finally {
      // El borrador no se necesita más: a la papelera de DocuSign (si falla, solo queda un borrador sin enviar)
      await llamar('/folders/recyclebin', { method: 'PUT', body: { envelopeIds: [sobre.envelopeId] } }).catch(() => {});
    }
  } catch (err) {
    return respuesta({ message: err.message, errorCode: err.code }, err.status || 502);
  }
}
