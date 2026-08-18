import PDFDocument from 'pdfkit';
import type { Certificate } from './entities/certificate.entity';

// GS-26 palette, so the PDF matches the app rather than looking like a default
// pdfkit document.
const INK = '#090415';
const CERISE = '#E5259A';
const MUTED = '#6B6580';

/**
 * Render a certificate of participation as a one-page A4 landscape PDF.
 *
 * Returns a Buffer rather than streaming to the response so the caller can set
 * Content-Length, and so a render failure surfaces as a 500 before any bytes
 * have been written.
 */
export function renderCertificatePdf(cert: Certificate): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 0,
      info: {
        Title: `GS-26 Certificate of Participation - ${cert.delegateName}`,
        Author: 'Policy Innovation Centre',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { width, height } = doc.page;

    // cerise rule down the left edge, echoing the app's accent
    doc.rect(0, 0, 18, height).fill(CERISE);
    doc
      .rect(46, 40, width - 92, height - 80)
      .lineWidth(1)
      .stroke('#E6E2EF');

    const centre = (
      text: string,
      y: number,
      size: number,
      color: string,
      font = 'Helvetica',
    ) =>
      doc
        .font(font)
        .fontSize(size)
        .fillColor(color)
        .text(text, 60, y, { width: width - 120, align: 'center' });

    centre('CERTIFICATE OF PARTICIPATION', 108, 13, MUTED, 'Helvetica-Bold');
    centre('This certifies that', 152, 12, MUTED);
    centre(cert.delegateName, 184, 34, INK, 'Helvetica-Bold');

    doc
      .moveTo(width / 2 - 90, 240)
      .lineTo(width / 2 + 90, 240)
      .lineWidth(1)
      .stroke(CERISE);

    centre('participated in the', 262, 12, MUTED);
    centre(
      'GS-26 Gender & Inclusion Summit 2026',
      288,
      19,
      INK,
      'Helvetica-Bold',
    );
    centre('Abuja, Nigeria  ·  September 8-9, 2026', 318, 12, MUTED);

    centre('Policy Innovation Centre', height - 148, 13, INK, 'Helvetica-Bold');

    // the code is the verifiable part - printed with where to check it
    centre(cert.code, height - 112, 14, CERISE, 'Helvetica-Bold');
    centre(
      `Issued ${cert.issuedAt.toISOString().slice(0, 10)}  ·  Verify this code at gs26.ng/verify`,
      height - 88,
      9,
      MUTED,
    );

    doc.end();
  });
}
