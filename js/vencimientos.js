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
