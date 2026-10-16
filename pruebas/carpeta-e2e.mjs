import { chromium } from 'playwright';
import { createMockDropbox } from './mockdbx.mjs';
const S = process.argv[2] || '..';
const APP = 'http://localhost:5173/';
const mock = createMockDropbox();
mock.put('/Contratos App/LEEME.txt', Buffer.from('x'));
mock.put('/Contratos App/EXPEDIENTES CORPORATIVOS RM/GRUPO EJEMPLO/CSF.pdf', Buffer.from('%PDF'));
mock.put('/Contratos App/EXPEDIENTES CLIENTES/EXPEDIENTES CORPORATIVOS CLIENTES/Alfadoc/CSF.pdf', Buffer.from('%PDF')); // expediente del cliente
mock.put('/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/Alfadoc/LEEME.txt', Buffer.from('x')); // carpeta de documentos del cliente ya existente
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
  if (await pg.locator('[data-wf=approve]').count()) {
    await Promise.all([pg.waitForEvent('download'), pg.click('[data-wf=approve]').then(() => pg.click('dialog.modal button[value=ok]'))]);
    await pg.waitForSelector('[data-wf=papel]');
  }
  await pg.waitForTimeout(300);
  return folder;
};
let f = await revision(ids[0]);
ok(f.startsWith('/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/Alfadoc/GRUPO EJEMPLO, S.A. DE C.V./CONTRATOS DE SERVICIOS'), 'cliente con carpeta existente (nombre distinto): ' + f);
ok(files().some((p) => p.startsWith('/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/Alfadoc/GRUPO EJEMPLO, S.A. DE C.V./CONTRATOS DE SERVICIOS') && p.endsWith('.docx')), 'Word guardado en la carpeta del cliente');
ok(!files().some((p) => p.includes('GRUPO EJEMPLO/CONTRATOS')), 'nada en la carpeta de la empresa del grupo');
ok((await pg.textContent('body')).includes('carpeta de ALFADOC S.A. DE C.V.'), 'la pantalla dice que va al expediente del cliente');
await pg.screenshot({ path: S + '/shots/carpeta1.png', fullPage: true });
f = await revision(ids[1]);
ok(f.startsWith('/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/NUEVO CLIENTE, S.A./GRUPO EJEMPLO, S.A. DE C.V./CONTRATOS DE SERVICIOS'), 'cliente nuevo: carpeta nueva en EXPEDIENTES CLIENTES: ' + f);
f = await revision(ids[2]);
ok(f.startsWith('/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/GRUPO EJEMPLO, S.A. DE C.V./CONTRATOS DE SERVICIOS'), 'sin cliente vinculado: carpeta de la empresa del grupo en GENERADOS: ' + f);
f = await revision(ids[3]);
ok(f.startsWith('/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/OTRO CLIENTE/GRUPO EJEMPLO, S.A. DE C.V./CONTRATOS DE SERVICIOS'), 'expediente fijado en la ficha: los contratos van a GENERADOS: ' + f);
f = await revision(ids[4]);
ok(f === '/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/Alfadoc/CONTRATOS DE TRABAJO/DETERMINADOS', 'trabajo determinado en el cliente-patrón (no en el trabajador): ' + f);
f = await revision(ids[5]);
ok(f === '/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/GRUPO EJEMPLO, S.A. DE C.V./CONTRATOS DE TRABAJO/INDETERMINADOS', 'trabajo indeterminado de una empresa del grupo: ' + f);
ok(!files().some((p) => p.includes('JUAN PÉREZ')), 'no se crea carpeta del trabajador');
const k2 = await pg.evaluate(async () => { const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); }); return new Promise((x) => { const q = d.transaction('parties').objectStore('parties').get('k2'); q.onsuccess = () => x(q.result); }); });
ok(!k2.expediente, 'generar contratos no cambia el expediente de la ficha: ' + k2.expediente);
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'TODO OK'); await b.close();
