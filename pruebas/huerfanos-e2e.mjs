import { chromium } from 'playwright';
import { createMockDropbox } from './mockdbx.mjs';
const APP = 'http://localhost:5173/';
const mock = createMockDropbox();
mock.put('/Contratos App/LEEME.txt', Buffer.from('x'));
const G = '/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/ALFADOC S.A. DE C.V.';
const V = `${G}/CONTRATOS DE SERVICIOS/Contrato de Prestación de Servicios`;
const E = `${G}/900 MANAGEMENT & BUSINESS, S.A. DE C.V./CONTRATOS DE SERVICIOS`;
const C = `${G}/EPSILON SA DE CV/CONTRATOS DE SERVICIOS`;
// Ya en su lugar nuevo (otro equipo los movió): el de 360 es de otro contrato; el de Epsilon no lo registra nadie
mock.put(`${E}/ContratoDePrestacionDeServicios-Alfadoc-900ManagementBusiness-2026-10-15-APROBADO.docx`, Buffer.from('PK a'));
mock.put(`${C}/ContratoDePrestacionDeServicios-Alfadoc-Epsilon-2026-10-10-APROBADO.docx`, Buffer.from('PK c'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await mock.attach(ctx, { id: 'a', name: 'Usuario Uno', email: 'a@example.com' });
const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
await pg.goto(APP + '#/ajustes'); await pg.fill('#dbx-key', 'k'); await pg.fill('#dbx-folder', '/Contratos App');
await pg.click('[data-dbx=connect]'); await pg.waitForSelector('[data-dbx=sync]');
const ids = await pg.evaluate(async ({ V, E }) => {
  const m = await import('./js/model.js');
  const tpl = { id: 'u-t', name: 'Prestación de servicios · Formato 5', titulo: 'Contrato de Prestación de Servicios', category: 'servicios', vars: [['x', 'X', 'text'], ['fecha_firma', 'F', 'date']], sections: [{ title: 'O', body: 'T {{x}}.' }],
    signers: [{ role: 'P', name: 'P', bind: { prefix: 'prestador' } }, { role: 'C', name: 'C', bind: { prefix: 'cliente' } }] };
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (st, v) => new Promise((x) => { const tx = d.transaction(st, 'readwrite'); tx.objectStore(st).put(v); tx.oncomplete = x; });
  await put('templates', { ...tpl, custom: true });
  const base = { activa: true, rfc: '', apoderados: [], accionistas: [], createdAt: 1, updatedAt: 1 };
  await put('parties', { ...base, id: 'g1', kind: 'pm', propia: true, nombre: '900 MANAGEMENT & BUSINESS, S.A. DE C.V.' });
  await put('parties', { ...base, id: 'g2', kind: 'pm', propia: true, nombre: 'EPSILON SA DE CV' });
  await put('parties', { ...base, id: 'k1', kind: 'pm', propia: false, nombre: 'ALFADOC S.A. DE C.V.' });
  const mk = (emp, fecha, docs) => { const c = m.newContractFromTemplate(tpl); c.variables = { x: 'u', fecha_firma: fecha }; c.status = 'final';
    c.signers[0].party = { id: emp }; c.signers[1].party = { id: 'k1' }; c.documentos = docs.map((p, i) => ({ id: 'd' + i, kind: 'docx', name: p.split('/').pop(), path: p, date: 1 })); return c; };
  const viejo = `${V}/Contrato de Prestación de Servicios - APROBADO.docx`;
  const duenio = mk('g1', '2026-10-15', [`${E}/ContratoDePrestacionDeServicios-Alfadoc-900ManagementBusiness-2026-10-15-APROBADO.docx`]);
  const otro360 = mk('g1', '2026-10-15', [viejo]);    // mismo nombre nuevo que el del dueño: no lo adopta, se quita
  const compre = mk('g2', '2026-10-10', [viejo]);     // ya está en su lugar y nadie lo registra: se adopta
  const perdido = mk('g2', '2026-10-15', [viejo, `${V}/Contrato de Prestación de Servicios - APROBADO.pdf`]); // no existe: se quitan
  for (const c of [duenio, otro360, compre, perdido]) await put('contracts', c);
  return [duenio.id, otro360.id, compre.id, perdido.id];
}, { V, E });
await pg.reload(); await pg.waitForSelector('[data-dbx=renombrar]');
const bt = await pg.textContent('[data-dbx=renombrar]'); ok(/Acomodar 4 /.test(bt), 'botón: ' + bt);
await pg.click('[data-dbx=renombrar]'); await pg.click('dialog[open] button[value=ok]');
await pg.waitForSelector('dialog[open] ul'); const html = await pg.evaluate(() => document.querySelector('dialog[open]').innerHTML);
ok(/Se acomodaron 1\./.test(html) && /Se quitaron de la app 3/.test(html) && !/No se pudieron/.test(html), 'resumen: ' + html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300));
await pg.click('dialog[open] button'); await pg.waitForTimeout(800);
const dbs = await pg.evaluate(async () => { const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); }); return new Promise((x) => { const q = d.transaction('contracts').objectStore('contracts').getAll(); q.onsuccess = () => x(q.result); }); });
const by = (i) => dbs.find((c) => c.id === ids[i]);
ok(by(0).documentos.length === 1, 'el dueño conserva su archivo');
ok(by(1).documentos.length === 0, 'el otro 360 no se adueña del archivo ajeno');
ok(by(2).documentos.length === 1 && by(2).documentos[0].path.startsWith(`${C}/`), 'Epsilon apunta al archivo ya movido');
ok(by(3).documentos.length === 0, 'referencias inexistentes quitadas');
ok(mock.files.size >= 3, 'no se borró nada en Dropbox');
ok(await pg.locator('[data-dbx=renombrar]').count() === 0, 'ya no queda nada por acomodar');
ok(!errors.length, 'sin errores: ' + errors.join(' | '));
await b.close(); process.exit(errors.length ? 1 : 0);
