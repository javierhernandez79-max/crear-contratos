import { chromium } from 'playwright'; import fs from 'fs';
const APP = 'http://localhost:5173/';
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const tpl = JSON.parse(fs.readFileSync('../sug/u-marco-servicios.json'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', (e) => errors.push(e.message));
await pg.goto(APP + '#/'); await pg.waitForSelector('#bottom-nav');
await pg.evaluate(async (tpl) => {
  const m = await import('./js/model.js'); const P = await import('./js/parties.js');
  const pm = (id, nombre, propia, apos) => ({ ...P.newParty('pm', propia), id, nombre, rfc: '', domicilio: 'DOM VIEJO ' + id, apoderados: apos });
  const apo = (id, n) => ({ ...P.newApoderado(), id, nombre: n });
  const g1 = pm('g1', 'GRUPO UNO, S.A. DE C.V.', true, [apo('a1', 'ANA')]);
  const cli = pm('c1', 'ALFADOC, S.A. DE C.V.', false, [apo('a4', 'DIANA CLIENTE')]);
  const mk = (id, status, ligarCliente) => {
    const c = m.newContractFromTemplate(tpl); c.id = id; c.status = status; c.etiqueta = 'Prestación de servicios · GRUPO UNO, S.A. DE C.V. · ' + (ligarCliente ? 'ALFADOC, S.A. DE C.V.' : 'ALFADOC');
    P.applyParty(c, c.signers.find((s) => s.bind?.prefix === 'prestador'), g1, g1.apoderados[0]);
    const sc = c.signers.find((s) => s.bind?.prefix === 'cliente');
    if (ligarCliente) P.applyParty(c, sc, cli, cli.apoderados[0]); else { c.variables.cliente_nombre = 'ALFADOC'; }
    m.syncVarDefs(c); return c;
  };
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (st, v) => new Promise((x) => { const tx = d.transaction(st, 'readwrite'); tx.objectStore(st).put(v); tx.oncomplete = x; });
  await put('templates', tpl); await put('parties', g1); await put('parties', cli);
  await put('contracts', mk('k1', 'aprobado', false));   // cliente capturado a mano
  await put('contracts', mk('k2', 'borrador', true));    // cliente ligado
  const f = mk('k3', 'final', true); await put('contracts', f); // firmado: no se toca
}, tpl);
await pg.reload(); await pg.waitForSelector('#bottom-nav');
const get = (id) => pg.evaluate(async (id) => { const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  return new Promise((x) => { const q = d.transaction('contracts').objectStore('contracts').get(id); q.onsuccess = () => x(q.result); }); }, id);

// Editar el cliente en su ficha y salir
await pg.goto(APP + '#/catalogo/c1'); await pg.waitForSelector('#party-form [data-k=domicilio]');
await pg.fill('#party-form [data-k=domicilio]', 'AV. NUEVA 123, CDMX');
await pg.fill('#party-form [data-k=rfc]', 'SEG010101AA1');
await pg.waitForTimeout(700);
let k2 = await get('k2');
ok(k2.variables.cliente_domicilio === 'DOM VIEJO c1', 'mientras se edita la ficha no se tocan los contratos');
await pg.click('#bottom-nav a[href="#/"]'); await pg.waitForTimeout(1200);
const toastTxt = await pg.textContent('#toasts, .toasts, body');
const [k1, k2b, k3] = [await get('k1'), await get('k2'), await get('k3')];
ok(k2b.variables.cliente_domicilio === 'AV. NUEVA 123, CDMX' && k2b.variables.cliente_rfc === 'SEG010101AA1' && k2b.status === 'borrador', 'contrato ligado: datos nuevos');
ok(k1.variables.cliente_domicilio === 'AV. NUEVA 123, CDMX' && k1.signers.find((s) => s.bind?.prefix === 'cliente').party?.id === 'c1' && k1.variables.cliente_representante === 'DIANA CLIENTE', 'cliente capturado a mano: se liga a la ficha y toma sus datos y su apoderado');
ok(k1.status === 'borrador' && k1.history.some((h) => /actualizados desde el catálogo/.test(h.text)), 'el aprobado vuelve a borrador con nota en la bitácora');
ok(k1.etiqueta === 'Prestación de servicios · GRUPO UNO, S.A. DE C.V. · ALFADOC, S.A. DE C.V.', 'el nombre en la lista toma la razón social completa: ' + k1.etiqueta);
ok(k3.variables.cliente_domicilio === 'DOM VIEJO c1' && k3.status === 'final', 'el firmado no se toca');
ok(/2 contratos actualizados/.test(toastTxt), 'aviso con cuántos se actualizaron');
// Prestador también
await pg.goto(APP + '#/catalogo/g1'); await pg.waitForSelector('#party-form [data-k=domicilio]');
await pg.fill('#party-form [data-k=domicilio]', 'PRESTADOR NUEVO'); await pg.waitForTimeout(600);
await pg.goto(APP + '#/catalogo'); await pg.waitForTimeout(1000);
ok((await get('k2')).variables.prestador_domicilio === 'PRESTADOR NUEVO' && (await get('k3')).variables.prestador_domicilio === 'DOM VIEJO g1', 'también con el prestador; el firmado se respeta');
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'TODO OK'); await b.close();
