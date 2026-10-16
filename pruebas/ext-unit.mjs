import * as X from '../js/extraccion.js';
import assert from 'node:assert/strict';
const CSF_PM = `CONSTANCIA DE SITUACIÓN FISCAL
Lugar y Fecha de Emisión
QUERÉTARO , QUERÉTARO A 05 DE OCTUBRE DE 2026
Datos de Identificación del Contribuyente:
RFC: EJE100315AB1
Denominación/Razón Social: EMPRESA EJEMPLO DEMO
Régimen Capital: SOCIEDAD ANONIMA DE CAPITAL VARIABLE
Nombre Comercial:
Fecha inicio de operaciones: 15 DE MARZO DE 2010
Estatus en el padrón: ACTIVO
Datos del domicilio registrado
Código Postal:76000 Tipo de Vialidad: AVENIDA (AV.)
Nombre de Vialidad: CONSTITUYENTES Número Exterior: 100
Número Interior: 5 Nombre de la Colonia: CENTRO
Nombre de la Localidad: SANTIAGO DE QUERÉTARO Nombre del Municipio o Demarcación Territorial: QUERÉTARO
Nombre de la Entidad Federativa: QUERÉTARO Entre Calle: JUÁREZ
Y Calle: ALLENDE
Correo Electrónico: CONTACTO@EJEMPLO.TEST`;
assert.equal(X.detectarTipo(CSF_PM), 'csf');
const a = X.extraerCSF(CSF_PM);
console.log(a);
assert.equal(a.kind, 'pm'); assert.equal(a.rfc, 'EJE100315AB1');
assert.equal(a.nombre, 'EMPRESA EJEMPLO DEMO S.A. DE C.V.');
assert.equal(a.domicilio, 'AVENIDA CONSTITUYENTES NO. 100 INT. 5, COL. CENTRO, C.P. 76000, QUERÉTARO, QUERÉTARO');
assert.equal(a.correo, 'contacto@ejemplo.test');
const CSF_PF = `CÉDULA DE IDENTIFICACIÓN FISCAL RFC: PEAJ800101XY2 CURP: PEAJ800101HQTRLN09 Nombre (s): JUAN Primer Apellido: PÉREZ Segundo Apellido: ALMANZA Fecha inicio de operaciones: 01 DE ENERO DE 2015 Código Postal:01000 Tipo de Vialidad: CALLE Nombre de Vialidad: OLIVO Número Exterior: 12 Número Interior: Nombre de la Colonia: FLORIDA Nombre del Municipio o Demarcación Territorial: ÁLVARO OBREGÓN Nombre de la Entidad Federativa: CIUDAD DE MÉXICO Entre Calle: X`;
const b = X.extraerCSF(CSF_PF);
console.log(b);
assert.equal(b.kind, 'pf'); assert.equal(b.nombre, 'JUAN PÉREZ ALMANZA'); assert.equal(b.curp, 'PEAJ800101HQTRLN09');
assert.equal(b.domicilio, 'OLIVO NO. 12, COL. FLORIDA, C.P. 01000, ÁLVARO OBREGÓN, CIUDAD DE MÉXICO');

assert.equal(X.letrasANumero('dos mil diez'), 2010);
assert.equal(X.letrasANumero('doce mil trescientos cuarenta y cinco'), 12345);
assert.equal(X.letrasANumero('veintiuno'), 21);
assert.equal(X.letrasANumero('hola'), null);

const ACTA = `LIBRO MIL DOSCIENTOS. ESCRITURA PÚBLICA NÚMERO 12,345 (DOCE MIL TRESCIENTOS CUARENTA Y CINCO). En la ciudad de Santiago de Querétaro, a los quince días del mes de marzo del año dos mil diez, ante mí, Licenciado Roberto Gómez Ruiz, Titular de la Notaría Pública número 7 de la ciudad de Querétaro, Querétaro, comparecen los señores ... para constituir una sociedad anónima de capital variable conforme a los siguientes estatutos. ARTÍCULO PRIMERO. La denominación de la sociedad será "EMPRESA EJEMPLO DEMO", seguida de las palabras ... ARTÍCULO SEGUNDO. El objeto social será: a) la prestación de servicios de consultoría; b) la compraventa de bienes. ARTÍCULO TERCERO. Duración ... Inscrita en el Registro Público de Comercio bajo el folio mercantil electrónico número N-2010012345 de fecha 2 de abril de 2010.`;
assert.equal(X.detectarTipo(ACTA), 'acta');
const c = X.extraerActa(ACTA);
console.log(c);
assert.equal(c.escrituraNumero, '12,345'); assert.equal(c.escrituraFecha, '2010-03-15');
assert.equal(c.notario, 'Licenciado Roberto Gómez Ruiz'); assert.equal(c.notariaNumero, '7');
assert.equal(c.folioMercantil, 'N-2010012345'); assert.equal(c.folioFecha, '2010-04-02');
assert.equal(c.nombre, 'EMPRESA EJEMPLO DEMO');
assert.match(c.objetoSocial, /^a\) la prestación de servicios de consultoría; b\) la compraventa de bienes$/);

const PODER = `INSTRUMENTO NÚMERO CUATRO MIL QUINIENTOS. En Querétaro, el 3 de julio de 2018, ante el Lic. Ana María Torres, Notario Público número 21 del Estado de Querétaro, comparece EMPRESA EJEMPLO DEMO, S.A. DE C.V., a fin de otorgar poder general para pleitos y cobranzas, actos de administración y para suscribir títulos de crédito en favor del señor Carlos Hernández Vega, quien acepta.`;
assert.equal(X.detectarTipo(PODER), 'poder');
const d = X.extraerPoder(PODER);
console.log(d);
assert.equal(d.poderNumero, '4,500'); assert.equal(d.poderFecha, '2018-07-03');
assert.equal(d.nombre, 'Carlos Hernández Vega'); assert.equal(d.notariaNumero, '21');
assert.equal(d.notario, 'Lic. Ana María Torres');
assert.equal(d.facultades, 'pleitos y cobranzas, actos de administración, títulos de crédito');
assert.ok(X.sinTexto('  \n  12 3 '));
console.log('OK');
