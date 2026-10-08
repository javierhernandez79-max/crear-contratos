// Lógica de documentos: creación, variables, formato y versiones.
export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export const VAR_TYPES = {
  text: 'Texto',
  date: 'Fecha',
  money: 'Monto',
  number: 'Número',
  address: 'Dirección',
  email: 'Correo',
};

export const humanize = (key) => {
  const t = key.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const slugify = (label) =>
  label
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'variable';

export function newContractFromTemplate(tpl) {
  const now = Date.now();
  const varDefs = tpl.vars.map(([key, label, type]) => ({ key, label, type }));
  const variables = {};
  for (const [key, , , def] of tpl.vars) {
    variables[key] = def ?? (key === 'fecha_firma' ? todayISO() : '');
  }
  const c = {
    id: uid(),
    title: tpl.name,
    templateId: tpl.id,
    status: 'borrador',
    varDefs,
    variables,
    currency: 'MXN',
    sections: tpl.sections.map((sec) => ({ id: uid(), title: sec.title, body: sec.body })),
    signers: tpl.signers.map((sg) => ({ id: uid(), role: sg.role, name: sg.name })),
    signatures: {},
    signedHash: null,
    versions: [],
    history: [],
    createdAt: now,
    updatedAt: now,
  };
  logChange(c, `Creado a partir de la plantilla "${tpl.name}"`);
  return c;
}

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Variables usadas en el documento que aún no tienen definición. */
export function syncVarDefs(c) {
  const used = usedVariables(c);
  for (const key of used) {
    if (!c.varDefs.some((d) => d.key === key)) {
      c.varDefs.push({ key, label: humanize(key), type: 'text' });
      if (!(key in c.variables)) c.variables[key] = '';
    }
  }
  return used;
}

export function usedVariables(c) {
  const used = new Set();
  const scan = (txt) => { for (const m of (txt || '').matchAll(VAR_RE)) used.add(m[1]); };
  scan(c.title);
  c.sections.forEach((sec) => { scan(sec.title); scan(sec.body); });
  c.signers.forEach((sg) => scan(sg.name));
  return used;
}

export function formatValue(def, raw, currency = 'MXN') {
  if (raw === undefined || raw === null || raw === '') return null;
  switch (def?.type) {
    case 'date': {
      const [y, m, d] = String(raw).split('-').map(Number);
      if (!y || !m || !d) return String(raw);
      return new Date(y, m - 1, d).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    case 'money': {
      const n = Number(String(raw).replace(/[^0-9.-]/g, ''));
      if (Number.isNaN(n)) return String(raw);
      return `${n.toLocaleString('es-MX', { style: 'currency', currency })} ${currency}`;
    }
    default:
      return String(raw);
  }
}

/**
 * Sustituye variables. `mode`:
 *  - 'text'  → texto plano; las variables vacías quedan como [Etiqueta]
 *  - 'parts' → arreglo de {text, var?, missing?} para resaltarlas en la vista previa
 */
export function fill(c, text, mode = 'text') {
  const parts = [];
  let last = 0;
  for (const m of (text || '').matchAll(VAR_RE)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    const key = m[1];
    const def = c.varDefs.find((d) => d.key === key);
    const val = formatValue(def, c.variables[key], c.currency);
    parts.push(val === null
      ? { text: `[${def?.label || humanize(key)}]`, var: key, missing: true }
      : { text: val, var: key });
    last = m.index + m[0].length;
  }
  if (last < (text || '').length) parts.push({ text: text.slice(last) });
  return mode === 'parts' ? parts : parts.map((p) => p.text).join('');
}

export function missingVariables(c) {
  return [...usedVariables(c)].filter((k) => formatValue(c.varDefs.find((d) => d.key === k), c.variables[k]) === null);
}

/** Huella del contenido final; si cambia después de firmar se avisa al usuario. */
export function contentHash(c) {
  const txt = [fill(c, c.title), ...c.sections.map((s) => fill(c, s.title) + '\n' + fill(c, s.body))].join('\n');
  let h = 5381;
  for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/**
 * Texto canónico que se firma con e.firma: mismo contenido que el PDF, en texto plano y
 * normalizado para que cualquier persona pueda volver a calcular la huella SHA-256.
 */
export function canonicalText(c) {
  const lines = [fill(c, c.title).toUpperCase(), ''];
  c.sections.forEach((s, i) => {
    lines.push(`${i + 1}. ${fill(c, s.title).toUpperCase()}`);
    lines.push(fill(c, s.body).trim(), '');
  });
  lines.push('FIRMANTES');
  c.signers.forEach((sg) => lines.push(`${sg.role}: ${fill(c, sg.name)}`));
  return lines.join('\n').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n') + '\n';
}

/** Firmas electrónicas avanzadas cuyo texto ya no coincide con el contrato. */
export function brokenEfirmas(c) {
  const text = canonicalText(c);
  return c.signers.filter((sg) => c.signatures[sg.id]?.type === 'efirma' && c.signatures[sg.id].signedText !== text);
}

export const hasEfirma = (c) => Object.values(c.signatures).some((s) => s.type === 'efirma');

export function snapshot(c) {
  return structuredClone({
    title: c.title, varDefs: c.varDefs, variables: c.variables,
    sections: c.sections, signers: c.signers, currency: c.currency,
  });
}

export function addVersion(c, note) {
  c.versions.unshift({ id: uid(), date: Date.now(), note: note || 'Versión guardada', data: snapshot(c) });
}

export function restoreVersion(c, versionId) {
  const v = c.versions.find((x) => x.id === versionId);
  if (!v) return;
  addVersion(c, 'Respaldo automático antes de restaurar');
  Object.assign(c, structuredClone(v.data));
  logChange(c, `Restauró la versión "${v.note}"`);
}

/** Registro de cambios. Ediciones repetidas del mismo elemento en 10 min se agrupan. */
export function logChange(c, text, groupKey) {
  const now = Date.now();
  const last = c.history[0];
  if (groupKey && last && last.groupKey === groupKey && now - last.date < 10 * 60 * 1000) {
    last.date = now;
    return;
  }
  c.history.unshift({ date: now, text, groupKey });
  if (c.history.length > 300) c.history.length = 300;
}

export function duplicateContract(c) {
  const copy = structuredClone(c);
  copy.id = uid();
  copy.title = `${c.title} (copia)`;
  copy.status = 'borrador';
  copy.signatures = {};
  copy.signedHash = null;
  copy.versions = [];
  copy.history = [];
  copy.createdAt = copy.updatedAt = Date.now();
  copy.sections.forEach((s) => (s.id = uid()));
  copy.signers.forEach((s) => (s.id = uid()));
  logChange(copy, `Duplicado de "${c.title}"`);
  return copy;
}

/** Convierte un contrato en plantilla reutilizable (sin valores ni firmas). */
export function contractToTemplate(c, name) {
  return {
    id: 'u-' + uid(),
    custom: true,
    category: 'mis',
    name,
    description: `Plantilla propia creada el ${new Date().toLocaleDateString('es-MX')}`,
    vars: c.varDefs.map((d) => [d.key, d.label, d.type, d.key === 'fecha_firma' ? undefined : c.variables[d.key] || undefined]),
    signers: c.signers.map(({ role, name }) => ({ role, name })),
    sections: c.sections.map(({ title, body }) => ({ title, body })),
    createdAt: Date.now(),
  };
}

export const fmtDateTime = (ts) =>
  new Date(ts).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fmtRelative = (ts) => {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 7 * 86400) return `hace ${Math.floor(diff / 86400)} d`;
  return new Date(ts).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
};
