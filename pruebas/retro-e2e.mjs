import { chromium } from 'playwright';
const APP = 'http://localhost:5173/';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const pg = await (await b.newContext()).newPage(); pg.on('pageerror', (e) => errors.push(e.message));
await pg.goto(APP); await pg.waitForSelector('#app');
const ids = await pg.evaluate(async () => {
  const m = await import('./js/model.js');
  const tpl = { id: 'u-t', name: 'P', titulo: 'Contrato', category: 'servicios', vars: [['x', 'X', 'text'], ['fecha_firma', 'F', 'date']], sections: [{ title: 'O', body: 'T {{x}}.' }], signers: [{ role: 'P', name: 'P' }] };
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (st, v) => new Promise((x) => { const tx = d.transaction(st, 'readwrite'); tx.objectStore(st).put(v); tx.oncomplete = x; });
  await put('templates', { ...tpl, custom: true });
  const mk = (f) => { const c = m.newContractFromTemplate(tpl); c.variables = { x: 'u', fecha_firma: f }; c.status = 'aprobado'; c.aprobado = { by: 'x', date: 1 };
    c.docusign = { status: 'voided', voidedReason: 'x', env: 'demo', sentAt: 1, sentBy: 'a', recipients: [{ name: 'A', email: 'a@x.com', status: 'completed' }] }; return c; };
  const viejo = mk('2020-01-01'), futuro = mk('2099-01-01');
  await put('contracts', viejo); await put('contracts', futuro); return [viejo.id, futuro.id];
});
await pg.reload(); await pg.waitForSelector('#app');
for (const [i, quiere, m] of [[0, 0, 'fecha pasada: sin "Preparar un nuevo envío"'], [1, 1, 'fecha futura: con "Preparar un nuevo envío"']]) {
  await pg.evaluate((id) => { location.hash = `#/c/${id}/documento`; }, ids[i]); await pg.waitForSelector('#ds-envio');
  ok(await pg.locator('#ds-envio [data-wf=ds-reset]').count() === quiere, m);
}
ok(!errors.length, 'sin errores: ' + errors.join(' | '));
await b.close(); process.exit(errors.length ? 1 : 0);
