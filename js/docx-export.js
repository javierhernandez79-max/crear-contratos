// Generación de Word (.docx) para revisión de los abogados. Recibe la librería docx como parámetro
// (vendor/docx.iife.js en el navegador, carga diferida; paquete npm en pruebas).
import { fill, layoutSections } from './model.js';

// Estilo de los documentos marco del despacho: Arial Narrow 10, márgenes laterales de 3 cm
const FONT = 'Arial Narrow';
const SIZE = 20; // medios puntos → 10 pt
const TWIP_CM = 567;

/**
 * Construye el documento. `label` va en el encabezado de cada página (p. ej. "EN REVISIÓN · v2");
 * vacío en la versión aprobada.
 */
export function buildDocxDocument(D, c, { label = '' } = {}) {
  const { Document, Paragraph, TextRun, AlignmentType, Header, Footer, PageNumber, Table, TableRow, TableCell, WidthType, BorderStyle, TabStopType } = D;
  const run = (text, opts = {}) => new TextRun({ text, font: FONT, size: SIZE, ...opts });
  const BODY = { after: 160, line: 252 };
  const para = (text, opts = {}) => new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: BODY,
    children: [run(text, opts.run)],
    ...opts.para,
  });
  // Los datos capturados van en negritas, como las "XXXX" de los documentos marco
  const filledRuns = (line) => fill(c, line, 'parts').map((p) => run(p.text, p.var && !p.missing ? { bold: true } : {}));

  const title = fill(c, c.title);
  // Si el documento abre con su propio proemio, el título solo va en el encabezado
  const children = c.sections[0]?.kind === 'texto' ? [] : [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [run(title.toUpperCase(), { bold: true, size: 24 })],
    }),
  ];

  layoutSections(c, (t) => fill(c, t)).forEach((l) => {
    if (l.heading) {
      children.push(new Paragraph({
        keepNext: true,
        alignment: l.texto ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { before: 240, after: 120 },
        children: [run(l.heading, { bold: true })],
      }));
    }
    const paras = (l.s.body || '').split(/\n/).map((p) => p.trim()).filter(Boolean);
    if (!paras.length && l.prefix) paras.push('');
    paras.forEach((p, j) => {
      // La primera línea de una cláusula ordinal inicia con "PRIMERA.- " en negritas
      const runs = filledRuns(p);
      children.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: BODY,
        children: j === 0 && l.prefix ? [run(l.prefix, { bold: true }), ...runs] : runs,
      }));
    });
  });

  // Firmas: tabla de dos columnas sin bordes
  if (c.signers.length) {
    children.push(new Paragraph({ keepNext: true, alignment: AlignmentType.CENTER, spacing: { before: 480, after: 240 }, children: [run('FIRMAS', { bold: true })] }));
    const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
    const cell = (sg) => new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: noBorders,
      // Como en los documentos marco: el carácter ("EL PATRÓN") arriba, la línea y el nombre abajo
      children: sg ? [
        new Paragraph({ spacing: { before: 240 }, alignment: AlignmentType.CENTER, children: [run(sg.role || '', { bold: true })] }),
        new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.CENTER, children: [run(signatureMark(c, sg), { italics: true, size: 18, color: '1E3A5F' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [run('_________________________________')] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [run(fill(c, sg.name) || ' ')] }),
      ] : [new Paragraph('')],
    });
    const rows = [];
    for (let i = 0; i < c.signers.length; i += 2) rows.push(new TableRow({ cantSplit: true, children: [cell(c.signers[i]), cell(c.signers[i + 1])] }));
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders, rows }));
  }

  if (c.anexos?.length) {
    children.push(new Paragraph({ keepNext: true, spacing: { before: 360, after: 120 }, children: [run('ANEXOS', { bold: true })] }));
    c.anexos.forEach((a, i) => children.push(para(`Anexo ${i + 1}. ${a.title || a.name}`, { para: { alignment: AlignmentType.LEFT } })));
  }

  const small = { font: FONT, size: 16, color: '888888' };
  const gray = { font: FONT, size: 22, color: 'A6A6A6', characterSpacing: 60 };
  return new Document({
    creator: 'Crear Contratos',
    title: fill(c, c.title),
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 }, // carta
          margin: { top: 2.5 * TWIP_CM, bottom: 2.5 * TWIP_CM, left: 3 * TWIP_CM, right: 3 * TWIP_CM },
        },
      },
      // Encabezado como en los documentos marco: "1 | Página" a la izquierda y el título espaciado a la derecha
      headers: {
        default: new Header({
          children: [new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: 12240 - 6 * TWIP_CM }],
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF', space: 4 } },
            spacing: { after: 240 },
            children: [
              new TextRun({ ...gray, bold: true, color: '7F7F7F', children: [PageNumber.CURRENT] }),
              new TextRun({ ...gray, text: ' | Página' }),
              new TextRun({ ...gray, text: `\t${title.toUpperCase()}` }),
            ],
          })],
        }),
      },
      footers: label ? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: label, ...small, bold: true, color: 'B42318' })] })] }) } : undefined,
      children,
    }],
  });
}

function signatureMark(c, sg) {
  const sig = c.signatures?.[sg.id];
  if (!sig) return ' ';
  return sig.type === 'efirma' ? `Firmado con e.firma · Cert. ${sig.info.certNumber}` : 'Firma autógrafa registrada en la app';
}

export async function buildDocxBlob(D, c, opts) {
  return D.Packer.toBlob(buildDocxDocument(D, c, opts));
}
