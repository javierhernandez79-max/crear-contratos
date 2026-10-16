import { chromium } from 'playwright';
import { createMockDropbox } from './mockdbx.mjs';
const S = process.argv[2] || '..';
const APP = 'http://localhost:5173/';
const mock = createMockDropbox();
mock.put('/Contratos App/LEEME.txt', Buffer.from('x'));
mock.put('/Contratos App/EXPEDIENTES CORPORATIVOS RM/GRUPO EJEMPLO/CSF.pdf', Buffer.from('%PDF'));
mock.put('/Contratos App/EXPEDIENTES CLIENTES/Alfadoc/CSF.pdf', Buffer.from('%PDF')); // carpeta de cliente ya existente
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await mock.attach(ctx, { id: 'a', name: 'Usuario Uno', email: 'a@example.com' });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const files = () => [...mock.files.values()].map((f) => f.path);

await pg.goto(APP + '#/ajustes');
await pg.fill('#dbx-key', 'k'); await pg.fill('#dbx-folder', '/Contratos App');
await pg.click('[data-dbx=connect]'); await pg.waitForSelector('[data-dbx=sync]');

const ids = await pg.evaluate(async () => {
  const m = await import('./js/model.js');
  const tpl = { id: 'u-t', name: 'Servicios', titulo: 'CONTRATO DE PRESTACIÓN DE SERVICIOS', vars: [['x', 'X', 'text']], sections: [{ title: 'OBJETO', body: 'Texto {{x}}.' }],
    signers: [{ role: 'EL PRESTADOR', name: 'P', bind: { prefix: 'prestador' } }, { role: 'EL CLIENTE', name: 'C', bind: { prefix: 'cliente' } }] };
  const mk = (cli, nombre) => {
    const c = m.newContractFromTemplate(tpl); c.variables = { x: 'uno' }; c.etiqueta = nombre;
    c.signers[0].party = { id: 'g1', apoderadoId: null, prefix: 'prestador' };
    if (cli) c.signers[1].party = { id: cli, apoderadoId: null, prefix: 'cliente' };
    return c;
  };
  const falta = mk('k1', 'Servicios Falta'); falta.variables = {}; const viejo = mk('k1', 'Servicios Viejo'); viejo.status = 'revision'; viejo.revision = 1;
  const cs = [falta, viejo, mk('k1', 'Servicios Alfadoc'), mk('k2', 'Servicios Nuevo'), mk(null, 'Solo grupo'), mk('k3', 'Servicios Con Carpeta')];
  // Trabajo: el patrón es el cliente ALFADOC (determinado) y la empresa del grupo (indeterminado); el trabajador vinculado no es dueño
  const trab = { id: 'u-trab', name: 'Trabajo', titulo: 'CONTRATO INDIVIDUAL DE TRABAJO', category: 'laboral', vars: [['fecha_fin', 'Fin', 'date']], sections: [{ title: 'UNO', body: 'Texto.' }],
    signers: [{ role: 'EL PATRÓN', name: 'P', bind: { prefix: 'patron' } }, { role: 'EL TRABAJADOR', name: 'T', bind: { prefix: 'trabajador' } }] };
  const t1 = m.newContractFromTemplate(trab); t1.etiqueta = 'Trabajo Juan';
  t1.signers[0].party = { id: 'k1', apoderadoId: null, prefix: 'patron' }; t1.signers[1].party = { id: 'w1', apoderadoId: null, prefix: 'trabajador' };
  const t2 = m.newContractFromTemplate({ ...trab, vars: [['x', 'X', 'text']] }); t2.etiqueta = 'Trabajo Ana';
  t2.signers[0].party = { id: 'g1', apoderadoId: null, prefix: 'patron' };
  cs.push(t1, t2);
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (st, v) => new Promise((x) => { const tx = d.transaction(st, 'readwrite'); tx.objectStore(st).put(v); tx.oncomplete = x; });
  const base = { activa: true, rfc: '', correo: '', apoderados: [], accionistas: [] };
  await put('parties', { ...base, id: 'g1', kind: 'pm', propia: true, nombre: 'GRUPO EJEMPLO, S.A. DE C.V.' });
  await put('parties', { ...base, id: 'k1', kind: 'pm', propia: false, nombre: 'ALFADOC S.A. DE C.V.' });
  await put('parties', { ...base, id: 'k2', kind: 'pm', propia: false, nombre: 'NUEVO CLIENTE, S.A.' });
  await put('parties', { ...base, id: 'w1', kind: 'pf', propia: false, nombre: 'JUAN PÉREZ' });
  await put('parties', { ...base, id: 'k3', kind: 'pm', propia: false, nombre: 'OTRO CLIENTE', expediente: '/Contratos App/Mis clientes/Otro' });
  for (const c of cs) await put('contracts', c);
  return cs.map((c) => c.id);
});
await pg.reload(); await pg.waitForSelector('#app');
const ir = async (id, tab) => { await pg.evaluate(([i, t]) => { location.hash = `#/c/${i}/${t}`; }, [id, tab]); await pg.waitForTimeout(600); };
const pasoOn = async () => (await pg.textContent('.stepper li.on'))?.trim();
// Paso 1: faltan datos
await ir(ids[0], 'documento');
ok((await pg.$$('.stepper li')).length === 4, 'cuatro pasos: ' + (await pg.textContent('.stepper')).replace(/\s+/g, ' '));
ok(/1\s*Documento/.test(await pasoOn()), 'con datos faltantes está en el paso 1');
ok(!(await pg.locator('[data-wf=approve]').count()) && !(await pg.locator('[data-wf=review]').count()), 'no hay botón de aprobar ni de revisión');
ok(await pg.locator('a.btn.primary >> text=Completar datos').count() === 1, 'botón Completar datos');
await pg.screenshot({ path: S + '/shots/flujo1.png', fullPage: true });
// Llenar el dato → paso 2
await ir(ids[0], 'variables');
const inp = pg.locator('.var-row[data-key="x"] .var-input input').first();
await inp.fill('uno'); await inp.press('Tab'); await pg.waitForTimeout(1200);
console.log('faltan', await pg.$$eval('.var-row.is-missing', (els) => els.map((e) => e.dataset.key)), await inp.inputValue());
await ir(ids[0], 'documento');
ok(/2\s*Revisión/.test(await pasoOn()), 'datos completos: paso 2 Revisión: ' + await pasoOn());
ok(!(await pg.locator('[data-wf=approve]').count()), 'sin Word de revisión no se puede aprobar');
await pg.screenshot({ path: S + '/shots/flujo2.png', fullPage: true });
await Promise.all([pg.waitForEvent('download'), pg.click('[data-wf=revision]')]);
await pg.waitForSelector('[data-wf=approve]');
ok(/3\s*Aprobación/.test(await pasoOn()) && (await pg.textContent('#editor-head')).includes('En revisión'), 'Word de revisión: paso 3 Aprobación, En revisión');
ok(files().some((p) => /\/CONTRATOS DE SERVICIOS\/[^/]*-REVISION\.docx$/.test(p)), 'Word de revisión en Dropbox');
await Promise.all([pg.waitForEvent('download'), pg.click('[data-wf=approve]').then(() => pg.click('dialog.modal button[value=ok]'))]);
await pg.waitForSelector('[data-wf=papel]');
ok(/4\s*Firma/.test(await pasoOn()), 'aprobado: paso 4 Firma');
ok(await pg.locator('[data-wf=ds-send]').count() === 1, 'botón Enviar a firma (DocuSign)');
ok(files().some((p) => /\/CONTRATOS DE SERVICIOS\/[^/]*-APROBADO\.pdf$/.test(p)), 'PDF aprobado en Dropbox');
ok(!files().some((p) => /revision\.docx$/i.test(p)), 'al aprobar se quita el Word de revisión');
await pg.screenshot({ path: S + '/shots/flujo3.png', fullPage: true });
// Firmado en papel
await pg.click('[data-wf=papel]');
await pg.setInputFiles('dialog.modal input[type=file]', { name: 'escaneo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 firmado') });
await pg.click('dialog.modal button[value=ok]');
await pg.waitForSelector('.stepper li.done:nth-child(4)');
ok((await pg.textContent('#editor-head')).includes('Firmado'), 'queda Firmado');
const firmado = files().find((p) => /\/CONTRATOS DE SERVICIOS\/[^/]*-FIRMADO\.pdf$/.test(p));
ok(firmado && mock.files.get(firmado.toLowerCase())?.data?.toString().includes('firmado') !== false, 'PDF escaneado guardado como FIRMADO.pdf: ' + firmado);
await pg.screenshot({ path: S + '/shots/flujo4.png', fullPage: true });
// Firmantes: sin firma dibujada ni e.firma
await ir(ids[0], 'firmas');
ok(!(await pg.locator('[data-act=sign], [data-act=efirma], [data-act=final]').count()), 'Firmantes: sin firma en la app ni marcar firmado');
ok(await pg.locator('.signer input[data-f=role]').count() === 2, 'Firmantes: se pueden configurar');
// Aprobar con datos faltantes por código: bloqueado
// Contrato viejo "en revisión": se lee como borrador
await ir(ids[1], 'documento');
ok(/3\s*Aprobación/.test(await pasoOn()) && (await pg.textContent('#editor-head')).includes('En revisión'), 'contrato en revisión: paso 3 Aprobación');
// Editar un contrato en revisión lo regresa a borrador (paso 2)
await ir(ids[1], 'variables');
const inp2 = pg.locator('.var-row[data-key="x"] .var-input input').first();
await inp2.fill('dos'); await inp2.press('Tab'); await pg.waitForTimeout(1200);
await ir(ids[1], 'documento');
ok(/2\s*Revisión/.test(await pasoOn()) && (await pg.textContent('#editor-head')).includes('Borrador'), 'editado: vuelve a borrador y a generar revisión');
// Lista
await pg.evaluate(() => { location.hash = '#/'; }); await pg.waitForTimeout(600);
const chips = await pg.textContent('body');
ok(chips.includes('En revisión'), 'la lista tiene filtro En revisión');
ok((await pg.textContent(`.ll-row[data-id="${ids[0]}"]`)).includes('2/2'), 'firmas 2/2 en la lista');
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'TODO OK'); await b.close();
