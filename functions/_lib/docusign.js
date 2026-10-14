// Conexión global de DocuSign (JWT Grant): el servidor entra a DocuSign con una sola cuenta del despacho
// y la app nunca ve la llave. Variables de Cloudflare:
//   DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID (API Username del remitente), DOCUSIGN_PRIVATE_KEY (Secret, RSA),
//   DOCUSIGN_ENV ("demo" o "prod", por omisión demo) y, opcionales, DOCUSIGN_ACCOUNT_ID y DOCUSIGN_REMITENTES.
// DOCUSIGN_REMITENTES: remitente por usuario de la app, "correo=UserID" separados por coma o renglón
// (p. ej. "ana@despacho.com=1111…, luis@despacho.com=2222…"). Quien no esté en la lista envía con DOCUSIGN_USER_ID.

const AUTH = { demo: 'account-d.docusign.com', prod: 'account.docusign.com' };
export const dsEnv = (env) => (String(env.DOCUSIGN_ENV || '').trim().toLowerCase() === 'prod' ? 'prod' : 'demo');
// Los IDs de DocuSign son GUID: si se pegaron con texto alrededor ("correo: …", paréntesis, espacios), se toma solo el GUID
export const guid = (v) => (String(v || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [String(v || '').trim()])[0];
const ik = (env) => guid(env.DOCUSIGN_INTEGRATION_KEY);
const usuario = (env) => guid(env.DOCUSIGN_USER_ID);

/** correo de acceso (minúsculas) → User ID de DocuSign, según DOCUSIGN_REMITENTES. */
function remitentes(env) {
  const m = new Map();
  for (const parte of String(env.DOCUSIGN_REMITENTES || '').split(/[\n,;]+/)) {
    const x = parte.match(/([^\s=:]+@[^\s=:]+)\s*[=:]\s*(.+)/);
    if (x) m.set(x[1].toLowerCase(), guid(x[2]));
  }
  return m;
}
/** Usuario de DocuSign con el que envía quien entró a la app (su remitente o el del despacho). */
export const usuarioPara = (env, correo) => remitentes(env).get(String(correo || '').toLowerCase()) || usuario(env);
/** Remitentes válidos: el del despacho y los de DOCUSIGN_REMITENTES. */
export const usuariosDS = (env) => new Set([usuario(env), ...remitentes(env).values()]);
export const usuarioDespacho = usuario;

export class DSError extends Error {
  constructor(message, { status = 502, code = '' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const faltantesDS = (env) => [
  !env.DOCUSIGN_INTEGRATION_KEY && 'DOCUSIGN_INTEGRATION_KEY',
  !env.DOCUSIGN_USER_ID && 'DOCUSIGN_USER_ID',
  !env.DOCUSIGN_PRIVATE_KEY && 'DOCUSIGN_PRIVATE_KEY',
].filter(Boolean);

/** URL para que el remitente autorice una sola vez que la app envíe a su nombre. */
export const consentUrl = (env, origin) => `https://${AUTH[dsEnv(env)]}/oauth/auth?${new URLSearchParams({
  response_type: 'code', scope: 'signature impersonation', client_id: ik(env),
  redirect_uri: `${origin}/api/docusign/consentido`,
})}`;

// ---- Llave privada: DocuSign la entrega en PKCS#1 ("BEGIN RSA PRIVATE KEY"); el navegador/Workers piden PKCS#8 ----
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const derLen = (n) => (n < 128 ? [n] : n < 256 ? [0x81, n] : n < 65536 ? [0x82, n >> 8, n & 255] : [0x83, n >> 16, (n >> 8) & 255, n & 255]);
const tlv = (tag, bytes) => new Uint8Array([tag, ...derLen(bytes.length), ...bytes]);
// AlgorithmIdentifier rsaEncryption (1.2.840.113549.1.1.1) + NULL
const RSA_ALG = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];

export function pemAPkcs8(pem) {
  const texto = String(pem || '').replace(/\\n/g, '\n');
  const pkcs1 = /BEGIN RSA PRIVATE KEY/.test(texto);
  const der = b64(texto.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
  if (!pkcs1) return der;
  return tlv(0x30, [...[0x02, 0x01, 0x00], ...RSA_ALG, ...tlv(0x04, der)]);
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlTxt = (s) => b64url(new TextEncoder().encode(s));

// Un token (y su cuenta) por remitente
const cache = new Map();

async function firmarJWT(env, sub) {
  const e = dsEnv(env);
  const now = Math.floor(Date.now() / 1000);
  const datos = `${b64urlTxt(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlTxt(JSON.stringify({
    iss: ik(env), sub, aud: AUTH[e], iat: now, exp: now + 3600, scope: 'signature impersonation',
  }))}`;
  let key;
  try {
    key = await crypto.subtle.importKey('pkcs8', pemAPkcs8(env.DOCUSIGN_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    throw new DSError('La llave privada de DocuSign (DOCUSIGN_PRIVATE_KEY) no es válida: pégala completa, con las líneas BEGIN y END.', { status: 503, code: 'llave_invalida' });
  }
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(datos));
  return `${datos}.${b64url(firma)}`;
}

/** Token de acceso (dura 1 hora; se guarda en memoria y se pide otro al vencer). */
export async function tokenDS(env, forzar = false, sub = usuario(env)) {
  const clave = `${dsEnv(env)}|${ik(env)}|${sub}`;
  const c = cache.get(clave);
  if (!forzar && c?.token && Date.now() < c.exp) return c.token;
  const r = await fetch(`https://${AUTH[dsEnv(env)]}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await firmarJWT(env, sub) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (d.error === 'consent_required') throw new DSError('Falta autorizar la conexión en DocuSign (una sola vez).', { status: 409, code: 'consent_required' });
    throw new DSError(`DocuSign rechazó la conexión: ${d.error_description || d.error || r.status}`, { status: 502, code: d.error || '' });
  }
  cache.set(clave, { ...(c || {}), token: d.access_token, exp: Date.now() + ((Number(d.expires_in) || 3600) - 120) * 1000 });
  return d.access_token;
}

/** Cuenta de DocuSign del remitente: { id, name, baseUri, usuario: { name, email } }. */
export async function cuentaDS(env, sub = usuario(env)) {
  const token = await tokenDS(env, false, sub);
  const c = cache.get(`${dsEnv(env)}|${ik(env)}|${sub}`);
  if (c?.cuenta) return c.cuenta;
  const r = await fetch(`https://${AUTH[dsEnv(env)]}/oauth/userinfo`, { headers: { Authorization: `Bearer ${token}` } });
  const info = await r.json().catch(() => ({}));
  if (!r.ok) throw new DSError('No se pudo leer la cuenta de DocuSign.', { status: 502 });
  const accs = info.accounts || [];
  const cuentaId = env.DOCUSIGN_ACCOUNT_ID && guid(env.DOCUSIGN_ACCOUNT_ID);
  const acc = (cuentaId && accs.find((a) => a.account_id === cuentaId)) || accs.find((a) => a.is_default) || accs[0];
  if (!acc) throw new DSError('El usuario de DocuSign no tiene una cuenta para enviar documentos.', { status: 502 });
  c.cuenta = { id: acc.account_id, name: acc.account_name, baseUri: acc.base_uri, usuario: { name: info.name, email: info.email } };
  return c.cuenta;
}
