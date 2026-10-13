// Organización en Dropbox de los documentos de cada contrato: dentro del expediente del cliente (o de la
// empresa, en los contratos de trabajo y comisión), una subcarpeta por tipo de contrato y, dentro, una
// carpeta por contrato. Ej.: SEGURIDOC/CONTRATOS DE SERVICIOS/<contrato>/ o ACME/CONTRATOS DE TRABAJO/DETERMINADOS/<contrato>/
import { esContratoServicios } from './servicios.js';

export const SUBCARPETAS = {
  servicios: 'CONTRATOS DE SERVICIOS',
  trabajoIndeterminado: 'CONTRATOS DE TRABAJO/INDETERMINADOS',
  trabajoDeterminado: 'CONTRATOS DE TRABAJO/DETERMINADOS',
  comision: 'CONTRATOS DE COMISIÓN MERCANTIL',
  confidencialidad: 'CONVENIOS DE CONFIDENCIALIDAD',
  asociacion: 'CONTRATOS DE ASOCIACIÓN',
  pi: 'PROPIEDAD INTELECTUAL',
  comercial: 'CONTRATOS COMERCIALES',
  otros: 'OTROS CONTRATOS',
};

const prefijos = (c) => new Set((c.signers || []).map((s) => s.bind?.prefix).filter(Boolean));
// Prefijo del firmante que es la empresa en contratos de trabajo y de comisión (dueña del expediente)
const EMPRESA_LOTE = ['patron', 'comitente'];

/** Tipo de contrato para elegir la subcarpeta. `categoria` = la de su plantilla, si se conoce. */
export function tipoCarpeta(c, categoria) {
  const p = prefijos(c);
  if (p.has('comitente') || p.has('comisionista')) return 'comision';
  if (p.has('patron') || p.has('trabajador') || categoria === 'laboral') {
    // Por tiempo determinado si el contrato pide fecha de terminación
    return (c.varDefs || []).some((d) => d.key === 'fecha_fin') ? 'trabajoDeterminado' : 'trabajoIndeterminado';
  }
  if (esContratoServicios(c) || categoria === 'servicios') return 'servicios';
  return ['confidencialidad', 'asociacion', 'pi', 'comercial'].includes(categoria) ? categoria : 'otros';
}

export const subcarpetaDe = (c, categoria) => SUBCARPETAS[tipoCarpeta(c, categoria)];

/** Subcarpeta de un lote del Excel P1 según su tipo (DETERMINADO, INDETERMINADO o COMISION). */
export const subcarpetaLote = (tipo) => SUBCARPETAS[
  tipo === 'COMISION' ? 'comision' : tipo === 'DETERMINADO' ? 'trabajoDeterminado' : 'trabajoIndeterminado'];

/**
 * Parte dueña del expediente donde se guarda el contrato. `partes` = [{ sg, p }] de los firmantes vinculados.
 * Trabajo y comisión: la empresa (patrón o comitente), no la persona. Los demás: el cliente o contraparte
 * (la primera parte que no es del grupo); si todas son del grupo, la primera.
 */
export function duenoCarpeta(c, partes, categoria) {
  if (!partes.length) return null;
  if (['comision', 'trabajoDeterminado', 'trabajoIndeterminado'].includes(tipoCarpeta(c, categoria))) {
    return (partes.find(({ sg }) => EMPRESA_LOTE.includes(sg.bind?.prefix || sg.party?.prefix))
      || partes.find(({ p }) => p.kind === 'pm') || partes[0]).p;
  }
  return (partes.find(({ p }) => !p.propia) || partes[0]).p;
}
