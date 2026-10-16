// Dropbox simulado en memoria, compartido por varios contextos de navegador.
export function createMockDropbox() {
  const files = new Map(); // lower path -> { path, name, rev, data: Buffer, mtime }
  const folders = new Set(['']);
  let revN = 1;
  const log = [];
  const opts = { delay: 0 };
  const lower = (p) => p.toLowerCase().replace(/\/$/, '');
  const parent = (p) => p.slice(0, p.lastIndexOf('/'));
  const addFolders = (p) => { let d = parent(p); while (d) { folders.add(lower(d)); d = parent(d); } };
  const meta = (f) => ({ '.tag': 'file', name: f.name, path_display: f.path, path_lower: lower(f.path), rev: f.rev, size: f.data.length, server_modified: f.mtime, id: 'id:' + f.path });
  const put = (path, data) => {
    const f = { path, name: path.split('/').pop(), rev: `r${revN++}`, data: Buffer.from(data), mtime: new Date().toISOString() };
    files.set(lower(path), f);
    addFolders(path);
    return f;
  };
  const err409 = (summary) => ({ status: 409, json: { error_summary: summary } });

  function rpc(endpoint, args) {
    switch (endpoint) {
      case 'users/get_current_account': return null; // se resuelve por usuario
      case 'auth/token/revoke': return {};
      case 'files/list_folder': {
        const base = lower(args.path);
        if (base && !folders.has(base) && !files.has(base)) return err409('path/not_found/..');
        const out = [];
        for (const f of files.values()) if (lower(parent(f.path)) === base) out.push(meta(f));
        for (const d of folders) if (d && parent(d) === base) out.push({ '.tag': 'folder', name: d.split('/').pop(), path_display: realFolder(d), path_lower: d });
        return { entries: out, has_more: false, cursor: 'c' };
      }
      case 'files/get_metadata': {
        const f = files.get(lower(args.path));
        if (f) return meta(f);
        if (folders.has(lower(args.path))) return { '.tag': 'folder', path_display: args.path };
        return err409('path/not_found/');
      }
      case 'files/delete_v2': {
        const k = lower(args.path);
        if (!files.has(k) && folders.has(k)) { for (const d of [...folders]) if (d === k || d.startsWith(k + '/')) folders.delete(d); for (const f of [...files.keys()]) if (f.startsWith(k + '/')) files.delete(f); return { metadata: { '.tag': 'folder' } }; }
        if (!files.has(k)) return err409('path_lookup/not_found/');
        const f = files.get(k);
        files.delete(k);
        return { metadata: meta(f) };
      }
      case 'files/create_folder_v2': {
        const k = lower(args.path);
        if (folders.has(k)) return err409('path/conflict/folder/');
        folders.add(k); addFolders(args.path + '/x');
        folderNames.set(k, args.path);
        return { metadata: { '.tag': 'folder', path_display: args.path } };
      }
      case 'files/move_v2': {
        const k = lower(args.from_path);
        if (!files.has(k) && folders.has(k)) {
          const dest = lower(args.to_path);
          if (folders.has(dest)) return err409('to/conflict/folder/');
          for (const f of [...files.values()]) if (lower(f.path).startsWith(k + '/')) { files.delete(lower(f.path)); put(args.to_path + f.path.slice(k.length), f.data); }
          for (const d of [...folders]) if (d === k || d.startsWith(k + '/')) folders.delete(d);
          folders.add(dest); addFolders(args.to_path + '/x'); folderNames.set(dest, args.to_path);
          return { metadata: { '.tag': 'folder', path_display: args.to_path } };
        }
        if (!files.has(k)) return err409('from_lookup/not_found/');
        if (files.has(lower(args.to_path))) return err409('to/conflict/file/');
        const f = files.get(k); files.delete(k);
        const g = put(args.to_path, f.data);
        return { metadata: meta(g) };
      }
      case 'files/get_temporary_link': return { link: 'https://dl.example.com' + encodeURI(args.path) };
    }
    throw new Error('rpc no simulado: ' + endpoint);
  }
  const folderNames = new Map();
  const realFolder = (d) => {
    if (folderNames.has(d)) return folderNames.get(d);
    for (const f of files.values()) if (lower(f.path).startsWith(d + '/')) return f.path.slice(0, d.length);
    return d;
  };

  function content(endpoint, args, body) {
    if (endpoint === 'files/download') {
      const f = files.get(lower(args.path));
      if (!f) return err409('path/not_found/');
      return { raw: f.data, meta: meta(f) };
    }
    if (endpoint === 'files/upload') {
      const k = lower(args.path);
      const ex = files.get(k);
      const mode = args.mode['.tag'];
      let path = args.path;
      if (mode === 'add' && ex) {
        if (!args.autorename) return err409('path/conflict/file/');
        const dot = path.lastIndexOf('.');
        let n = 1;
        do { path = `${args.path.slice(0, dot)} (${n++})${args.path.slice(dot)}`; } while (files.has(lower(path)));
      }
      if (mode === 'update' && (!ex || ex.rev !== args.mode.update)) return err409('path/conflict/file/');
      const f = put(path, body);
      log.push(`upload ${path}`);
      return meta(f);
    }
    throw new Error('content no simulado: ' + endpoint);
  }

  /** Conecta el mock a un contexto de Playwright para el usuario `user`. */
  async function attach(context, user) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': 'Dropbox-API-Result', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    await context.route('https://www.dropbox.com/oauth2/authorize**', (route) => {
      const u = new URL(route.request().url());
      const back = `${u.searchParams.get('redirect_uri')}?code=code-${user.id}&state=${u.searchParams.get('state')}`;
      route.fulfill({ status: 302, headers: { Location: back } });
    });
    await context.route(/https:\/\/(api|content)\.dropboxapi\.com\/.*/, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const url = new URL(req.url());
      const endpoint = url.pathname.replace(/^\/2\//, '');
      const json = (status, obj, extra = {}) => route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(obj) });
      if (url.pathname === '/oauth2/token') {
        return json(200, { access_token: `tok-${user.id}`, expires_in: 14400, refresh_token: `ref-${user.id}`, token_type: 'bearer' });
      }
      const auth = req.headers().authorization || '';
      // Sin Dropbox-API-Path-Root las rutas se resuelven dentro de la carpeta personal (como en Dropbox real)
      const teamRoot = () => { try { return JSON.parse(req.headers()['dropbox-api-path-root'] || 'null')?.root === '100'; } catch { return false; } };
      if (auth !== `Bearer tok-${user.id}`) return json(401, { error_summary: 'invalid_access_token/' });
      if (endpoint === 'users/get_current_account') {
        // Cuenta de equipo: raíz del equipo '100', carpeta personal '/<nombre>' (namespace '200')
        return json(200, { name: { display_name: user.name }, email: user.email, root_info: { '.tag': 'team', root_namespace_id: '100', home_namespace_id: '200', home_path: '/' + user.name } });
      }
      let res;
      if (url.host.startsWith('content')) {
        const args = JSON.parse(req.headers()['dropbox-api-arg']);
        if (!teamRoot()) args.path = '/' + user.name + args.path;
        if (endpoint === 'files/upload' && opts.delay && (!opts.only || args.path.includes(opts.only))) await new Promise((r) => setTimeout(r, opts.delay));
        res = content(endpoint, args, req.postDataBuffer() || Buffer.alloc(0));
        if (res.raw) return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Result': JSON.stringify(res.meta).replace(/[\u007f-\uffff]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')) }, body: res.raw });
      } else {
        const body = req.postData();
        const a = body ? JSON.parse(body) : null;
        if (a && typeof a.path === 'string' && !teamRoot()) a.path = '/' + user.name + a.path;
        res = rpc(endpoint, a);
      }
      if (res && res.status === 409) return json(409, res.json);
      return json(200, res);
    });
  }

  return { files, attach, put, log, opts };
}
