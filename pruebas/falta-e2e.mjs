import { chromium } from 'playwright';
const APP = 'http://localhost:5173/';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
pg.on('pageerror', (e) => errors.push(e.message));
await pg.goto(APP + '#/');
// Unit: partyGaps y missingVariables
const r = await pg.evaluate(async () => {
  const P = await import('./js/parties.js'); const m = await import('./js/model.js');
  const p = P.newParty('pm', true); Object.assign(p, { nombre: 'ACC', rfc: 'X', domicilio: 'D' });
  const g1 = P.partyGaps(p);
  const a = P.newApoderado(); a.nombre = 'Ana'; a.poderNumero = '1'; p.apoderados.push(a);
  const g2 = P.partyGaps(p);
  Object.assign(p, { escrituraNumero: '1', escrituraFecha: '2020-01-01', notario: 'N', notariaNumero: '2', notariaCiudad: 'C', folioMercantil: 'F' });
  Object.assign(a, { poderFecha: '2020-01-01', notario: 'N', notariaNumero: '3', notariaCiudad: 'C' });
  const g3 = P.partyGaps(p);
  const pf = P.newParty('pf'); Object.assign(pf, { nombre: 'X', rfc: 'R', curp: 'C', domicilio: 'D', identificacion: 'INE' });
  const g4 = P.partyGaps(pf);
  // Contrato con declaraciones con [falta]
  const tpl = { id: 'u-t', name: 'S', titulo: 'T', vars: [['x', 'X', 'text']], sections: [{ title: 'D', body: '{{cliente_declaraciones}} {{x}}' }], signers: [{ role: 'EL CLIENTE', name: 'C', bind: { prefix: 'cliente' } }] };
  const c = m.newContractFromTemplate(tpl); c.variables.x = 'uno';
  const q = P.newParty('pm'); Object.assign(q, { nombre: 'Q', rfc: 'R', domicilio: 'D' });
  P.applyParty(c, c.signers[0], q, null); m.syncVarDefs?.(c);
  return { g1, g2, g3, g4, miss: m.missingVariables(c), det: m.missingDetail(c) };
});
console.log(JSON.stringify(r, null, 1));
ok(r.g1.length === 7, 'PM sin escritura ni apoderado: 7 faltantes (6 constitutiva + apoderado)');
ok(r.g2.length === 10 && r.g2.includes('Fecha del poder de Ana'), 'apoderado vigente sin datos del poder suma 4');
ok(r.g3.length === 0, 'PM completa: 0');
ok(r.g4.join() === 'Estado civil,Ocupación', 'PF: estado civil y ocupación cuentan');
ok(r.miss.includes('cliente_declaraciones'), 'declaraciones con [falta] cuenta como faltante');
ok(r.det.some((t) => /notario/.test(t) && /apoderado/.test(t)), 'detalle dice qué falta');
await b.close();
if (errors.length) { console.log(errors); process.exit(1); }
// UI: contrato con declaraciones incompletas en la pestaña de aprobación y en el catálogo
const b2 = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p2 = await (await b2.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
p2.on('pageerror', (e) => errors.push(e.message));
await p2.goto(APP + '#/'); await p2.waitForSelector('#app');
const cid = await p2.evaluate(async () => {
  const m = await import('./js/model.js'); const P = await import('./js/parties.js');
  const tpl = { id: 'u-t', name: 'S', titulo: 'T', vars: [['x', 'X', 'text']], sections: [{ title: 'D', body: '{{cliente_declaraciones}} {{x}}' }], signers: [{ role: 'EL CLIENTE', name: 'C', bind: { prefix: 'cliente' } }] };
  const c = m.newContractFromTemplate(tpl); c.variables.x = 'uno'; c.etiqueta = 'Falta escritura';
  const q = P.newParty('pm'); Object.assign(q, { id: 'q1', nombre: 'ACCELERATRANS', rfc: 'R', domicilio: 'D' });
  P.applyParty(c, c.signers[0], q, null); c.signers[0].party = { id: 'q1', apoderadoId: null, prefix: 'cliente' };
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (st, v) => new Promise((x) => { const tx = d.transaction(st, 'readwrite'); tx.objectStore(st).put(v); tx.oncomplete = x; });
  await put('parties', q); await put('contracts', c); return c.id;
});
await p2.reload(); await p2.waitForSelector('#app');
await p2.goto(APP + `#/c/${cid}/documento`); await p2.waitForSelector('.stepper');
const txt = await p2.textContent('.form-block');
ok(/Faltan 1 dato/.test(txt) && /notario/.test(await p2.textContent('.faltan-list')), 'paso 1 bloqueado y lista lo que falta');
ok(!(await p2.$('[data-wf=approve]')), 'sin botón Aprobar');
await p2.goto(APP + `#/c/${cid}/variables`); await p2.waitForSelector('.var-row');
ok(/Faltan en el catálogo/.test(await p2.textContent('.var-row.is-missing')), 'Variables marca declaraciones incompletas');
await p2.goto(APP + '#/catalogo'); await p2.waitForSelector('.party-list');
ok(/Faltan 7 datos/.test(await p2.textContent('.party-list')), 'catálogo: 7 faltantes');
await p2.screenshot({ path: process.argv[2] + '/falta-cat.png' });
await b2.close();
if (errors.length) { console.log(errors); process.exit(1); }
