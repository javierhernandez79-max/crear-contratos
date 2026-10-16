import { chromium } from 'playwright';
const S = process.argv[2] || 'shots'; const APP = 'http://localhost:5173/';
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });

// ---- DocuSign simulado ----
const mock = { envelopes: [], status: 'sent', signer: 'sent', voided: null, auth: null };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT' };
await ctx.route(/https:\/\/account-d\.docusign\.com\/oauth\/auth.*/, (route) => {
  const u = new URL(route.request().url());
  mock.auth = Object.fromEntries(u.searchParams);
  const to = u.searchParams.get('response_type') === 'token'
    ? `${u.searchParams.get('redirect_uri')}#access_token=tok123&expires_in=28800&token_type=Bearer&state=${u.searchParams.get('state')}`
    : `${u.searchParams.get('redirect_uri')}?code=code123&state=${encodeURIComponent(u.searchParams.get('state'))}`;
  return route.fulfill({ status: 302, headers: { Location: to } });
});
mock.tokens = [];
await ctx.route(/https:\/\/account-d\.docusign\.com\/oauth\/token/, async (route) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const p = Object.fromEntries(new URLSearchParams(route.request().postData()));
  mock.tokens.push(p);
  if (p.grant_type === 'authorization_code') {
    const { createHash } = await import('crypto');
    const ch = createHash('sha256').update(p.code_verifier).digest('base64url');
    ok(p.code === 'code123' && p.client_id === 'ik-test' && ch === mock.auth.code_challenge && !p.client_secret, 'canje del código con PKCE (verifier correcto, sin secreto)');
    return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: 'tok123', refresh_token: 'ref1', expires_in: 28800, token_type: 'Bearer' }) });
  }
  ok(p.grant_type === 'refresh_token' && p.refresh_token === 'ref1', 'renueva con el refresh token');
  return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: 'tok123', refresh_token: 'ref1', expires_in: 28800 }) });
});
await ctx.route(/https:\/\/account-d\.docusign\.com\/oauth\/userinfo/, (route) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  ok(route.request().headers().authorization === 'Bearer tok123', 'userinfo con token');
  return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Usuario Uno', email: 'j@example.com', accounts: [{ account_id: 'acc1', is_default: true, account_name: 'Cuenta Demo', base_uri: 'https://demo.docusign.net' }] }) });
});
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
await ctx.route(/https:\/\/demo\.docusign\.net\/restapi\/v2\.1\/accounts\/acc1\/.*/, async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const path = new URL(req.url()).pathname.replace('/restapi/v2.1/accounts/acc1', '');
  const json = (o) => route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
  if (req.method() === 'POST' && path === '/envelopes') {
    const body = req.postDataJSON(); mock.envelopes.push(body); mock.status = 'sent'; mock.signer = 'sent';
    return json({ envelopeId: 'env' + mock.envelopes.length, status: 'sent' });
  }
  const last = mock.envelopes.at(-1);
  if (req.method() === 'PUT') { mock.voided = req.postDataJSON(); mock.status = 'voided'; return json({}); }
  if (/\/recipients$/.test(path)) return json({ signers: last.recipients.signers.map((s) => ({ name: s.name, email: s.email, status: mock.signer, signedDateTime: mock.signer === 'completed' ? new Date().toISOString() : undefined })) });
  if (/\/documents\/(combined|certificate)$/.test(path)) return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/pdf' }, body: PDF });
  if (/^\/envelopes\/env\d+$/.test(path)) return json({ status: mock.status, completedDateTime: mock.status === 'completed' ? new Date().toISOString() : undefined });
  return route.fulfill({ status: 404, headers: cors, body: '{}' });
});

// ---- Datos: empresa del grupo, cliente y contrato de servicios aprobado ----
await pg.goto(APP + '#/'); await pg.waitForSelector('#app');
const ids = await pg.evaluate(async () => {
  const m = await import('./js/model.js');
  const tpl = { id: 'u-marco-serv', name: 'Servicios', titulo: 'CONTRATO DE PRESTACIÓN DE SERVICIOS', vars: [['servicios', 'Servicios', 'text'], ['prestador_nombre', 'Prestador', 'text'], ['cliente_nombre', 'Cliente', 'text']],
    sections: [{ title: 'OBJETO', body: 'Servicios: {{servicios}}.' }],
    signers: [{ role: 'EL PRESTADOR', name: '{{prestador_nombre}}', bind: { prefix: 'prestador' } }, { role: 'EL CLIENTE', name: '{{cliente_nombre}}', bind: { prefix: 'cliente' } }] };
  const c = m.newContractFromTemplate(tpl);
  c.variables = { servicios: 'consultoría', prestador_nombre: 'GRUPO EJEMPLO, S.A. DE C.V., representada por ANA PÉREZ', cliente_nombre: 'LUIS GÓMEZ' };
  c.status = 'aprobado'; c.aprobado = { by: 'x', date: Date.now() };
  c.signers[0].party = { id: 'g1', apoderadoId: 'a1', prefix: 'prestador' };
  c.signers[1].party = { id: 'k1', apoderadoId: null, prefix: 'cliente' };
  const plain = { id: 'n1', ...m.newContractFromTemplate({ ...tpl, vars: [['x', 'X', 'text']], sections: [{ title: 'UNO', body: 'Texto {{x}}.' }], signers: [{ role: 'A', name: 'A' }] }) , id: 'n1', status: 'aprobado' };
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (st, v) => new Promise((x) => { const tx = d.transaction(st, 'readwrite'); tx.objectStore(st).put(v); tx.oncomplete = x; });
  await put('parties', { id: 'g1', kind: 'pm', propia: true, activa: true, nombre: 'GRUPO EJEMPLO, S.A. DE C.V.', rfc: 'GEJ100101AA1', correo: 'empresa@example.com', apoderados: [{ id: 'a1', nombre: 'ANA PÉREZ', cargo: 'Apoderada', correo: 'ana@example.com', vigente: true }], accionistas: [] });
  await put('parties', { id: 'k1', kind: 'pf', propia: false, activa: true, nombre: 'LUIS GÓMEZ', rfc: 'GOLL800101AB1', correo: '', apoderados: [], accionistas: [] });
  await put('contracts', c); await put('contracts', plain);
  return { c: c.id, n: plain.id };
});

