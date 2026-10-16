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

const CSF2 = await mkPdf(['CONSTANCIA DE SITUACIÓN FISCAL', 'Datos de Identificación del Contribuyente:', 'RFC: OEP200101XY9', 'Denominación/Razón Social: OTRA EMPRESA PRUEBA', 'Régimen Capital: SOCIEDAD ANONIMA DE CAPITAL VARIABLE', 'Nombre Comercial:', 'Datos del domicilio registrado', 'Código Postal:06000 Tipo de Vialidad: CALLE', 'Nombre de Vialidad: REFORMA Número Exterior: 10', 'Nombre de la Colonia: CENTRO', 'Nombre del Municipio o Demarcación Territorial: CUAUHTEMOC', 'Nombre de la Entidad Federativa: CIUDAD DE MÉXICO']);
const PODER2 = await mkPdf(['INSTRUMENTO NÚMERO DOS MIL. En la Ciudad de México, el 5 de mayo de 2021, ante el Lic. Pedro Gómez Ruiz, Notario Público número 45 de la Ciudad de México, comparece OTRA EMPRESA PRUEBA, S.A. DE C.V., a fin de otorgar poder general para actos de administración en favor del señor Luis Martínez Soto, quien acepta. Texto de relleno para que tenga suficientes letras en el documento.']);
const PODER3 = await mkPdf(['INSTRUMENTO NÚMERO TRES MIL. En la Ciudad de México, el 6 de junio de 2022, ante el Lic. Pedro Gómez Ruiz, Notario Público número 45, comparece DESCONOCIDA SIN FICHA, S.C., a fin de otorgar poder general para pleitos y cobranzas en favor de la señora Ana López Díaz, quien acepta. Texto de relleno para que tenga suficientes letras en el documento.']);
await pg.evaluate(async () => {
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (v) => new Promise((x) => { const tx = d.transaction('parties', 'readwrite'); tx.objectStore('parties').put(v); tx.oncomplete = x; });
  await put({ id: 'e1', kind: 'pm', propia: true, activa: true, nombre: 'EMPRESA EJEMPLO DEMO, S.A. DE C.V.', rfc: 'EJE100315AB1', domicilio: '', correo: '', telefono: '', escrituraNumero: '', escrituraFecha: '', notario: '', notariaNumero: '', notariaCiudad: '', folioMercantil: '', folioFecha: '', objetoSocial: '', curp: '', expediente: '', notas: '', apoderados: [], accionistas: [], createdAt: 1, updatedAt: 1 });
});
const all = () => pg.evaluate(async () => { const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  return new Promise((x) => { const q = d.transaction('parties').objectStore('parties').getAll(); q.onsuccess = () => x(q.result); }); });

// 1) Dentro de la ficha: dos documentos de la misma empresa a la vez
await pg.reload(); await pg.waitForSelector('#cat-new'); await pg.evaluate(() => { location.hash = '#/catalogo/e1'; });
await pg.waitForSelector('#party-extract');
await pg.click('#party-extract');
let [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('dialog.modal button[value=local]')]);
ok(fc.isMultiple(), 'la ficha permite elegir varios PDF');
await fc.setFiles([{ name: 'csf.pdf', mimeType: 'application/pdf', buffer: CSF }, { name: 'poder.pdf', mimeType: 'application/pdf', buffer: PODER }]);
await pg.waitForSelector('#ex-filas');
ok((await pg.textContent('dialog.modal h2, dialog.modal .modal-title, dialog.modal header')).includes('1 de 2'), 'primer documento: 1 de 2');
await pg.click('dialog.modal button[value=ok]');
await pg.waitForSelector('#ex-apo');
ok((await pg.textContent('dialog.modal')).includes('2 de 2') && (await pg.inputValue('#ex-tipo')) === 'poder', 'segundo documento: el poder');
await pg.click('dialog.modal button[value=ok]');
await pg.waitForTimeout(600);
let e1 = (await all()).find((p) => p.id === 'e1');
ok(e1.domicilio.startsWith('AVENIDA CONSTITUYENTES') && e1.apoderados.length === 1 && e1.apoderados[0].poderNumero === '4,500', 'se aplicaron los dos documentos a la misma ficha');

// 2) Alta masiva desde el Catálogo
await pg.goto(APP + '#/catalogo'); await pg.waitForSelector('#cat-pdf');
await pg.click('#cat-pdf');
[fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('dialog.modal button[value=local]')]);
await fc.setFiles([
  { name: 'poder-otra.pdf', mimeType: 'application/pdf', buffer: PODER2 },
  { name: 'csf-otra.pdf', mimeType: 'application/pdf', buffer: CSF2 },
  { name: 'csf-ejemplo.pdf', mimeType: 'application/pdf', buffer: CSF },
  { name: 'escaneado.pdf', mimeType: 'application/pdf', buffer: SCAN },
  { name: 'poder-desconocida.pdf', mimeType: 'application/pdf', buffer: PODER3 },
]);
await pg.waitForSelector('.alta-list');
const t = await pg.textContent('dialog.modal');
const filas = await pg.$$eval('.alta-list .ll-row:not(.ll-head)', (rs) => rs.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
console.log(filas);
ok(filas.length === 2, 'dos fichas en el plan (nueva + existente)');
const fo = filas.find((x) => x.includes('OTRA EMPRESA'));
ok(fo && fo.includes('Nueva') && fo.includes('LUIS MARTINEZ SOTO'.replace(/./g, (c) => c)) || (fo && fo.includes('Nueva') && /Luis Mart/i.test(fo)), 'nueva con su poder aunque el poder venga antes que la constancia: ' + fo);
const fe = filas.find((x) => x.includes('EMPRESA EJEMPLO'));
ok(fe && fe.includes('Sin cambios'), 'existente sin datos nuevos: sin cambios');
ok(t.includes('escaneado.pdf') && t.includes('poder-desconocida.pdf') && t.includes('No se usaron (2)'), 'lista los omitidos con motivo');
await pg.screenshot({ path: S + '/alta-pdf.png', fullPage: true });
await pg.selectOption('dialog.modal select[name=propia]', 'si');
await pg.click('dialog.modal button[value=ok]');
await pg.waitForTimeout(600);
const ps = await all();
const otra = ps.find((p) => p.rfc === 'OEP200101XY9');
ok(ps.length === 2 && otra && otra.propia && otra.domicilio.includes('REFORMA') && otra.apoderados.length === 1 && otra.apoderados[0].poderNumero === '2,000', 'guardó la nueva como empresa del grupo con domicilio y apoderado');
ok((await pg.locator('.party-list .ll-row[data-id]').count()) === 2, 'catálogo con 2 fichas');
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'TODO OK'); await b.close();
