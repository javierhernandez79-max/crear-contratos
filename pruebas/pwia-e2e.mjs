import { chromium } from 'playwright'; import { readFileSync } from 'fs';
const S = process.argv[2]; const APP = 'http://localhost:5173/';
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const prop = readFileSync(S + '/pw/propuesta.json', 'utf8');
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
let iaActiva = false; let enviado = null;
await ctx.route('**/api/ia', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ activa: iaActiva, admin: false }) }));
await ctx.route('**/api/plantilla-ia', (r) => { enviado = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: 'application/json', body: prop }); });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|apagada|no está disponible/.test(m.text())) errors.push(m.text()); });
await pg.goto(APP + '#/plantillas'); await pg.waitForSelector('#tpl-word');
const subir = async () => {
  await pg.click('#tpl-word');
  await pg.setInputFiles('dialog.modal input[type=file]', S + '/pw/sin-marcas.docx');
  await pg.fill('dialog.modal [name=nombre]', 'Arrendamiento IA');
  await pg.click('dialog.modal button[value=ok]');
};
// IA apagada: aviso claro
await subir(); await pg.waitForTimeout(800);
ok((await pg.textContent('body')).includes('la lectura con IA está apagada'), 'sin marcas e IA apagada: aviso');
iaActiva = true;
await subir();
await pg.waitForSelector('dialog.modal >> text=Datos que encontró la IA');
ok(enviado?.parrafos?.length === 13 && enviado.parrafos[1].includes('INMUEBLES DEL CENTRO') && enviado.parrafos[4].includes('⟦B0⟧'), 'manda el texto de los párrafos con los blancos numerados');
const n = await pg.$$eval('dialog.modal .ia-campo', (els) => els.length);
ok(n === 11, 'muestra los 11 campos propuestos');
ok(await pg.isDisabled('dialog.modal [name=c10]') && (await pg.textContent('dialog.modal')).includes('no se encontró en el Word'), 'el que no está en el Word sale desmarcado');
await pg.screenshot({ path: S + '/shots/pwia1-revision.png' });
await pg.uncheck('dialog.modal [name=c8]'); // ciudad de firma queda como texto fijo
await pg.fill('dialog.modal [name=e6]', 'Renta mensual (con IVA)');
await pg.click('dialog.modal button[value=ok]');
await pg.waitForSelector('dialog.modal >> text=Revisa la plantilla');
const rev = await pg.textContent('dialog.modal');
ok(rev.includes('9 datos') && rev.includes('2 firmantes') && rev.includes('Renta mensual (con IVA)') && !rev.includes('ciudad_firma'), 'resumen con lo elegido');
await pg.click('dialog.modal button[value=ok]'); await pg.waitForTimeout(600);
ok((await pg.textContent('.tpl-list')).includes('Arrendamiento IA'), 'plantilla creada');
await pg.screenshot({ path: S + '/shots/pwia2-lista.png' });
// Un Word que ya trae marcas no llama a la IA
enviado = null;
await pg.click('#tpl-word');
await pg.setInputFiles('dialog.modal input[type=file]', S + '/pw/arrendamiento.docx');
await pg.fill('dialog.modal [name=nombre]', 'Con marcas');
await pg.click('dialog.modal button[value=ok]');
await pg.waitForSelector('dialog.modal >> text=Revisa la plantilla');
ok(enviado === null, 'Word con marcas: no se llama a la IA');
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'TODO OK'); await b.close();
