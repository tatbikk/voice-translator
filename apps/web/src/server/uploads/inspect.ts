import 'server-only';
import { inflateRawSync } from 'node:zlib';
import { SECURITY_POLICY } from '@mahkama/core';

// The upload inspector (prompt, «المدخلات والملفات»: «يتحقق من نوع الملف المرفوع
// من محتواه لا من امتداده، ومن حجمه»; Phase 2 memo, rows 1, 13, 14, 16, 17).
// The type is read from the bytes and compared with the extension the browser
// sent and with the types accepted at the place of the upload. A Word document
// is a ZIP archive: it is opened here within strict limits (entries, declared
// and actual inflated sizes), without any XML parser that could resolve an
// entity, and refused with macros or a document type definition. A PDF with
// active content is refused; this is a second line only, the first being that
// no deposited document is ever served as a web page (attachment, nosniff,
// sandbox). Nothing here reads the clock, the database or the network.

export type UploadType = 'pdf' | 'docx' | 'jpeg' | 'png';

export const MEDIA_TYPES: Readonly<Record<UploadType, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

const EXTENSIONS: Readonly<Record<string, UploadType>> = { pdf: 'pdf', docx: 'docx', jpg: 'jpeg', jpeg: 'jpeg', png: 'png' };

export type InspectResult =
  | { readonly ok: true; readonly type: UploadType; readonly mediaType: string }
  | { readonly ok: false; readonly reason: 'TYPE_MISMATCH' | 'TYPE_NOT_ACCEPTED' | 'UNSAFE'; readonly detail: string };

const refuse = (reason: 'TYPE_MISMATCH' | 'TYPE_NOT_ACCEPTED' | 'UNSAFE', detail: string): InspectResult => ({ ok: false, reason, detail });

// ---------------------------------------------------------------------------
// Names

// Control characters, and the invisible marks that can make a name read
// differently from what it is (direction overrides and isolates, zero-width).
// eslint-disable-next-line no-control-regex -- the control characters are what this class removes
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

function lastSegment(name: string): string {
  const cleaned = name.normalize('NFC').replace(INVISIBLE, '');
  const parts = cleaned.split(/[\\/]/);
  return (parts[parts.length - 1] ?? '').trim();
}

function extensionOf(name: string): string | null {
  const segment = lastSegment(name);
  const dot = segment.lastIndexOf('.');
  if (dot <= 0 || dot === segment.length - 1) return null;
  return segment.slice(dot + 1).toLowerCase();
}

/** The title shown for an upload: the name's last segment, without extension or invisible marks; null when nothing is left. */
export function uploadTitle(name: string): string | null {
  const segment = lastSegment(name).replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const title = segment.replace(/\s+/g, ' ').trim();
  if (title === '' || title === '.') return null;
  return Array.from(title).slice(0, SECURITY_POLICY.uploads.titleMaxChars).join('');
}

// ---------------------------------------------------------------------------
// Signatures

const startsWith = (bytes: Uint8Array, prefix: readonly number[]) => prefix.every((b, i) => bytes[i] === b);
const latin1 = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');

function sniff(bytes: Uint8Array): UploadType | 'zip' | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'zip'; // PK\3\4: a Word document, or another archive
  return null;
}

// ---------------------------------------------------------------------------
// PDF

// Names of active content; #xx escapes are decoded first (/J#61vaScript).
const PDF_ACTIVE = /\/(?:JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|XFA|ImportData|SubmitForm)(?![A-Za-z0-9])/;

function pdfProblem(bytes: Uint8Array): string | null {
  const text = latin1(bytes);
  if (!text.slice(-4096).includes('%%EOF')) return 'PDF_TRUNCATED';
  const decoded = text.replace(/#([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  if (PDF_ACTIVE.test(decoded)) return 'PDF_ACTIVE_CONTENT';
  return null;
}

function imageProblem(type: 'png' | 'jpeg', bytes: Uint8Array): string | null {
  const tail = latin1(bytes.subarray(Math.max(0, bytes.byteLength - 64)));
  if (type === 'png' && !tail.includes('IEND')) return 'IMAGE_TRUNCATED';
  if (type === 'jpeg' && !tail.includes('ÿÙ')) return 'IMAGE_TRUNCATED';
  return null;
}

// ---------------------------------------------------------------------------
// ZIP (no ZIP64, no encryption), read in memory within the limits of the policy

class ArchiveRefused extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = 'ArchiveRefused';
  }
}

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localOffset: number;
}

