import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { createMockDropbox } from './mockdbx.mjs';
const S = process.argv[2];
const APP = 'http://localhost:5173/';
const mock = createMockDropbox();
// La carpeta compartida ya existe en la raíz del equipo (como en la cuenta real)
mock.put('/Contratos App/LEEME.txt', Buffer.from('carpeta del equipo'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
let step = '';
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) errors.push(msg); };

async function user(id, name) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await mock.attach(ctx, { id, name, email: `${id}@example.com` });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errors.push(`[${id}] ${step}: ${e.message}`));
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${id}] ${step}: ${m.text()}`); });
  await pg.goto(APP + '#/ajustes');
  await pg.waitForSelector('#dbx-key');
  await pg.fill('#dbx-key', 'appkey123');
  await pg.fill('#dbx-folder', '/Contratos App');
  await pg.click('[data-dbx=connect]');
  await pg.waitForSelector('[data-dbx=sync]', { timeout: 15000 });
  await sync(pg);
  return pg;
}
async function sync(pg) {
  await pg.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  await pg.click('#sync-pill');
  await pg.waitForFunction(() => !document.querySelector('#sync-pill').classList.contains('busy'), null, { timeout: 15000 });
  await pg.waitForTimeout(300);
}
const fileNames = () => [...mock.files.values()].map((f) => f.path);

step = 'A conecta';
const A = await user('a', 'Usuario Uno');
ok(await A.textContent('#dbx-block').then((t) => t.includes('Conectado como Usuario Uno')), 'A conectado');
await A.screenshot({ path: S + '/d1-settings.png', fullPage: true });

step = 'A importa catálogo y crea contrato';
await A.goto(APP + '#/catalogo');
await A.waitForSelector('#cat-export');
await A.setInputFiles('#cat-import', S + '/rt.xlsx');
await A.click('dialog.modal button[value=ok]');
await A.waitForSelector('.party-list .ll-row[data-id]');
await A.goto(APP + '#/plantillas');
await A.locator('.tpl-list .ll-row[data-id]').first().click();
await A.click('dialog.modal button[value=use]');
await A.waitForSelector('.parties-box');
await A.locator('.party-slot').first().locator('[data-pact=pick]').click();
await A.locator('.party-pick').first().click();
await A.click('dialog.modal button[value=ok]');
await A.waitForTimeout(800);
const contractUrl = A.url();
const contractId = contractUrl.split('/c/')[1].split('/')[0];
await sync(A);
ok(fileNames().includes('/Contratos App/catalogo-partes.xlsx'), 'catálogo subido a Dropbox');
ok(fileNames().includes(`/Contratos App/datos-app/contratos/${contractId}.json`), 'contrato subido a Dropbox');

step = 'B conecta';
const B = await user('b', 'Abogada Uno');
await B.goto(APP + '#/');
await B.waitForSelector('.contract-list .ll-row[data-id]');
ok(await B.locator('.contract-list .ll-row[data-id]').count() === 1, 'B ve el contrato de A');
ok((await B.textContent('.contract-list .ll-row[data-id]')).includes('Usuario Uno'), 'B ve quién lo modificó');
await B.goto(APP + '#/catalogo');
await B.waitForSelector('.party-list .ll-row[data-id]');
ok(await B.locator('.party-list .ll-row[data-id]').count() === 2, 'B ve las 2 partes del catálogo');

step = 'B edita una parte';
await B.locator('.party-list .ll-row[data-id]', { hasText: 'Grupo Ejemplo' }).click();
await B.fill('[data-k=telefono]', '5512345678');
await B.waitForTimeout(700);
await B.goto(APP + '#/catalogo');
await sync(B);
await sync(A);
await A.goto(APP + '#/catalogo');
await A.locator('.party-list .ll-row[data-id]', { hasText: 'Grupo Ejemplo' }).click();
ok(await A.inputValue('[data-k=telefono]') === '5512345678', 'A recibe el cambio de B en el catálogo');

step = 'Edición directa del Excel en Dropbox';
{
  const f = mock.files.get('/contratos app/catalogo-partes.xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(f.data);
  const ws = wb.getWorksheet('Catálogo');
  const hdr = {};
  ws.getRow(1).eachCell((c, i) => { hdr[c.value] = i; });
  const r = ws.addRow([]);
  r.getCell(hdr['Tipo (Moral/Física)']).value = 'Moral';
  r.getCell(hdr['Empresa del grupo (Sí/No)']).value = 'Sí';
  r.getCell(hdr['Activa (Sí/No)']).value = 'Sí';
  r.getCell(hdr['Nombre o razón social']).value = 'Inmobiliaria Nueva, S.A.P.I. de C.V.';
  r.getCell(hdr['RFC']).value = 'INU200101AA1';
  mock.put('/Contratos App/catalogo-partes.xlsx', await wb.xlsx.writeBuffer());
}
await A.goto(APP + '#/catalogo');
await sync(A);
await A.waitForSelector('.party-list .ll-row[data-id]');
ok(await A.locator('.party-list .ll-row[data-id]', { hasText: 'Inmobiliaria Nueva' }).count() === 1, 'A ve la fila agregada a mano en Excel');
await sync(B);
const idOf = (pg) => pg.evaluate(async () => {
  const req = indexedDB.open('crear-contratos');
  const dbh = await new Promise((r) => { req.onsuccess = () => r(req.result); });
  const all = await new Promise((r) => { const q = dbh.transaction('parties').objectStore('parties').getAll(); q.onsuccess = () => r(q.result); });
  return all.find((p) => p.rfc === 'INU200101AA1')?.id;
});
const idA = await idOf(A);
const idB = await idOf(B);
ok(idA && idA === idB, `mismo ID en ambos equipos para la fila nueva (${idA} / ${idB})`);
{
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(mock.files.get('/contratos app/catalogo-partes.xlsx').data);
  const ws = wb.getWorksheet('Catálogo'); let col = 0; ws.getRow(1).eachCell((c, i) => { if (c.value === 'ID (no modificar)') col = i; });
  let ids = 0; ws.eachRow((r, i) => { if (i > 1 && r.getCell(col).value) ids++; });
  ok(ids === 3, `el Excel en Dropbox tiene los 3 ID escritos (${ids})`);
}

step = 'Conflicto en contrato';
await A.goto(contractUrl.replace('/variables', '/secciones'));
await A.waitForSelector('#doc-title');
await B.goto(APP + `#/c/${contractId}/secciones`);
await B.waitForSelector('#doc-title');
await B.fill('#doc-title', 'NDA editado por B');
await B.waitForTimeout(800);
await sync(B);
// A edita sin haber sincronizado
await A.evaluate(() => { window.__noSync = true; });
await A.fill('#doc-title', 'NDA editado por A');
await A.waitForTimeout(800);
await sync(A);
await A.goto(APP + '#/');
await A.waitForSelector('.contract-list .ll-row[data-id]');
const titles = await A.locator('.contract-list .ll-row[data-id] > span:first-child > strong').allTextContents();
ok(titles.includes('NDA editado por B') && titles.some((t) => t.startsWith('NDA editado por A (copia en conflicto')), `conflicto: queda la de B y la de A como copia (${titles.join(' | ')})`);

