import { chromium } from 'playwright';
const S = process.argv[2] || '.'; const APP = 'http://localhost:5173/';
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) console.log('console:', m.text()); });

let iaEstado = null; // null = sin servidor (404)
const posts = []; const lecturas = []; const pdfVacios = [];
let respuestaIA = {};
await pg.route('**/api/ia', async (route) => {
  if (!iaEstado) return route.fulfill({ status: 404, contentType: 'text/html', body: 'not found' });
  if (route.request().method() === 'POST') {
    const body = route.request().postDataJSON(); posts.push(body);
    if (!iaEstado.admin) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Solo el administrador puede encender o apagar la lectura con IA.' }) });
    iaEstado = { ...iaEstado, activa: body.activa, programada: body.activa, hasta: body.hasta, vencida: false };
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(iaEstado) });
});
await pg.route('**/api/leer-pdf', async (route) => {
  const body = route.request().postDataJSON(); lecturas.push(body.nombre);
  const bytes = Buffer.from(body.pdf || '', 'base64');
  if (!(bytes.length > 500 && bytes.subarray(0, 5).toString() === '%PDF-')) pdfVacios.push(body.nombre);
  const r = respuestaIA[body.nombre];
  if (!r) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'La IA no pudo leer el documento.' }) });
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
});

await pg.goto(APP + '#/catalogo'); await pg.waitForSelector('#cat-new');
const mkPdf = (lines, blank = false) => pg.evaluate(async ({ lines, blank }) => {
  if (!window.jspdf) await new Promise((r) => { const s = document.createElement('script'); s.src = 'vendor/jspdf.umd.min.js'; s.onload = r; document.head.appendChild(s); });
  const d = new window.jspdf.jsPDF();
  if (blank) { d.setFillColor(200, 200, 200); d.rect(10, 10, 100, 100, 'F'); }
  else { let y = 15; for (const l of lines) for (const w of d.splitTextToSize(l, 180)) { d.text(w, 10, y); y += 7; } }
  const u8 = new Uint8Array(d.output('arraybuffer')); let s = ''; for (const x of u8) s += String.fromCharCode(x); return btoa(s);
}, { lines, blank }).then((b64) => Buffer.from(b64, 'base64'));
const SCAN = await mkPdf([], true);
const CSF2 = await mkPdf(['CONSTANCIA DE SITUACIÓN FISCAL', 'Datos de Identificación del Contribuyente:', 'RFC: OEP200101XY9', 'Denominación/Razón Social: OTRA EMPRESA PRUEBA', 'Régimen Capital: SOCIEDAD ANONIMA DE CAPITAL VARIABLE', 'Nombre Comercial:', 'Datos del domicilio registrado', 'Código Postal:06000 Tipo de Vialidad: CALLE', 'Nombre de Vialidad: REFORMA Número Exterior: 10', 'Nombre de la Colonia: CENTRO', 'Nombre del Municipio o Demarcación Territorial: CUAUHTEMOC', 'Nombre de la Entidad Federativa: CIUDAD DE MÉXICO']);
await pg.evaluate(async () => {
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (v) => new Promise((x) => { const tx = d.transaction('parties', 'readwrite'); tx.objectStore('parties').put(v); tx.oncomplete = x; });
  await put({ id: 'e1', kind: 'pm', propia: true, activa: true, nombre: 'EMPRESA EJEMPLO DEMO, S.A. DE C.V.', rfc: 'EJE100315AB1', domicilio: '', correo: '', telefono: '', escrituraNumero: '', escrituraFecha: '', notario: '', notariaNumero: '', notariaCiudad: '', folioMercantil: '', folioFecha: '', folioLugar: '', objetoSocial: '', curp: '', expediente: '', notas: '', apoderados: [], accionistas: [], createdAt: 1, updatedAt: 1 });
});
const all = () => pg.evaluate(async () => { const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  return new Promise((x) => { const q = d.transaction('parties').objectStore('parties').getAll(); q.onsuccess = () => x(q.result); }); });
const subir = async (btnSel, files) => {
  await pg.click(btnSel);
  const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('dialog.modal button[value=local]')]);
  await fc.setFiles(files);
};

await pg.reload(); await pg.waitForSelector('#cat-new');
// 1) Sin servidor: Ajustes sin tarjeta y el escaneado se captura a mano
await pg.goto(APP + '#/ajustes'); await pg.waitForSelector('#export');
ok(!(await pg.$('#ia-box')), 'sin servidor: no aparece la tarjeta de IA');
await pg.goto(APP + '#/catalogo/e1'); await pg.waitForSelector('#party-extract');
await subir('#party-extract', [{ name: 'scan.pdf', mimeType: 'application/pdf', buffer: SCAN }]);
await pg.waitForSelector('dialog.modal >> text=PDF sin texto');
ok((await pg.textContent('dialog.modal')).includes('apagada'), 'sin IA: avisa que está apagada');
ok(!lecturas.length, 'sin IA: no se envía nada');
await pg.click('dialog.modal button[value=""]');

