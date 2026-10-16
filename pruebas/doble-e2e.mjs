import { chromium } from 'playwright';
import { createMockDropbox } from './mockdbx.mjs';
const APP = 'http://localhost:5173/';
const mock = createMockDropbox();
mock.put('/Contratos App/LEEME.txt', Buffer.from('x'));
const R = '/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/ALFADOC/CONTRATOS DE SERVICIOS/Viejo';
const L = '/Contratos App/EXPEDIENTES CLIENTES/DOCUMENTOS GENERADOS - LEGAL APP/ALFADOC/CONTRATOS DE TRABAJO/INDETERMINADOS/Lote';
mock.put(`${R}/Viejo - APROBADO.pdf`, Buffer.from('%PDF'));
mock.put(`${L}/01 - ANA PEREZ.docx`, Buffer.from('PK'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const files = () => [...mock.files.values()].map((f) => f.path);
const abrir = async (u) => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await mock.attach(ctx, u);
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(APP + '#/ajustes'); await pg.fill('#dbx-key', 'k'); await pg.fill('#dbx-folder', '/Contratos App');
  await pg.click('[data-dbx=connect]'); await pg.waitForSelector('[data-dbx=sync]');
  return pg;
};
const A = await abrir({ id: 'a', name: 'Usuario Uno', email: 'a@example.com' });
await A.evaluate(async ({ R, L }) => {
  const m = await import('./js/model.js');
  const tpl = { id: 'u-t', name: 'Contrato de Prestación de Servicios', vars: [['x', 'X', 'text']], sections: [{ title: 'O', body: 'T {{x}}.' }],
    signers: [{ role: 'P', name: 'P', bind: { prefix: 'prestador' } }, { role: 'C', name: 'C', bind: { prefix: 'cliente' } }] };
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (st, v) => new Promise((x) => { const tx = d.transaction(st, 'readwrite'); tx.objectStore(st).put(v); tx.oncomplete = x; });
  const base = { activa: true, rfc: '', correo: '', apoderados: [], accionistas: [], createdAt: 1, updatedAt: 1 };
  await put('parties', { ...base, id: 'g1', kind: 'pm', propia: true, nombre: 'GRUPO UNO SA DE CV' });
  await put('parties', { ...base, id: 'k1', kind: 'pm', propia: false, nombre: 'ALFADOC S.A. DE C.V.' });
  const v = m.newContractFromTemplate(tpl); v.variables = { x: 'u' }; v.etiqueta = 'Viejo'; v.status = 'final';
  v.signers[0].party = { id: 'g1' }; v.signers[1].party = { id: 'k1' };
  v.documentos = [{ id: 'd0', kind: 'pdf', name: 'Viejo - APROBADO.pdf', path: `${R}/Viejo - APROBADO.pdf`, date: 1 }];
  await put('contracts', v);
  await put('lotes', { id: 'l1', cliente: 'Alfadoc', title: 'Lote', tipo: 'INDETERMINADO', status: 'aprobado', plantilla: { name: 'Contrato de Trabajo' }, empresa: { nombre: 'GRUPO UNO SA DE CV' },
    trabajadores: [{ nombre: 'ANA PEREZ' }], excluidos: [], dropbox: { carpeta: L, at: 1 }, createdAt: 1, updatedAt: 1, history: [] });
}, { R, L });
await A.reload(); await A.waitForSelector('[data-dbx=sync]'); await A.click('[data-dbx=sync]'); await A.waitForTimeout(1500);
const B = await abrir({ id: 'b', name: 'Otro U', email: 'b@example.com' });
await B.waitForTimeout(1500); await B.goto(APP + '#/ajustes'); await B.reload(); await B.waitForSelector('[data-dbx=renombrar]');
const bt = await B.textContent('[data-dbx=renombrar]'); ok(/Acomodar \d+ /.test(bt), 'B ve pendientes: ' + bt);
// A renombra; B tiene la pantalla vieja y presiona después
await A.goto(APP + '#/ajustes'); await A.reload(); await A.waitForSelector('[data-dbx=renombrar]');
await A.click('[data-dbx=renombrar]'); await A.click('dialog.modal button[value=ok]'); await A.waitForTimeout(2500);
ok(files().some((p) => /\/GRUPO UNO SA DE CV\/CONTRATOS DE SERVICIOS\/ContratoDePrestacionDeServicios-Alfadoc-GrupoUno-\d{4}-\d\d-\d\d-APROBADO\.pdf$/.test(p)) && files().some((p) => /GRUPO UNO SA DE CV\/CONTRATOS DE TRABAJO\/INDETERMINADOS\/Lote\/ContratoDeTrabajo-Alfadoc-GrupoUno-AnaPerez\.docx$/.test(p)), 'A renombró');
await B.click('[data-dbx=renombrar]');
await B.waitForSelector('text=Ya no hay archivos por acomodar', { timeout: 15000 }).then(() => ok(true, 'B: ya no hay nada por renombrar')).catch(() => ok(false, 'B: aviso de nada por renombrar'));
ok(await B.locator('dialog.modal').count() === 0, 'B no ve confirmación ni fallos');
await B.waitForTimeout(1500); await B.click('[data-dbx=sync]'); await B.waitForTimeout(1500);
const titulos = await B.evaluate(async () => { const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); }); const all = (st) => new Promise((x) => { const q = d.transaction(st).objectStore(st).getAll(); q.onsuccess = () => x(q.result.map((y) => y.title || y.etiqueta)); }); return [...await all('lotes'), ...await all('contracts')]; });
ok(!titulos.some((t) => /conflicto/.test(t || '')) && titulos.length === 2, 'sin copias en conflicto: ' + titulos.join(' | '));
ok(!files().some((p) => /conflicto/.test(p)), 'Dropbox sin copias en conflicto');
ok(!errors.length, 'sin errores: ' + errors.join(' | '));
await b.close(); process.exit(errors.length ? 1 : 0);
