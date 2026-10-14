// Estado de la conexión global de DocuSign. Sin las variables, la app usa la conexión por usuario.
import { correoDe, esAdmin, respuesta } from '../../_lib/acceso.js';
import { consentUrl, cuentaDS, dsEnv, faltantesDS, usuarioDespacho, usuarioPara } from '../../_lib/docusign.js';

export async function onRequestGet({ request, env }) {
  const correo = await correoDe(request, env).catch(() => null);
  if (!correo) return respuesta({ error: 'Sesión no válida: vuelve a entrar a la app.' }, 401);
  const admin = esAdmin(correo, env);
  const faltan = faltantesDS(env);
  if (faltan.length === 3) return respuesta({ configurada: false });
  if (faltan.length) return respuesta({ configurada: false, faltan: admin ? faltan : undefined });
  // Cada usuario de la app envía con su remitente (DOCUSIGN_REMITENTES) o con el del despacho
  const sub = usuarioPara(env, correo);
  const propio = sub !== usuarioDespacho(env);
  try {
    const c = await cuentaDS(env, sub);
    return respuesta({ configurada: true, conectada: true, env: dsEnv(env), cuenta: { id: c.id, name: c.name }, remitente: c.usuario, remitenteId: sub, propio, admin });
  } catch (err) {
    return respuesta({
      configurada: true, conectada: false, env: dsEnv(env), admin, propio, error: err.message, codigo: err.code,
      // Para diagnosticar desde una captura: con qué correo se entró y qué usuario de DocuSign se intentó
      correo, intentado: sub,
      // El enlace lo debe abrir el usuario de DocuSign que envía: el administrador (remitente del despacho) o quien tiene
      // remitente propio. Al remitente propio se le ofrece con cualquier rechazo: un usuario nuevo que aún no autoriza
      // a veces recibe invalid_request en lugar de consent_required
      consentimiento: (err.code === 'consent_required' && (admin || propio)) || (propio && err.code !== 'llave_invalida')
        ? consentUrl(env, new URL(request.url).origin) : undefined,
    });
  }
}
