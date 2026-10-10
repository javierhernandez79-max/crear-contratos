// Generación de PDF con jsPDF (incluido localmente para funcionar sin conexión).
import { fill, fmtDateTime, slugify, canonicalText } from './model.js';

const PAGE = { w: 215.9, h: 279.4 }; // Carta
const M = { top: 25, bottom: 25, left: 25, right: 25 };
const CONTENT_W = PAGE.w - M.left - M.right;
const LINE = 5.6; // mm por línea a 11pt

export function buildPdf(c, { watermark = !['aprobado', 'final'].includes(c.status) } = {}) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'letter', compress: true });
  doc.setProperties({ title: fill(c, c.title), creator: 'Crear Contratos' });
  let y = M.top;

  const decoratePage = () => {
    if (!watermark) return;
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.08 }));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(90);
    doc.setTextColor(0);
    doc.text('BORRADOR', PAGE.w / 2, PAGE.h / 2, { align: 'center', angle: 45, baseline: 'middle' });
    doc.restoreGraphicsState();
  };
  const newPage = () => { doc.addPage(); decoratePage(); y = M.top; };
  const ensure = (h) => { if (y + h > PAGE.h - M.bottom) newPage(); };

  decoratePage();

  // Título
  doc.setTextColor(20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  const titleLines = doc.splitTextToSize(fill(c, c.title).toUpperCase(), CONTENT_W);
  doc.text(titleLines, PAGE.w / 2, y, { align: 'center' });
  y += titleLines.length * 7 + 6;

  // Secciones
  c.sections.forEach((sec, i) => {
    const heading = `${i + 1}. ${fill(c, sec.title).toUpperCase()}`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    ensure(LINE * 3);
    doc.text(heading, M.left, y);
    y += LINE + 1;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const paragraphs = fill(c, sec.body).split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
    paragraphs.forEach((p) => {
      const lines = doc.splitTextToSize(p, CONTENT_W);
      lines.forEach((ln, j) => {
        ensure(LINE);
        const isLast = j === lines.length - 1;
        if (isLast) doc.text(ln, M.left, y); else justifyLine(doc, ln, M.left, y, CONTENT_W);
        y += LINE;
      });
      y += 2;
    });
    y += 3;
  });

  // Firmas
  const signers = c.signers;
  if (signers.length) {
    const colW = (CONTENT_W - 10) / 2;
    const blockH = 48;
    ensure(14 + blockH);
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('FIRMAS', PAGE.w / 2, y, { align: 'center' });
    y += 8;
    for (let i = 0; i < signers.length; i += 2) {
      ensure(blockH);
      [signers[i], signers[i + 1]].forEach((sg, col) => {
        if (!sg) return;
        const x = M.left + col * (colW + 10);
        const sig = c.signatures[sg.id];
        if (sig?.type === 'efirma') {
          // Sello de firma electrónica avanzada en lugar de la imagen
          const bx = x + colW / 2 - 32;
          doc.setDrawColor(30, 58, 95);
          doc.setFillColor(238, 243, 250);
          doc.roundedRect(bx, y + 2, 64, 20, 2, 2, 'FD');
          doc.setTextColor(30, 58, 95);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.text('FIRMA ELECTRÓNICA AVANZADA', bx + 32, y + 7.5, { align: 'center' });
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.text(sig.info.rfc ? `RFC ${sig.info.rfc}` : sig.info.name.slice(0, 40), bx + 32, y + 12, { align: 'center' });
          doc.text(`Cert. ${sig.info.certNumber}`.slice(0, 48), bx + 32, y + 16, { align: 'center' });
          doc.text('Ver constancia anexa', bx + 32, y + 20, { align: 'center' });
          doc.setTextColor(20);
        } else if (sig?.image) {
          try { doc.addImage(sig.image, 'PNG', x + colW / 2 - 30, y, 60, 22, undefined, 'FAST'); } catch { /* imagen inválida */ }
        }
        doc.setDrawColor(60);
        doc.line(x + 5, y + 25, x + colW - 5, y + 25);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        const nameLines = doc.splitTextToSize(fill(c, sg.name) || '______________________', colW);
        doc.text(nameLines, x + colW / 2, y + 30, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(90);
        doc.text(sg.role || '', x + colW / 2, y + 30 + nameLines.length * 4.5, { align: 'center' });
        if (sig?.date) doc.text(`Firmado: ${fmtDateTime(sig.date)}`, x + colW / 2, y + 34.5 + nameLines.length * 4.5, { align: 'center' });
        doc.setTextColor(20);
      });
      y += blockH;
    }
  }

  // Relación de anexos (documentos de las partes en Dropbox)
  if (c.anexos?.length) {
    ensure(LINE * 4);
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('ANEXOS', M.left, y);
    y += LINE + 1;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    c.anexos.forEach((a, i) => {
      const lines = doc.splitTextToSize(`Anexo ${i + 1}. ${a.title || a.name}`, CONTENT_W);
      ensure(lines.length * LINE);
      doc.text(lines, M.left, y);
      y += lines.length * LINE;
    });
  }

  // Constancia de firmas electrónicas avanzadas
  const efirmas = c.signers.map((sg) => [sg, c.signatures[sg.id]]).filter(([, sig]) => sig?.type === 'efirma');
  if (efirmas.length) {
    const current = canonicalText(c);
    newPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('CONSTANCIA DE FIRMA ELECTRÓNICA AVANZADA', PAGE.w / 2, y, { align: 'center' });
    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(70);
    const intro = 'Este documento fue firmado con certificados de firma electrónica avanzada. Cada firma se calculó sobre el texto íntegro del contrato (título, cláusulas y firmantes) mediante el algoritmo RSA con SHA-256. Cualquier modificación posterior del contenido invalida la firma. Los archivos .p7s (PKCS#7) y el texto firmado (.txt) permiten verificarla de forma independiente.';
    doc.splitTextToSize(intro, CONTENT_W).forEach((ln) => { doc.text(ln, M.left, y); y += 4.2; });
    y += 4;
    doc.setTextColor(20);

    efirmas.forEach(([sg, sig]) => {
      const i = sig.info;
      const intact = sig.signedText === current;
      const rows = [
        ['Firmante', `${sg.role}: ${fill(c, sg.name)}`],
        ['Titular del certificado', i.name],
        ...(i.rfc ? [['RFC', i.rfc]] : []),
        ...(i.curp ? [['CURP', i.curp]] : []),
        ['No. de certificado', i.certNumber],
        ['Emisor', i.issuer],
        ['Vigencia del certificado', `${new Date(i.validFrom).toLocaleDateString('es-MX')} al ${new Date(i.validTo).toLocaleDateString('es-MX')}`],
        ['Fecha y hora de firma', fmtDateTime(sig.date)],
        ['Huella SHA-256 del texto', sig.hash],
        ['Estado', intact ? 'Íntegra: el contenido coincide con el texto firmado' : 'INVÁLIDA: el contenido cambió después de la firma'],
      ];
      const sigLines = (() => { doc.setFont('courier', 'normal'); doc.setFontSize(6.5); return doc.splitTextToSize(sig.signature, CONTENT_W - 4); })();
      ensure(rows.length * 5 + sigLines.length * 2.8 + 18);
      doc.setDrawColor(200);
      doc.line(M.left, y, PAGE.w - M.right, y);
      y += 5;
      rows.forEach(([k, v]) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.text(k, M.left, y);
        const mono = k.startsWith('Huella');
        doc.setFont(mono ? 'courier' : 'helvetica', 'normal');
        doc.setFontSize(mono ? 7.5 : 8.5);
        if (k === 'Estado') doc.setTextColor(...(intact ? [29, 122, 70] : [180, 35, 24]));
        const vl = doc.splitTextToSize(String(v), CONTENT_W - 48);
        doc.text(vl, M.left + 48, y);
        doc.setTextColor(20);
        y += vl.length * 4 + 1;
      });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text('Firma digital (base64)', M.left, y);
      y += 4;
      doc.setFont('courier', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(80);
      sigLines.forEach((ln) => { ensure(3); doc.text(ln, M.left + 2, y); y += 2.8; });
      doc.setTextColor(20);
      y += 6;
    });

    ensure(22);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Cómo verificar', M.left, y);
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(70);
    const how = 'Descarga desde la app el texto firmado (.txt) y la firma (.p7s) de cada firmante. Con OpenSSL: openssl cms -verify -inform DER -in firma.p7s -content texto-firmado.txt -binary -noverify -out /dev/null. La huella SHA-256 del .txt debe coincidir con la indicada arriba. La vigencia y no revocación del certificado pueden confirmarse ante el SAT.';
    doc.splitTextToSize(how, CONTENT_W).forEach((ln) => { ensure(4.2); doc.text(ln, M.left, y); y += 4.2; });
    doc.setTextColor(20);
  }

  // Pie de página
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(`Página ${p} de ${total}`, PAGE.w - M.right, PAGE.h - 12, { align: 'right' });
    doc.text(doc.splitTextToSize(fill(c, c.title), CONTENT_W - 40)[0], M.left, PAGE.h - 12);
  }

  const filename = `${slugify(fill(c, c.title)).slice(0, 60)}.pdf`;
  return { blob: doc.output('blob'), filename };
}

// Justificado manual: reparte el espacio sobrante entre las palabras de la línea.
function justifyLine(doc, line, x, y, width) {
  const words = line.trim().split(/\s+/);
  if (words.length < 2) return doc.text(line, x, y);
  const wordsW = words.reduce((sum, w) => sum + doc.getTextWidth(w), 0);
  const gap = (width - wordsW) / (words.length - 1);
  if (gap > doc.getTextWidth(' ') * 4) return doc.text(line, x, y); // evita huecos exagerados
  let cx = x;
  for (const w of words) {
    doc.text(w, cx, y);
    cx += doc.getTextWidth(w) + gap;
  }
}

export async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  download(blob, filename);
  return 'downloaded';
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
