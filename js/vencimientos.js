import { habilesEntre, sumarHabiles } from './habiles.js';
// Vencimientos: contratos de trabajo por tiempo determinado (Fecha de Terminación del P1)
// de los lotes aprobados. Se avisa desde N días antes; los vencidos siguen apareciendo
// hasta que alguien los marca como atendidos (renovado o terminado).

export const DIAS_DEFAULT = 15;
export const DIAS_URGENTE = 7;
export const SEGUIMIENTO = { renovado: 'Renovado', terminado: 'Terminado' };

const utc = (iso) => {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return y && m && d ? Date.UTC(y, m - 1, d) : NaN;
};

/** Días de hoy a la fecha (negativo si ya pasó). */
export const diasHasta = (iso, hoy) => Math.round((utc(iso) - utc(hoy)) / 86400000);

export function nivel(dias, anticipacion) {
  if (dias < 0) return 'vencido';
  if (dias <= Math.min(DIAS_URGENTE, anticipacion)) return 'urgente';
  if (dias <= anticipacion) return 'proximo';
  return 'vigente';
}

/** Una fila por trabajador con fecha de terminación, ordenadas de la más próxima a la más lejana. */
export function listaVencimientos(lotes, { hoy, anticipacion = DIAS_DEFAULT }) {
  const out = [];
  for (const l of lotes) {
    if (l.status !== 'aprobado' || l.tipo !== 'DETERMINADO') continue;
    l.trabajadores.forEach((w, idx) => {
      if (!w.fin || Number.isNaN(utc(w.fin))) return;
      const dias = diasHasta(w.fin, hoy);
      out.push({
        loteId: l.id, idx, nombre: w.nombre, curp: w.curp, puesto: w.puesto,
        cliente: l.cliente || '', empresa: l.empresa?.nombre || '',
        fin: w.fin, dias, nivel: nivel(dias, anticipacion), seguimiento: w.seguimiento || null,
      });
    });
  }
  return out.sort((a, b) => a.dias - b.dias || a.nombre.localeCompare(b.nombre));
}

/** Pendientes de atender: vencidos y los que vencen dentro de la anticipación. */
export const porAtender = (lista) => lista.filter((v) => !v.seguimiento && v.nivel !== 'vigente');

export function textoDias(dias) {
  if (dias === 0) return 'Vence hoy';
  if (dias === 1) return 'Vence mañana';
  if (dias > 0) return `En ${dias} días`;
  return dias === -1 ? 'Venció ayer' : `Venció hace ${-dias} días`;
}

// ---------- Contratos de prestación de servicios sin firma del cliente ----------
// Se cuenta desde que se generó el contrato; pasados PLAZO_FIRMA días hábiles sin marcarse como
// firmado, se avisa. Se puede descartar el aviso (p. ej. el cliente canceló) con una nota.

export const PLAZO_FIRMA = 15;

const isoLocal = (ms) => {
  const d = new Date(ms);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** Días hábiles que lleva el contrato sin firmar y fecha límite. null si ya está firmado. */
export function plazoFirma(c, hoy) {
  if (c.status === 'final' || !c.createdAt) return null;
  const inicio = isoLocal(c.createdAt);
  const habiles = habilesEntre(inicio, hoy);
  return { inicio, habiles, limite: sumarHabiles(inicio, PLAZO_FIRMA), atrasado: habiles >= PLAZO_FIRMA };
}

/** Contratos de servicios sin firma: [{ c, inicio, habiles, limite, atrasado, descartada }], los más atrasados primero. */
export function listaFirmasPendientes(contracts, { hoy, esServicios }) {
  return contracts.filter(esServicios)
    .map((c) => ({ c, ...plazoFirma(c, hoy), descartada: c.alertaFirma?.descartada ? c.alertaFirma : null }))
    .filter((x) => x.inicio)
    .sort((a, b) => b.habiles - a.habiles);
}

export const firmasPorAtender = (lista) => lista.filter((x) => x.atrasado && !x.descartada);
