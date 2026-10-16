import { chromium } from 'playwright';
import ExcelJS from 'exceljs'; import fs from 'fs';
import { createMockDropbox } from './mockdbx.mjs';
const S = process.argv[2] || '..'; const APP = 'http://localhost:5173/';
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const tpl = JSON.parse(fs.readFileSync('../marco/out/u-marco-trabajo-indeterminado.json'));
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('P1 ');
ws.addRow(['ID ', 'Apellido Paterno', 'Apellido Materno', 'Nombre', 'NOMBRE COMPLETO', 'Nacionalidad', 'RFC con Homoclave', 'CURP', 'Sexo', 'Estado Civil', 'Calle', 'No. Ext.', 'No. Int.', 'Colonia', 'Alcaldía/municipio', 'CP', 'SD', 'Puesto', 'Fecha de Antigüedad', 'Tipo de Contrato', 'Días de Pago', 'Fecha de Ingreso', 'Lugar de Trabajo', 'Fecha de Firma']);
ws.addRow([1, 'PEREZ', 'LOPEZ', 'ANA', '', 'MEXICANO(A)', 'PELA900101AB1', 'PELA900101MDFRPN01', '', 'CASADO', 'CALLE UNO', 10, null, 'CENTRO', 'CUAUHTEMOC', '6000', 500, 'AUXILIAR', new Date(Date.UTC(2020, 0, 15)), 'INDETERMINADO', '15 y último de mes', new Date(Date.UTC(2026, 9, 1)), 'CDMX', new Date(Date.UTC(2026, 9, 1))]);
await wb.xlsx.writeFile(S + '/p1-dbx.xlsx');
const mock = createMockDropbox();
mock.put('/Contratos App/LEEME.txt', Buffer.from('x'));
mock.put('/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/Alfadoc/LEEME.txt', Buffer.from('%PDF'));
mock.put('/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/BETA/LEEME.txt', Buffer.from('%PDF')); // otro cliente que solo empieza igual
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await mock.attach(ctx, { id: 'a', name: 'Usuario Uno', email: 'a@example.com' });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const files = () => [...mock.files.values()].map((f) => f.path);
await pg.goto(APP + '#/ajustes');
await pg.fill('#dbx-key', 'k'); await pg.fill('#dbx-folder', '/Contratos App');
await pg.click('[data-dbx=connect]'); await pg.waitForSelector('[data-dbx=sync]');
await pg.evaluate(async (t) => {
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (store, v) => new Promise((x) => { const tx = d.transaction(store, 'readwrite'); tx.objectStore(store).put(v); tx.oncomplete = x; });
  await put('templates', t);
  await put('parties', { id: 'emp1', kind: 'pm', propia: true, activa: true, nombre: 'EMPRESA DEMO, S.A. DE C.V.', rfc: 'EDE010101AA1', domicilio: 'AV. DEMO 1, CDMX', apoderados: [{ id: 'apo1', nombre: 'MARIA APODERADA', cargo: 'Apoderado legal', vigente: true }], accionistas: [], createdAt: 1, updatedAt: 1 });
  await put('parties', { id: 'cli1', kind: 'pm', propia: false, activa: true, nombre: 'ALFADOC S.A. DE C.V.', rfc: '', apoderados: [], accionistas: [], createdAt: 1, updatedAt: 1 });
}, tpl);
// Cada lote con otro salario diario: con los mismos datos la app (bien) rechaza el contrato idéntico de otro lote
let nLote = 0;
async function p1Variante() {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(S + '/p1-dbx.xlsx'); const ws = wb.worksheets[0];
  let fila = 0, col = 0;
  ws.eachRow((row, r) => { if (!col) row.eachCell((c, k) => { if (String(c.value).trim() === 'SD') { fila = r; col = k; } }); });
  ws.getRow(fila + 1).getCell(col).value = 500 + (++nLote);
  const f = `${S}/p1-dbx-${nLote}.xlsx`; await wb.xlsx.writeFile(f); return f;
}
const lote = async (cliente) => {
  await pg.goto(APP + '#/lotes'); await pg.reload(); await pg.waitForSelector('a[href="#/lotes/nuevo"]');
  await pg.click('a[href="#/lotes/nuevo"]'); await pg.waitForSelector('#l-tpl');
  await pg.selectOption('#l-tpl', tpl.id); await pg.selectOption('#l-per', 'QUINCENAL'); await pg.selectOption('#l-emp', 'emp1'); await pg.fill('#l-cli', cliente);
  await pg.setInputFiles('#l-file', await p1Variante()); await pg.waitForSelector('.lt-row:not(.lt-head)');
  await pg.click('#l-create'); await pg.waitForSelector('#lote-approve');
  await pg.click('#lote-approve'); await pg.click('dialog.modal button[value=ok]');
  await pg.waitForSelector('text=En Dropbox:', { timeout: 20000 });
  return pg.textContent('section.card code');
};
// 1) Cliente del catálogo con carpeta existente de otro nombre
let carpeta = await lote('Alfadoc');
ok(carpeta.startsWith('/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/Alfadoc/EMPRESA DEMO, S.A. DE C.V./CONTRATOS DE TRABAJO/INDETERMINADOS/'), 'lote en la carpeta del cliente: ' + carpeta);
ok(files().some((p) => p.startsWith(carpeta + '/') && p.endsWith('/ContratoIndividualDeTrabajoPorTiempoIndeterminado-Alfadoc-EmpresaDemo-AnaPerezLopez.docx')), 'contrato subido');
ok(files().some((p) => p.startsWith(carpeta + '/00 - P1')), 'P1 subido junto');
ok(!files().some((p) => p.includes('EXPEDIENTES CORPORATIVOS')), 'nada en la carpeta del patrón');
await pg.screenshot({ path: S + '/shots/lote-dbx.png', fullPage: true });
// 1b) Subir el firmado de un trabajador
ok((await pg.textContent('body')).includes('Firmados: 0 de 1'), 'contador de firmados 0 de 1');
await pg.click('[data-firmado="0"]');
await pg.setInputFiles('dialog.modal input[type=file]', { name: 'escaneo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 firmado ana') });
await pg.click('dialog.modal button[value=ok]');
await pg.waitForSelector('[data-firmado-abrir="0"]');
ok(files().some((p) => p === carpeta + '/ContratoIndividualDeTrabajoPorTiempoIndeterminado-Alfadoc-EmpresaDemo-AnaPerezLopez-FIRMADO.pdf'), 'firmado en la carpeta del lote');
ok((await pg.textContent('body')).includes('Firmados: 1 de 1'), 'contador 1 de 1');
await pg.screenshot({ path: S + '/shots/lote-firmado.png', fullPage: true });
await pg.goto(APP + '#/lotes'); await pg.waitForTimeout(500);
ok((await pg.textContent('body')).includes('1/1 firmados'), 'la lista de lotes muestra firmados');
// 2) Cliente que no está en el catálogo
carpeta = await lote('CLIENTE NUEVO');
ok(carpeta.startsWith('/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/CLIENTE NUEVO/EMPRESA DEMO, S.A. DE C.V./CONTRATOS DE TRABAJO/INDETERMINADOS/'), 'cliente fuera del catálogo: carpeta con su nombre: ' + carpeta);
// 3) Con o sin tipo de sociedad: misma carpeta; un nombre que solo empieza igual no se confunde
carpeta = await lote('ALFADOC S.A. DE C.V.');
ok(carpeta.startsWith('/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/Alfadoc/EMPRESA DEMO, S.A. DE C.V./CONTRATOS DE TRABAJO/'), 'con tipo de sociedad: misma carpeta del cliente: ' + carpeta);
carpeta = await lote('BETA LOGISTICA, S.A. DE C.V.');
ok(carpeta.startsWith('/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/BETA LOGISTICA, S.A. DE C.V./'), 'no se mete en la carpeta BETA: ' + carpeta);
carpeta = await lote('Beta Logística');
ok(carpeta.startsWith('/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/BETA LOGISTICA, S.A. DE C.V./'), 'sin tipo de sociedad ni acentos: la misma carpeta creada antes: ' + carpeta);
const ls = await pg.evaluate(async () => { const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); }); return new Promise((x) => { const q = d.transaction('lotes').objectStore('lotes').getAll(); q.onsuccess = () => x(q.result); }); });
ok(ls.every((l) => l.dropbox?.carpeta && l.history.some((h) => /Dropbox/.test(h.text))), 'el lote registra dónde quedó (sincroniza al equipo)');
// 4) Lote guardado con el nombre anterior: el botón de Ajustes lo renombra
const c1 = ls.find((l) => l.cliente === 'Alfadoc').dropbox.carpeta;
const mv = (a, z) => { const f = mock.files.get((c1 + '/' + a).toLowerCase()); mock.files.delete((c1 + '/' + a).toLowerCase()); mock.put(c1 + '/' + z, f.data); };
await pg.evaluate(async () => { const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); }); const l = await new Promise((x) => { const q = d.transaction('lotes').objectStore('lotes').getAll(); q.onsuccess = () => x(q.result.find((y) => y.cliente === 'Alfadoc')); }); delete l.dropbox.nombresNuevos; await new Promise((x) => { const tx = d.transaction('lotes', 'readwrite'); tx.objectStore('lotes').put(l); tx.oncomplete = x; }); });
mv('ContratoIndividualDeTrabajoPorTiempoIndeterminado-Alfadoc-EmpresaDemo-AnaPerezLopez.docx', '01 - ANA PEREZ LOPEZ.docx'); mv('ContratoIndividualDeTrabajoPorTiempoIndeterminado-Alfadoc-EmpresaDemo-AnaPerezLopez-FIRMADO.pdf', '01 - ANA PEREZ LOPEZ - FIRMADO.pdf');
await pg.evaluate(async (c1) => { const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const l = await new Promise((x) => { const q = d.transaction('lotes').objectStore('lotes').getAll(); q.onsuccess = () => x(q.result.find((y) => y.cliente === 'Alfadoc')); });
  l.trabajadores[0].firmado.path = c1 + '/01 - ANA PEREZ LOPEZ - FIRMADO.pdf';
  await new Promise((x) => { const tx = d.transaction('lotes', 'readwrite'); tx.objectStore('lotes').put(l); tx.oncomplete = x; }); }, c1);
await pg.goto(APP + '#/ajustes'); await pg.reload(); await pg.waitForSelector('[data-dbx=renombrar]');
const bt = await pg.textContent('[data-dbx=renombrar]'); ok(/Acomodar 2 /.test(bt), 'botón: 2 archivos del lote: ' + bt);
await pg.click('[data-dbx=renombrar]'); await pg.click('dialog.modal button[value=ok]'); await pg.waitForTimeout(1200);
ok(files().includes(c1 + '/ContratoIndividualDeTrabajoPorTiempoIndeterminado-Alfadoc-EmpresaDemo-AnaPerezLopez.docx') && files().includes(c1 + '/ContratoIndividualDeTrabajoPorTiempoIndeterminado-Alfadoc-EmpresaDemo-AnaPerezLopez-FIRMADO.pdf') && !files().some((p) => p.includes('01 - ANA')), 'lote renombrado');
ok(await pg.locator('[data-dbx=renombrar]').count() === 0, 'ya no queda nada por renombrar');
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'TODO OK'); await b.close();
