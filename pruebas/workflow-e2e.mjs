import { chromium } from 'playwright';
import { createMockDropbox } from './mockdbx.mjs';
const S = process.argv[2];
const APP = 'http://localhost:5173/';
const mock = createMockDropbox();
mock.put('/Contratos App/LEEME.txt', Buffer.from('x'));
mock.put('/Contratos App/EXPEDIENTES CORPORATIVOS RM/GRUPO EJEMPLO/CSF.pdf', Buffer.from('%PDF'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await mock.attach(ctx, { id: 'a', name: 'Usuario Uno', email: 'a@example.com' });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const files = () => [...mock.files.values()].map((f) => f.path);

await pg.goto(APP + '#/ajustes');
await pg.fill('#dbx-key', 'k');
await pg.fill('#dbx-folder', '/Contratos App');
await pg.click('[data-dbx=connect]');
await pg.waitForSelector('[data-dbx=sync]');
ok((await pg.textContent('#dbx-block')).includes('espacio del equipo'), 'Ajustes indica espacio del equipo');

// Catálogo y contrato de servicios con el Cliente = empresa del grupo
await pg.goto(APP + '#/catalogo');
await pg.setInputFiles('#cat-import', S + '/rt.xlsx');
await pg.click('dialog.modal button[value=ok]');
await pg.waitForSelector('.party-list .ll-row[data-id]');
await pg.goto(APP + '#/plantillas');
await pg.locator('.tpl-list .ll-row[data-id]', { hasText: 'Contrato de consultoría' }).click();
await pg.click('dialog.modal button[value=use]');
await pg.waitForSelector('.parties-box');
await pg.locator('.party-slot').first().locator('[data-pact=pick]').click();
await pg.locator('.party-pick', { hasText: 'Grupo Ejemplo' }).click();
await pg.click('dialog.modal button[value=ok]');
await pg.waitForTimeout(300);
await pg.locator('.var-row[data-key=tarifa_hora] [data-role=value]').fill('150000');
await pg.waitForTimeout(700);
const cid = pg.url().split('/c/')[1].split('/')[0];

// Vista previa con monto en letra
await pg.goto(APP + `#/c/${cid}/vista`);
await pg.waitForSelector('#paper');
ok((await pg.textContent('#paper')).includes('$150,000.00 (CIENTO CINCUENTA MIL PESOS 00/100 M.N.)'), 'monto en letra en el contrato');

// Word para revisión
await pg.goto(APP + `#/c/${cid}/documento`);
await pg.waitForSelector('.stepper');
await pg.screenshot({ path: S + '/w1-documento.png', fullPage: true });
const [dl1] = await Promise.all([pg.waitForEvent('download'), pg.click('[data-wf=review]').then(async () => { await pg.waitForTimeout(300); if (await pg.locator('dialog.modal button[value=ok]').count()) await pg.click('dialog.modal button[value=ok]'); })]);
await dl1.saveAs(S + '/revision.docx');
await pg.waitForSelector('.badge.revision');
const base = '/Contratos App/EXPEDIENTES CORPORATIVOS RM/GRUPO EJEMPLO/CONTRATOS DE SERVICIOS/Contrato de consultoría';
ok(files().includes(`${base}/Contrato de consultoría - v1 revision.docx`), `Word v1 guardado en la carpeta de la empresa (${files().filter((f) => f.includes('CONTRATOS')).join(', ')})`);

// Aprobar
await pg.click('[data-wf=approve]');
const dls = [];
pg.on('download', (d) => dls.push(d));
await pg.click('dialog.modal button[value=ok]');
await pg.waitForSelector('.badge.aprobado');
await pg.waitForTimeout(500);
ok(files().includes(`${base}/Contrato de consultoría - APROBADO.docx`) && files().includes(`${base}/Contrato de consultoría - APROBADO.pdf`), 'Word y PDF aprobados en Dropbox');
await pg.screenshot({ path: S + '/w2-aprobado.png', fullPage: true });

// Editar → regresa a borrador
await pg.goto(APP + `#/c/${cid}/secciones`);
await pg.waitForSelector('.sec-card textarea');
await pg.locator('.sec-card textarea').first().type(' Cambio.');
await pg.waitForTimeout(700);
ok(await pg.locator('#editor-head .badge.borrador').count() === 1, 'una edición regresa el contrato a borrador');

// Editar una plantilla de la app
await pg.goto(APP + '#/plantillas');
await pg.locator('.tpl-list .ll-row[data-id]', { hasText: 'confidencialidad mutuo' }).click();
await pg.click('dialog.modal button[value=edit]');
await pg.waitForSelector('#tpl-form');
await pg.locator('.sub-item[data-list=sections] .sec-title').first().fill('PARTES CONTRATANTES');
await pg.locator('.sub-item[data-list=sections] textarea').first().fill('Contrato entre {{parte_a}} y {{parte_b}} con folio {{folio_interno}}.');
await pg.locator('.sub-item[data-list=sections] textarea').first().dispatchEvent('change');
await pg.waitForTimeout(800);
await pg.screenshot({ path: S + '/w3-tpl.png', fullPage: true });
ok(await pg.locator('[data-act=add-missing]').count() === 1, 'detecta variables sin definir');
if (await pg.locator('[data-act=add-missing]').count()) { await pg.click('[data-act=add-missing]'); await pg.waitForTimeout(400); }
await pg.goto(APP + '#/plantillas');
ok(await pg.locator('.tpl-list .ll-row[data-id]', { hasText: 'confidencialidad mutuo' }).count() === 1, 'la plantilla modificada reemplaza a la original (sin duplicado)');
ok((await pg.locator('.tpl-list .ll-row[data-id]', { hasText: 'confidencialidad mutuo' }).textContent()).includes('Modificada'), 'se marca como modificada');
await pg.locator('.tpl-list .ll-row[data-id]', { hasText: 'confidencialidad mutuo' }).click();
await pg.click('dialog.modal button[value=use]');
await pg.waitForSelector('.parties-box');
await pg.goto(pg.url().replace('/variables', '/secciones'));
await pg.waitForSelector('.sec-title');
ok(await pg.locator('.sec-title').first().inputValue() === 'PARTES CONTRATANTES', 'contrato nuevo usa la plantilla editada');
// Restaurar
await pg.goto(APP + '#/plantilla/u-nda-mutuo');
await pg.waitForSelector('[data-act=restore]');
await pg.click('[data-act=restore]');
await pg.click('dialog.modal button[value=ok]');
await pg.waitForTimeout(400);
await pg.locator('.tpl-list .ll-row[data-id]', { hasText: 'confidencialidad mutuo' }).click();
ok((await pg.textContent('dialog.modal')).includes('Partes'), 'restaurar devuelve la original');
await pg.keyboard.press('Escape');

await pg.click('#sync-pill');
await pg.waitForTimeout(1500);
ok(!files().some((p) => p.startsWith('/Usuario Uno/')), 'nada en carpeta personal');
console.log('errors:', errors);
await b.close();
process.exit(errors.length ? 1 : 0);
