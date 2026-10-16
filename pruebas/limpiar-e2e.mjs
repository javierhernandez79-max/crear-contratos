import { chromium } from 'playwright';
import { createMockDropbox } from './mockdbx.mjs';
import { createHash } from 'crypto';
const APP = 'http://localhost:5173/';
const mock = createMockDropbox();
mock.put('/Contratos App/LEEME.txt', Buffer.from('x'));
const G = '/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP';
mock.put(`${G}/ALFADOC/EMPRESA/CONTRATOS DE SERVICIOS/C-APROBADO.docx`, Buffer.from('PK'));
mock.put(`${G}/ALFADOC/EMPRESA/CONTRATOS DE TRABAJO/Lote/W.docx`, Buffer.from('PK'));
mock.put(`${G}/suelto.pdf`, Buffer.from('%PDF'));
mock.put('/Contratos App/EXPEDIENTES CLIENTES/EXPEDIENTES CORPORATIVOS CLIENTES/ALFADOC/acta.pdf', Buffer.from('%PDF'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const files = () => [...mock.files.values()].map((f) => f.path);
// El correo autorizado real solo existe como hash en js/app.js: la prueba sustituye ese hash por el de un correo ficticio
const AUTORIZADO = 'autorizado@example.com';
const hashAutorizado = createHash('sha256').update(AUTORIZADO).digest('hex');
async function user(u) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await mock.attach(ctx, u);
  await ctx.route('**/js/app.js', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/const LIMPIEZA_CUENTA = '[0-9a-f]{64}'/, `const LIMPIEZA_CUENTA = '${hashAutorizado}'`);
    await route.fulfill({ response: res, body });
  });
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(`${u.id}: ${e.message}`));
  pg.on('dialog', (d) => d.accept());
  await pg.goto(APP + '#/ajustes'); await pg.fill('#dbx-key', 'k'); await pg.fill('#dbx-folder', '/Contratos App');
  await pg.click('[data-dbx=connect]'); await pg.waitForSelector('[data-dbx=sync]');
  return pg;
}
const A = await user({ id: 'a', name: 'Autorizado', email: 'Autorizado@Example.com' });
await A.evaluate(async () => {
  const m = await import('./js/model.js');
  const tpl = { id: 'u-t', name: 'P', titulo: 'Contrato', category: 'servicios', vars: [['x', 'X', 'text']], sections: [{ title: 'O', body: 'T {{x}}.' }], signers: [{ role: 'P', name: 'P' }] };
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (st, v) => new Promise((x) => { const tx = d.transaction(st, 'readwrite'); tx.objectStore(st).put(v); tx.oncomplete = x; });
  await put('templates', { ...tpl, custom: true, createdAt: 1, updatedAt: 1 });
  await put('parties', { id: 'k1', kind: 'pm', propia: false, nombre: 'ALFADOC', activa: true, rfc: '', apoderados: [], accionistas: [], createdAt: 1, updatedAt: 1 });
  for (let i = 0; i < 3; i++) { const c = m.newContractFromTemplate(tpl); c.variables = { x: 'u' + i }; await put('contracts', c); }
  await put('lotes', { id: 'l1', cliente: 'S', title: 'Lote', tipo: 'INDETERMINADO', status: 'borrador', trabajadores: [], excluidos: [], createdAt: 1, updatedAt: 1, history: [] });
  await put('papelera', { id: 'p1', store: 'contracts', at: Date.now(), nombre: 'x', item: { id: 'zz' } });
});
await A.reload(); await A.waitForSelector('[data-dbx=sync]'); await A.click('[data-dbx=sync]'); await A.waitForTimeout(2500);
ok(files().filter((p) => p.includes('/datos-app/contratos/')).length === 3, 'contratos subidos a Dropbox');
const B = await user({ id: 'b', name: 'Otro', email: 'otro@example.com' });
await B.click('[data-dbx=sync]'); await B.waitForTimeout(2500);
ok(await B.locator('[data-dbx=borrar-pruebas]').count() === 0, 'otro usuario no ve el botón');
ok((await B.evaluate(async () => { const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); }); return new Promise((x) => { const q = d.transaction('contracts').objectStore('contracts').count(); q.onsuccess = () => x(q.result); }); })) === 3, 'B tiene los 3 contratos');
// B crea un contrato y no sincroniza (cambio local pendiente): tras el borrado no debe volver a subir
await B.evaluate(async () => {
  const m = await import('./js/model.js');
  const tpl = { id: 'u-t', name: 'P', titulo: 'Contrato', vars: [['x', 'X', 'text']], sections: [{ title: 'O', body: 'T' }], signers: [] };
  const c = m.newContractFromTemplate(tpl); c.title = 'Pendiente de B';
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  await new Promise((x) => { const tx = d.transaction('contracts', 'readwrite'); tx.objectStore('contracts').put(c); tx.oncomplete = x; });
});
await A.goto(APP + '#/ajustes'); await A.waitForSelector('[data-dbx=borrar-pruebas]');
ok(true, 'el usuario autorizado ve el botón');
// Confirmación mal escrita: no borra
await A.click('[data-dbx=borrar-pruebas]'); await A.fill('dialog[open] input[name=v]', 'borrar'); await A.click('dialog[open] button[value=ok]'); await A.waitForTimeout(800);
ok(files().filter((p) => p.includes('/datos-app/contratos/')).length === 3 && files().some((p) => p.endsWith('suelto.pdf')), 'con "borrar" en minúsculas no se borra nada');
await A.click('[data-dbx=borrar-pruebas]'); await A.fill('dialog[open] input[name=v]', 'BORRAR'); await A.click('dialog[open] button[value=ok]');
await A.waitForSelector('.toast >> text=/Se borraron/', { timeout: 15000 });
console.log(await A.textContent('.toast'));
const resto = files();
ok(!resto.some((p) => p.startsWith(G + '/')), 'DOCUMENTOS GENERADOS vacía');
ok(!resto.some((p) => /datos-app\/(contratos|lotes|papelera)\//.test(p)), 'registros de contratos, lotes y papelera borrados en Dropbox');
ok(resto.some((p) => p.includes('/datos-app/plantillas/')) && resto.some((p) => p.endsWith('catalogo-partes.xlsx')) && resto.some((p) => p.endsWith('acta.pdf')), 'plantillas, catálogo y expedientes intactos');
ok(files().some((p) => p.endsWith('/datos-app/limpieza.json')), 'aviso de borrado en Dropbox');
await B.goto(APP + '#/ajustes'); await B.waitForSelector('[data-dbx=sync]'); await B.click('[data-dbx=sync]'); await B.waitForTimeout(2500);
await B.waitForSelector('dialog[open] >> text=Sesión cerrada');
ok(/borró los datos de prueba/.test(await B.textContent('dialog[open]')), 'B recibe el aviso de sesión cerrada');
await B.click('dialog[open] button'); await B.waitForSelector('[data-dbx=connect]');
ok(await B.locator('[data-dbx=sync]').count() === 0, 'B quedó desconectado de Dropbox');
await A.goto(APP + '#/ajustes'); await A.waitForSelector('[data-dbx=sync]');
ok(true, 'A (quien borró) sigue conectado');
// Un tercer equipo que se conecta después no pierde nada propio ni ve avisos
const C = await user({ id: 'c', name: 'Nuevo', email: 'nuevo@example.com' });
await C.click('[data-dbx=sync]'); await C.waitForTimeout(2000);
ok(!/borró los datos/.test(await C.evaluate(() => document.body.textContent)), 'equipo nuevo sin aviso');
// A no se borra a sí mismo otra vez: crea uno nuevo, sincroniza y se conserva
await A.evaluate(async () => {
  const m = await import('./js/model.js');
  const c = m.newContractFromTemplate({ id: 'u-t', name: 'P', titulo: 'Real', vars: [], sections: [{ title: 'O', body: 'T' }], signers: [] });
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  await new Promise((x) => { const tx = d.transaction('contracts', 'readwrite'); tx.objectStore('contracts').put(c); tx.oncomplete = x; });
});
await A.reload(); await A.waitForSelector('[data-dbx=sync]'); await A.click('[data-dbx=sync]'); await A.waitForTimeout(2000);
ok(files().filter((p) => p.includes('/datos-app/contratos/')).length === 1, 'contrato nuevo después del borrado se conserva');
await B.fill('#dbx-key', 'k'); await B.fill('#dbx-folder', '/Contratos App'); await B.click('[data-dbx=connect]'); await B.waitForSelector('[data-dbx=sync]');
await B.click('[data-dbx=sync]'); await B.waitForTimeout(2500);
ok(await B.locator('dialog[open]').count() === 0 && await B.locator('[data-dbx=sync]').count() === 1, 'B reconecta sin volver a borrar ni cerrar sesión');
const nB = await B.evaluate(async () => { const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); }); const n = (st) => new Promise((x) => { const q = d.transaction(st).objectStore(st).count(); q.onsuccess = () => x(q.result); }); return [await n('contracts'), await n('lotes'), await n('templates')]; });
ok(nB[0] === 1 && nB[1] === 0 && nB[2] === 1, 'B tras reconectar: solo el contrato nuevo de A, sin lotes, con la plantilla: ' + nB);
ok(![...mock.files.values()].some((f) => /datos-app\/(contratos|lotes)\//.test(f.path) && String(f.data).includes('Pendiente de B')) && files().filter((p) => /datos-app\/(contratos|lotes)\//.test(p)).length === 1, 'B no vuelve a subir nada, ni su cambio pendiente');
ok(!errors.length, 'sin errores: ' + errors.join(' | '));
await b.close(); process.exit(errors.length ? 1 : 0);