function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const limits = SECURITY_POLICY.uploads.docx;
  // The end of central directory record: 22 bytes, then up to 65535 of comment.
  let end = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 22 - 65_535); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ArchiveRefused('ZIP_NO_DIRECTORY');
  const count = view.getUint16(end + 10, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff) throw new ArchiveRefused('ZIP64');
  if (count > limits.maxEntries) throw new ArchiveRefused('ZIP_TOO_MANY_ENTRIES');
  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  let declaredTotal = 0;
  for (let n = 0; n < count; n += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw new ArchiveRefused('ZIP_BAD_DIRECTORY');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = Buffer.from(bytes.subarray(offset + 46, offset + 46 + nameLength)).toString('utf8');
    if (flags & 0x1) throw new ArchiveRefused('ZIP_ENCRYPTED');
    if (method !== 0 && method !== 8) throw new ArchiveRefused('ZIP_METHOD');
    if (size > limits.maxEntryBytes) throw new ArchiveRefused('ZIP_ENTRY_TOO_LARGE');
    declaredTotal += size;
    if (declaredTotal > limits.maxTotalBytes) throw new ArchiveRefused('ZIP_TOO_LARGE');
    if (name.startsWith('/') || name.split('/').includes('..')) throw new ArchiveRefused('ZIP_BAD_NAME');
    entries.push({ name, method, compressedSize, size, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localOffset;
  if (at + 30 > bytes.byteLength || view.getUint32(at, true) !== 0x04034b50) throw new ArchiveRefused('ZIP_BAD_ENTRY');
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (data.byteLength !== entry.compressedSize) throw new ArchiveRefused('ZIP_BAD_ENTRY');
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) throw new ArchiveRefused('ZIP_BAD_ENTRY');
    return data;
  }
  try {
    // The archive's own claim bounds the inflation: a part that inflates beyond
    // its declared size (a "bomb") is refused, not read to the end.
    const out = inflateRawSync(data, { maxOutputLength: Math.min(entry.size, SECURITY_POLICY.uploads.docx.maxEntryBytes) + 1 });
    if (out.byteLength !== entry.size) throw new ArchiveRefused('ZIP_SIZE_MISMATCH');
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  } catch (error) {
    if (error instanceof ArchiveRefused) throw error;
    throw new ArchiveRefused('ZIP_INFLATE');
  }
}

const WORD_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

/** The XML of the document part of a Word document, or a refusal. */
function wordDocumentXml(bytes: Uint8Array): { ok: true; xml: string } | { ok: false; reason: 'TYPE_NOT_ACCEPTED' | 'UNSAFE'; detail: string } {
  try {
    const entries = zipEntries(bytes);
    const byName = new Map(entries.map((e) => [e.name, e]));
    const types = byName.get('[Content_Types].xml');
    const main = byName.get('word/document.xml');
    if (!types || !main) return { ok: false, reason: 'TYPE_NOT_ACCEPTED', detail: 'NOT_A_WORD_DOCUMENT' };
    if (entries.some((e) => /(^|\/)vba[^/]*$/i.test(e.name))) {
      return { ok: false, reason: 'UNSAFE', detail: 'MACRO' };
    }
    const typesXml = Buffer.from(readEntry(bytes, types)).toString('utf8');
    if (!typesXml.includes(WORD_MAIN)) return { ok: false, reason: 'TYPE_NOT_ACCEPTED', detail: 'NOT_A_WORD_DOCUMENT' };
    if (/macroEnabled|vbaProject/i.test(typesXml)) return { ok: false, reason: 'UNSAFE', detail: 'MACRO' };
    const xml = Buffer.from(readEntry(bytes, main)).toString('utf8');
    for (const part of [typesXml, xml]) {
      if (/<!DOCTYPE|<!ENTITY/i.test(part)) return { ok: false, reason: 'UNSAFE', detail: 'XML_DOCTYPE' };
    }
    return { ok: true, xml };
  } catch (error) {
    if (error instanceof ArchiveRefused) return { ok: false, reason: 'UNSAFE', detail: error.detail };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Text

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXmlText(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (_m, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? '';
  });
}

/** A paragraph as it enters the fixed copy: NFC, no control character but the tab. */
function cleanParagraph(text: string): string {
  return text
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- control characters are removed from the paragraphs
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/[ \t]+/g, (m) => (m.includes('\t') ? '\t' : ' '))
    .trim();
}

