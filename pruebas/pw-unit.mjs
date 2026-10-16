import { readFileSync } from 'fs';
const R = '../js/';
const { plantillaDesdeWord, unirMarcas } = await import(R + 'plantilla-word.js');
const { moldeDocx, readZip } = await import(R + 'molde.js');
const { newContractFromTemplate } = await import(R + 'model.js');
const S = process.argv[2];
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const { plantilla: t, avisos } = await plantillaDesdeWord(new Uint8Array(readFileSync(S + '/pw/arrendamiento.docx')), { nombre: 'Arrendamiento', categoria: 'comercial', archivo: 'arrendamiento.docx', id: 'u-x' });
ok(t.vars.map((v) => v[0]).join() === 'arrendador_nombre,arrendador_representante,arrendatario_nombre,arrendatario_rfc,arrendador_domicilio,monto_renta,fecha_inicio', 'marcas (incluidas las partidas): ' + t.vars.map((v) => v[0]));
ok(t.vars.find((v) => v[0] === 'arrendatario_rfc')[1] === 'RFC (El Arrendatario)', 'etiqueta de dato de parte: ' + t.vars.find((v) => v[0] === 'arrendatario_rfc')[1]);
ok(t.vars.find((v) => v[0] === 'monto_renta')[2] === 'money' && t.vars.find((v) => v[0] === 'fecha_inicio')[2] === 'date' && t.vars.find((v) => v[0] === 'arrendador_domicilio')[2] === 'address', 'tipos');
ok(t.signers.length === 2 && t.signers[0].bind.prefix === 'arrendador' && t.signers[0].name.includes('representada por'), 'firmantes: ' + JSON.stringify(t.signers.map((s) => s.name)));
ok(t.firmasDS.join() === 'arrendador,arrendatario' && !avisos.length, 'marcas de DocuSign, sin avisos: ' + avisos);
ok(t.sections.map((s) => s.title).join('|') === 'CONTRATO DE ARRENDAMIENTO|DECLARACIONES|CLÁUSULAS', 'secciones: ' + t.sections.map((s) => s.title).join('|'));
ok(!JSON.stringify(t.sections).includes('_ds_'), 'las marcas de firma no salen en la vista previa');
ok(t.title === 'CONTRATO DE ARRENDAMIENTO' && t.molde.data.length > 100, 'título y molde');
// Llenado: el Word sale con los datos, sin llaves, también en el encabezado
const c = newContractFromTemplate(t);
Object.assign(c.variables, { arrendador_nombre: 'INMUEBLES SA', arrendador_representante: 'ANA', arrendatario_nombre: 'JUAN PÉREZ', arrendatario_rfc: 'PEJJ800101AAA', arrendador_domicilio: 'Calle 1', monto_renta: '15000', fecha_inicio: '2026-11-01' });
ok(c.conMolde === true, 'contrato con molde');
const blob = await moldeDocx(c, t.molde, { anchors: { arrendador: '~dsf1~' } });
const files = await readZip(new Uint8Array(await blob.arrayBuffer()));
const txt = files.filter((f) => /word\/(document|header1)\.xml/.test(f.name)).map((f) => new TextDecoder().decode(f.data)).join('');
ok(txt.includes('INMUEBLES SA') && txt.includes('JUAN PÉREZ') && txt.includes('PEJJ800101AAA') && txt.includes('~dsf1~'), 'Word llenado (y ancla DocuSign)');
ok(!/\{\{|\}\}/.test(txt), 'no quedan llaves');
ok(/header1[\s\S]*/.test(files.map((f) => f.name).join()) && new TextDecoder().decode(files.find((f) => f.name === 'word/header1.xml').data).includes('JUAN PÉREZ'), 'encabezado llenado');
const r2 = await plantillaDesdeWord(new Uint8Array(readFileSync(S + '/pw/sin-firma.docx')), { nombre: 'X', categoria: 'comercial', archivo: 'x.docx', id: 'u-y' });
ok(r2.avisos.some((a) => a.includes('{{_ds_arrendatario}}')), 'aviso de marca de firma faltante');
try { await plantillaDesdeWord(new Uint8Array(readFileSync(S + '/pw/viejo.doc')), { nombre: 'X', categoria: 'comercial', archivo: 'v.doc', id: 'u-z' }); ok(false, '.doc rechazado'); }
catch (e) { ok(/guárdalo como \.docx/.test(e.message), '.doc rechazado: ' + e.message); }
ok(unirMarcas('<w:p><w:r><w:t>a {{x</w:t></w:r><w:r><w:t>}} b</w:t></w:r></w:p>') === '<w:p><w:r><w:t xml:space="preserve">a {{x}}</w:t></w:r><w:r><w:t xml:space="preserve"> b</w:t></w:r></w:p>', 'unirMarcas');
console.log(fails ? `${fails} FALLAS` : 'TODO OK');
// Sello de DocuSign: la marca pasa al inicio de la línea de firma "____" (formato con la marca al final del nombre)
const { reubicarFirmas } = await import(R + 'molde.js');
const xmlF = '<w:tc><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>_____________</w:t></w:r></w:p><w:p><w:r><w:t>{{prestador_nombre}}</w:t></w:r><w:r><w:t>{{_ds_prestador}}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{{cliente_nombre}}{{_ds_cliente}}</w:t></w:r></w:p></w:tc>';
const re = reubicarFirmas(xmlF);
ok(/<w:t>\{\{_ds_prestador\}\}<\/w:t><\/w:r><w:r><w:t>_____________/.test(re) && !/prestador_nombre\}\}<\/w:t><\/w:r><w:r><w:t>\{\{_ds/.test(re), 'marca de firma al inicio de la línea: ' + re.slice(0, 200));
ok(re.includes('{{cliente_nombre}}{{_ds_cliente}}'), 'sin línea en su celda: la marca no se mueve (no toma la línea de otra celda)');
console.log(fails ? `${fails} FALLAS` : 'TODO OK (con firmas)');
