import { PDFDocument, rgb } from '../node_modules/pdf-lib/dist/pdf-lib.esm.min.js';
import { hexToRgb } from './annotation-manager.js';

export async function savePdfWithAnnotations(originalBytes, annotations) {
  const pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();

  for (const ann of annotations) {
    const page = pages[ann.page];
    if (!page) continue;

    const { height: pageHeight } = page.getSize();

    switch (ann.type) {
      case 'highlight':
      case 'underline':
      case 'strikeout': {
        const color = hexToRgb(ann.color || '#ffff00');
        const pdfColor = rgb(color.r, color.g, color.b);

        for (const rect of ann.rects || []) {
          const pdfY = pageHeight - rect.y - rect.height;

          if (ann.type === 'highlight') {
            page.drawRectangle({
              x: rect.x,
              y: pdfY,
              width: rect.width,
              height: rect.height,
              color: pdfColor,
              opacity: 0.4,
            });
          } else if (ann.type === 'underline') {
            page.drawLine({
              start: { x: rect.x, y: pdfY },
              end: { x: rect.x + rect.width, y: pdfY },
              thickness: 1.5,
              color: pdfColor,
            });
          } else if (ann.type === 'strikeout') {
            const midY = pdfY + rect.height / 2;
            page.drawLine({
              start: { x: rect.x, y: midY },
              end: { x: rect.x + rect.width, y: midY },
              thickness: 1.5,
              color: pdfColor,
            });
          }
        }
        break;
      }

      case 'ink': {
        if (!ann.points || ann.points.length < 2) break;
        const color = hexToRgb(ann.color || '#000000');
        const pdfColor = rgb(color.r, color.g, color.b);

        for (let i = 1; i < ann.points.length; i++) {
          const p0 = ann.points[i - 1];
          const p1 = ann.points[i];
          page.drawLine({
            start: { x: p0.x, y: pageHeight - p0.y },
            end: { x: p1.x, y: pageHeight - p1.y },
            thickness: ann.lineWidth || 2,
            color: pdfColor,
          });
        }
        break;
      }

      case 'signature': {
        if (!ann.imageData) break;
        const imageBytes = base64ToUint8Array(ann.imageData);
        let image;
        if (ann.imageData.startsWith('data:image/png')) {
          image = await pdfDoc.embedPng(imageBytes);
        } else {
          image = await pdfDoc.embedJpg(imageBytes);
        }

        const rect = ann.rects[0];
        const pdfY = pageHeight - rect.y - rect.height;
        page.drawImage(image, {
          x: rect.x,
          y: pdfY,
          width: rect.width,
          height: rect.height,
        });
        break;
      }
    }
  }

  return pdfDoc.save();
}

function base64ToUint8Array(base64) {
  const data = base64.includes(',') ? base64.split(',')[1] : base64;
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
