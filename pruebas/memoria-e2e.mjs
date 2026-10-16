import { chromium, devices } from 'playwright';
const APP = 'http://localhost:5173/';
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
for (const [nombre, script] of [
  ['indexedDB inexistente', () => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); }],
  ['indexedDB.open lanza', () => { IDBFactory.prototype.open = function () { throw new DOMException('The operation is insecure.', 'SecurityError'); }; }],
]) {
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(script);
  const pg = await ctx.newPage();
  const pe = []; pg.on('pageerror', (e) => pe.push(e.message));
  await pg.goto(APP + '#/'); await pg.waitForSelector('#app > *', { timeout: 15000 });
  await pg.waitForTimeout(1000); const t = await pg.textContent('body'); if (!/no deja/.test(t)) console.log(t.slice(0,300));
  ok(!/no pudo arrancar/.test(await pg.textContent('#app')) && /no deja guardar datos/.test(t), `${nombre}: arranca con aviso`);
  // crear un contrato en memoria y verlo en la lista
  await pg.goto(APP + '#/catalogo'); await pg.waitForTimeout(500);
  ok(!/no pudo arrancar/.test(await pg.textContent('#app')) && /Catálogo/.test(await pg.textContent('#app')), `${nombre}: navega al catálogo`);
  const n = await pg.evaluate(async () => { const db = await import('./js/db.js'); await db.put('meta', { id: 'x', v: 1 }); return (await db.get('meta', 'x')).v; });
  ok(n === 1, `${nombre}: guarda y lee en memoria`);
  ok(!pe.length, `${nombre}: sin errores de página ${pe.join(' | ')}`);
  await ctx.close();
}
const ctx = await b.newContext(); const pg = await ctx.newPage(); await pg.goto(APP + '#/'); await pg.waitForSelector('#app > *');
ok(!(await pg.$('.aviso-memoria')), 'con IndexedDB normal no hay aviso');
await b.close(); if (errors.length) process.exit(1);
