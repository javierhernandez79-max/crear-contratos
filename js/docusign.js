// Cliente mínimo de la API de firma de DocuSign, sin servidor: el navegador habla directo con DocuSign
// (CORS) con un token de "Implicit Grant" que dura 8 horas; al vencer se vuelve a conectar.
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
export const isConnected = () => !!cfg?.token && Date.now() < (cfg.expiresAt || 0);
async function save() { await db.put('meta', structuredClone(cfg)); }

export async function setOptions({ key, env }) {
  if (key !== undefined) cfg.key = key.trim();
  if (env !== undefined && env !== cfg.env) {
    // Otra plataforma: la sesión anterior no sirve
    cfg.env = env;
    Object.assign(cfg, { token: null, expiresAt: 0, account: null, user: null });
  }
  await save();
}

/** La URI de regreso debe registrarse tal cual en la app de DocuSign. */
export const redirectUri = () => location.origin + location.pathname;

export function startAuth() {
  if (!cfg.key) throw new DocuSignError('Falta el Integration Key de DocuSign.');
  const state = crypto.randomUUID();
  sessionStorage.setItem('ds-auth', JSON.stringify({ state, hash: location.hash }));
  const q = new URLSearchParams({ response_type: 'token', scope: 'signature cors', client_id: cfg.key, redirect_uri: redirectUri(), state });
  location.assign(`${AUTH[cfg.env]}/oauth/auth?${q}`);
}

/** Si la página viene de regreso de DocuSign (#access_token=…), guarda el token. Devuelve true si conectó. */
export async function handleRedirect() {
  const h = location.hash.slice(1);
  if (!/(^|&)(access_token|error)=/.test(h)) return false;
  const q = new URLSearchParams(h);
  const saved = JSON.parse(sessionStorage.getItem('ds-auth') || 'null');
  sessionStorage.removeItem('ds-auth');
  history.replaceState(null, '', redirectUri() + (saved?.hash || '#/ajustes'));
  if (q.has('error') || !saved || q.get('state') !== saved.state) {
    throw new DocuSignError(q.get('error_description') || 'Se canceló la conexión con DocuSign.');
  }
  cfg.token = q.get('access_token');
  cfg.expiresAt = Date.now() + (Number(q.get('expires_in')) || 28800) * 1000 - 60000;
  const info = await call(`${AUTH[cfg.env]}/oauth/userinfo`, { raw: false, absolute: true });
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

async function call(url, { method = 'GET', body, raw = false, absolute = false } = {}) {
  if (!isConnected()) throw new DocuSignError('La sesión de DocuSign venció (dura 8 horas). Conéctate de nuevo en Ajustes.', { status: 401 });
  const full = absolute ? url : `${cfg.account.baseUri}/restapi/v2.1/accounts/${cfg.account.id}${url}`;
  const res = await fetch(full, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), Accept: raw ? 'application/pdf' : 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
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
 * Crea y envía un sobre. `recipients` = [{ name, email, anchor }]: todos firman a la vez.
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
      documents: [{ documentId: '1', name: fileName, fileExtension: 'pdf', documentBase64 }],
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
