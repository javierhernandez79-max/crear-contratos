// Identidad de quien llama, tomada del token de Cloudflare Access (no del navegador): así el servidor
// sabe quién es y la llave de la IA no se puede usar desde fuera de la app protegida.
// Variables de Cloudflare: ACCESS_TEAM (p. ej. "miequipo.cloudflareaccess.com") y, opcional, ACCESS_AUD.

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const json = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

let certs = { team: '', keys: [], at: 0 };
async function llaves(team, forzar = false) {
  if (!forzar && certs.team === team && Date.now() - certs.at < 3600e3) return certs.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('No se pudieron leer las llaves de Cloudflare Access');
  certs = { team, keys: (await r.json()).keys || [], at: Date.now() };
  return certs.keys;
}

function token(request) {
  const h = request.headers.get('Cf-Access-Jwt-Assertion');
  if (h) return h;
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? m[1] : '';
}

/** Correo (en minúsculas) de quien llama, o null si no trae un token válido de Access. */
export async function correoDe(request, env) {
  const team = String(env.ACCESS_TEAM || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const jwt = token(request);
  if (!team || !jwt) return null;
  const [h, p, s] = jwt.split('.');
  if (!s) return null;
  let header, payload;
  try { header = json(h); payload = json(p); } catch { return null; }
  if (header.alg !== 'RS256') return null;
  let jwk = (await llaves(team)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await llaves(team, true)).find((k) => k.kid === header.kid); // Access rota sus llaves
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const ahora = Date.now() / 1000;
  if (!(payload.exp > ahora) || payload.iss !== `https://${team}`) return null;
  if (env.ACCESS_AUD) {
    const aud = [].concat(payload.aud || []);
    if (!aud.includes(env.ACCESS_AUD)) return null;
  }
  return String(payload.email || '').toLowerCase() || null;
}

/** Correos que pueden encender y apagar la IA (IA_ADMIN, separados por coma). */
export const esAdmin = (correo, env) => !!correo && String(env.IA_ADMIN || '').toLowerCase().split(/[,\s]+/).filter(Boolean).includes(correo);

export const respuesta = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

/** Estado del interruptor guardado en KV: { activa, hasta (AAAA-MM-DD o ''), por, en }. */
export async function estado(env) {
  const e = (env.IA_KV && (await env.IA_KV.get('estado', 'json'))) || { activa: false, hasta: '' };
  // "hasta" incluye ese día completo, en hora de la Ciudad de México
  const hoy = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
  const vencida = !!e.hasta && hoy > e.hasta;
  return { ...e, vigente: !!e.activa && !vencida, vencida };
}