// 2) Usuario normal con IA apagada: ve el estado, sin botones
iaEstado = { configurada: true, activa: false, programada: false, hasta: '', vencida: false, admin: false };
await pg.goto(APP + '#/ajustes'); await pg.waitForSelector('#ia-box');
ok((await pg.textContent('#ia-box')).includes('Apagada') && !(await pg.$('#ia-on')), 'no admin: ve "Apagada" y no hay botones');

// 3) Admin enciende con fecha de fin
iaEstado.admin = true; iaEstado.faltan = [];
await pg.goto(APP + '#/catalogo'); await pg.goto(APP + '#/ajustes'); await pg.waitForSelector('#ia-on');
await pg.fill('#ia-hasta', '2099-12-31');
await pg.click('#ia-on');
await pg.waitForSelector('#ia-off');
ok(posts.at(-1)?.activa === true && posts.at(-1)?.hasta === '2099-12-31', 'admin: enciende con fecha de fin');
ok((await pg.textContent('#ia-box')).includes('Encendida hasta'), 'muestra "Encendida hasta …"');
await pg.screenshot({ path: S + '/ia-ajustes.png' });

// 4) Ficha: escaneado leído con IA
respuestaIA['acta-scan.pdf'] = { tipo: 'acta', kind: 'pm', empresa: 'EMPRESA EJEMPLO DEMO, S.A. DE C.V.', datos: { nombre: 'EMPRESA EJEMPLO DEMO', escrituraNumero: '12,345', escrituraFecha: '2010-03-15', notario: 'Licenciado Juan Pérez López', notariaNumero: '7', notariaCiudad: 'Querétaro, Querétaro', folioMercantil: 'N-2010012345', objetoSocial: 'Prestación de servicios.' } };
await pg.goto(APP + '#/catalogo/e1'); await pg.waitForSelector('#party-extract');
await subir('#party-extract', [{ name: 'acta-scan.pdf', mimeType: 'application/pdf', buffer: SCAN }]);
await pg.waitForSelector('#ex-filas');
const txt = await pg.textContent('dialog.modal');
ok(txt.includes('leído con IA') && (await pg.inputValue('#ex-tipo')) === 'acta', 'ficha: muestra lo leído con IA como escritura constitutiva');
ok((await pg.inputValue('[name=v_escrituraNumero]')) === '12,345' && (await pg.inputValue('[name=v_escrituraFecha]')) === '2010-03-15', 'datos de la IA en la revisión');
await pg.screenshot({ path: S + '/ia-ficha.png' });
await pg.click('dialog.modal button[value=ok]');
await pg.waitForTimeout(500);
let e1 = (await all()).find((p) => p.id === 'e1');
ok(e1.escrituraNumero === '12,345' && e1.notario === 'Licenciado Juan Pérez López' && e1.folioMercantil === 'N-2010012345', 'se aplicaron a la ficha');

// 5) Ficha: error de la IA
await subir('#party-extract', [{ name: 'malo.pdf', mimeType: 'application/pdf', buffer: SCAN }]);
await pg.waitForSelector('dialog.modal >> text=PDF sin texto');
ok((await pg.textContent('dialog.modal')).includes('No se pudo leer con IA'), 'error de la IA: aviso claro');
await pg.click('dialog.modal button[value=""]');

