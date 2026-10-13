// Interruptor de la lectura con IA. Todos ven el estado; solo los correos de IA_ADMIN lo cambian.
import { correoDe, esAdmin, estado, respuesta } from '../_lib/acceso.js';

const faltantes = (env) => [
  !env.ANTHROPIC_API_KEY && 'ANTHROPIC_API_KEY',
  !env.ACCESS_TEAM && 'ACCESS_TEAM',
  !env.IA_ADMIN && 'IA_ADMIN',
  !env.IA_KV && 'IA_KV (espacio KV)',
].filter(Boolean);

export async function onRequestGet({ request, env }) {
  const correo = await correoDe(request, env).catch(() => null);
  const e = await estado(env);
  return respuesta({
    configurada: !faltantes(env).length,
    faltan: esAdmin(correo, env) ? faltantes(env) : undefined,
    activa: e.vigente,
    programada: !!e.activa,
    hasta: e.hasta || '',
    vencida: e.vencida,
    admin: esAdmin(correo, env),
  });
}

export async function onRequestPost({ request, env }) {
  const correo = await correoDe(request, env).catch(() => null);
  if (!esAdmin(correo, env)) return respuesta({ error: 'Solo el administrador puede encender o apagar la lectura con IA.' }, 403);
  if (!env.IA_KV) return respuesta({ error: 'Falta el espacio KV "IA_KV" en Cloudflare.' }, 503);
  let body;
  try { body = await request.json(); } catch { return respuesta({ error: 'Solicitud inválida' }, 400); }
  const hasta = String(body.hasta || '');
  if (hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return respuesta({ error: 'Fecha inválida' }, 400);
  await env.IA_KV.put('estado', JSON.stringify({ activa: !!body.activa, hasta, por: correo, en: new Date().toISOString() }));
  return onRequestGet({ request, env });
}
