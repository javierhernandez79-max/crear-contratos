import { chromium } from 'playwright';
import { mkRar } from './rar-util.mjs';
const S = process.argv[2] || '.'; const APP = 'http://localhost:5173/';
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push(e.message));

// IA encendida (simulada): se registra qué se le manda
const enviados = [];
await pg.route('**/api/ia', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configurada: true, activa: true, programada: true, hasta: '', vencida: false, admin: false }) }));
await pg.route('**/api/leer-pdf', async (route) => {
  const body = route.request().postDataJSON(); enviados.push(body);
  if (body.nombre === 'ine.png') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tipo: 'ine', kind: 'pf', empresa: '', datos: { nombre: 'CARLOS HERNANDEZ VEGA', claveElector: 'HRVGCR80010109H100', vigencia: '2031' } }) });
  return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'La IA no pudo leer el documento.' }) });
});

await pg.goto(APP + '#/catalogo'); await pg.waitForSelector('#cat-new');
const CSF = ['CONSTANCIA DE SITUACIÓN FISCAL', 'Datos de Identificación del Contribuyente:', 'RFC: EJE100315AB1', 'Denominación/Razón Social: EMPRESA EJEMPLO DEMO', 'Régimen Capital: SOCIEDAD ANONIMA DE CAPITAL VARIABLE', 'Nombre Comercial:', 'Datos del domicilio registrado', 'Código Postal:76000 Tipo de Vialidad: AVENIDA (AV.)', 'Nombre de Vialidad: CONSTITUYENTES Número Exterior: 100', 'Nombre de la Colonia: CENTRO', 'Nombre del Municipio o Demarcación Territorial: QUERÉTARO', 'Nombre de la Entidad Federativa: QUERÉTARO'];
const CSF2 = CSF.map((l) => l.replace('EJE100315AB1', 'OEP200101XY9').replace('EMPRESA EJEMPLO DEMO', 'OTRA EMPRESA PRUEBA'));
// Word .docx mínimo armado en la página con el zip de la app
const mkDocx = (lines) => pg.evaluate(async (lines) => {
  const { buildZip } = await import('./js/zip.js');
  const te = new TextEncoder(); const x = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const doc = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map((l) => `<w:p><w:r><w:t xml:space="preserve">${x(l)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`;
  const z = buildZip([
    { name: '[Content_Types].xml', data: te.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: 'word/document.xml', data: te.encode(doc) },
  ]);
  let s = ''; for (const c of z) s += String.fromCharCode(c); return btoa(s);
}, lines).then((b64) => Buffer.from(b64, 'base64'));
const mkZip = (files) => pg.evaluate(async (files) => {
  const { buildZip } = await import('./js/zip.js');
  const z = buildZip(files.map((f) => ({ name: f.name, data: Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)) })));
  let s = ''; for (const c of z) s += String.fromCharCode(c); return btoa(s);
}, files.map((f) => ({ name: f.name, b64: Buffer.from(f.data).toString('base64') }))).then((b64) => Buffer.from(b64, 'base64'));
const PNG = await pg.evaluate(() => { const c = Object.assign(document.createElement('canvas'), { width: 3000, height: 2000 }); const g = c.getContext('2d'); g.fillStyle = '#ccc'; g.fillRect(0, 0, 3000, 2000); return c.toDataURL('image/png').split(',')[1]; }).then((b64) => Buffer.from(b64, 'base64'));

await pg.evaluate(async () => {
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (v) => new Promise((x) => { const tx = d.transaction('parties', 'readwrite'); tx.objectStore('parties').put(v); tx.oncomplete = x; });
  await put({ id: 'e1', kind: 'pm', propia: true, activa: true, nombre: 'EMPRESA EJEMPLO DEMO, S.A. DE C.V.', rfc: '', domicilio: '', correo: '', telefono: '', apoderados: [{ id: 'a1', nombre: 'CARLOS HERNANDEZ VEGA', vigente: true, poderNumero: '', poderFecha: '' }], accionistas: [], createdAt: 1, updatedAt: 1 });
});
await pg.reload(); await pg.waitForSelector('#cat-new');
const subir = async (btnSel, files) => {
  await pg.click(btnSel);
  const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('dialog.modal button[value=local]')]);
  const accept = await fc.element().getAttribute('accept');
  ok(['.pdf', '.docx', '.txt', '.md', '.jpg', '.png'].every((e) => accept.includes(e)), 'el selector acepta PDF, Word, imagen, .txt y .md: ' + accept);
  await fc.setFiles(files);
};
await pg.evaluate(() => { location.hash = '#/catalogo/e1'; }); await pg.waitForSelector('#party-extract');
ok((await pg.textContent('#party-extract')).includes('Llenar desde documento'), 'botón "Llenar desde documento"');

// 1) .txt: se lee en el equipo, sin IA
await subir('#party-extract', [{ name: 'csf.txt', mimeType: 'text/plain', buffer: Buffer.from(CSF.join('\n')) }]);
await pg.waitForSelector('#ex-filas');
ok((await pg.inputValue('#ex-tipo')) === 'csf' && (await pg.inputValue('input[name=v_rfc]')) === 'EJE100315AB1', '.txt: detecta la constancia y lee el RFC');
await pg.click('dialog.modal button[value=""]'); await pg.waitForTimeout(300);

