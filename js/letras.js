// Montos en letra para contratos: 150000 → "CIENTO CINCUENTA MIL PESOS 00/100 M.N."
const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ',
  'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE',
  'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function hasta999(n) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const r = n % 100;
  let txt = CENTENAS[c];
  if (r) {
    const dec = r < 30 ? UNIDADES[r] : DECENAS[Math.floor(r / 10)] + (r % 10 ? ` Y ${UNIDADES[r % 10]}` : '');
    txt = txt ? `${txt} ${dec}` : dec;
  }
  return txt;
}

/** Entero a letras. `apocope` usa "UN" en lugar de "UNO" (antes de sustantivo: "UN PESO", "VEINTIÚN MIL"). */
export function enLetras(n, apocope = true) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'CERO';
  const grupos = [
    [1e12, 'BILLÓN', 'BILLONES'],
    [1e6, 'MILLÓN', 'MILLONES'],
    [1e3, 'MIL', 'MIL'],
    [1, '', ''],
  ];
  const partes = [];
  let resto = n;
  for (const [valor, sing, plur] of grupos) {
    const q = Math.floor(resto / valor);
    resto %= valor;
    if (!q) continue;
    if (valor === 1e3) {
      partes.push(q === 1 ? 'MIL' : `${apocopar(hasta999(q))} MIL`);
    } else if (valor === 1) {
      partes.push(apocope ? apocopar(hasta999(q)) : hasta999(q));
    } else {
      partes.push(q === 1 ? `UN ${sing}` : `${apocopar(enLetras(q))} ${plur}`);
    }
  }
  return partes.join(' ').replace(/\s+/g, ' ').trim();
}

const apocopar = (t) => t.replace(/VEINTIUNO$/, 'VEINTIÚN').replace(/UNO$/, 'UN');

const MONEDAS = {
  MXN: ['PESO', 'PESOS', 'M.N.'],
  USD: ['DÓLAR', 'DÓLARES', 'USD'],
  EUR: ['EURO', 'EUROS', 'EUR'],
  COP: ['PESO', 'PESOS', 'COP'],
  ARS: ['PESO', 'PESOS', 'ARS'],
  CLP: ['PESO', 'PESOS', 'CLP'],
  PEN: ['SOL', 'SOLES', 'PEN'],
};

/** "CIENTO CINCUENTA MIL PESOS 00/100 M.N." */
export function montoEnLetra(monto, moneda = 'MXN') {
  const total = Math.round(Math.abs(Number(monto)) * 100);
  const enteros = Math.floor(total / 100);
  const centavos = String(total % 100).padStart(2, '0');
  const [sing, plur, sufijo] = MONEDAS[moneda] || ['', '', moneda];
  const nombre = enteros === 1 ? sing : plur;
  // "UN MILLÓN DE PESOS", "DOS MILLONES DE PESOS"
  const de = /(MILLÓN|MILLONES|BILLÓN|BILLONES)$/.test(enLetras(enteros)) ? ' DE' : '';
  return `${enLetras(enteros)}${de} ${nombre} ${centavos}/100 ${sufijo}`.replace(/\s+/g, ' ').trim();
}
