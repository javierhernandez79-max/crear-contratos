import { chromium, devices } from 'playwright';
const APP = 'http://localhost:5173/';
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const phone = devices['iPhone 13'];
// 1. Normal
let ctx = await b.newContext({ ...phone });
let pg = await ctx.newPage();
await pg.goto(APP + '#/'); await pg.waitForSelector('#app > *', { timeout: 10000 });
ok(!(await pg.textContent('#app')).includes('no pudo arrancar'), 'arranque normal sin aviso');
await ctx.close();
// 2. El módulo no carga
ctx = await b.newContext({ ...phone });
await ctx.route('**/js/app.js', (r) => r.abort());
pg = await ctx.newPage();
await pg.goto(APP + '#/'); await pg.waitForTimeout(1500);
const t2 = await pg.textContent('#app');
ok(/no pudo arrancar/.test(t2) && /No cargó/.test(t2) && /iPhone/.test(t2), 'si el script no carga, se ve el aviso con el motivo y el navegador');
await ctx.close();
// 3. Error de sintaxis en un módulo
ctx = await b.newContext({ ...phone });
await ctx.route('**/js/extraccion.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'const x = /a/zz;' }));
pg = await ctx.newPage();
await pg.goto(APP + '#/'); await pg.waitForTimeout(1500);
ok(/no pudo arrancar/.test(await pg.textContent('#app')), 'error de sintaxis en un módulo: aviso');
console.log((await pg.textContent('#app pre')).slice(0, 160));
await ctx.close();
// 4. Estado de DocuSign sin respuesta: la app arranca igual
ctx = await b.newContext({ ...phone });
await ctx.route('**/api/docusign/estado', () => {});
pg = await ctx.newPage();
const t0 = Date.now();
await pg.goto(APP + '#/'); await pg.waitForSelector('#app > *', { timeout: 15000 });
ok(Date.now() - t0 < 11000 && !(await pg.textContent('#app')).includes('no pudo arrancar'), `DocuSign colgado: arranca en ${Date.now() - t0} ms`);
await b.close();
if (errors.length) process.exit(1);
