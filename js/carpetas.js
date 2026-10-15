// Organización en Dropbox de los documentos de cada contrato: en DOCUMENTOS GENERADOS/<cliente> (o <empresa>,
// en los contratos de trabajo y comisión), una subcarpeta por tipo de contrato y, dentro, una
// carpeta por contrato. Ej.: SEGURIDOC/CONTRATOS DE SERVICIOS/<contrato>/ o ACME/CONTRATOS DE TRABAJO/DETERMINADOS/<contrato>/
import { esContratoServicios } from './servicios.js';
import { DROPBOX_CLIENTES, DROPBOX_EXPEDIENTES, DROPBOX_GENERADOS, DROPBOX_CORP_CLIENTES } from './config.js';

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

// ---- Rutas de la organización anterior (antes de oct-2026) ----
// Antes: EXPEDIENTES CLIENTES/<cliente>/ guardaba el expediente y los contratos generados, y los contratos de las
// empresas del grupo iban en EXPEDIENTES CORPORATIVOS RM/<empresa>/CONTRATOS…. Ahora los contratos van en
// DOCUMENTOS GENERADOS - LEGAL APP/<dueño>/ y el expediente del cliente en EXPEDIENTES CORPORATIVOS CLIENTES/<cliente>/.
const esGenerado = (seg) => /^(CONTRATOS|OTROS CONTRATOS)\b/i.test(seg || '');

/** Ruta en la organización nueva (o la misma si no cambia). `raiz` = carpeta compartida de la app. */
export function migrarRuta(ruta, raiz) {
  if (typeof ruta !== 'string' || !ruta.startsWith('/')) return ruta;
  const base = String(raiz || '').replace(/\/+$/, '');
  const bajo = (dir) => {
    const pre = `${base}/${dir}/`;
    return ruta.toLowerCase().startsWith(pre.toLowerCase()) ? ruta.slice(pre.length).split('/') : null;
  };
  const nueva = (dir, partes) => [`${base}/${dir}`, ...partes].filter(Boolean).join('/');
  const cli = bajo(DROPBOX_CLIENTES);
  if (cli) {
    const [carpeta, ...resto] = cli;
    if ([DROPBOX_GENERADOS, DROPBOX_CORP_CLIENTES].some((d) => d.split('/').pop().toUpperCase() === carpeta.toUpperCase())) return ruta;
    const generado = esGenerado(resto[0]) || carpeta.toUpperCase() === 'SIN CLIENTE';
    return nueva(generado ? DROPBOX_GENERADOS : DROPBOX_CORP_CLIENTES, [carpeta, ...resto]);
  }
  const rm = bajo(DROPBOX_EXPEDIENTES);
  if (rm && esGenerado(rm[1])) return nueva(DROPBOX_GENERADOS, rm);
  return ruta;
}

/** Cambia en un objeto (contrato, lote, ficha) todas las rutas de la organización anterior. Devuelve si cambió algo. */
export function migrarRutas(obj, raiz) {
  let cambio = false;
  const visitar = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string') {
        const n = migrarRuta(v, raiz);
        if (n !== v) { o[k] = n; cambio = true; }
      } else visitar(v);
    }
  };
  visitar(obj);
  return cambio;
}