// ---- Conectar DocuSign ----
await pg.goto(APP + '#/ajustes'); await pg.reload(); await pg.waitForSelector('#ds-block');
await pg.fill('#ds-key', 'ik-test');
await pg.click('[data-ds=connect]');
await pg.waitForSelector('#ds-block >> text=Conectado', { timeout: 15000 });
ok(mock.auth?.scope === 'signature cors' && mock.auth.response_type === 'code' && mock.auth.code_challenge_method === 'S256' && mock.auth.state.startsWith('ds.') && mock.auth.client_id === 'ik-test', 'pide código con PKCE (S256) y scope signature cors');
ok(mock.tokens.some((t) => t.grant_type === 'authorization_code'), 'canjeó el código');
ok(mock.auth.redirect_uri === 'http://localhost:5173', 'URI de regreso sin diagonal final: ' + mock.auth.redirect_uri);
ok(!errors.some((e) => /Dropbox/.test(e)) && !(await pg.locator('.toast.error').count()), 'el regreso de DocuSign no lo toma Dropbox');
ok(pg.url().endsWith('#/ajustes'), 'regresa a Ajustes sin token en la URL: ' + pg.url());
await pg.screenshot({ path: S + '/ds1-ajustes.png', fullPage: true });

// ---- Contrato sin servicios: no ofrece DocuSign ----
await pg.evaluate((id) => { location.hash = `#/c/${id}/documento`; }, ids.n);
await pg.waitForSelector('.stepper');
ok((await pg.locator('[data-wf=ds-send]').count()) && (await pg.locator('[data-wf=papel]').count()), 'contrato que no es de servicios: DocuSign y papel');

// ---- Enviar ----
await pg.evaluate((id) => { location.hash = `#/c/${id}/documento`; }, ids.c);
await pg.waitForSelector('[data-wf=ds-send]');
await pg.click('[data-wf=ds-send]');
await pg.waitForSelector('dialog.modal .ds-rcpt');
const n0 = await pg.locator('dialog.modal input[name^=n_]').first().inputValue();
const e0 = await pg.locator('dialog.modal input[name^=e_]').first().inputValue();
ok(n0 === 'ANA PÉREZ' && e0 === 'ana@example.com', `prellena apoderado (${n0} / ${e0})`);
ok(await pg.locator('dialog.modal >> text=Nuestra parte').count() === 1, 'marca nuestra parte');
await pg.screenshot({ path: S + '/ds2-enviar.png' });
await pg.click('dialog.modal button[value=ok]');
ok(await pg.locator('dialog.modal input:invalid').count() === 1, 'exige el correo faltante del cliente');
await pg.locator('dialog.modal input[name^=e_]').nth(1).fill('luis@example.com');
await pg.click('dialog.modal button[value=ok]');
await pg.waitForSelector('#ds-envio');
const env = mock.envelopes[0];
ok(env?.recipients.signers.length === 2 && env.status === 'sent', 'sobre con 2 firmantes enviado');
ok(env.recipients.signers.every((s, i) => s.tabs.signHereTabs[0].anchorString === `~dsf${i + 1}~`), 'anclas de firma');
ok(env.documents[0].documentBase64.length > 1000, 'PDF adjunto');
(await import('fs')).writeFileSync(S + '/para-firma.pdf', Buffer.from(env.documents[0].documentBase64, 'base64'));
await pg.screenshot({ path: S + '/ds3-enviado.png', fullPage: true });
const correoCliente = await pg.evaluate(async () => { const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); }); return new Promise((x) => { const q = d.transaction('parties').objectStore('parties').get('k1'); q.onsuccess = () => x(q.result.correo); }); });
ok(correoCliente === 'luis@example.com', 'guardó el correo en el catálogo');

