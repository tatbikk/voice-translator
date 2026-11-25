// File samples for the upload tests (Phase 2 memo, rows 1, 13, 14, 15 and 17):
// well-formed files of each accepted type, built here byte by byte, and files
// whose content contradicts their name, carries active content, or expands
// beyond the archive limits. Nothing is read from disk; every sample is
// fictitious.
import { deflateRawSync, deflateSync } from 'node:zlib';

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------------------
// CRC-32 (ZIP and PNG)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// PDF

/** A minimal, well-formed one-page PDF. */
export function pdfBytes(note = 'sample'): Uint8Array {
  return bytes(
    [
      '%PDF-1.4',
      `% ${note}`,
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj',
      'trailer << /Root 1 0 R >>',
      '%%EOF',
      '',
    ].join('\n'),
  );
}

/** A PDF that runs a script when opened. */
export function pdfWithJavaScript(): Uint8Array {
  return bytes(
    [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj',
      '2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj',
      'trailer << /Root 1 0 R >>',
      '%%EOF',
      '',
    ].join('\n'),
  );
}

/** The same, with the name written in hexadecimal escapes (#61 = a). */
export function pdfWithEscapedJavaScript(): Uint8Array {
  return bytes(
    [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /OpenAction << /S /J#61v#61Script /JS (x) >> >> endobj',
      'trailer << /Root 1 0 R >>',
      '%%EOF',
      '',
    ].join('\n'),
  );
}

/** A PDF that launches a program. */
export function pdfWithLaunch(): Uint8Array {
  return bytes(['%PDF-1.4', '1 0 obj << /Type /Action /S /Launch /F (cmd.exe) >> endobj', 'trailer << /Root 1 0 R >>', '%%EOF', ''].join('\n'));
}

/** A PDF carrying an embedded file. */
export function pdfWithEmbeddedFile(): Uint8Array {
  return bytes(
    ['%PDF-1.4', '1 0 obj << /Type /Catalog /Names << /EmbeddedFiles 2 0 R >> >> endobj', 'trailer << /Root 1 0 R >>', '%%EOF', ''].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Images

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = bytes(type);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, data.byteLength);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(concat([typeBytes, data])));
  return concat([length, typeBytes, data, crc]);
}

/** A 1×1 grey PNG. */
export function pngBytes(): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1);
  view.setUint32(4, 1);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  // one scanline: filter byte 0, then one grey pixel
  const idat = new Uint8Array(deflateSync(new Uint8Array([0, 128])));
  return concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array())]);
}

/** A minimal JPEG stream: start of image, an APP0 segment, end of image. */
export function jpegBytes(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

// ---------------------------------------------------------------------------
// ZIP and DOCX

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
  /** deflate the entry (default true) */
  readonly deflate?: boolean;
  /** override the uncompressed size written in the headers (to lie about it) */
  readonly declaredSize?: number;
}

/** A ZIP archive (no ZIP64, no encryption), with optional lies in its headers. */
export function zipBytes(entries: readonly ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = bytes(entry.name);
    const deflate = entry.deflate ?? true;
    const data = deflate ? new Uint8Array(deflateRawSync(entry.data)) : entry.data;
    const crc = crc32(entry.data);
    const size = entry.declaredSize ?? entry.data.byteLength;
    const local = new Uint8Array(30 + name.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, deflate ? 8 : 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.byteLength, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.byteLength);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, deflate ? 8 : 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.byteLength, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.byteLength, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.byteLength + data.byteLength;
  }
  const centralSize = centrals.reduce((n, c) => n + c.byteLength, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return concat([...locals, ...centrals, end]);
}

const CONTENT_TYPES = (extra = '') =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${extra}
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A word document XML part with one paragraph per string (a leading "1." keeps its number as text). */
export function documentXml(paragraphs: readonly string[], options: { doctype?: boolean; numbered?: readonly number[] } = {}): string {
  const numbered = new Set(options.numbered ?? []);
  const body = paragraphs
    .map((p, i) => {
      const numPr = numbered.has(i) ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : '';
      return `<w:p>${numPr}<w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`;
    })
    .join('');
  const doctype = options.doctype ? '<!DOCTYPE w:document [<!ENTITY x SYSTEM "file:///etc/passwd">]>\n' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${doctype}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

/** A well-formed DOCX with the given paragraphs. */
export function docxBytes(
  paragraphs: readonly string[],
  options: { macro?: boolean; doctype?: boolean; numbered?: readonly number[]; extraEntries?: readonly ZipEntry[] } = {},
): Uint8Array {
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: bytes(CONTENT_TYPES(options.macro ? '\n<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>' : '')) },
    { name: '_rels/.rels', data: bytes(ROOT_RELS) },
    { name: 'word/document.xml', data: bytes(documentXml(paragraphs, options)) },
  ];
  if (options.macro) entries.push({ name: 'word/vbaProject.bin', data: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]) });
  entries.push(...(options.extraEntries ?? []));
  return zipBytes(entries);
}

/** A DOCX whose document part inflates far beyond the archive limit while declaring a small size. */
/** A DOCX whose document part is the given XML, with optional parts beside it (review P2-S-01, P2-S-03). */
export function docxFromXml(xml: string, options: { extraEntries?: readonly ZipEntry[]; documentRels?: string; duplicateDocument?: boolean } = {}): Uint8Array {
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: bytes(CONTENT_TYPES()) },
    { name: '_rels/.rels', data: bytes(ROOT_RELS) },
    { name: 'word/document.xml', data: bytes(xml) },
  ];
  if (options.documentRels) entries.push({ name: 'word/_rels/document.xml.rels', data: bytes(options.documentRels) });
  if (options.duplicateDocument) entries.push({ name: 'word/document.xml', data: bytes(documentXml(['نص آخر'])) });
  entries.push(...(options.extraEntries ?? []));
  return zipBytes(entries);
}

/** The relationships part of a document, with one relationship of the given type and target. */
export function documentRels(type: string, target: string, external: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>
</Relationships>`;
}

/** The XML wrapper of a document part around a raw body. */
export const wordXml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

export function docxBomb(inflatedBytes: number): Uint8Array {
  const filler = new Uint8Array(inflatedBytes).fill(0x20);
  return zipBytes([
    { name: '[Content_Types].xml', data: bytes(CONTENT_TYPES()) },
    { name: '_rels/.rels', data: bytes(ROOT_RELS) },
    { name: 'word/document.xml', data: filler, declaredSize: 1024 },
  ]);
}

/** A DOCX with more archive entries than allowed. */
export function docxWithManyEntries(count: number): Uint8Array {
  const extra: ZipEntry[] = Array.from({ length: count }, (_, i) => ({ name: `word/media/x${String(i)}.xml`, data: bytes('<a/>'), deflate: false }));
  return docxBytes(['نص'], { extraEntries: extra });
}

/** A plain ZIP that is not a word document. */
export function plainZip(): Uint8Array {
  return zipBytes([{ name: 'readme.txt', data: bytes('not a document') }]);
}

// ---------------------------------------------------------------------------
// Files whose content contradicts their name

export const HTML_PAGE = bytes('<!doctype html><html><body><script>alert(1)</script></body></html>');
/** The first bytes of a Windows executable. */
export const EXECUTABLE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff]);
export const PLAIN_TEXT = bytes('هذا نص عادي لا وثيقة');
