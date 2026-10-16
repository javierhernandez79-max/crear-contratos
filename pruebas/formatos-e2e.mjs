import { chromium } from 'playwright'; import fs from 'fs'; import { execSync } from 'child_process';
const S = process.argv[2] || '../shots'; const APP = 'http://localhost:5173/';
const errors = []; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) errors.push(m); };
const bundle = JSON.parse(fs.readFileSync('../fmt/formatos-cps.json'));
const tpls = bundle.templates.filter((t) => ['F2', 'F3', 'F5'].includes(t.formato));
const marco = JSON.parse(fs.readFileSync('../sug/u-marco-servicios.json'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push(e.message));
await pg.goto(APP + '#/'); await pg.waitForSelector('#bottom-nav');
const apo = (id, n) => ({ id, nombre: n, cargo: 'Apoderado legal', vigente: true, poderNumero: '55', poderFecha: '2020-01-02', notario: 'Lic. P', notariaNumero: '9', notariaCiudad: 'CDMX' });
const pm = (id, nombre, propia, apos = []) => ({ id, kind: 'pm', propia, activa: true, nombre, rfc: '', domicilio: 'DOM ' + id, correo: '', telefono: '', escrituraNumero: '100', escrituraFecha: '2015-10-20', notario: 'Lic. Notario ' + id, notariaNumero: '7', notariaCiudad: 'León', folioMercantil: '', folioFecha: '', objetoSocial: '', apoderados: apos, accionistas: [] });
const idb = (fn, arg) => pg.evaluate(async ({ fn, arg }) => {
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const put = (st, v) => new Promise((x) => { const tx = d.transaction(st, 'readwrite'); tx.objectStore(st).put(v); tx.oncomplete = x; });
  const all = (st) => new Promise((x) => { const q = d.transaction(st).objectStore(st).getAll(); q.onsuccess = () => x(q.result); });
  return new Function('put', 'all', 'arg', `return (async () => { ${fn} })()`)(put, all, arg);
}, { fn, arg });
await idb('for (const t of arg.t) await put("templates", t); for (const p of arg.p) await put("parties", p);', { t: [...tpls, marco], p: [
  pm('g1', 'ZETA TECH SYSTEMS, S.A. DE C.V.', true, [apo('a1', 'ANA APODERADA')]), pm('g2', 'EPSILON CLEANING SERVICE, S.A.', true, [apo('a3', 'CARLOS')]),
  pm('g3', 'BETAMAR DEL BAJIO, S.A. DE C.V.', true, [apo('a5', 'EVA')]), pm('c1', 'ALFADOC, S.A. DE C.V.', false, [apo('a4', 'DIANA CLIENTE')]), pm('c2', 'OTRO CLIENTE, S.A.', false, [apo('a6', 'FER')])] });
await pg.reload(); await pg.waitForSelector('a[href="#/servicios"]');

const abrir = async () => {
  await pg.goto(APP + '#/'); await pg.waitForSelector('a[href="#/servicios"]');
  await pg.click('a[href="#/servicios"]'); await pg.waitForSelector('#s-fecha');
  await pg.setInputFiles('#s-file', '../sug/in/sug.xlsx'); await pg.waitForSelector('[data-fmt]');
};
const opciones = (pid) => pg.$$eval(`[data-fmt="${pid}"] option`, (os) => os.filter((o) => o.value).map((o) => ({ t: o.textContent.trim(), dis: o.disabled, sel: o.selected })));

// 1. Primera solicitud: se elige formato por empresa
await abrir();
ok(!(await pg.locator('#s-tpl').count()), 'ya no hay selector de plantilla único');
let o1 = await opciones('g1');
ok(o1.length === 3 && o1.map((o) => o.t.slice(0, 2)).join() === 'F2,F3,F5' && o1[0].t === 'F2', 'solo formatos con código, en orden: ' + o1.map((o) => o.t).join(' | '));
ok(await pg.isDisabled('#s-create'), 'sin formato elegido no se puede crear');
await pg.selectOption('[data-fmt="g1"]', 'u-cps-f2'); await pg.waitForTimeout(200);
const o2 = await opciones('g2');
ok(o2.find((o) => o.t.startsWith('F2')).dis && o2.find((o) => o.t.startsWith('F2')).t.includes('elegido para ZETA TECH'), 'F2 bloqueado en la otra fila: ' + o2[0].t);
await pg.selectOption('[data-fmt="g2"]', 'u-cps-f3'); await pg.waitForTimeout(200);
ok(!(await pg.isDisabled('#s-create')), 'con formato en cada empresa se habilita crear');
await pg.screenshot({ path: S + '/fmt1-eleccion.png', fullPage: true });
await pg.click('#s-create'); await pg.waitForSelector('.serv-doc');
const chips = await pg.locator('.serv-doc .formato-chip').allTextContents();
ok(chips.join() === 'F2,F3', 'revisión muestra el formato de cada contrato: ' + chips);
let cs = await idb('return all("contracts")');
ok(cs.length === 2 && cs.every((c) => c.conMolde) && cs.map((c) => c.formato).sort().join() === 'F2,F3', 'contratos con formato y molde');
ok(!JSON.stringify(cs.map((c) => [c.sections, c.variables])).includes('"F2"'), 'el código no está en el texto ni en los datos');
// Flujo nuevo: con datos faltantes no se aprueba; se completan en la base y se recarga
ok(await pg.isDisabled('#sr-approve'), 'con datos faltantes no se puede aprobar en lote');
await pg.evaluate(async () => {
  const m = await import('./js/model.js');
  const r = indexedDB.open('crear-contratos'); const d = await new Promise((x) => { r.onsuccess = () => x(r.result); });
  const cs = await new Promise((x) => { const q = d.transaction('contracts').objectStore('contracts').getAll(); q.onsuccess = () => x(q.result); });
  for (const c of cs) {
    for (const k of m.missingVariables(c)) { const t = c.varDefs.find((v) => v.key === k)?.type; c.variables[k] = t === 'date' ? '2026-10-01' : t === 'number' || t === 'money' ? '1' : 'X'; }
    await new Promise((x) => { const tx = d.transaction('contracts', 'readwrite'); tx.objectStore('contracts').put(c); tx.oncomplete = x; });
  }
});
await pg.reload(); await pg.waitForSelector('#sr-approve:not([disabled])');
// Aprobar: solo Word
const [zip] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), (async () => { await pg.click('#sr-approve'); await pg.click('dialog.modal button[value=ok]'); })()]);
await zip.saveAs(S + '/fmt.zip');
const zl = execSync(`unzip -Z1 ${S}/fmt.zip`).toString().trim().split('\n');
ok(zl.length === 2 && zl.every((n) => n.endsWith('.docx')), 'zip solo con los 2 Word (el PDF sale de Word): ' + zl.join(' | '));
execSync(`rm -rf ${S}/fmtz && mkdir -p ${S}/fmtz && cd ${S}/fmtz && unzip -q ../fmt.zip`);
const w = zl.find((n) => n.includes('ZetaTech'));
const xml = execSync(`unzip -p "${S}/fmtz/${w}" word/document.xml`).toString();
ok(xml.includes('Antique Olive'), 'Word conserva la letra del formato F2 (Antique Olive)');
ok(!xml.includes('{{') && xml.includes('ALFADOC') && xml.includes('ZETA TECH SYSTEMS') && xml.includes('Servicios de sistemas de Seguridad'), 'Word con datos y servicios, sin marcadores');
ok(!/~dsf/.test(xml), 'sin marcas de DocuSign en el Word normal');
const docTxt = execSync(`cd ${S}/fmtz && timeout 120 soffice --headless --convert-to txt:Text "${w}" >/dev/null 2>&1; cat "${w.replace(/docx$/, 'txt')}"`).toString();
ok(/DIANA CLIENTE/.test(docTxt) && !/X{4,}/.test(docTxt), 'Word abre en LibreOffice y no quedan huecos XXXX');

