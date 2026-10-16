import { chromium } from 'playwright';
const S = process.argv[2] || '.'; const APP = 'http://localhost:5173/';
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
await pg.goto(APP + '#/catalogo'); await pg.waitForSelector('#cat-new');
// PDFs ficticios generados con jsPDF en la página
const mkPdf = (lines, blank = false) => pg.evaluate(async ({ lines, blank }) => {
  if (!window.jspdf) await new Promise((r) => { const s = document.createElement('script'); s.src = 'vendor/jspdf.umd.min.js'; s.onload = r; document.head.appendChild(s); });
  const d = new window.jspdf.jsPDF();
  if (blank) { d.setFillColor(200, 200, 200); d.rect(10, 10, 100, 100, 'F'); }
  else { let y = 15; for (const l of lines) for (const w of d.splitTextToSize(l, 180)) { d.text(w, 10, y); y += 7; if (y > 280) { d.addPage(); y = 15; } } }
  const u8 = new Uint8Array(d.output('arraybuffer')); let s = ''; for (const x of u8) s += String.fromCharCode(x); return btoa(s);
}, { lines, blank }).then((b64) => Buffer.from(b64, 'base64'));
const CSF = await mkPdf(['CONSTANCIA DE SITUACIÓN FISCAL', 'Datos de Identificación del Contribuyente:', 'RFC: EJE100315AB1', 'Denominación/Razón Social: EMPRESA EJEMPLO DEMO', 'Régimen Capital: SOCIEDAD ANONIMA DE CAPITAL VARIABLE', 'Nombre Comercial:', 'Fecha inicio de operaciones: 15 DE MARZO DE 2010', 'Datos del domicilio registrado', 'Código Postal:76000 Tipo de Vialidad: AVENIDA (AV.)', 'Nombre de Vialidad: CONSTITUYENTES Número Exterior: 100', 'Número Interior: 5 Nombre de la Colonia: CENTRO', 'Nombre del Municipio o Demarcación Territorial: QUERÉTARO', 'Nombre de la Entidad Federativa: QUERÉTARO Entre Calle: JUÁREZ']);
const PODER = await mkPdf(['INSTRUMENTO NÚMERO CUATRO MIL QUINIENTOS. En Querétaro, el 3 de julio de 2018, ante el Lic. Ana María Torres, Notario Público número 21 del Estado de Querétaro, comparece EMPRESA EJEMPLO DEMO, S.A. DE C.V., a fin de otorgar poder general para pleitos y cobranzas y actos de administración en favor del señor Carlos Hernández Vega, quien acepta. Texto de relleno para que tenga suficientes letras.']);
const SCAN = await mkPdf([], true);

await pg.evaluate(async () => {
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (v) => new Promise((x) => { const tx = d.transaction('parties', 'readwrite'); tx.objectStore('parties').put(v); tx.oncomplete = x; });
  await put({ id: 'e1', kind: 'pm', propia: true, activa: true, nombre: 'EMPRESA EJEMPLO DEMO, S.A. DE C.V.', rfc: 'EJE100315AB1', domicilio: 'DOMICILIO VIEJO', correo: '', telefono: '', escrituraNumero: '', escrituraFecha: '', notario: '', notariaNumero: '', notariaCiudad: '', folioMercantil: '', folioFecha: '', objetoSocial: '', curp: '', expediente: '', notas: '',
    apoderados: [{ id: 'a1', nombre: 'CARLOS HERNANDEZ VEGA', cargo: 'Apoderado legal', poderNumero: '', poderFecha: '', notario: '', notariaNumero: '', notariaCiudad: '', facultades: '', vigente: true }], accionistas: [], createdAt: 1, updatedAt: 1 });
});
await pg.reload(); await pg.waitForSelector('#cat-new'); await pg.evaluate(() => { location.hash = '#/catalogo/e1'; });
await pg.waitForSelector('#party-extract');
const subir = async (buf, name) => {
  await pg.click('#party-extract');
  const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('dialog.modal button[value=local]')]);
  await fc.setFiles({ name, mimeType: 'application/pdf', buffer: buf });
};
// 1) CSF
await subir(CSF, 'csf.pdf');
await pg.waitForSelector('#ex-filas');
const txt = await pg.textContent('dialog.modal');
ok((await pg.inputValue('#ex-tipo')) === 'csf', 'detecta CSF');
ok(await pg.isChecked('input[name=u_domicilio]') === false && txt.includes('Distinto'), 'domicilio existente distinto viene sin marcar');
ok(txt.includes('Igual'), 'RFC igual marcado como Igual');
ok((await pg.inputValue('textarea[name=v_domicilio]')).startsWith('AVENIDA CONSTITUYENTES NO. 100'), 'domicilio armado');
await pg.screenshot({ path: S + '/x1-csf.png' });
await pg.check('input[name=u_domicilio]');
await pg.fill('textarea[name=v_domicilio]', 'AVENIDA CONSTITUYENTES NO. 100 INT. 5, COL. CENTRO, C.P. 76000, QUERÉTARO, QRO.');
await pg.click('dialog.modal button[value=ok]');
await pg.waitForFunction(() => document.querySelector('[data-k=domicilio]')?.value.includes('QRO.'));
ok(true, 'aplica el domicilio corregido a mano');
ok((await pg.inputValue('#party-form [data-k=nombre]')) === 'EMPRESA EJEMPLO DEMO, S.A. DE C.V.', 'no toca lo no marcado');
// 2) Poder → apoderado existente sugerido
await subir(PODER, 'poder.pdf');
await pg.waitForSelector('#ex-apo');
ok((await pg.inputValue('#ex-tipo')) === 'poder', 'detecta poder');
ok((await pg.inputValue('#ex-apo')) === 'a1', 'sugiere el apoderado existente por nombre');
ok(await pg.isChecked('input[name=u_poderNumero]'), 'número de poder vacío viene marcado');
await pg.screenshot({ path: S + '/x2-poder.png' });
await pg.selectOption('#ex-apo', '');
ok(await pg.isChecked('input[name=u_nombre]'), 'con nuevo apoderado el nombre viene marcado');
await pg.selectOption('#ex-apo', 'a1');
ok(!(await pg.isChecked('input[name=u_nombre]')), 'de vuelta al existente el nombre no viene marcado');
await pg.click('dialog.modal button[value=ok]');
await pg.waitForFunction(() => [...document.querySelectorAll('[data-list=apoderados] [data-k=poderNumero]')].some((i) => i.value === '4,500'));
const apos = await pg.evaluate(() => [...document.querySelectorAll('[data-list=apoderados]')].length);
ok(apos === 1, 'actualizó el existente, sin duplicar');
ok((await pg.inputValue('[data-list=apoderados] [data-k=poderFecha]')) === '2018-07-03', 'fecha del poder');
// 3) Escaneado
await subir(SCAN, 'scan.pdf');
await pg.waitForSelector('dialog.modal >> text=parece escaneado');
ok(true, 'avisa PDF escaneado');
await pg.click('dialog.modal .btn.primary');
// persistencia
await pg.reload(); await pg.waitForSelector('#party-form');
ok((await pg.inputValue('[data-k=domicilio]')).includes('QRO.'), 'persistió tras recargar');
await pg.setViewportSize({ width: 390, height: 800 });
await subir(CSF, 'csf.pdf'); await pg.waitForSelector('#ex-filas');
const ov = await pg.evaluate(() => document.querySelector('dialog.modal').scrollWidth <= window.innerWidth + 1);
ok(ov, 'móvil sin scroll horizontal'); await pg.screenshot({ path: S + '/x3-movil.png' });
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'TODO OK'); await b.close();
