import { readFileSync, writeFileSync } from 'fs';
const R = '../js/';
const W = await import(R + 'plantilla-word.js');
const S = process.argv[2];
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const bytes = new Uint8Array(readFileSync(S + '/cti/original.docx'));
const w = await W.leerWord(bytes);
const num = W.numerarBlancos(w.parrafos);
ok(num[2].includes('“⟦B0⟧”') && num[2].includes('LEGAL ⟦B1⟧') && num[2].includes('C. ⟦B2⟧'), 'los tres XXXXXXXXX del primer párrafo con número distinto');
// Propuesta como la daría la IA con los blancos numerados
const C = (texto, clave, parrafo) => ({ texto, clave, etiqueta: clave, tipo: 'text', parrafos: [parrafo] });
const campos = [
  C('⟦B0⟧', 'patron_nombre', 2), C('⟦B1⟧', 'patron_representante', 2), C('⟦B2⟧', 'trabajador_nombre', 2),
  C('⟦B3⟧', 'patron_representante', 5), C('⟦B4⟧', 'patron_domicilio', 5),
  C('⟦B5⟧', 'trabajador_nombre', 7), C('⟦B6⟧', 'trabajador_nacionalidad', 7), C('⟦B7⟧', 'trabajador_sexo', 7),
  C('⟦B8⟧', 'trabajador_domicilio', 7), C('⟦B9⟧', 'trabajador_curp', 7), C('⟦B10⟧', 'trabajador_rfc', 7),
  C('$ ⟦B17⟧ (⟦B18⟧ PESOS ⟦B19⟧/100 M.N.)', 'salario_diario', 39),
  C('⟦B24⟧', 'patron_nombre', 97), C('⟦B25⟧', 'patron_representante', 99), C('⟦B26⟧', 'trabajador_nombre', 104),
];
ok(W.contarCampos(num, campos).every((n) => n === 1), 'cada campo se encuentra una vez');
const marcado = await W.marcarWord(bytes, { campos, firmas: [{ prefijo: 'patron', parrafo: 99 }, { prefijo: 'trabajador', parrafo: 104 }] });
const p2 = (await W.leerWord(marcado)).parrafos;
ok(p2[2].includes('“{{patron_nombre}}”, REPRESENTADA POR SU REPRESENTANTE LEGAL {{patron_representante}}') && p2[2].includes('C. {{trabajador_nombre}}, A QUIEN'), 'primer párrafo: tres campos distintos');
ok(p2[7].includes('NACIONALIDAD {{trabajador_nacionalidad}}, DE SEXO {{trabajador_sexo}}, CON DOMICILIO PARTICULAR EN {{trabajador_domicilio}}'), 'declaración del trabajador');
ok(p2[39].includes('LA SUMA DIARIA DE {{salario_diario}}, DENTRO') && p2[39].includes('DE MANERA XXXXXXXXX'), 'salario (cifra y letra en un campo); el blanco no elegido regresa a XXXXXXXXX');
ok(!p2.join('').includes('⟦B'), 'no quedan números de blanco en el Word');
ok(p2[9].endsWith('FUNCIONES DE XXXXXXXXX.'), 'blancos no marcados intactos');
ok(p2[99].endsWith('{{_ds_patron}}') && p2[104].endsWith('{{_ds_trabajador}}'), 'marcas de firma');
const { plantilla } = await W.plantillaDesdeWord(marcado, { nombre: 'Prueba', categoria: 'laboral', archivo: 'x.docx', id: 'u-p' });
ok(plantilla.signers.map((s) => s.bind.prefix).join() === 'patron,trabajador', 'firmantes patrón y trabajador');
// Tabulador entre blancos: se cuentan igual que en el texto que ve la IA
const xml = '<w:p><w:r><w:t>____</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>____</w:t></w:r></w:p>';
const [x2, n] = W.reemplazarEnParrafo(xml, /_{3,}/g, (m) => `[${m.index}]`);
ok(n === 2 && x2.includes('<w:tab/>') && x2.includes('[0]') && x2.includes('[5]'), 'dos blancos separados por tabulador: ' + x2);
console.log(fails ? `${fails} FALLAS` : 'TODO OK');