// 2. Segunda solicitud con el mismo cliente: formatos fijos
await abrir();
o1 = await opciones('g1');
ok(await pg.isDisabled('[data-fmt="g1"]') && o1.find((o) => o.sel)?.t.startsWith('F2'), 'ZETA TECH queda fija en F2 con este cliente');
ok(await pg.isDisabled('[data-fmt="g2"]') && (await opciones('g2')).find((o) => o.sel)?.t.startsWith('F3'), 'EPSILON fija en F3');
ok((await pg.textContent('.serv-list')).includes('Fijo: ya lo usa con este cliente'), 'aviso de formato fijo');
await pg.selectOption('[data-emp="1"]', 'g3'); await pg.waitForSelector('[data-fmt="g3"]');
const o3 = await opciones('g3');
ok(o3.find((o) => o.t.startsWith('F2')).dis && o3.find((o) => o.t.startsWith('F3')).dis && !o3.find((o) => o.t.startsWith('F5')).dis, 'otra empresa: F2 y F3 ocupados con este cliente, F5 libre');
ok(o3.find((o) => o.t.startsWith('F3')).t.includes('ya es de EPSILON'), 'dice de quién es el formato: ' + o3.find((o) => o.t.startsWith('F3')).t);
await pg.screenshot({ path: S + '/fmt2-fijos.png', fullPage: true });
// Otro cliente: sin amarres
await pg.selectOption('#s-cli', 'c2'); await pg.waitForTimeout(300);
ok(!(await pg.isDisabled('[data-fmt="g1"]')), 'con otro cliente la empresa no queda fija');
// Cliente capturado a mano con el mismo nombre: también se detecta
await pg.click('[data-modo=manual]'); await pg.fill('[data-man=cliente_nombre]', 'Alfadoc SA de CV'); await pg.press('[data-man=cliente_nombre]', 'Tab'); await pg.waitForTimeout(300);
ok(await pg.isDisabled('[data-fmt="g1"]'), 'cliente capturado a mano con el mismo nombre (sin tipo de sociedad): ZETA TECH fija en F2');
await pg.click('#s-cancel');

