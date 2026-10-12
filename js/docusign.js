// Cliente mínimo de la API de firma de DocuSign, sin servidor: el navegador habla directo con DocuSign
// (CORS). Se conecta con "Authorization Code Grant" + PKCE (app pública, sin secreto), como recomienda
// DocuSign; el token dura 8 horas y se renueva solo con el refresh token. Se acepta también el regreso de
// "Implicit Grant" (#access_token=…) por si la app de DocuSign quedó configurada así.
// La configuración y el token se guardan en IndexedDB (store "meta") de cada equipo.
import * as db from './db.js';
import { DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_ENV } from './config.js';

const AUTH = { demo: 'https://account-d.docusign.com', prod: 'https://account.docusign.com' };
export const ENVS = { demo: 'Pruebas (demo)', prod: 'Producción' };

export class DocuSignError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code || '';
  }
}

let cfg = null; // { id, key, env, token, expiresAt, user: {name, email}, account: {id, name, baseUri} }

export async function loadConfig() {
  cfg = (await db.get('meta', 'docusign')) || { id: 'docusign' };
  cfg.key ||= DOCUSIGN_INTEGRATION_KEY;
  cfg.env ||= DOCUSIGN_ENV || 'demo';
  return cfg;
}
export const config = () => cfg;
/** Hay cuenta enlazada (aunque el token haya vencido). */
export const isLinked = () => !!cfg?.account;
/** El token sigue vigente. */
export const isConnected = () => !!cfg?.account && (!!cfg.refreshToken || (!!cfg.token && Date.now() < (cfg.expiresAt || 0)));
async function save() { await db.put('meta', structuredClone(cfg)); }

export async function setOptions({ key, env }) {
  if (key !== undefined) cfg.key = key.trim();
  if (env !== undefined && env !== cfg.env) {
    // Otra plataforma: la sesión anterior no sirve
    cfg.env = env;
    Object.assign(cfg, { token: null, refreshToken: null, expiresAt: 0, account: null, user: null });
  }
  await save();
}

/** La URI de regreso debe registrarse tal cual en la app de DocuSign. */
export const redirectUri = () => location.origin + location.pathname;

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// El "state" de DocuSign empieza con "ds." para no confundir su regreso (?code=…) con el de Dropbox
const DS_STATE = 'ds.';

export async function startAuth() {
  if (!cfg.key) throw new DocuSignError('Falta el Integration Key de DocuSign.');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = DS_STATE + b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem('ds-auth', JSON.stringify({ state, verifier, hash: location.hash }));
  const q = new URLSearchParams({
    response_type: 'code', scope: 'signature cors', client_id: cfg.key, redirect_uri: redirectUri(), state,
    code_challenge: challenge, code_challenge_method: 'S256',
  });
  location.assign(`${AUTH[cfg.env]}/oauth/auth?${q}`);
}

