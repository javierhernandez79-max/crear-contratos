// Cliente mínimo de la API de Dropbox, sin servidor: OAuth con PKCE desde el navegador.
// La configuración y los tokens se guardan en IndexedDB (store "meta") de cada equipo.
import * as db from './db.js';
import { DROPBOX_APP_KEY, DROPBOX_FOLDER } from './config.js';

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

export class DropboxError extends Error {
  constructor(message, { status, summary } = {}) {
    super(message);
    this.status = status;
    this.summary = summary || '';
  }
  get notFound() { return /not_found/.test(this.summary); }
  get conflict() { return /conflict/.test(this.summary); }
}

let cfg = null; // { id, appKey, folder, refreshToken, accessToken, expiresAt, account, pathRoot }

export async function loadConfig() {
  cfg = (await db.get('meta', 'dropbox')) || { id: 'dropbox' };
  cfg.appKey ||= DROPBOX_APP_KEY;
  cfg.folder ||= DROPBOX_FOLDER;
  return cfg;
}
export const config = () => cfg;
export const isConnected = () => !!cfg?.refreshToken;
async function save() { await db.put('meta', structuredClone(cfg)); }

export async function setOptions({ appKey, folder }) {
  if (appKey !== undefined) cfg.appKey = appKey.trim();
  if (folder !== undefined) cfg.folder = normalizePath(folder) || DROPBOX_FOLDER;
  await save();
}

export const normalizePath = (p) => {
  const t = String(p || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  return t && !t.startsWith('/') ? `/${t}` : t;
};
export const joinPath = (...parts) => normalizePath(parts.filter(Boolean).join('/'));

/** La URI de regreso debe registrarse tal cual en la app de Dropbox (sin #). */
export const redirectUri = () => location.origin + location.pathname;

// ---------- OAuth (PKCE) ----------
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function startAuth() {
  if (!cfg.appKey) throw new DropboxError('Falta la App key de Dropbox.');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem('dbx-pkce', JSON.stringify({ verifier, state, hash: location.hash }));
  const q = new URLSearchParams({
    client_id: cfg.appKey, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
    redirect_uri: redirectUri(), token_access_type: 'offline', state,
  });
  location.assign(`${AUTH_URL}?${q}`);
}

/** Si la página viene de regreso de Dropbox, canjea el código. Devuelve 'ok' | 'error' | null. */
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  const saved = JSON.parse(sessionStorage.getItem('dbx-pkce') || 'null');
  sessionStorage.removeItem('dbx-pkce');
  history.replaceState(null, '', redirectUri() + (saved?.hash || '#/ajustes'));
  if (q.has('error') || !saved || q.get('state') !== saved.state) {
    throw new DropboxError(q.get('error_description') || 'Se canceló la conexión con Dropbox.');
  }
  const tok = await tokenRequest({
    code: q.get('code'), grant_type: 'authorization_code', client_id: cfg.appKey,
    code_verifier: saved.verifier, redirect_uri: redirectUri(),
  });
  cfg.refreshToken = tok.refresh_token;
  setAccess(tok);
  await loadAccount();
  await save();
  return 'ok';
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams(params) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new DropboxError(data.error_description || 'Dropbox rechazó la autorización.', { status: res.status, summary: data.error });
  return data;
}

function setAccess(tok) {
  cfg.accessToken = tok.access_token;
  cfg.expiresAt = Date.now() + (tok.expires_in - 60) * 1000;
}

async function accessToken(force = false) {
  if (!cfg.refreshToken) throw new DropboxError('No hay conexión con Dropbox.');
  if (force || !cfg.accessToken || Date.now() > cfg.expiresAt) {
    try {
      setAccess(await tokenRequest({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken, client_id: cfg.appKey }));
    } catch (err) {
      if (err.status === 400 || err.status === 401) { await disconnect(); throw new DropboxError('La sesión de Dropbox expiró. Conéctate de nuevo.', { status: 401 }); }
      throw err;
    }
    await save();
  }
  return cfg.accessToken;
}