function boundedParagraphs(paragraphs: readonly string[]): string[] {
  const { maxChars, maxParagraphs } = SECURITY_POLICY.applicationText;
  if (paragraphs.length > maxParagraphs) throw new ArchiveRefused('TEXT_TOO_LONG');
  if (paragraphs.reduce((n, p) => n + p.length, 0) > maxChars) throw new ArchiveRefused('TEXT_TOO_LONG');
  return [...paragraphs];
}

/** The pasted application as numbered paragraphs: one per line, the numbering typed in the text kept, empty lines dropped. */
export function pastedParagraphs(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map(cleanParagraph)
    .filter((p) => p !== '');
}

/** The paragraphs of a Word document, its numbered lists numbered. Throws on a document beyond the limits. */
export function docxParagraphs(bytes: Uint8Array): string[] {
  const part = wordDocumentXml(bytes);
  if (!part.ok) throw new ArchiveRefused(part.detail);
  const paragraphs: string[] = [];
  const counters = new Map<string, number>();
  for (const match of part.xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const body = match[1] ?? '';
    let text = '';
    for (const token of body.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g)) {
      if (token[1] !== undefined) text += decodeXmlText(token[1]);
      else text += token[0] === '<w:tab/>' ? '\t' : ' ';
    }
    const cleaned = cleanParagraph(text);
    if (cleaned === '') continue;
    const numId = /<w:numPr>[\s\S]*?<w:numId w:val="(\d+)"\/>/.exec(body)?.[1];
    if (numId !== undefined && numId !== '0') {
      const next = (counters.get(numId) ?? 0) + 1;
      counters.set(numId, next);
      paragraphs.push(`${String(next)}. ${cleaned}`);
    } else {
      paragraphs.push(cleaned);
    }
  }
  return boundedParagraphs(paragraphs);
}

// ---------------------------------------------------------------------------

/**
 * The type of an upload, read from its content and checked against its name
 * and the types accepted at its place.
 */
export function inspectUpload(bytes: Uint8Array, options: { declaredName: string; accept: readonly UploadType[] }): InspectResult {
  const extension = extensionOf(options.declaredName);
  const claimed = extension ? EXTENSIONS[extension] : undefined;
  if (!claimed) return refuse('TYPE_NOT_ACCEPTED', 'EXTENSION');
  const sniffed = sniff(bytes);
  let detected: UploadType | null;
  if (sniffed === 'zip') {
    // An archive is accepted only as a Word document, opened within the limits.
    const part = wordDocumentXml(bytes);
    if (!part.ok) return part.reason === 'UNSAFE' ? refuse('UNSAFE', part.detail) : refuse('TYPE_MISMATCH', part.detail);
    detected = 'docx';
  } else {
    detected = sniffed;
  }
  if (detected !== claimed) return refuse('TYPE_MISMATCH', detected ?? 'UNKNOWN');
  if (!options.accept.includes(detected)) return refuse('TYPE_NOT_ACCEPTED', detected);
  const problem = detected === 'pdf' ? pdfProblem(bytes) : detected === 'docx' ? null : imageProblem(detected, bytes);
  if (problem) return refuse('UNSAFE', problem);
  if (detected === 'docx') {
    try {
      docxParagraphs(bytes);
    } catch (error) {
      if (error instanceof ArchiveRefused) return refuse('UNSAFE', error.detail);
      throw error;
    }
  }
  return { ok: true, type: detected, mediaType: MEDIA_TYPES[detected] };
}

export function isArchiveRefusal(error: unknown): error is Error & { detail: string } {
  return error instanceof ArchiveRefused;
}
