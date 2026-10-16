import { chromium } from 'playwright';
const APP = 'http://localhost:5173/'; const S = process.argv[2];
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
const estado = { configurada: true, conectada: false, env: 'demo', admin: false, propio: true, error: 'DocuSign rechazó la conexión (HTTP 400, invalid_request)', codigo: 'invalid_request', correo: 'auxiliar@x.com', intentado: 'a16b8b96-8e73-42c2-9e07-0de85d50c1c4', consentimiento: 'https://account-d.docusign.com/oauth/auth?x=1' };
await ctx.route('**/api/docusign/estado', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(estado) }));
await pg.goto(APP + '#/ajustes'); await pg.waitForSelector('#ds-block');
await pg.waitForTimeout(500);
const t = await pg.textContent('#ds-block');
ok(/HTTP 400/.test(t) && /auxiliar@x.com/.test(t) && /a16b8b96/.test(t) && /remitente propio/.test(t), 'muestra correo, usuario intentado y HTTP');
ok(/puede faltar autorizarla/.test(t) && await pg.$('#ds-block a[href*="oauth/auth"]'), 'ofrece Autorizar al remitente propio');
await pg.locator('#ds-block').screenshot({ path: S + '/ds-diag.png' });
await b.close(); if (errors.length) { console.log(errors); process.exit(1); }