// 3. Contrato que rompe la regla (prestador cambiado a mano): no se puede aprobar
cs = await idb('return all("contracts")');
const base = cs.find((c) => c.formato === 'F2');
const malo = JSON.parse(JSON.stringify(base)); malo.id = 'malo'; malo.status = 'revision'; malo.createdAt = Date.now(); malo.grupoServicios = null;
const sp = malo.signers.find((s) => s.bind?.prefix === 'prestador'); sp.party = { id: 'g3', apoderadoId: 'a5', prefix: 'prestador' }; malo.variables.prestador_nombre = 'BETAMAR DEL BAJIO, S.A. DE C.V.';
await idb('await put("contracts", arg)', malo);
await pg.goto(APP + '#/'); await pg.reload(); await pg.waitForSelector('.contract-list');
await pg.goto(APP + '#/c/malo/documento'); await pg.waitForSelector('[data-wf=approve]');
ok((await pg.textContent('.banner.danger')).includes('El formato F2 ya se usó con este cliente para ZETA TECH'), 'aviso de conflicto de formato en Word y PDF');
ok(await pg.isDisabled('[data-wf=approve]'), 'la aprobación se bloquea (botón inactivo)');
// Pestaña Secciones: solo lectura
await pg.goto(APP + '#/c/malo/secciones'); await pg.waitForSelector('.paper');
ok(!(await pg.locator('#sections textarea, [data-add]').count()) && (await pg.textContent('#app')).includes('El texto de las cláusulas es fijo'), 'secciones de solo lectura con aviso de formato');
ok((await pg.textContent('#editor-head')).includes('F2'), 'encabezado del contrato con el código');
await pg.screenshot({ path: S + '/fmt3-conflicto.png', fullPage: true });
// PDF → ofrece el Word
await pg.goto(APP + '#/c/malo/documento'); await pg.waitForSelector('[data-wf=approve]');
await pg.goto(APP + '#/'); await pg.waitForSelector('.contract-list');
ok((await pg.locator('.contract-list .ll-row[data-id] .muted.small').allTextContents()).filter((t) => /^Formato \d/.test(t)).sort().join() === 'Formato 2,Formato 2,Formato 3', 'lista con el formato en la columna Tipo');

// Biblioteca: solo la plantilla maestra; los formatos quedan ocultos
await pg.goto(APP + '#/plantillas'); await pg.waitForSelector('.tpl-list');
let tl = await pg.textContent('.tpl-list');
ok(tl.includes('marco del despacho') && !/Formato [235]/.test(tl), 'biblioteca sin las plantillas por formato');
await pg.click('#tpl-fmt'); tl = await pg.textContent('.tpl-list');
ok(/Formato 2/.test(tl) && /Formato 5/.test(tl), 'el enlace muestra los 3 formatos para editarlos');
console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'TODO OK');
await b.close();
