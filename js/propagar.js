// Cuando cambian los datos de una parte en el catálogo, se vuelven a copiar a los contratos que la usan.
// Solo contratos que no se han firmado (ni en la app ni en un envío de DocuSign en curso); si estaban
// en revisión o aprobados regresan a borrador, porque el documento cambió.
import { applyParty } from './parties.js';
import { syncVarDefs, logChange } from './model.js';
import { nucleo } from './servicios.js';

const ENVIO_ABIERTO = ['created', 'sent', 'delivered', 'signed'];

/** ¿Se puede tocar este contrato? */
export const editable = (c) => c.status !== 'final' && !Object.keys(c.signatures || {}).length && !ENVIO_ABIERTO.includes(c.docusign?.status);

/**
 * Reaplica los datos de `cambiadas` (partes del catálogo) en los contratos. Los firmantes ligados a esa parte
 * se actualizan; los capturados a mano con el mismo nombre (sin tipo de sociedad) se ligan a la ficha.
 * Modifica los contratos en su lugar y devuelve los que cambiaron.
 */
export function propagarPartes(contracts, cambiadas) {
  const out = [];
  for (const c of contracts) {
    if (!editable(c)) continue;
    const antes = JSON.stringify([c.variables, c.signers.map((s) => [s.name, s.party])]);
    const etiquetaAntes = c.etiqueta;
    const nombres = [];
    for (const sg of c.signers) {
      let p = sg.party && cambiadas.find((x) => x.id === sg.party.id);
      if (!p && !sg.party && sg.bind?.prefix) {
        const k = nucleo(c.variables?.[`${sg.bind.prefix}_nombre`]);
        const iguales = k ? cambiadas.filter((x) => nucleo(x.nombre) === k) : [];
        if (iguales.length === 1) p = iguales[0];
      }
      if (!p) continue;
      // El mismo apoderado que ya firmaba; si no había o ya no existe, el único vigente
      const vigentes = p.apoderados.filter((a) => a.nombre?.trim() && a.vigente);
      const apo = p.apoderados.find((a) => a.id === sg.party?.apoderadoId) || (vigentes.length === 1 ? vigentes[0] : null);
      applyParty(c, sg, p, apo);
      nombres.push(p.nombre);
    }
    if (!nombres.length) continue;
    syncVarDefs(c);
    // El nombre que se puso al crearlo desde el Sugerido ("Prestación de servicios · prestador · cliente") se
    // rehace con los nombres nuevos; un nombre escrito a mano no se toca
    if (/^Prestación de servicios · /.test(c.etiqueta || '') && c.variables.prestador_nombre && c.variables.cliente_nombre) {
      c.etiqueta = `Prestación de servicios · ${c.variables.prestador_nombre} · ${c.variables.cliente_nombre}`;
      if (c.grupoServicios) c.grupoServicios = { ...c.grupoServicios, cliente: c.variables.cliente_nombre };
    }
    if (JSON.stringify([c.variables, c.signers.map((s) => [s.name, s.party])]) === antes) {
      // Solo cambió el nombre en la lista (el documento es el mismo): se guarda sin tocar el estado
      if (c.etiqueta !== etiquetaAntes) out.push(c);
      continue;
    }
    logChange(c, `Datos de ${nombres.join(' y ')} actualizados desde el catálogo`);
    if (c.status !== 'borrador') {
      logChange(c, 'El contrato volvió a borrador porque cambiaron los datos de una parte');
      c.status = 'borrador';
    }
    out.push(c);
  }
  return out;
}
