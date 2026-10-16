import { chromium } from 'playwright'; import ExcelJS from 'exceljs'; import fs from 'fs';
import { createMockDropbox } from './mockdbx.mjs';
const S = '..'; const APP = 'http://localhost:5173/';
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const ltpl = JSON.parse(fs.readFileSync('../marco/out/u-marco-trabajo-indeterminado.json'));
const p1 = async (name, filas) => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('P1 ');
  ws.addRow(['ID ', 'Apellido Paterno', 'Apellido Materno', 'Nombre', 'NOMBRE COMPLETO', 'Nacionalidad', 'RFC con Homoclave', 'CURP', 'Sexo', 'Estado Civil', 'Calle', 'No. Ext.', 'No. Int.', 'Colonia', 'Alcaldía/municipio', 'CP', 'SD', 'Puesto', 'Fecha de Antigüedad', 'Tipo de Contrato', 'Días de Pago', 'Fecha de Ingreso', 'Lugar de Trabajo', 'Fecha de Firma']);
  for (const sd of filas) ws.addRow([1, 'PEREZ', 'LOPEZ', 'ANA', '', 'MEXICANO(A)', 'PELA900101AB1', 'PELA900101MDFRPN01', '', 'CASADO', 'CALLE UNO', 10, null, 'CENTRO', 'CUAUHTEMOC', '6000', sd, 'AUXILIAR', new Date(Date.UTC(2020, 0, 15)), 'INDETERMINADO', '15 y último de mes', new Date(Date.UTC(2026, 9, 1)), 'CDMX', new Date(Date.UTC(2026, 9, 1))]);
  await wb.xlsx.writeFile(`${S}/${name}`);
};
await p1('p1-a.xlsx', [500]); await p1('p1-a2.xlsx', [500, 500]); await p1('p1-b.xlsx', [650]);
const mock = createMockDropbox(); mock.put('/Contratos App/LEEME.txt', Buffer.from('x'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await mock.attach(ctx, { id: 'a', name: 'Usuario Uno', email: 'a@example.com' });
const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
await pg.goto(APP + '#/ajustes'); await pg.fill('#dbx-key', 'k'); await pg.fill('#dbx-folder', '/Contratos App');
await pg.click('[data-dbx=connect]'); await pg.waitForSelector('[data-dbx=sync]');
const ids = await pg.evaluate(async (lt) => {
  const m = await import('./js/model.js');
  const tpl = { id: 'u-t', name: 'Servicios', titulo: 'CONTRATO DE PRESTACIÓN DE SERVICIOS', vars: [['x', 'X', 'text'], ['fecha_firma', 'F', 'date']], sections: [{ title: 'OBJETO', body: 'Texto {{x}}.' }],
    signers: [{ role: 'P', name: 'P', bind: { prefix: 'prestador' } }, { role: 'C', name: 'C', bind: { prefix: 'cliente' } }] };
  const mk = (x, st) => { const c = m.newContractFromTemplate(tpl); c.variables = { x, fecha_firma: '2099-01-10' }; c.status = st;
    c.signers[0].party = { id: 'g1', apoderadoId: null, prefix: 'prestador' }; c.signers[1].party = { id: 'k1', apoderadoId: null, prefix: 'cliente' }; return c; };
  const a = mk('uno', 'aprobado'), b2 = mk('uno', 'borrador');
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (st, v) => new Promise((x) => { const tx = d.transaction(st, 'readwrite'); tx.objectStore(st).put(v); tx.oncomplete = x; });
  await put('templates', { ...tpl, custom: true }); await put('templates', lt);
  const base = { activa: true, rfc: '', correo: '', apoderados: [], accionistas: [] };
  await put('parties', { ...base, id: 'g1', kind: 'pm', propia: true, nombre: 'EMPRESA DEMO, S.A. DE C.V.', apoderados: [{ id: 'apo1', nombre: 'MARIA', cargo: 'Apoderado', vigente: true }] });
  await put('parties', { ...base, id: 'k1', kind: 'pm', propia: false, nombre: 'ALFADOC S.A. DE C.V.' });
  await put('contracts', a); await put('contracts', b2); return [a.id, b2.id];
}, ltpl);
await pg.goto(APP + '#/'); await pg.reload(); await pg.waitForSelector('#app');
await pg.evaluate((i) => { location.hash = `#/c/${i}/documento`; }, ids[1]); await pg.waitForSelector('[data-wf=revision]');
await pg.click('[data-wf=revision]'); await pg.waitForSelector('dialog[open] >> text=Ese documento ya existe');
ok(/ALFADOC/.test(await pg.textContent('dialog[open]')) && !mock.files.size === false && ![...mock.files.values()].some((f) => /REVISION/.test(f.path)), 'contrato idéntico: aviso y no se genera Word');
await pg.click('dialog[open] button[value=abrir]'); await pg.waitForTimeout(500);
ok((await pg.evaluate(() => location.hash)).includes(ids[0]), 'abre el existente');
// Con un dato distinto sí se genera
await pg.evaluate(async (i) => { const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const c = await new Promise((x) => { const q = d.transaction('contracts').objectStore('contracts').get(i); q.onsuccess = () => x(q.result); }); c.variables.x = 'dos';
  await new Promise((x) => { const tx = d.transaction('contracts', 'readwrite'); tx.objectStore('contracts').put(c); tx.oncomplete = x; }); }, ids[1]);
await pg.reload(); await pg.waitForSelector('#app'); await pg.evaluate((i) => { location.hash = `#/c/${i}/documento`; }, ids[1]); await pg.waitForSelector('[data-wf=revision]');
await Promise.all([pg.waitForEvent('download'), pg.click('[data-wf=revision]')]); await pg.waitForSelector('[data-wf=approve]');
ok([...mock.files.values()].some((f) => /REVISION/.test(f.path)), 'con un dato distinto sí se genera');
// Lotes
const nuevo = async (file, per = 'QUINCENAL') => {
  await pg.goto(APP + '#/lotes'); await pg.waitForTimeout(400); await pg.goto(APP + '#/lotes/nuevo'); await pg.waitForSelector('#l-tpl');
  await pg.selectOption('#l-tpl', ltpl.id); await pg.selectOption('#l-per', per); await pg.selectOption('#l-emp', 'g1'); await pg.fill('#l-cli', 'Alfadoc');
  await pg.evaluate(() => document.querySelectorAll('.lt-row').forEach((r) => r.remove()));
  await pg.setInputFiles('#l-file', `${S}/${file}`); await pg.waitForSelector('.lt-row:not(.lt-head)'); await pg.waitForTimeout(300);
};
await nuevo('p1-a.xlsx'); await pg.click('#l-create'); await pg.waitForSelector('#lote-approve');
await nuevo('p1-a2.xlsx');
const filas = await pg.evaluate(() => [...document.querySelectorAll('.lt-row:not(.lt-head)')].map((r) => r.textContent.replace(/\s+/g, ' ')));
console.log(filas);
ok(/Ya existe un contrato idéntico en el lote/.test(filas[0]) && /CURP repetida/.test(filas[1]), 'mismo trabajador y mismos datos en otro lote: error');
ok(await pg.locator('#l-create').isDisabled(), 'no se puede crear un lote solo con idénticos');
await nuevo('p1-a2.xlsx', 'MENSUAL');
const f2 = await pg.evaluate(() => [...document.querySelectorAll('.lt-row:not(.lt-head)')].map((r) => r.textContent.replace(/\s+/g, ' ')));
ok(/Listo/.test(f2[0]) && /CURP repetida/.test(f2[1]), 'otra periodicidad: se permite; repetido dentro del Excel: error');
await nuevo('p1-b.xlsx');
const f3 = await pg.textContent('.lt-row:not(.lt-head)'); console.log(f3.replace(/\s+/g, ' ')); ok(/Listo/.test(f3), 'otro salario diario: se permite');
ok(!errors.length, 'sin errores: ' + errors.join(' | '));
await b.close(); process.exit(errors.length ? 1 : 0);
