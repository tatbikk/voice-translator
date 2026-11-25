// A minimal reader of the text of the PDF files the platform prints, for tests
// only (review P1-S-15: the environment line must be read in the PDF itself).
// It knows what Chromium's PDF backend (Skia) writes: Flate streams with a
// direct /Length, Type0 fonts (two-byte codes) and Type3 fonts (one-byte
// codes) with a ToUnicode CMap, /ActualText spans for shaped glyphs, and
// /ReversedChars marked content around right-to-left runs, whose glyphs come in
// visual order. Each page comes back as its text objects (BT … ET), in the
// order they are drawn, each in logical order.
import { inflateSync } from 'node:zlib';

interface PdfObject {
  readonly dict: string;
  readonly stream: Buffer | null;
}

function readObjects(pdf: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const header = /(\d+) 0 obj\s*/g;
  for (let m = header.exec(pdf); m; m = header.exec(pdf)) {
    const start = header.lastIndex;
    const end = pdf.indexOf('endobj', start);
    const streamAt = pdf.indexOf('stream', start);
    if (streamAt !== -1 && streamAt < end) {
      const dict = pdf.slice(start, streamAt);
      let dataStart = streamAt + 'stream'.length;
      if (pdf[dataStart] === '\r') dataStart += 1;
      if (pdf[dataStart] === '\n') dataStart += 1;
      const direct = /\/Length (\d+)(?!\s+\d+\s+R)/.exec(dict);
      const length = direct ? Number(direct[1]) : pdf.indexOf('endstream', dataStart) - dataStart;
      const raw = Buffer.from(pdf.slice(dataStart, dataStart + length), 'latin1');
      objects.set(Number(m[1]), { dict, stream: dict.includes('/FlateDecode') ? inflateSync(raw) : raw });
      header.lastIndex = pdf.indexOf('endobj', dataStart + length) + 'endobj'.length;
    } else {
      objects.set(Number(m[1]), { dict: pdf.slice(start, end), stream: null });
      header.lastIndex = end + 'endobj'.length;
    }
  }
  return objects;
}

const utf16 = (hex: string) => Buffer.from(hex, 'hex').swap16().toString('utf16le').replace(/\uFEFF/g, '');

function readCMap(text: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code = '', value = ''] of (block[1] ?? '').matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) map.set(parseInt(code, 16), utf16(value));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, from = '', to = '', first = ''] of (block[1] ?? '').matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const start = utf16(first);
      for (let code = parseInt(from, 16), i = 0; code <= parseInt(to, 16); code += 1, i += 1) {
        map.set(code, start.slice(0, -1) + String.fromCodePoint((start.codePointAt(start.length - 1) ?? 0) + i));
      }
    }
  }
  return map;
}

const ref = (dict: string, key: string) => {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(dict);
  return m ? Number(m[1]) : null;
};

function pageIds(objects: Map<number, PdfObject>, id: number): number[] {
  const node = objects.get(id);
  if (!node) return [];
  if (/\/Type\s*\/Page\b(?!s)/.test(node.dict)) return [id];
  const kids = /\/Kids\s*\[([^\]]*)\]/.exec(node.dict)?.[1] ?? '';
  return [...kids.matchAll(/(\d+)\s+0\s+R/g)].flatMap(([, kid]) => pageIds(objects, Number(kid)));
}

type Frame = { readonly kind: 'reversed'; readonly units: string[] } | { readonly kind: 'actual' } | { readonly kind: 'other' };

const TOKEN =
  /\/Span\s*<<\s*\/ActualText\s*<([0-9A-Fa-f]*)>\s*>>\s*BDC|\/(ReversedChars)\s+BMC|\/\w+\s+BMC|\bBDC\b|\b(EMC)\b|\/([\w.+-]+)\s+[-\d.]+\s+Tf|<([0-9A-Fa-f]*)>\s*Tj|\[((?:[^\]\\]|\\.)*)\]\s*TJ|\b(BT|ET)\b/g;