export async function disconnect() {
  const token = cfg.accessToken;
  Object.assign(cfg, { refreshToken: null, accessToken: null, expiresAt: 0, account: null, pathRoot: null });
  await save();
  if (token) fetch(`${API}/auth/token/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
}

// ---------- Llamadas ----------
// Dropbox-API-Arg va en un encabezado HTTP: los caracteres no ASCII (acentos, ñ) deben escaparse.
const headerJson = (obj) => JSON.stringify(obj).replace(/[\u007f-￿]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));

async function call(url, { args, body, headers = {}, argsInHeader = false, raw = false } = {}, retry = true) {
  const h = { Authorization: `Bearer ${await accessToken()}`, ...headers };
  if (cfg.pathRoot) h['Dropbox-API-Path-Root'] = JSON.stringify({ '.tag': 'root', root: cfg.pathRoot });
  let reqBody = body;
  if (argsInHeader) h['Dropbox-API-Arg'] = headerJson(args);
  else if (args !== undefined) { h['Content-Type'] = 'application/json'; reqBody = JSON.stringify(args); }
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: h, body: reqBody });
  } catch {
    throw new DropboxError('Sin conexión con Dropbox.', { status: 0 });
  }
  if (res.status === 401 && retry) { await accessToken(true); return call(url, { args, body, headers, argsInHeader, raw }, false); }
  if (res.status === 429 && retry) {
    await new Promise((r) => setTimeout(r, (Number(res.headers.get('Retry-After')) || 2) * 1000));
    return call(url, { args, body, headers, argsInHeader, raw }, false);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new DropboxError(data.error_summary || `Error de Dropbox (${res.status})`, { status: res.status, summary: data.error_summary });
  }
  if (raw) return res;
  return res.json();
}

async function loadAccount() {
  cfg.pathRoot = null;
  const acc = await call(`${API}/users/get_current_account`);
  cfg.account = { name: acc.name?.display_name || acc.email, email: acc.email };
  // Cuentas de equipo ("team space"): la raíz del equipo es distinta de la carpeta personal del miembro.
  // Sin el encabezado Dropbox-API-Path-Root, "/Carpeta" se crearía dentro de la carpeta personal.
  const ri = acc.root_info || {};
  cfg.rootInfo = { tag: ri['.tag'] || null, root: ri.root_namespace_id || null, home: ri.home_namespace_id || null, homePath: ri.home_path || null };
  if (ri.root_namespace_id && ri.root_namespace_id !== ri.home_namespace_id) cfg.pathRoot = String(ri.root_namespace_id);
}

/** Conexiones hechas con versiones anteriores no guardaban la raíz del equipo: se vuelve a leer la cuenta. */
export async function ensureAccount() {
  if (!isConnected() || cfg.rootInfo) return;
  await loadAccount();
  await save();
}

/** Texto para Ajustes: en qué espacio de Dropbox se trabaja. */
export const rootLabel = () => (cfg?.pathRoot ? 'espacio del equipo' : cfg?.rootInfo ? 'carpeta personal' : '');

export async function listFolder(path) {
  const entries = [];
  let res;
  try {
    res = await call(`${API}/files/list_folder`, { args: { path: normalizePath(path), recursive: false, include_deleted: false } });
  } catch (err) {
    if (err.notFound) return [];
    throw err;
  }
  entries.push(...res.entries);
  while (res.has_more) {
    res = await call(`${API}/files/list_folder/continue`, { args: { cursor: res.cursor } });
    entries.push(...res.entries);
  }
  return entries;
}

export async function getMetadata(path) {
  try {
    return await call(`${API}/files/get_metadata`, { args: { path: normalizePath(path) } });
  } catch (err) {
    if (err.notFound) return null;
    throw err;
  }
}

export async function download(path) {
  const res = await call(`${CONTENT}/files/download`, { args: { path: normalizePath(path) }, argsInHeader: true, raw: true });
  const meta = JSON.parse(res.headers.get('Dropbox-API-Result') || '{}');
  return { data: await res.arrayBuffer(), meta };
}

/** `rev` → solo sobrescribe si nadie lo cambió (si no, lanza conflicto). Sin `rev` → archivo nuevo. */
export function upload(path, data, { rev, overwrite = false, autorename = false } = {}) {
  const mode = rev ? { '.tag': 'update', update: rev } : overwrite ? { '.tag': 'overwrite' } : { '.tag': 'add' };
  return call(`${CONTENT}/files/upload`, {
    args: { path: normalizePath(path), mode, autorename, mute: true, strict_conflict: !!rev },
    argsInHeader: true, body: data, headers: { 'Content-Type': 'application/octet-stream' },
  });
}

export async function remove(path) {
  try {
    await call(`${API}/files/delete_v2`, { args: { path: normalizePath(path) } });
  } catch (err) {
    if (!err.notFound) throw err;
  }
}

export async function createFolder(path) {
  try {
    await call(`${API}/files/create_folder_v2`, { args: { path: normalizePath(path), autorename: false } });
  } catch (err) {
    if (!err.conflict) throw err;
  }
}

export async function temporaryLink(path) {
  return (await call(`${API}/files/get_temporary_link`, { args: { path: normalizePath(path) } })).link;
}
