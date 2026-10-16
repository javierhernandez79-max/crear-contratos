import { chromium } from 'playwright';
import { createMockDropbox } from './mockdbx.mjs';
const S = process.argv[2]; const APP = 'http://localhost:5173/';
const mock = createMockDropbox();
mock.put('/Contratos App/LEEME.txt', Buffer.from('x'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const user = { id: 'a', name: 'Usuario Uno', email: 'a@example.com' };
const equipo = async () => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await mock.attach(ctx, user);
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await pg.goto(APP + '#/ajustes');
  await pg.fill('#dbx-key', 'k'); await pg.fill('#dbx-folder', '/Contratos App');
  await pg.click('[data-dbx=connect]'); await pg.waitForSelector('[data-dbx=sync]');
  return pg;
};
const sincronizar = async (pg) => { await pg.goto(APP + '#/ajustes'); await pg.waitForSelector('[data-dbx=sync]'); await pg.click('[data-dbx=sync]'); await pg.waitForTimeout(2500); };
const idb = (pg, fn, arg) => pg.evaluate(async ({ fn, arg }) => {
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (st, v) => new Promise((x) => { const tx = d.transaction(st, 'readwrite'); tx.objectStore(st).put(v); tx.oncomplete = x; });
  const all = (st) => new Promise((x) => { const q = d.transaction(st).objectStore(st).getAll(); q.onsuccess = () => x(q.result); });
  return new Function('put', 'all', 'arg', `return (async () => { ${fn} })()`)(put, all, arg);
}, { fn, arg });
const A = await equipo();
await idb(A, `
  const m = await import('./js/model.js');
  const base = { custom: true, category: 'laboral', description: 'd', vars: [['x', 'X', 'text']], sections: [{ title: 'UNO', body: 'Texto {{x}}.' }], signers: [], createdAt: 1, updatedAt: 1 };
  await put('templates', { ...base, id: 'u-marco-trabajo-indeterminado', name: 'Marco trabajo' });
  await put('templates', { ...base, id: 'u-cps-f1', name: 'Formato 1', formato: 'F1', category: 'servicios' });
  await put('templates', { ...base, id: 'u-propia', name: 'Mi plantilla' });
  const c = m.newContractFromTemplate({ ...base, id: 'u-propia', name: 'Mi plantilla' }); c.id = 'c1'; c.etiqueta = 'Contrato de prueba';
  await put('contracts', c);
  await put('parties', { id: 'p1', kind: 'pm', propia: false, activa: true, nombre: 'CLIENTE BORRABLE SA', rfc: '', apoderados: [], accionistas: [] });
  // Entrada vieja (40 días): se purga al abrir
  await put('papelera', { id: 'viejo', store: 'contracts', itemId: 'cv', item: { id: 'cv' }, nombre: 'Viejo', at: Date.now() - 40 * 864e5, by: 'x', updatedAt: 1 });
`);
await A.reload(); await A.waitForSelector('#app'); await A.waitForTimeout(800);
ok(!(await idb(A, `return (await all('papelera')).some((e) => e.id === 'viejo')`)), 'lo de más de 30 días se borra al abrir');
// Protección
await A.goto(APP + '#/plantillas'); await A.waitForTimeout(500);
const btnDel = async (name) => A.locator('.tpl-list .ll-row', { hasText: name }).locator('[data-act=del]').count();
ok(await btnDel('Marco trabajo') === 0 && await btnDel('Formato 1') === 0, 'plantilla marco y formato F1: sin botón de eliminar');
ok(await btnDel('Mi plantilla') === 1, 'plantilla propia sí se elimina');
await A.goto(APP + '#/plantilla/u-marco-trabajo-indeterminado'); await A.waitForTimeout(600);
ok(!(await A.locator('[data-act=delete]').count()), 'editor de la plantilla marco: sin "Eliminar plantilla"');
// Borrar plantilla, contrato y parte
await A.goto(APP + '#/plantillas'); await A.waitForTimeout(400);
await A.locator('.tpl-list .ll-row', { hasText: 'Mi plantilla' }).locator('[data-act=del]').click();
ok((await A.textContent('dialog.modal')).includes('Papelera'), 'el aviso dice que se puede recuperar');
await A.click('dialog.modal button[value=ok]'); await A.waitForTimeout(400);
await A.goto(APP + '#/'); await A.waitForTimeout(500);
await A.locator('.ll-row[data-id="c1"] [data-act=del]').click(); await A.click('dialog.modal button[value=ok]'); await A.waitForTimeout(400);
await A.goto(APP + '#/catalogo'); await A.waitForTimeout(500);
await A.locator('.ll-row', { hasText: 'CLIENTE BORRABLE' }).locator('[data-act=del]').click(); await A.click('dialog.modal button[value=ok]'); await A.waitForTimeout(400);
await sincronizar(A);
const files = () => [...mock.files.values()].map((f) => f.path);
ok(files().filter((p) => p.includes('/datos-app/papelera/')).length === 3, 'la papelera se sube a Dropbox: ' + files().filter((p) => p.includes('papelera')).length);
ok(!files().some((p) => p.endsWith('/c1.json')), 'el contrato ya no está en la carpeta de contratos');
const t = await A.textContent('#papelera');
ok(t.includes('Contrato de prueba') && t.includes('Mi plantilla') && t.includes('CLIENTE BORRABLE SA') && t.includes('se borra en 30 días'), 'Ajustes → Papelera muestra lo borrado');
await A.screenshot({ path: S + '/shots/papelera.png', fullPage: true });
// Otro equipo: ve la papelera y restaura el contrato
const B = await equipo();
await sincronizar(B);
ok((await B.textContent('#papelera')).includes('Contrato de prueba'), 'el otro equipo ve la papelera');
await B.locator('#papelera .doc-item', { hasText: 'Contrato de prueba' }).locator('[data-papelera=restaurar]').click();
await B.waitForTimeout(800);
ok(!(await B.textContent('#papelera')).includes('Contrato de prueba'), 'sale de la papelera al restaurar');
await sincronizar(B);
ok(files().some((p) => p.endsWith('/datos-app/contratos/c1.json')) && files().filter((p) => p.includes('/datos-app/papelera/')).length === 2, 'restaurado en Dropbox');
await sincronizar(A);
await A.goto(APP + '#/'); await A.waitForTimeout(600);
ok(await A.locator('.ll-row[data-id="c1"]').count() === 1, 'el primer equipo recibe el contrato restaurado');
// Restaurar la parte del catálogo
await A.goto(APP + '#/ajustes'); await A.waitForSelector('#papelera');
await A.locator('#papelera .doc-item', { hasText: 'CLIENTE BORRABLE' }).locator('[data-papelera=restaurar]').click(); await A.waitForTimeout(600);
ok(await idb(A, `return (await all('parties')).some((p) => p.id === 'p1')`), 'parte del catálogo restaurada');
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'TODO OK'); await b.close();
