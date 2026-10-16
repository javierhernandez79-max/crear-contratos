import { chromium } from 'playwright';
import { createMockDropbox } from './mockdbx.mjs';
import { aprobar as aprobarPasos } from './flujo-util.mjs';
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
  const cs = [mk('k1', 'Servicios Alfadoc'), mk('k2', 'Servicios Nuevo'), mk(null, 'Solo grupo'), mk('k3', 'Servicios Con Carpeta')];
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

const revision = async (id) => {
  await pg.evaluate((i) => { location.hash = `#/c/${i}/documento`; }, id);
  await pg.waitForSelector('.stepper');
  await pg.waitForTimeout(500); // la ruta se actualiza al terminar de leer las carpetas de Dropbox
  const folder = await pg.textContent('#doc-folder');
  // Flujo nuevo: sin revisión; si los datos están completos se aprueba (eso guarda el Word)
  if (await pg.locator('#app [data-wf=approve], #app [data-wf=revision]').count()) {
    await aprobarPasos(pg);
    await pg.waitForSelector('[data-wf=papel]');
  }
  await pg.waitForTimeout(300);
  return folder;
};
const aprobar = async (id) => {
  await pg.evaluate((i) => { location.hash = `#/c/${i}/documento`; }, id);
  await aprobarPasos(pg);
  await pg.waitForSelector('.badge.aprobado, .stepper li.on'); await pg.waitForTimeout(1500);
};
await revision(ids[0]);
const aprob = () => files().filter((p) => /APROBADO/.test(p));
ok(aprob().length === 2, 'primera aprobación: Word y PDF: ' + aprob().join(', '));
const rev1 = [...mock.files.values()].find((x) => x.path.endsWith('APROBADO.docx')).rev;
// Editar un dato: vuelve a borrador; nueva revisión y segunda aprobación
await pg.evaluate((i) => { location.hash = `#/c/${i}/variables`; }, ids[0]);
await pg.waitForSelector('.var-row[data-key="x"] .var-input input');
const inp = pg.locator('.var-row[data-key="x"] .var-input input').first();
await inp.fill('dos'); await inp.dispatchEvent('input'); await pg.waitForTimeout(1500);
console.log('estado tras editar', await pg.textContent('#editor-head .badge'));
await pg.evaluate((i) => { location.hash = '#/c/' + i + '/documento'; }, ids[0]); await pg.waitForTimeout(1500); await pg.screenshot({ path: '' + (process.argv[2] || '..') + '/reap.png' });
await revision(ids[0]);
ok(aprob().length === 2 && !aprob().some((p) => /\(\d\)/.test(p)), 'segunda aprobación reemplaza, sin "(1)": ' + aprob().join(', '));
ok([...mock.files.values()].find((x) => x.path.endsWith('APROBADO.docx')).rev !== rev1, 'el APROBADO.docx es el nuevo');
const docs = await pg.$$eval('.doc-item strong', (els) => els.map((e) => e.textContent).filter((t) => /APROBADO/.test(t)));
ok(docs.length === 2, 'la lista de documentos no repite el APROBADO: ' + docs.join(' | '));
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'TODO OK'); await b.close();
