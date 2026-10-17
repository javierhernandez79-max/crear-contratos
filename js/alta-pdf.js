// Alta de varias partes a la vez desde documentos: PDF, Word, imagen o texto (constancias fiscales, escrituras constitutivas, poderes,
// boletas del Registro Público e INE de los apoderados).
// Arma un plan sin guardar nada: qué fichas se crean, cuáles se completan y qué documentos se omiten.
import { detectarTipo, extraer, sinTexto } from './extraccion.js';
import { newParty, newApoderado, rfcDuplicado } from './parties.js';
import { nucleo, parecido } from './servicios.js';

const plano = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const vacio = (v) => !String(v ?? '').trim();
const ORDEN = { csf: 0, acta: 1, rpp: 2, poder: 3, ine: 4 };

/** Copia a `destino` solo los datos que tiene vacíos (nunca sobrescribe). Devuelve cuántos llenó. */
function completar(destino, data, campos) {
  let n = 0;
  for (const k of campos) {
    if (vacio(data[k]) || !vacio(destino[k])) continue;
    destino[k] = k === 'rfc' || k === 'curp' ? String(data[k]).toUpperCase() : data[k];
    n++;
  }
  return n;
}
const CSF = ['nombre', 'rfc', 'curp', 'domicilio', 'correo'];
const ACTA = ['nombre', 'escrituraNumero', 'escrituraFecha', 'notario', 'notariaNumero', 'notariaCiudad', 'folioMercantil', 'folioFecha', 'objetoSocial'];
const PODER = ['nombre', 'poderNumero', 'poderFecha', 'notario', 'notariaNumero', 'notariaCiudad', 'facultades'];
const RPP = ['folioMercantil', 'folioFecha', 'folioLugar'];
const INE_APO = ['identificacion', 'identificacionVigencia'];
const INE_PF = ['curp', 'identificacion', 'sexo'];
/** "EMPRESA X - ACT CONST.pdf" → "EMPRESA X": el expediente suele nombrar los archivos con la empresa al inicio. */
const empresaDelArchivo = (name) => String(name || '').replace(/\.[a-z0-9]{2,8}$/i, '').split(/\s+-\s+/)[0].trim();

/**
 * docs = [{ name, text, ia? }] (ia = lo leído con IA de un escaneado: { tipo, kind, empresa, datos });
 * parties = catálogo actual (no se modifica).
 * Devuelve { filas: [{ party, nueva, docs: [{name, tipo}], llenos }], omitidos: [{ name, motivo }] }.
 */
