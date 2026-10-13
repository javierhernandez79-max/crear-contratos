// Alta de varias partes a la vez desde PDF (constancias fiscales, escrituras constitutivas y poderes).
// Arma un plan sin guardar nada: qué fichas se crean, cuáles se completan y qué documentos se omiten.
import { detectarTipo, extraer, sinTexto } from './extraccion.js';
import { newParty, newApoderado, rfcDuplicado } from './parties.js';
import { nucleo, parecido } from './servicios.js';

const plano = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const vacio = (v) => !String(v ?? '').trim();
const ORDEN = { csf: 0, acta: 1, poder: 2 };

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

  const leidos = docs.map((d) => ({ ...d, tipo: d.ia ? (d.ia.tipo === 'otro' ? null : d.ia.tipo) : sinTexto(d.text) ? 'sin-texto' : detectarTipo(d.text) }))
    .sort((a, b) => (ORDEN[a.tipo] ?? 9) - (ORDEN[b.tipo] ?? 9));
  for (const d of leidos) {
    if (d.tipo === 'sin-texto') { omitidos.push({ name: d.name, motivo: d.errorIA || 'Parece escaneado (sin texto que leer): captúralo a mano o enciende la lectura con IA.' }); continue; }
    if (!d.tipo) { omitidos.push({ name: d.name, motivo: 'No parece constancia fiscal, escritura constitutiva ni poder.' }); continue; }
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
      const p = mencionada(texto, data.nombre || d.ia?.empresa);
      const f = p ? deParte(p) : fila(newParty('pm', false), true);
      f.llenos += completar(f.party, data, ACTA);
      f.docs.push({ name: d.name, tipo: d.tipo, ia: !!d.ia });
    } else {
      const p = mencionada(texto, d.ia?.empresa);
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
