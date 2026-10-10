// Generación de Word (.docx) para revisión de los abogados. Recibe la librería docx como parámetro
// (vendor/docx.iife.js en el navegador, carga diferida; paquete npm en pruebas).
import { fill, layoutSections } from './model.js';

const FONT = 'Arial';
const SIZE = 22; // medios puntos → 11 pt
const TWIP_CM = 567;

/**
 * Construye el documento. `label` va en el encabezado de cada página (p. ej. "EN REVISIÓN · v2");
 * vacío en la versión aprobada.
 */
export function buildDocxDocument(D, c, { label = '' } = {}) {
  const { Document, Paragraph, TextRun, AlignmentType, Header, Footer, PageNumber, Table, TableRow, TableCell, WidthType, BorderStyle } = D;
  const run = (text, opts = {}) => new TextRun({ text, font: FONT, size: SIZE, ...opts });
  const para = (text, opts = {}) => new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 160, line: 300 },
    children: [run(text, opts.run)],
    ...opts.para,
  });

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [run(fill(c, c.title).toUpperCase(), { bold: true, size: 26 })],
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
    const paras = fill(c, l.s.body).split(/\n/).map((p) => p.trim()).filter(Boolean);
    if (!paras.length && l.prefix) paras.push('');
    paras.forEach((p, j) => {
      // La primera línea de una cláusula ordinal inicia con "PRIMERA.- " en negritas
      children.push(j === 0 && l.prefix
        ? new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 160, line: 300 }, children: [run(l.prefix, { bold: true }), run(p)] })
        : para(p));
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
  return new Document({
    creator: 'Crear Contratos',
    title: fill(c, c.title),
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 }, // carta
          margin: { top: 2.5 * TWIP_CM, bottom: 2.5 * TWIP_CM, left: 2.5 * TWIP_CM, right: 2.5 * TWIP_CM },
        },
      },
      headers: label ? { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: label, ...small, bold: true, color: 'B42318' })] })] }) } : undefined,
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ ...small, children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES] })],
          })],
        }),
      },
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
