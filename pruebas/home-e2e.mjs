import { chromium } from 'playwright';
import { createMockDropbox } from './mockdbx.mjs';
const APP = 'http://localhost:5173/';
const mock = createMockDropbox();
// Compartida desde otro equipo: solo existe dentro de la carpeta personal de "Ana E"
mock.put('/Ana E/Legal - Documentos App/LEEME.txt', Buffer.from('x'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
async function connect(id, name) {
  const ctx = await b.newContext();
  await mock.attach(ctx, { id, name, email: `${id}@example.com` });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(APP + '#/ajustes');
  await pg.waitForSelector('#dbx-key');
  await pg.fill('#dbx-key', 'appkey123');
  await pg.fill('#dbx-folder', '/Legal - Documentos App');
  await pg.click('[data-dbx=connect]');
  await pg.waitForSelector('[data-dbx=sync]', { timeout: 15000 });
  await pg.click('[data-dbx=sync]');
  await pg.waitForTimeout(2500);
  return pg;
}
const A = await connect('a', 'Ana E');
const txt = await A.textContent('#dbx-block');
ok(txt.includes('/Ana E/Legal - Documentos App'), 'usa la carpeta dentro de la personal');
ok(!txt.includes('No se encontró'), 'sin error de carpeta');
ok(!txt.includes('Aún sin sincronizar'), 'sincronizó: ' + txt.match(/Carpeta[^·]*·[^.]*/)?.[0]);
ok(![...mock.files.values()].some((f) => f.path.startsWith('/Legal - Documentos App')), 'no crea la carpeta en la raíz del equipo');
const B = await connect('b', 'Beto');
const tb = await B.textContent('#dbx-block');
ok(tb.includes('acepta la invitación'), 'sin carpeta: aviso de aceptar invitación');
await b.close();
if (errors.length) { console.log(errors); process.exit(1); }
