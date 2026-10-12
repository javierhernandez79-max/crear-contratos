// Días hábiles en México: lunes a viernes sin los días de descanso obligatorio del art. 74 de la LFT.
const ymd = (d) => d.toISOString().slice(0, 10);
const utc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

/** n-ésimo lunes del mes (n = 1, 2, 3…), en ISO. */
function lunes(year, month, n) {
  const d = new Date(Date.UTC(year, month, 1));
  const first = (8 - d.getUTCDay()) % 7 + 1; // día del primer lunes
  return ymd(new Date(Date.UTC(year, month, first + (n - 1) * 7)));
}

const cache = new Map();
/** Días de descanso obligatorio del año (art. 74 LFT). */
export function feriados(year) {
  if (!cache.has(year)) {
    const s = new Set([
      `${year}-01-01`, lunes(year, 1, 1), lunes(year, 2, 3), `${year}-05-01`,
      `${year}-09-16`, lunes(year, 10, 3), `${year}-12-25`,
    ]);
    // Transmisión del Poder Ejecutivo Federal: 1 de octubre cada seis años (2024, 2030…)
    if (year >= 2024 && (year - 2024) % 6 === 0) s.add(`${year}-10-01`);
    cache.set(year, s);
  }
  return cache.get(year);
}

export function esHabil(iso) {
  const d = utc(iso);
  const wd = d.getUTCDay();
  return wd !== 0 && wd !== 6 && !feriados(d.getUTCFullYear()).has(iso);
}

/** Días hábiles transcurridos después de `desde` y hasta `hasta` (incluido). */
export function habilesEntre(desde, hasta) {
  let n = 0;
  const end = utc(hasta).getTime();
  for (let d = utc(desde); ;) {
    d = new Date(d.getTime() + 86400000);
    if (d.getTime() > end) return n;
    if (esHabil(ymd(d))) n++;
  }
}

/** Fecha (ISO) en que se cumplen `n` días hábiles después de `desde`. */
export function sumarHabiles(desde, n) {
  let d = utc(desde);
  for (let k = 0; k < n;) {
    d = new Date(d.getTime() + 86400000);
    if (esHabil(ymd(d))) k++;
  }
  return ymd(d);
}
