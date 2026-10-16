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
await pg.reload(); await pg.waitForSelector('#cat-new');
const nParties = () => pg.evaluate(async () => { const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); }); return new Promise((x) => { const q = d.transaction('parties').objectStore('parties').getAll(); q.onsuccess = () => x(q.result); }); });
const subir = async (buf, name) => {
  await pg.click('#party-extract');
  const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('dialog.modal button[value=local]')]);
  await fc.setFiles({ name, mimeType: 'application/pdf', buffer: buf });
};
// 1) Nueva ficha vacía + CSF con RFC existente → aplica a la existente y descarta la vacía
await pg.click('#cat-new'); await pg.click('dialog.modal button[value=pm-grupo]');
await pg.waitForSelector('#party-extract');
await subir(CSF, 'csf.pdf'); await pg.waitForSelector('#ex-filas');
await pg.click('dialog.modal button[value=ok]');
await pg.waitForSelector('dialog.modal >> text=RFC ya registrado');
await pg.screenshot({ path: S + '/dup1.png' });
await pg.click('dialog.modal button[value=ok]');
await pg.waitForFunction(() => location.hash === '#/catalogo/e1');
await pg.waitForTimeout(400);
let all = await nParties();
ok(all.length === 1, 'no se duplicó (fichas: ' + all.length + ')');
ok(all[0].domicilio.startsWith('AVENIDA CONSTITUYENTES'), 'datos marcados aplicados a la existente');
// 2) Captura manual del RFC repetido → aviso; "Corregir" deja el RFC vacío
await pg.evaluate(() => { location.hash = '#/catalogo'; }); await pg.waitForSelector('#cat-new');
await pg.click('#cat-new'); await pg.click('dialog.modal button[value=pm]');
await pg.waitForSelector('#party-form');
await pg.fill('#party-form [data-k=nombre]', 'OTRA SA');
await pg.fill('#party-form > * [data-k=rfc], #party-form [data-k=rfc] >> nth=0', 'eje100315ab1');
await pg.locator('#party-form [data-k=rfc]').first().press('Tab');
await pg.waitForSelector('dialog.modal >> text=RFC ya registrado');
await pg.click('dialog.modal button[value=""]');
await pg.waitForTimeout(500);
ok((await pg.locator('#party-form [data-k=rfc]').first().inputValue()) === '', 'corregir: RFC vacío');
all = await nParties();
ok(all.filter((p) => p.rfc === 'EJE100315AB1').length === 1, 'solo una ficha con ese RFC');
// 3) Lista marca duplicados preexistentes
await pg.evaluate(async () => {
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  await new Promise((x) => { const tx = d.transaction('parties', 'readwrite'); tx.objectStore('parties').put({ id: 'e2', kind: 'pm', propia: true, activa: true, nombre: 'EMPRESA EJEMPLO DEMO SA DE CV', rfc: 'EJE100315AB1', apoderados: [], accionistas: [], createdAt: 2, updatedAt: 2 }); tx.oncomplete = x; });
});
await pg.evaluate(() => { location.hash = '#/'; }); await pg.reload(); await pg.evaluate(() => { location.hash = '#/catalogo'; }); await pg.waitForSelector('.party-list');
const rep = await pg.locator('.party-list >> text=RFC repetido').count();
ok(rep === 2, 'lista marca RFC repetido en ambas (' + rep + ')');
await pg.screenshot({ path: S + '/dup2.png' });
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'TODO OK'); await b.close();
