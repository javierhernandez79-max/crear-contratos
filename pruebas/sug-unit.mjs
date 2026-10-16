import ExcelJS from 'exceljs';
import { readSugerido, parecido, mejorCoincidencia, listaServicios, limpiarConcepto } from '../js/servicios.js';
const ok = (c, m) => console.log(c ? 'OK  ' : 'FAIL', m);
const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile('../sug/in/sug.xlsx');
const r = readSugerido(wb); console.log(JSON.stringify(r));
ok(r.cliente === 'ALFADOC' && r.empresas.length === 2 && r.empresas[0].conceptos.length === 2, 'lee el archivo real');
ok(parecido('ZETA TECH-SYSTEMS S.A DE C.V.', 'Zeta Tech Systems, S.A. de C.V.') === 1, 'ignora puntuación y tipo de sociedad');
const grupo = [{ nombre: 'ZETA TECH-SYSTEMS, S.A. DE C.V.' }, { nombre: 'EPSILON CLEANING SERVICE, S.A.' }, { nombre: 'VITALDEMO, S.A. DE C.V.' }, { nombre: 'BETAMAR DEL BAJIO, S.A. DE C.V.' }];
for (const [n, esp] of [['ZETA TECH-SYSTEMS S.A DE C.V.', 0], ['EPSILON-CLEANING-SERVICE, S.A.', 1], ['VITALDEMO S.A. DE C.V.', 2], ['VITALDENO, S.A. DE C.V.', 2], ['EPSILON CLEANNING SERVICES', 1], ['MERCAZA DEL BAJIO', 3], ['OTRA EMPRESA SA', null]]) {
  const m = mejorCoincidencia(n, grupo); ok((m ? grupo.indexOf(m.p) : null) === esp, `${n} → ${m ? m.p.nombre + ' (' + m.score.toFixed(2) + ')' : 'sin coincidencia'}`);
}
ok(listaServicios(['A', 'B', 'C']) === 'a) A; b) B; y c) C', 'lista con incisos');
ok(limpiarConcepto('84111501- Servicio de contabilidad de costos') === 'Servicio de contabilidad de costos' && limpiarConcepto('80111500 -Asesoría en recursos humanos') === 'Asesoría en recursos humanos' && limpiarConcepto('9212504 - Servicio de vigilancia.') === 'Servicio de vigilancia', 'quita clave SAT');
ok(!mejorCoincidencia('BIOTECHNOLOGIA AVANZADA SA DE CV', [{ nombre: 'TECH SA DE CV' }, { nombre: 'OTRA' }]), 'TECH no se confunde con BIOTECHNOLOGIA');
ok(!mejorCoincidencia('ALFA SERVICIOS INDUSTRIALES SA', [{ nombre: 'ALFA SA' }]), 'ALFA SA no se confunde con ALFA SERVICIOS INDUSTRIALES');
ok(mejorCoincidencia('GRUPO X', [{ nombre: 'GRUPO X SA DE CV' }])?.score === 1, 'GRUPO X = GRUPO X SA DE CV');
const wb2 = new ExcelJS.Workbook(); const ws2 = wb2.addWorksheet('S');
ws2.addRow(['CLIENTE Z']); ws2.addRow(['EMPRESA', 'CONCEPTO']); ws2.addRow(['TOTAL PLAY SA DE CV', '1 - Internet']); ws2.addRow([null, 'Totalidad de servicios de limpieza']); ws2.addRow(['Total por empresa', null]); ws2.addRow(['OTRA SA', { formula: 'X', result: { error: '#N/A' } }]); ws2.addRow([null, 'Algo']);
const r2 = readSugerido(wb2); console.log(JSON.stringify(r2.empresas.map((e) => [e.nombre, e.conceptos])));
ok(r2.empresas.length === 2 && r2.empresas[0].conceptos.length === 2 && r2.empresas[1].conceptos.join() === 'Algo', 'TOTAL PLAY y "Totalidad" no se pierden; error de fórmula se ignora');