export function planAlta(docs, parties) {
  const filas = [];
  const omitidos = [];
  const fila = (p, nueva) => { const f = { party: p, nueva, docs: [], llenos: 0 }; filas.push(f); return f; };
  /** Fila del plan (o ficha existente, que entra al plan como copia) para una parte. */
  const deParte = (p) => filas.find((f) => f.party.id === p.id) || fila(structuredClone(p), false);
  // Empresa que menciona el documento: primero las del lote, luego el catálogo
  const mencionada = (text, nombre) => {
    const cands = [...filas.map((f) => f.party), ...parties.filter((p) => !filas.some((f) => f.party.id === p.id))];
    if (nombre) {
      const best = cands.map((p) => ({ p, s: parecido(nombre, p.nombre) })).sort((a, b) => b.s - a.s)[0];
      if (best && best.s >= 0.85) return best.p;
    }
    const t = plano(text);
    return cands.find((p) => { const k = nucleo(p.nombre); return k.length >= 6 && t.includes(k); }) || null;
  };
  // Si el documento no la menciona, la empresa del nombre del archivo
  const deArchivo = (name) => { const e = empresaDelArchivo(name); return e ? mencionada(e, e) : null; };

  const leidos = docs.map((d) => ({ ...d, tipo: d.error ? 'error' : d.ia ? (d.ia.tipo === 'otro' ? null : d.ia.tipo) : sinTexto(d.text) ? 'sin-texto' : detectarTipo(d.text) }))
    .sort((a, b) => (ORDEN[a.tipo] ?? 9) - (ORDEN[b.tipo] ?? 9));
  for (const d of leidos) {
    if (d.tipo === 'error') { omitidos.push({ name: d.name, motivo: d.error }); continue; }
    if (d.tipo === 'sin-texto') { omitidos.push({ name: d.name, motivo: d.errorIA || 'Parece escaneado o es una imagen (sin texto que leer): captúralo a mano o enciende la lectura con IA.' }); continue; }
    if (!d.tipo) { omitidos.push({ name: d.name, motivo: 'No parece constancia fiscal, escritura constitutiva, poder, boleta del Registro Público ni INE.' }); continue; }
    const data = d.ia ? { ...d.ia.datos, kind: d.ia.kind || undefined } : extraer(d.tipo, d.text);
    // Con IA no hay texto: la empresa se busca por la denominación que leyó
    const texto = d.ia ? d.ia.empresa : d.text;
    if (d.tipo === 'csf') {
      const rfc = String(data.rfc || '').toUpperCase();
      if (!rfc) { omitidos.push({ name: d.name, motivo: 'No encontré el RFC en la constancia.' }); continue; }
      const enLote = filas.find((f) => plano(f.party.rfc) === plano(rfc));
      const existente = !enLote && rfcDuplicado(rfc, parties);
      const f = enLote || (existente ? deParte(existente) : fila(newParty(data.kind || 'pm', false), true));
      f.llenos += completar(f.party, data, CSF);
      f.docs.push({ name: d.name, tipo: d.tipo, ia: !!d.ia });
    } else if (d.tipo === 'acta') {
      const p = mencionada(texto, data.nombre || d.ia?.empresa) || deArchivo(d.name);
      const f = p ? deParte(p) : fila(newParty('pm', false), true);
      f.llenos += completar(f.party, data, ACTA);
      f.docs.push({ name: d.name, tipo: d.tipo, ia: !!d.ia });
    } else if (d.tipo === 'rpp') {
      const p = mencionada(texto, data.nombre || d.ia?.empresa) || deArchivo(d.name);
      if (!p) { omitidos.push({ name: d.name, motivo: 'Registro Público: no identifiqué de qué empresa es. Súbelo junto con su constancia o desde su ficha.' }); continue; }
      const f = deParte(p);
      f.llenos += completar(f.party, data, RPP);
      f.docs.push({ name: d.name, tipo: d.tipo, ia: !!d.ia });
    } else if (d.tipo === 'ine') {
      if (!data.nombre) { omitidos.push({ name: d.name, motivo: 'INE: no se leyó el nombre.' }); continue; }
      // Primero el apoderado con ese nombre (en el lote o el catálogo); si no, una persona física; si no, la empresa del archivo
      const cands = [...filas.map((x) => x.party), ...parties.filter((p) => !filas.some((x) => x.party.id === p.id))];
      let dueno = null;
      let apo = null;
      for (const p of cands) {
        const a = p.kind === 'pm' && p.apoderados.find((x) => parecido(x.nombre, data.nombre) >= 0.8);
        if (a) { dueno = p; apo = a; break; }
      }
      const pf = !dueno && cands.find((p) => p.kind === 'pf' && parecido(p.nombre, data.nombre) >= 0.85);
      if (pf) {
        const f = deParte(pf);
        f.llenos += completar(f.party, data, INE_PF);
        f.docs.push({ name: d.name, tipo: d.tipo, ia: !!d.ia });
        continue;
      }
      if (!dueno) {
        dueno = deArchivo(d.name);
        if (!dueno || dueno.kind !== 'pm') { omitidos.push({ name: d.name, motivo: `INE de ${data.nombre}: no encontré a qué empresa o apoderado pertenece. Súbela desde la ficha de la empresa.` }); continue; }
      }
      const f = deParte(dueno);
      let a = apo && f.party.apoderados.find((x) => x.id === apo.id);
      if (!a) { a = newApoderado(); a.nombre = data.nombre; f.party.apoderados.push(a); f.llenos++; }
      f.llenos += completar(a, data, INE_APO);
      f.docs.push({ name: d.name, tipo: d.tipo, ia: !!d.ia });
    } else {
      const p = mencionada(texto, d.ia?.empresa) || deArchivo(d.name);
      if (!p) { omitidos.push({ name: d.name, motivo: 'Poder: no identifiqué de qué empresa es. Súbelo desde la ficha de la empresa.' }); continue; }
      const f = deParte(p);
      if (!data.nombre) { omitidos.push({ name: d.name, motivo: `Poder de ${p.nombre}: no encontré el nombre del apoderado.` }); continue; }
      let a = f.party.apoderados.find((x) => parecido(x.nombre, data.nombre) >= 0.8);
      if (!a) { a = newApoderado(); f.party.apoderados.push(a); f.llenos++; }
      f.llenos += completar(a, data, PODER);
      f.docs.push({ name: d.name, tipo: d.tipo, ia: !!d.ia });
    }
  }
  return { filas, omitidos };
}