// 6) Alta masiva: constancia con texto + poder escaneado de esa empresa + escaneado que falla
respuestaIA['poder-scan.pdf'] = { tipo: 'poder', kind: 'pm', empresa: 'OTRA EMPRESA PRUEBA, S.A. DE C.V.', datos: { nombre: 'Luis Martínez Soto', poderNumero: '2,000', poderFecha: '2021-05-05', notario: 'Licenciado Pedro Gómez Ruiz', notariaNumero: '45', notariaCiudad: 'la Ciudad de México', facultades: 'actos de administración' } };
lecturas.length = 0;
await pg.goto(APP + '#/catalogo'); await pg.waitForSelector('#cat-pdf');
await subir('#cat-pdf', [
  { name: 'poder-scan.pdf', mimeType: 'application/pdf', buffer: SCAN },
  { name: 'csf-otra.pdf', mimeType: 'application/pdf', buffer: CSF2 },
  { name: 'otro-scan.pdf', mimeType: 'application/pdf', buffer: SCAN },
]);
await pg.waitForSelector('.alta-list');
const t = await pg.textContent('dialog.modal');
ok(lecturas.length === 2 && !lecturas.includes('csf-otra.pdf'), 'solo los escaneados van a la IA');
const filas = await pg.$$eval('.alta-list .ll-row:not(.ll-head)', (rs) => rs.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
console.log(filas);
ok(filas.length === 1 && filas[0].includes('Luis Martínez Soto') && filas[0].includes('IA'), 'poder escaneado unido a la empresa de la constancia, con etiqueta IA');
ok(t.includes('otro-scan.pdf') && t.includes('no se pudo leer con IA'), 'el escaneado que falló sale en omitidos con el motivo');
await pg.screenshot({ path: S + '/ia-alta.png', fullPage: true });
await pg.click('dialog.modal button[value=ok]');
await pg.waitForTimeout(600);
const otra = (await all()).find((p) => p.rfc === 'OEP200101XY9');
ok(otra && otra.apoderados[0]?.poderNumero === '2,000' && otra.apoderados[0]?.notariaNumero === '45', 'guardó la empresa con el apoderado leído con IA');

ok(!pdfVacios.length, 'la IA recibe el PDF completo (no vacío): ' + pdfVacios.join(', '));

// 6b) PDF con texto mal leído: escritura larga que trae la cédula fiscal agregada, y constancia sin RFC legible
const relleno = Array(60).fill('Texto de relleno de la escritura con cláusulas y artículos de los estatutos sociales de la sociedad.').join(' ');
const ACTA_TXT = await mkPdf(['ESCRITURA PÚBLICA NÚMERO 7,777. CONSTITUCIÓN DE SOCIEDAD ANÓNIMA DE CAPITAL VARIABLE ante el Lic. Pedro Gómez Ruiz, Notario Público número 45. La denominación será "BANQUETES DEMO". ' + relleno, 'ANEXO: CÉDULA DE IDENTIFICACIÓN FISCAL']);
const CSF_MALA = await mkPdf(['CONSTANCIA DE SITUACIÓN FISCAL', 'Texto ilegible de un escaneo con capa de texto mala, sin el dato del registro federal que se necesita para identificar a la empresa en el catálogo.']);
respuestaIA['csf-mala.pdf'] = { tipo: 'csf', kind: 'pm', empresa: '', datos: { nombre: 'BANQUETES DEMO S.A. DE C.V.', rfc: 'BDE200101AB1' } };
lecturas.length = 0;
await pg.goto(APP + '#/catalogo'); await pg.waitForSelector('#cat-pdf');
await subir('#cat-pdf', [
  { name: 'acta-texto.pdf', mimeType: 'application/pdf', buffer: ACTA_TXT },
  { name: 'csf-mala.pdf', mimeType: 'application/pdf', buffer: CSF_MALA },
]);
await pg.waitForSelector('dialog.modal >> text=Alta desde 2 documentos');
const t2 = await pg.textContent('dialog.modal');
const f2 = await pg.$$eval('.alta-list .ll-row:not(.ll-head)', (rs) => rs.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
console.log(f2);
ok(!lecturas.includes('acta-texto.pdf'), 'la escritura con texto bueno no va a la IA');
ok(lecturas.includes('csf-mala.pdf'), 'la constancia con texto sin RFC sí va a la IA');
ok(f2.some((x) => x.includes('Constitutiva: acta-texto.pdf')) && !t2.includes('No encontré el RFC'), 'la escritura con la cédula agregada se toma como constitutiva');
ok(f2.some((x) => x.includes('BDE200101AB1')), 'la constancia leída con IA trae el RFC');
ok(!pdfVacios.length, 'la IA recibe el PDF completo también cuando antes se leyó el texto');
await pg.click('dialog.modal button[value=""]');

// 6c) INE y boleta del RPP en el alta: se unen a la empresa por el nombre del archivo y al apoderado
const ACTA_B = await mkPdf(['ESCRITURA PÚBLICA NÚMERO 8,888. CONSTITUCIÓN DE SOCIEDAD ANÓNIMA DE CAPITAL VARIABLE ante el Lic. Pedro Gómez Ruiz, Notario Público número 45. La denominación será "COCINERA DEMO". ' + relleno]);
respuestaIA['COCINERA DEMO - INE MARIA LOPEZ.pdf'] = { tipo: 'ine', kind: 'pf', empresa: '', datos: { nombre: 'MARIA LOPEZ PEREZ', curp: 'LOPM900101MDFPRR09', claveElector: 'LPPRMR90010109M100', vigencia: '2031', sexo: 'femenino' } };
respuestaIA['COCINERA DEMO - RPP.pdf'] = { tipo: 'rpp', kind: 'pm', empresa: 'COCINERA DEMO, S.A. DE C.V.', datos: { nombre: 'COCINERA DEMO', folioMercantil: 'N-2020001234', folioFecha: '2020-02-03', folioLugar: 'Ciudad de México' } };
lecturas.length = 0;
await pg.goto(APP + '#/catalogo'); await pg.waitForSelector('#cat-pdf');
await subir('#cat-pdf', [
  { name: 'COCINERA DEMO - INE MARIA LOPEZ.pdf', mimeType: 'application/pdf', buffer: SCAN },
  { name: 'COCINERA DEMO - ACT CONST.pdf', mimeType: 'application/pdf', buffer: ACTA_B },
  { name: 'COCINERA DEMO - RPP.pdf', mimeType: 'application/pdf', buffer: SCAN },
]);
await pg.waitForSelector('dialog.modal >> text=Alta desde 3 documentos');
const f3 = await pg.$$eval('.alta-list .ll-row:not(.ll-head)', (rs) => rs.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
console.log(f3, await pg.textContent('dialog.modal').then((x) => x.includes('No se usaron')));
ok(f3.length === 1 && /RPP: COCINERA DEMO - RPP\.pdf/.test(f3[0]) && /INE: COCINERA DEMO - INE/.test(f3[0]) && f3[0].includes('MARIA LOPEZ PEREZ'), 'INE y RPP en la misma ficha que la constitutiva, con el apoderado de la INE');
await pg.click('dialog.modal button[value=ok]');
await pg.waitForTimeout(600);
const bq = (await all()).find((p) => p.nombre === 'COCINERA DEMO');
const ma = bq?.apoderados.find((x) => x.nombre === 'MARIA LOPEZ PEREZ');
ok(bq && bq.folioMercantil === 'N-2020001234' && bq.folioLugar === 'Ciudad de México' && bq.folioFecha === '2020-02-03', 'folio, fecha y lugar del RPP en la ficha');
ok(ma && ma.identificacion.includes('LPPRMR90010109M100') && ma.identificacionVigencia === '2031', 'INE del apoderado: identificación y vigencia');

// 6d) INE vencida desde la ficha: se aplica al apoderado elegido y avisa
respuestaIA['ine-vieja.pdf'] = { tipo: 'ine', kind: 'pf', empresa: '', datos: { nombre: 'MARIA LOPEZ PEREZ', claveElector: 'LPPRMR90010109M100', vigencia: '2020' } };
await pg.goto(APP + '#/catalogo/' + bq.id); await pg.waitForSelector('#party-extract');
await subir('#party-extract', [{ name: 'ine-vieja.pdf', mimeType: 'application/pdf', buffer: SCAN }]);
await pg.waitForSelector('#ex-apo');
const tx = await pg.textContent('dialog.modal');
ok((await pg.inputValue('#ex-tipo')) === 'ine' && tx.includes('venció en 2020'), 'ficha: INE detectada, con aviso de vencida');
ok((await pg.$eval('#ex-apo', (s) => s.options[s.selectedIndex].text)) === 'MARIA LOPEZ PEREZ', 'sugiere el apoderado con ese nombre');
await pg.screenshot({ path: S + '/ia-ine.png' });
await pg.check('[name=u_identificacionVigencia]');
await pg.click('dialog.modal button[value=ok]');
await pg.waitForTimeout(500);
const bq2 = (await all()).find((p) => p.id === bq.id);
ok(bq2.apoderados.length === 1 && bq2.apoderados[0].identificacionVigencia === '2020', 'se aplicó al mismo apoderado (sin duplicarlo)');
ok((await pg.textContent('body')).includes('INE vencida de MARIA LOPEZ PEREZ'), 'la ficha avisa la INE vencida');

// 7) Admin apaga
await pg.goto(APP + '#/ajustes'); await pg.waitForSelector('#ia-off');
await pg.click('#ia-off'); await pg.waitForSelector('#ia-on');
ok(posts.at(-1)?.activa === false, 'admin: apaga');

// 8) Móvil: Ajustes sin desbordar
await pg.setViewportSize({ width: 390, height: 800 });
await pg.goto(APP + '#/catalogo'); await pg.goto(APP + '#/ajustes'); await pg.waitForSelector('#ia-box');
ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'móvil sin scroll horizontal');
await pg.screenshot({ path: S + '/ia-movil.png', fullPage: true });
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'TODO OK'); await b.close();
