import { chromium } from 'playwright';
const S = process.argv[2] || '..';
const APP = 'http://localhost:5173/';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const pg = await b.newPage({ viewport: { width: 1280, height: 1000 } });
pg.on('pageerror', (e) => errors.push(e.message));
await pg.goto(APP + '#/catalogo'); await pg.waitForSelector('#app');
await pg.evaluate(async () => {
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (v) => new Promise((x) => { const tx = d.transaction('parties', 'readwrite'); tx.objectStore('parties').put(v); tx.oncomplete = x; });
  const base = { kind: 'pm', propia: true, activa: true, accionistas: [], createdAt: 1, updatedAt: 1 };
  await put({ ...base, id: 'sin', nombre: 'AGENDA DEMO S.A. DE C.V.', rfc: 'ADE210304LX9', domicilio: 'CALLE 1', apoderados: [] });
  await put({ ...base, id: 'con', nombre: 'OTRA DEMO S.A. DE C.V.', rfc: 'ODE010101AA1', domicilio: 'CALLE 2', escrituraNumero: '10', escrituraFecha: '2020-01-01', notario: 'Lic. Uno', notariaNumero: '5', notariaCiudad: 'CDMX', folioMercantil: '123',
    apoderados: [{ id: 'a1', nombre: 'ANA APODERADA', cargo: 'Apoderada', vigente: true, poderNumero: '9', poderFecha: '', notario: 'Lic. Dos', notariaNumero: '7', notariaCiudad: 'CDMX' },
      { id: 'a2', nombre: 'BETO VIEJO', vigente: false, poderNumero: '', poderFecha: '' }] });
});
const faltan = async () => pg.$$eval('#party-form .field.falta [data-k]', (els) => els.map((e) => (e.closest('[data-list]') ? `a${e.closest('[data-list]').dataset.i}.` : '') + e.dataset.k));

// Sin escritura ni apoderados: los 6 campos de la escritura en rojo y la sección de apoderados marcada
await pg.reload(); await pg.waitForSelector('.ll-row[data-id="sin"]'); await pg.evaluate(() => { location.hash = '#/catalogo/sin'; }); await pg.waitForSelector('#party-form');
const f1 = await faltan();
ok(['escrituraNumero', 'escrituraFecha', 'notario', 'notariaNumero', 'notariaCiudad', 'folioMercantil'].every((k) => f1.includes(k)) && f1.length === 6, 'campos de la escritura en rojo: ' + f1.join(','));
ok(!f1.includes('correo') && !f1.includes('telefono'), 'correo y teléfono (opcionales) no van en rojo');
const opc = async () => pg.$$eval('#party-form .field.opcional [data-k]', (els) => els.map((e) => e.dataset.k));
ok((await opc()).sort().join() === 'correo,folioFecha,folioLugar,objetoSocial,telefono', 'opcionales vacíos en amarillo: ' + (await opc()).join(','));
ok(await pg.$eval('#party-form [data-k="correo"]', (e) => getComputedStyle(e).borderColor) !== await pg.$eval('#party-form [data-k="notario"]', (e) => getComputedStyle(e).borderColor), 'amarillo distinto del rojo');
ok(await pg.$eval('#party-apoderados', (e) => e.classList.contains('falta')), 'sin apoderado vigente: la sección de apoderados en rojo');
ok((await pg.textContent('#party-gaps')).includes('Están marcados en rojo'), 'el aviso dice que están en rojo');
ok(await pg.$eval('#party-form [data-k="notario"]', (e) => getComputedStyle(e).borderColor) !== await pg.$eval('#party-form [data-k="rfc"]', (e) => getComputedStyle(e).borderColor), 'el borde de un faltante es distinto al de un campo normal');
await pg.screenshot({ path: S + '/shots/faltantes-ficha.png', fullPage: true });
// Al capturar se quita el rojo y se actualiza el aviso, sin esperar a salir del campo
await pg.fill('#party-form [data-k="escrituraNumero"]', '1234');
ok(!(await faltan()).includes('escrituraNumero'), 'al escribir la escritura deja de estar en rojo');
ok(!(await pg.textContent('#party-gaps')).includes('Escritura,'), 'el aviso ya no menciona la escritura');
await pg.fill('#party-form [data-k="escrituraNumero"]', '');
await pg.fill('#party-form [data-k="correo"]', 'contacto@example.com');
ok(!(await opc()).includes('correo'), 'al capturar el correo deja de estar en amarillo');
ok((await faltan()).includes('escrituraNumero'), 'al borrarla vuelve a marcarse');

// Con apoderado vigente sin fecha de poder: solo ese campo del apoderado vigente
await pg.evaluate(() => { location.hash = '#/catalogo/con'; }); await pg.waitForSelector('#party-form'); await pg.waitForTimeout(300);
const f2 = await faltan();
ok(f2.join() === 'a0.poderFecha', 'solo la fecha del poder del apoderado vigente: ' + f2.join(','));
const opcApo = async (i) => pg.$$eval(`[data-list="apoderados"][data-i="${i}"] .field.opcional [data-k]`, (els) => els.map((e) => e.dataset.k));
ok((await opcApo(0)).sort().join() === 'correo,facultades,identificacion,identificacionVigencia', 'apoderado vigente: opcionales vacíos en amarillo: ' + (await opcApo(0)).join(','));
ok((await opcApo(1)).length === 0, 'apoderado no vigente: sin marcas');
await pg.fill('[data-list="apoderados"][data-i="0"] [data-k="facultades"]', 'pleitos y cobranzas');
ok(!(await opcApo(0)).includes('facultades'), 'al capturar facultades deja de estar en amarillo');
ok(!(await pg.$eval('#party-apoderados', (e) => e.classList.contains('falta'))), 'con apoderado vigente la sección no se marca');
await pg.fill('[data-list="apoderados"][data-i="0"] [data-k="poderFecha"]', '2021-05-05');
ok((await faltan()).length === 0 && await pg.$eval('#party-gaps', (e) => e.hidden), 'completa: sin rojos y sin aviso');
// Mismo cálculo que la lista del catálogo ("Faltan N datos")
await pg.evaluate(() => { location.hash = '#/catalogo'; }); await pg.waitForTimeout(400);
ok(!(await pg.textContent('.ll-row[data-id="con"]')).includes('Faltan'), 'la lista ya no dice que falten datos');
ok(!errors.length, 'sin errores: ' + errors.join(' | '));
await b.close();
process.exit(errors.length ? 1 : 0);
