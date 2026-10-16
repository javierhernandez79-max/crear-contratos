import { chromium } from 'playwright';
const S = process.argv[2]; const APP = 'http://localhost:5173/';
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|guárdalo como .docx/.test(m.text())) errors.push(m.text()); });
await pg.goto(APP + '#/plantillas'); await pg.waitForSelector('#tpl-word');
// .doc viejo: error claro
await pg.click('#tpl-word');
await pg.setInputFiles('dialog.modal input[type=file]', S + '/pw/viejo.doc');
await pg.click('dialog.modal button[value=ok]'); await pg.waitForTimeout(800);
ok((await pg.textContent('body')).includes('guárdalo como .docx'), '.doc: aviso de guardarlo como .docx');
// Word bueno
await pg.click('#tpl-word');
await pg.setInputFiles('dialog.modal input[type=file]', S + '/pw/arrendamiento.docx');
ok(await pg.inputValue('dialog.modal [name=nombre]') === 'arrendamiento', 'nombre propuesto desde el archivo');
await pg.fill('dialog.modal [name=nombre]', 'Contrato de arrendamiento');
await pg.selectOption('dialog.modal [name=categoria]', 'comercial');
await pg.click('dialog.modal summary');
await pg.screenshot({ path: S + '/shots/pw1-subir.png' });
await pg.click('dialog.modal button[value=ok]');
await pg.waitForSelector('dialog.modal >> text=Revisa la plantilla');
const rev = await pg.textContent('dialog.modal');
ok(rev.includes('7 datos') && rev.includes('2 firmantes'), 'resumen: 7 datos y 2 firmantes');
await pg.screenshot({ path: S + '/shots/pw2-revisa.png' });
await pg.click('dialog.modal button[value=ok]'); await pg.waitForTimeout(600);
ok((await pg.textContent('.tpl-list')).includes('Contrato de arrendamiento'), 'aparece en Mis plantillas');
await pg.screenshot({ path: S + '/shots/pw3-lista.png' });
// Mismo nombre: no duplica
await pg.click('#tpl-word');
await pg.setInputFiles('dialog.modal input[type=file]', S + '/pw/arrendamiento.docx');
await pg.fill('dialog.modal [name=nombre]', 'contrato de arrendamiento');
await pg.click('dialog.modal button[value=ok]'); await pg.waitForTimeout(600);
ok((await pg.textContent('body')).includes('Ya existe una plantilla'), 'no permite nombre repetido');
// Contrato desde la plantilla
const id = await pg.evaluate(async () => {
  const m = await import('./js/model.js');
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const t = await new Promise((x) => { const q = d.transaction('templates').objectStore('templates').getAll(); q.onsuccess = () => x(q.result.find((y) => y.name === 'Contrato de arrendamiento')); });
  const c = m.newContractFromTemplate(t);
  Object.assign(c.variables, { arrendador_nombre: 'INMUEBLES SA', arrendador_representante: 'ANA', arrendatario_nombre: 'JUAN PÉREZ', arrendatario_rfc: 'PEJJ800101AAA', arrendador_domicilio: 'Calle 1', monto_renta: '15000', fecha_inicio: '2026-11-01' });
  await new Promise((x) => { const tx = d.transaction('contracts', 'readwrite'); tx.objectStore('contracts').put(c); tx.oncomplete = x; });
  return c.id;
});
await pg.reload(); await pg.evaluate((i) => { location.hash = `#/c/${i}/documento`; }, id); await pg.waitForSelector('[data-wf=approve]');
ok((await pg.textContent('body')).includes('Word de la plantilla'), 'aviso de Word de la plantilla (sin código de formato)');
const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('[data-wf=approve]').then(() => pg.click('dialog.modal button[value=ok]'))]);
await dl.saveAs(S + '/pw/salida.docx');
ok(dl.suggestedFilename().endsWith('APROBADO.docx'), 'aprobado genera el Word: ' + dl.suggestedFilename());
await pg.waitForSelector('[data-wf=ds-send]');
await pg.screenshot({ path: S + '/shots/pw4-contrato.png', fullPage: true });
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'TODO OK'); await b.close();
