// La app llama aquí en lugar de a DocuSign: el servidor agrega el token de la cuenta del despacho.
// Solo se permiten las llamadas que usa la app (crear, consultar y cancelar sobres, y bajar sus documentos).
import { correoDe, respuesta } from '../../../_lib/acceso.js';
import { cuentaDS, faltantesDS, guid, tokenDS, usuarioDespacho, usuarioPara, usuariosDS } from '../../../_lib/docusign.js';

const PERMITIDAS = [
  ['POST', /^\/envelopes$/],
  ['GET', /^\/envelopes\/[A-Za-z0-9-]{8,64}$/],
  ['PUT', /^\/envelopes\/[A-Za-z0-9-]{8,64}$/],
  ['GET', /^\/envelopes\/[A-Za-z0-9-]{8,64}\/recipients$/],
  ['GET', /^\/envelopes\/[A-Za-z0-9-]{8,64}\/documents\/(combined|certificate)$/],
];

export async function onRequest({ request, env, params }) {
  const correo = await correoDe(request, env).catch(() => null);
  if (!correo) return respuesta({ message: 'Sesión no válida: vuelve a entrar a la app.' }, 401);
  if (faltantesDS(env).length) return respuesta({ message: 'La conexión de DocuSign del despacho no está configurada.' }, 503);
  const ruta = `/${[].concat(params.path || []).join('/')}`;
  if (!PERMITIDAS.some(([m, re]) => m === request.method && re.test(ruta))) return respuesta({ message: 'Llamada no permitida' }, 403);
  const body = request.method === 'GET' ? undefined : await request.text();
  // Un sobre nuevo sale con el remitente de quien lo envía. Consultar o cancelar uno existente se hace como su
  // remitente (lo manda la app; solo uno de los configurados); sin dato, el del despacho (sobres anteriores).
  const pedido = guid(request.headers.get('X-DS-Remitente') || '');
  const sub = request.method === 'POST' ? usuarioPara(env, correo)
    : usuariosDS(env).has(pedido) ? pedido : usuarioDespacho(env);
  try {
    const c = await cuentaDS(env, sub);
    const pedir = async (forzar) => fetch(`${c.baseUri}/restapi/v2.1/accounts/${c.id}${ruta}`, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${await tokenDS(env, forzar, sub)}`,
        Accept: request.headers.get('Accept') || 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    });
    let r = await pedir(false);
    if (r.status === 401) r = await pedir(true); // token revocado antes de tiempo
    if (request.method !== 'GET') console.log('docusign', correo, request.method, ruta, r.status);
    return new Response(r.body, {
      status: r.status,
      headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return respuesta({ message: err.message, errorCode: err.code }, err.status || 502);
  }
}