// ---- Cancelar y reenviar ----
await pg.click('[data-wf=ds-void]');
await pg.click('dialog.modal button[value=ok]');
await pg.waitForSelector('#ds-envio >> text=Cancelado');
ok(mock.voided?.status === 'voided', 'canceló en DocuSign');
await pg.click('[data-wf=ds-reset]');
await pg.click('[data-wf=ds-send]');
await pg.waitForSelector('dialog.modal .ds-rcpt');
ok((await pg.locator('dialog.modal input[name^=e_]').nth(1).inputValue()) === 'luis@example.com', 'segundo envío ya trae el correo guardado');
await pg.click('dialog.modal button[value=ok]');
await pg.waitForSelector('#ds-envio >> text=Enviado');
ok(mock.envelopes.length === 2, 'segundo sobre');

// ---- Firmado por todos ----
mock.status = 'completed'; mock.signer = 'completed';
await pg.click('[data-wf=ds-refresh]');
await pg.waitForSelector('#ds-envio >> text=Firmado por todos', { timeout: 15000 });
const c = await pg.evaluate(async (id) => { const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); }); return new Promise((x) => { const q = d.transaction('contracts').objectStore('contracts').get(id); q.onsuccess = () => x(q.result); }); }, ids.c);
ok(c.status === 'final', 'contrato marcado firmado');
ok(c.documentos.some((x) => /FIRMADO DocuSign/.test(x.name)) && c.documentos.some((x) => /certificado DocuSign/.test(x.name)), 'registró PDF firmado y certificado');
ok(c.history.some((h) => /DocuSign/.test(h.text || h.msg || JSON.stringify(h))), 'bitácora');
await pg.screenshot({ path: S + '/ds4-firmado.png', fullPage: true });

// ---- Contrato con formato propio (Word original): DocuSign recibe el Word con las marcas de firma ----
const f2 = JSON.parse((await import('fs')).readFileSync('../fmt/formatos-cps.json')).templates.find((t) => t.formato === 'F2');
const idm = await pg.evaluate(async (t) => {
  const m = await import('./js/model.js');
  const c = m.newContractFromTemplate(t);
  c.status = 'aprobado'; c.aprobado = { by: 'x', date: Date.now() };
  for (const d of c.varDefs) c.variables[d.key] = d.key === 'fecha_firma' ? new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10) : 'DATO ' + d.key;
  c.variables.prestador_nombre = 'GRUPO EJEMPLO, S.A. DE C.V.'; c.variables.prestador_representante = 'ANA PÉREZ';
  c.signers[0].party = { id: 'g1', apoderadoId: 'a1', prefix: 'prestador' };
  c.signers[1].party = { id: 'k1', apoderadoId: null, prefix: 'cliente' };
  c.signatures[c.signers[0].id] = { type: 'autografa', image: 'data:,', date: Date.now() };
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (st, v) => new Promise((x) => { const tx = d.transaction(st, 'readwrite'); tx.objectStore(st).put(v); tx.oncomplete = x; });
  await put('templates', t); await put('contracts', c); return c.id;
}, f2);
await pg.setViewportSize({ width: 1280, height: 900 });
await pg.goto(APP + '#/'); await pg.reload(); await pg.waitForSelector('#app');
await pg.evaluate((id) => { location.hash = `#/c/${id}/documento`; }, idm);
await pg.waitForSelector('[data-wf=ds-send]'); await pg.click('[data-wf=ds-send]');
await pg.waitForSelector('dialog.modal .ds-rcpt');
ok(await pg.locator('dialog.modal .ds-rcpt').count() === 2, 'formato propio: firman todos en DocuSign aunque haya firma en la app');
await pg.locator('dialog.modal input[name^=e_]').nth(1).fill('luis@example.com');
await pg.click('dialog.modal button[value=ok]'); await pg.waitForSelector('#ds-envio');
const envM = mock.envelopes.at(-1);
ok(envM.documents[0].fileExtension === 'docx' && envM.documents[0].name.endsWith('.docx'), 'envía el Word del formato');
(await import('fs')).writeFileSync(S + '/ds-molde.docx', Buffer.from(envM.documents[0].documentBase64, 'base64'));
const { execSync } = await import('child_process');
const dx = execSync(`unzip -p ${S}/ds-molde.docx word/document.xml`).toString();
ok(dx.includes('~dsf1~') && dx.includes('~dsf2~') && dx.includes('Antique Olive') && !dx.includes('{{'), 'Word con marcas de firma de ambas partes y estilo del formato');
ok(envM.recipients.signers.map((x) => x.tabs.signHereTabs[0].anchorString).join() === '~dsf1~,~dsf2~', 'cada firmante con su marca');
await pg.setViewportSize({ width: 390, height: 800 });
await pg.evaluate(() => window.scrollTo(0, 0));
const anchos = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth, hash: location.hash, anchos: [...document.querySelectorAll('#app *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 5).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right) + ' ' + (e.textContent || '').slice(0, 40)) }));
console.log(JSON.stringify(anchos));
await pg.screenshot({ path: S + '/ds5-movil.png', fullPage: true });
ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'móvil sin scroll horizontal');
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'TODO OK'); await b.close();
