// Estado de la conexión global de DocuSign. Sin las variables, la app usa la conexión por usuario.
import { correoDe, esAdmin, respuesta } from '../../_lib/acceso.js';
import { consentUrl, cuentaDS, dsEnv, faltantesDS } from '../../_lib/docusign.js';

export async function onRequestGet({ request, env }) {
  const correo = await correoDe(request, env).catch(() => null);
  if (!correo) return respuesta({ error: 'Sesión no válida: vuelve a entrar a la app.' }, 401);
  const admin = esAdmin(correo, env);
  const faltan = faltantesDS(env);
  if (faltan.length === 3) return respuesta({ configurada: false });
  if (faltan.length) return respuesta({ configurada: false, faltan: admin ? faltan : undefined });
  try {
    const c = await cuentaDS(env);
    return respuesta({ configurada: true, conectada: true, env: dsEnv(env), cuenta: { id: c.id, name: c.name }, remitente: c.usuario, admin });
  } catch (err) {
    return respuesta({
      configurada: true, conectada: false, env: dsEnv(env), admin, error: err.message, codigo: err.code,
      // Solo el administrador ve el enlace: lo debe abrir el usuario de DocuSign que envía
      consentimiento: admin && err.code === 'consent_required' ? consentUrl(env, new URL(request.url).origin) : undefined,
    });
  }
}