// 2) .md
await subir('#party-extract', [{ name: 'csf.md', mimeType: 'text/markdown', buffer: Buffer.from('# Constancia\n\n' + CSF.join('\n\n')) }]);
await pg.waitForSelector('#ex-filas');
ok((await pg.inputValue('#ex-tipo')) === 'csf' && (await pg.inputValue('input[name=v_rfc]')) === 'EJE100315AB1', '.md: detecta la constancia y lee el RFC');
await pg.click('dialog.modal button[value=""]'); await pg.waitForTimeout(300);

// 3) Word .docx
await subir('#party-extract', [{ name: 'csf.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await mkDocx(CSF) }]);
await pg.waitForSelector('#ex-filas');
ok((await pg.inputValue('#ex-tipo')) === 'csf' && (await pg.inputValue('input[name=v_rfc]')) === 'EJE100315AB1', '.docx: detecta la constancia y lee el RFC');
await pg.click('dialog.modal button[value=ok]'); await pg.waitForTimeout(500);
ok(!enviados.length, 'texto, Markdown y Word con datos no se mandan a la IA');

// 4) Imagen: va a la IA como JPEG reducido
await subir('#party-extract', [{ name: 'ine.png', mimeType: 'image/png', buffer: PNG }]);
await pg.waitForSelector('#ex-filas');
const env = enviados.at(-1);
ok(env && env.imagen && !env.pdf && Buffer.from(env.imagen, 'base64').subarray(0, 2).toString('hex') === 'ffd8', 'la imagen va a la IA como JPEG');
const dims = await pg.evaluate(async (b64) => { const bmp = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + b64)).blob()); return [bmp.width, bmp.height]; }, env.imagen);
ok(dims[0] === 2400 && dims[1] === 1600, 'reducida a 2400 px por lado: ' + dims);
ok((await pg.inputValue('#ex-tipo')) === 'ine', 'imagen: tipo INE leído con IA');
await pg.screenshot({ path: S + '/formatos-imagen.png' });
await pg.click('dialog.modal button[value=""]'); await pg.waitForTimeout(300);

// 4b) .zip con un Word dentro de una carpeta (sin la basura de macOS)
enviados.length = 0;
const ZIP = await mkZip([{ name: 'expediente/csf.docx', data: await mkDocx(CSF) }, { name: '__MACOSX/expediente/._csf.docx', data: Buffer.from('x') }, { name: 'expediente/notas.exe', data: Buffer.from('x') }]);
await subir('#party-extract', [{ name: 'expediente.zip', mimeType: 'application/zip', buffer: ZIP }]);
await pg.waitForSelector('#ex-filas');
ok((await pg.textContent('dialog.modal')).includes('Datos de csf.docx') && (await pg.inputValue('input[name=v_rfc]')) === 'EJE100315AB1', '.zip: abre el Word de adentro y lee la constancia');
ok(!(await pg.textContent('dialog.modal')).includes(' de 2:'), '.zip: ignora __MACOSX y formatos que no se leen');
await pg.click('dialog.modal button[value=""]'); await pg.waitForTimeout(300);

// 5) Alta desde documentos: Word con datos + Word dañado (se omite con motivo)
enviados.length = 0;
await pg.goto(APP + '#/catalogo'); await pg.waitForSelector('#cat-pdf');
ok((await pg.textContent('#cat-pdf')).includes('Alta desde documentos'), 'botón "Alta desde documentos"');
const CSF3 = CSF.map((l) => l.replace('EJE100315AB1', 'TER190101AB2').replace('EMPRESA EJEMPLO DEMO', 'TERCERA DEMO'));
const RAR = mkRar([{ name: 'TERCERA\\TERCERA - CSF.md', data: Buffer.from(CSF3.join('\n')) }, { name: 'leeme.exe', data: Buffer.from('x') }]);
await subir('#cat-pdf', [
  { name: 'TERCERA.rar', mimeType: 'application/vnd.rar', buffer: RAR },
  { name: 'danado.rar', mimeType: 'application/vnd.rar', buffer: Buffer.from('Rar!no es rar') },
  { name: 'OTRA - CSF.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await mkDocx(CSF2) },
  { name: 'roto.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('no es zip') },
]);
await pg.waitForSelector('.alta-list');
const t = await pg.textContent('dialog.modal');
ok(t.includes('OTRA EMPRESA PRUEBA') && t.includes('OEP200101XY9'), 'alta: la constancia en Word crea la ficha');
ok(t.includes('roto.docx') && t.includes('no es un Word .docx'), 'alta: el Word dañado sale en omitidos con el motivo');
ok(t.includes('TERCERA DEMO') && t.includes('TER190101AB2') && t.includes('TERCERA - CSF.md'), 'alta: la constancia en .md dentro del .rar crea la ficha');
ok(t.includes('Alta desde 3 documentos'), 'alta: del .rar solo se toma el .md (no el .exe) y el .rar dañado no cuenta');
await pg.screenshot({ path: S + '/formatos-alta.png', fullPage: true });
await pg.click('dialog.modal button[value=ok]'); await pg.waitForTimeout(600);
ok(!errors.length, 'sin errores: ' + errors.join(' | '));
await b.close();
process.exit(errors.length ? 1 : 0);
