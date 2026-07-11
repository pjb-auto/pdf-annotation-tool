import { PDFDocument, StandardFonts, rgb } from '../node_modules/pdf-lib/dist/pdf-lib.esm.min.js';

const A4 = [595.28, 841.89];

const TEXT_EXTS = ['txt', 'text', 'md', 'markdown', 'csv', 'tsv', 'log', 'json'];
const HTML_EXTS = ['htm', 'html'];
const DOCX_EXTS = ['docx'];

export function getExtension(name) {
  const match = /\.([^.]+)$/.exec(name || '');
  return match ? match[1].toLowerCase() : '';
}

export function detectKind(name) {
  const ext = getExtension(name);
  if (TEXT_EXTS.includes(ext)) return 'text';
  if (HTML_EXTS.includes(ext)) return 'html';
  if (DOCX_EXTS.includes(ext)) return 'docx';
  return null;
}

export function canGenerate(name) {
  return detectKind(name) !== null;
}

export const acceptedExtensions = [...TEXT_EXTS, ...HTML_EXTS, ...DOCX_EXTS];

function sanitizeForStandardFont(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (ch === '\t') {
      out += '    ';
    } else if (code === 10 || code === 13) {
      out += ch;
    } else if (code >= 32 && code <= 255) {
      out += ch;
    } else {
      out += '?';
    }
  }
  return out;
}

function wrapLine(line, font, fontSize, maxWidth) {
  if (line === '') return [''];
  const words = line.split(/(\s+)/);
  const result = [];
  let current = '';

  const pushHardWrapped = (chunk) => {
    let piece = '';
    for (const char of chunk) {
      if (font.widthOfTextAtSize(piece + char, fontSize) > maxWidth && piece !== '') {
        result.push(piece);
        piece = char;
      } else {
        piece += char;
      }
    }
    current = piece;
  };

  for (const word of words) {
    const candidate = current + word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
      if (current.trim() !== '') result.push(current);
      current = '';
      pushHardWrapped(word);
    } else {
      if (current !== '') result.push(current);
      current = word;
    }
  }
  if (current !== '') result.push(current);
  return result.length ? result : [''];
}

export async function textToPdf(text) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Courier);
  const fontSize = 10;
  const lineHeight = 14;
  const margin = 48;
  const maxWidth = A4[0] - margin * 2;

  let page = pdfDoc.addPage(A4);
  let y = A4[1] - margin;

  const rawLines = sanitizeForStandardFont(text).split(/\r?\n/);
  for (const raw of rawLines) {
    const wrapped = wrapLine(raw, font, fontSize, maxWidth);
    for (const line of wrapped) {
      if (y < margin) {
        page = pdfDoc.addPage(A4);
        y = A4[1] - margin;
      }
      page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
      y -= lineHeight;
    }
  }

  return pdfDoc.save();
}

export function suggestedPdfName(sourceName) {
  const base = (sourceName || 'document').replace(/\.[^.]+$/, '');
  return `${base}.pdf`;
}