async function tokenRequest(params) {
  let res;
  try {
    res = await fetch(`${AUTH[cfg.env]}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cfg.key, ...params }),
    });
  } catch {
    throw new DocuSignError(`DocuSign no respondió desde el navegador. Revisa que en la app de DocuSign el origen ${location.origin} esté en "CORS configuration".`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new DocuSignError(data.error_description || data.error || `DocuSign rechazó la conexión (${res.status})`, { status: res.status, code: data.error });
  return data;
}

function setToken(tok) {
  cfg.token = tok.access_token;
  cfg.expiresAt = Date.now() + (Number(tok.expires_in) || 28800) * 1000 - 60000;
  if (tok.refresh_token) cfg.refreshToken = tok.refresh_token;
}

/** Token vigente: si venció, se renueva con el refresh token (sin volver a entrar). */
async function ensureToken(force = false) {
  if (!force && cfg.token && Date.now() < cfg.expiresAt) return;
  if (!cfg.refreshToken) {
    cfg.token = null;
    throw new DocuSignError('La sesión de DocuSign venció. Conéctate de nuevo en Ajustes.', { status: 401 });
  }
  try {
    setToken(await tokenRequest({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken }));
    await save();
  } catch (err) {
    if (err.status === 400 || err.status === 401) {
      Object.assign(cfg, { token: null, refreshToken: null });
      await save();
      throw new DocuSignError('La sesión de DocuSign venció. Conéctate de nuevo en Ajustes.', { status: 401 });
    }
    throw err;
  }
}

/** Si la página viene de regreso de DocuSign (?code=… o #access_token=…), guarda el token. Devuelve true si conectó. */
export async function handleRedirect() {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.slice(1));
  const q = (search.get('state') || '').startsWith(DS_STATE) ? search
    : /(^|&)(access_token|error)=/.test(location.hash.slice(1)) ? hash : null;
  if (!q) return false;
  const saved = JSON.parse(sessionStorage.getItem('ds-auth') || 'null');
  sessionStorage.removeItem('ds-auth');
  history.replaceState(null, '', redirectUri() + (saved?.hash || '#/ajustes'));
  if (q.has('error') || !saved || q.get('state') !== saved.state) {
    throw new DocuSignError(q.get('error_description') || q.get('error_message') || 'Se canceló la conexión con DocuSign.');
  }
  if (q.has('code')) {
    setToken(await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), code_verifier: saved.verifier, redirect_uri: redirectUri() }));
  } else {
    setToken({ access_token: q.get('access_token'), expires_in: q.get('expires_in') });
    cfg.refreshToken = null;
  }
  const info = await call(`${AUTH[cfg.env]}/oauth/userinfo`, { raw: false, absolute: true, sinCuenta: true });
  const acc = (info.accounts || []).find((a) => a.is_default) || info.accounts?.[0];
  if (!acc) throw new DocuSignError('Tu usuario de DocuSign no tiene una cuenta para enviar documentos.');
  cfg.user = { name: info.name, email: info.email };
  cfg.account = { id: acc.account_id, name: acc.account_name, baseUri: acc.base_uri };
  await save();
  return true;
}

export async function disconnect() {
  Object.assign(cfg, { token: null, expiresAt: 0, account: null, user: null });
  await save();
}

async function call(url, { method = 'GET', body, raw = false, absolute = false, sinCuenta = false, reintento = false } = {}) {
  if (!sinCuenta) {
    if (!cfg.account) throw new DocuSignError('Conecta DocuSign en Ajustes.', { status: 401 });
    await ensureToken();
  }
  const full = absolute ? url : `${cfg.account.baseUri}/restapi/v2.1/accounts/${cfg.account.id}${url}`;
  const res = await fetch(full, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), Accept: raw ? 'application/pdf' : 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    // Token revocado o vencido antes de tiempo: se renueva una vez y se reintenta
    if (!reintento && !sinCuenta && cfg.refreshToken) {
      await ensureToken(true);
      return call(url, { method, body, raw, absolute, sinCuenta, reintento: true });
    }
    cfg.token = null;
    await save();
    throw new DocuSignError('La sesión de DocuSign venció. Conéctate de nuevo en Ajustes.', { status: 401 });
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new DocuSignError(data.message || `Error de DocuSign (${res.status})`, { status: res.status, code: data.errorCode });
  }
  return raw ? res.blob() : res.json();
}

const toBase64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Marca invisible que se escribe en el PDF donde firma cada destinatario. */
export const anchorOf = (n) => `~dsf${n}~`;

/**
 * Crea y envía un sobre con un PDF o un Word (`pdf`, tipo según `fileName`). `recipients` = [{ name, email, anchor }]: todos firman a la vez.
 * Devuelve { envelopeId, status }.
 */
export async function sendEnvelope({ subject, message, pdf, fileName, recipients }) {
  const documentBase64 = await toBase64(pdf);
  const signers = recipients.map((r, i) => ({
    recipientId: String(i + 1),
    routingOrder: '1',
    name: r.name,
    email: r.email,
    // La firma queda arriba de la línea de firma (la marca está 5 mm sobre la línea); DocuSign añade su propio sello de tiempo
    tabs: { signHereTabs: [{ anchorString: r.anchor, anchorUnits: 'pixels', anchorXOffset: '0', anchorYOffset: '-20', anchorIgnoreIfNotPresent: 'false' }] },
  }));
  return call('/envelopes', {
    method: 'POST',
    body: {
      emailSubject: subject.slice(0, 100),
      emailBlurb: message || '',
      documents: [{ documentId: '1', name: fileName, fileExtension: fileName.split('.').pop() || 'pdf', documentBase64 }],
      recipients: { signers },
      status: 'sent',
    },
  });
}

/** Estado del sobre y de cada firmante. */
export async function envelopeStatus(id) {
  const [env, rec] = await Promise.all([call(`/envelopes/${id}`), call(`/envelopes/${id}/recipients`)]);
  return {
    status: env.status,
    completedAt: env.completedDateTime ? Date.parse(env.completedDateTime) : null,
    voidedReason: env.voidedReason || '',
    signers: (rec.signers || []).map((s) => ({ name: s.name, email: s.email, status: s.status, signedAt: s.signedDateTime ? Date.parse(s.signedDateTime) : null, declinedReason: s.declinedReason || '' })),
  };
}

/** PDF firmado y certificado de finalización de DocuSign. */
export async function signedFiles(id) {
  const [signed, certificate] = await Promise.all([
    call(`/envelopes/${id}/documents/combined`, { raw: true }),
    call(`/envelopes/${id}/documents/certificate`, { raw: true }),
  ]);
  return { signed, certificate };
}

export async function voidEnvelope(id, reason) {
  return call(`/envelopes/${id}`, { method: 'PUT', body: { status: 'voided', voidedReason: reason.slice(0, 200) } });
}

export const STATUS = {
  created: 'Borrador en DocuSign', sent: 'Enviado', delivered: 'Abierto por los firmantes', signed: 'Firmado',
  completed: 'Firmado por todos', declined: 'Rechazado', voided: 'Cancelado', autoresponded: 'Correo rebotado',
};
export const statusLabel = (s) => STATUS[s] || s || '—';
