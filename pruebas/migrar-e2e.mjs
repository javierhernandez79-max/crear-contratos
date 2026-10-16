import { chromium } from 'playwright';
const APP = 'http://localhost:5173/';
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const pg = await (await b.newContext()).newPage(); pg.on('pageerror', (e) => errors.push(e.message));
await pg.goto(APP + '#/'); await pg.waitForSelector('#app');
const R = '/Legal - Documentos App';
await pg.evaluate(async (R) => {
  const m = await import('./js/model.js');
  const c = m.newContractFromTemplate({ id: 'u-t', name: 'S', titulo: 'T', vars: [], sections: [{ title: 'A', body: 'x' }], signers: [] });
  c.id = 'c-old'; c.updatedAt = 1000;
  c.documentos = [{ id: 'd1', path: `${R}/EXPEDIENTES CLIENTES/ALFADOC S.A. DE C.V./CONTRATOS DE SERVICIOS/X/X - APROBADO.pdf` }];
  c.anexos = [{ path: `${R}/EXPEDIENTES CLIENTES/ALFADOC S.A. DE C.V/ALFADOC - CSF.pdf` }];
  const p = { id: 'p-old', kind: 'pm', propia: false, activa: true, nombre: 'OMEGA', apoderados: [], accionistas: [], expediente: `${R}/EXPEDIENTES CLIENTES/OMEGA SEGURIDAD PRIVADA, S.A. DE C.V`, updatedAt: 5 };
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (st, v) => new Promise((x) => { const tx = d.transaction(st, 'readwrite'); tx.objectStore(st).put(v); tx.oncomplete = x; });
  await put('contracts', c); await put('parties', p);
}, R);
await pg.reload(); await pg.waitForSelector('#app'); await pg.waitForTimeout(800);
const r = await pg.evaluate(async () => {
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const get = (st, k) => new Promise((x) => { const q = d.transaction(st).objectStore(st).get(k); q.onsuccess = () => x(q.result); });
  return { c: await get('contracts', 'c-old'), p: await get('parties', 'p-old') };
});
ok(r.c.documentos[0].path.includes('/DOCUMENTOS GENERADOS - LEGAL APP/ALFADOC S.A. DE C.V./CONTRATOS DE SERVICIOS/'), 'contrato: documento a GENERADOS');
ok(r.c.anexos[0].path.includes('/EXPEDIENTES CORPORATIVOS CLIENTES/ALFADOC S.A. DE C.V/'), 'contrato: anexo a CORPORATIVOS');
ok(r.c.updatedAt === 1001, 'contrato: +1 ms para que gane al sincronizar');
ok(r.p.expediente.endsWith('/EXPEDIENTES CORPORATIVOS CLIENTES/OMEGA SEGURIDAD PRIVADA, S.A. DE C.V'), 'ficha: expediente a CORPORATIVOS');
await b.close(); if (errors.length) { console.log(errors); process.exit(1); }