function pageText(objects: Map<number, PdfObject>, page: PdfObject): string[] {
  const fonts = new Map<string, { codes: Map<number, string>; bytes: number }>();
  const fontDict = /\/Font\s*<<([^>]*)>>/.exec(page.dict)?.[1] ?? '';
  for (const [, name = '', id = ''] of fontDict.matchAll(/\/([\w.+-]+)\s+(\d+)\s+0\s+R/g)) {
    const font = objects.get(Number(id));
    const cmapId = font ? ref(font.dict, 'ToUnicode') : null;
    const cmap = cmapId === null ? null : objects.get(cmapId)?.stream;
    fonts.set(name, { codes: cmap ? readCMap(cmap.toString('latin1')) : new Map<number, string>(), bytes: font?.dict.includes('/Type0') ? 4 : 2 });
  }
  const contentIds = /\/Contents\s*\[([^\]]*)\]/.exec(page.dict)?.[1] ?? /\/Contents\s+(\d+\s+0\s+R)/.exec(page.dict)?.[1] ?? '';
  const content = [...contentIds.matchAll(/(\d+)\s+0\s+R/g)].map(([, id]) => objects.get(Number(id))?.stream?.toString('latin1') ?? '').join('\n');

  const texts: string[] = [];
  let current: string[] = [];
  const stack: Frame[] = [];
  let font = { codes: new Map<number, string>(), bytes: 4 };
  const emit = (unit: string) => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const frame = stack[i];
      if (frame?.kind === 'actual') return;
      if (frame?.kind === 'reversed') {
        frame.units.push(unit);
        return;
      }
    }
    current.push(unit);
  };
  const glyphs = (hex: string) => {
    for (let i = 0; i + font.bytes <= hex.length; i += font.bytes) emit(font.codes.get(parseInt(hex.slice(i, i + font.bytes), 16)) ?? '');
  };
  for (const m of content.matchAll(TOKEN)) {
    const [whole, actual, reversed, emc, fontName, tj, tjArray, bt] = m;
    if (actual !== undefined) {
      emit(utf16(actual));
      stack.push({ kind: 'actual' });
    } else if (reversed) {
      stack.push({ kind: 'reversed', units: [] });
    } else if (emc) {
      const frame = stack.pop();
      if (frame?.kind === 'reversed') for (const unit of frame.units.reverse()) emit(unit);
    } else if (fontName) {
      font = fonts.get(fontName) ?? { codes: new Map(), bytes: 4 };
    } else if (tj !== undefined) {
      glyphs(tj);
    } else if (tjArray !== undefined) {
      for (const [, hex = ''] of tjArray.matchAll(/<([0-9A-Fa-f]*)>/g)) glyphs(hex);
    } else if (bt === 'BT') {
      current = [];
    } else if (bt === 'ET') {
      texts.push(current.join(''));
      current = [];
    } else if (whole.endsWith('BMC') || whole.endsWith('BDC')) {
      stack.push({ kind: 'other' });
    }
  }
  return texts;
}

/** The text objects of every page of a PDF, page by page. */
export function pdfPages(bytes: Uint8Array): string[][] {
  const pdf = Buffer.from(bytes).toString('latin1');
  const objects = readObjects(pdf);
  const root = [...objects].find(([, o]) => /\/Type\s*\/Pages\b/.test(o.dict) && !/\/Parent\s+\d+/.test(o.dict));
  if (!root) throw new Error('no page tree in the PDF');
  return pageIds(objects, root[0]).map((id) => {
    const page = objects.get(id);
    return page ? pageText(objects, page) : [];
  });
}

const compact = (text: string) => text.replace(/\s+/g, '');

/**
 * Whether a right-to-left line appears on a page: consecutive text objects
 * that, read from right to left (they are drawn from left to right), give the
 * line, spaces aside.
 */
export function readsRightToLeft(texts: readonly string[], line: string): boolean {
  const wanted = compact(line);
  for (let i = 0; i < texts.length; i += 1) {
    for (let k = 1; k <= 8 && i + k <= texts.length; k += 1) {
      if (compact(texts.slice(i, i + k).reverse().join('')) === wanted) return true;
    }
  }
  return false;
}