step = 'Anexos';
// Carpeta existente con nombre corto: debe reconocerse como expediente de "Grupo Ejemplo, S.A. de C.V."
mock.put('/Contratos App/EXPEDIENTES CORPORATIVOS RM/GRUPO EJEMPLO/Acta constitutiva.pdf', Buffer.from('%PDF acta'));
await A.goto(APP + `#/c/${contractId}/anexos`);
await A.waitForSelector('[data-act=upload]');
await A.click('[data-act=upload]');
await A.waitForSelector('dialog.modal .radio-list');
const [chooser] = await Promise.all([A.waitForEvent('filechooser'), A.click('dialog.modal button[value=ok]')]);
await chooser.setFiles({ name: 'INE representante.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 prueba') });
await A.waitForSelector('.anexo');
ok(fileNames().includes('/Contratos App/EXPEDIENTES CORPORATIVOS RM/GRUPO EJEMPLO/INE representante.pdf'), `anexo subido a la carpeta existente de la empresa (${fileNames().filter((p) => p.includes('EXPEDIENTES')).join(', ')})`);
await A.click('[data-act=pick]');
await A.waitForSelector('.file-item');
await A.screenshot({ path: S + '/d2-browse.png' });
await A.locator('.file-item', { hasText: 'Acta constitutiva' }).locator('input').check();
await A.click('dialog.modal button[value=ok]');
await A.waitForTimeout(300);
ok(await A.locator('.anexo').count() === 2, '2 anexos en el contrato');
await A.screenshot({ path: S + '/d3-anexos.png', fullPage: true });
const [pdf] = await Promise.all([A.waitForEvent('download'), A.click('#btn-more').then(() => A.click('dialog.modal button[value=pdf]')).then(() => A.waitForTimeout(400)).then(async () => { if (await A.locator('dialog.modal button[value=ok]').count()) await A.click('dialog.modal button[value=ok]'); })]);
await pdf.saveAs(S + '/anexos.pdf');

step = 'Borrado';
await sync(A);
await sync(B);
await B.goto(APP + '#/');
await B.waitForSelector('.contract-list .ll-row[data-id]');
const before = await B.locator('.contract-list .ll-row[data-id]').count();
await B.locator('.contract-list .ll-row[data-id]').first().locator('[data-act=menu]').click();
await B.click('dialog.modal button[value=del]');
await B.click('dialog.modal button[value=ok]');
await B.waitForTimeout(300);
await sync(B);
await sync(A);
await A.goto(APP + '#/');
await A.waitForTimeout(300);
ok(await A.locator('.contract-list .ll-row[data-id]').count() === before - 1, 'A ve el borrado hecho por B');
await A.screenshot({ path: S + '/d4-home.png' });

ok(!fileNames().some((p) => p.startsWith('/Usuario Uno/') || p.startsWith('/Abogada Uno/')), 'nada se escribió en carpetas personales');
console.log('dropbox files:', fileNames());
console.log('errors:', errors);
await b.close();
process.exit(errors.length ? 1 : 0);
