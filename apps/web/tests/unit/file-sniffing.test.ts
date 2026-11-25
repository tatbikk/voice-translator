// The upload inspector (docs/security/phase-2-memo.md rows 1, 13, 14, 16, 17):
// the type of a file is read from its bytes and compared with its name and with
// the types accepted at its place; a Word document is opened within limits and
// refused with macros or a document type definition; a PDF with active content
// is refused; the name a browser sends is a title, never a path. The text of a
// pasted application and of a Word document becomes numbered paragraphs.
import { describe, expect, it } from 'vitest';
import { SECURITY_POLICY } from '@mahkama/core';
import { docxParagraphs, inspectUpload, pastedParagraphs, uploadTitle } from '@/server/uploads/inspect';
import {
  EXECUTABLE,
  HTML_PAGE,
  PLAIN_TEXT,
  docxBomb,
  docxBytes,
  docxWithManyEntries,
  jpegBytes,
  pdfBytes,
  pdfWithEmbeddedFile,
  pdfWithEscapedJavaScript,
  pdfWithJavaScript,
  pdfWithLaunch,
  plainZip,
  pngBytes,
} from '../helpers/samples';

const ALL = ['pdf', 'docx', 'jpeg', 'png'] as const;

describe('the type is read from the content', () => {
  it('recognizes each accepted type under its own extension', () => {
    expect(inspectUpload(pdfBytes(), { declaredName: 'a.pdf', accept: ALL })).toMatchObject({ ok: true, type: 'pdf', mediaType: 'application/pdf' });
    expect(inspectUpload(pngBytes(), { declaredName: 'a.PNG', accept: ALL })).toMatchObject({ ok: true, type: 'png', mediaType: 'image/png' });
    expect(inspectUpload(jpegBytes(), { declaredName: 'a.jpg', accept: ALL })).toMatchObject({ ok: true, type: 'jpeg', mediaType: 'image/jpeg' });
    expect(inspectUpload(jpegBytes(), { declaredName: 'a.jpeg', accept: ALL })).toMatchObject({ ok: true, type: 'jpeg' });
    expect(inspectUpload(docxBytes(['نص']), { declaredName: 'a.docx', accept: ALL })).toMatchObject({
      ok: true,
      type: 'docx',
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  });

  it('refuses a content that contradicts the extension', () => {
    for (const [bytes, name] of [
      [HTML_PAGE, 'a.pdf'],
      [EXECUTABLE, 'a.pdf'],
      [pngBytes(), 'a.pdf'],
      [pdfBytes(), 'a.png'],
      [pngBytes(), 'a.jpg'],
      [pdfBytes(), 'a.docx'],
      [docxBytes(['x']), 'a.pdf'],
    ] as const) {
      expect(inspectUpload(bytes, { declaredName: name, accept: ALL }), name).toMatchObject({ ok: false, reason: 'TYPE_MISMATCH' });
    }
  });

  it('refuses a type that is not accepted at the place, or a file without a known type', () => {
    expect(inspectUpload(docxBytes(['x']), { declaredName: 'a.docx', accept: ['pdf', 'jpeg', 'png'] })).toMatchObject({ ok: false, reason: 'TYPE_NOT_ACCEPTED' });
    expect(inspectUpload(PLAIN_TEXT, { declaredName: 'a.txt', accept: ALL })).toMatchObject({ ok: false, reason: 'TYPE_NOT_ACCEPTED' });
    expect(inspectUpload(plainZip(), { declaredName: 'a.zip', accept: ALL })).toMatchObject({ ok: false, reason: 'TYPE_NOT_ACCEPTED' });
    expect(inspectUpload(pdfBytes(), { declaredName: 'no-extension', accept: ALL })).toMatchObject({ ok: false, reason: 'TYPE_NOT_ACCEPTED' });
    expect(inspectUpload(new Uint8Array(), { declaredName: 'empty.pdf', accept: ALL })).toMatchObject({ ok: false });
  });

  it('refuses a plain archive renamed as a Word document', () => {
    expect(inspectUpload(plainZip(), { declaredName: 'a.docx', accept: ALL })).toMatchObject({ ok: false });
  });
});

describe('active content and archive limits', () => {
  it('refuses a PDF carrying a script, even written with escapes, a launch action or an embedded file', () => {
    for (const bytes of [pdfWithJavaScript(), pdfWithEscapedJavaScript(), pdfWithLaunch(), pdfWithEmbeddedFile()]) {
      expect(inspectUpload(bytes, { declaredName: 'a.pdf', accept: ALL })).toMatchObject({ ok: false, reason: 'UNSAFE' });
    }
  });

  it('refuses a Word document with macros or a document type definition', () => {
    expect(inspectUpload(docxBytes(['x'], { macro: true }), { declaredName: 'a.docx', accept: ALL })).toMatchObject({ ok: false, reason: 'UNSAFE' });
    expect(inspectUpload(docxBytes(['x'], { doctype: true }), { declaredName: 'a.docx', accept: ALL })).toMatchObject({ ok: false, reason: 'UNSAFE' });
  });

  it('stops opening an archive beyond its limits of entries and of inflated size, whatever its headers claim', () => {
    expect(inspectUpload(docxWithManyEntries(SECURITY_POLICY.uploads.docx.maxEntries + 1), { declaredName: 'a.docx', accept: ALL })).toMatchObject({ ok: false, reason: 'UNSAFE' });
    expect(inspectUpload(docxBomb(SECURITY_POLICY.uploads.docx.maxEntryBytes + 1024), { declaredName: 'a.docx', accept: ALL })).toMatchObject({ ok: false, reason: 'UNSAFE' });
  });
});

describe('the name a browser sends is a title', () => {
  it('keeps the last segment, without its extension, control characters or direction marks', () => {
    expect(uploadTitle('../../etc/\u202Efdp.exe\u202C.pdf')).toBe('fdp.exe');
    expect(uploadTitle('C:\\Users\\x\\عقد التوريد.pdf')).toBe('عقد التوريد');
    expect(uploadTitle('a\u0000b\u200Fc.pdf')).toBe('abc');
    expect(uploadTitle('   .pdf')).toBeNull();
    expect((uploadTitle(`${'م'.repeat(400)}.pdf`) ?? '').length).toBeLessThanOrEqual(150);
  });
});

describe('the text of the application becomes numbered paragraphs', () => {
  it('splits pasted text on its lines, keeping the numbering typed in the text and dropping empty lines', () => {
    expect(pastedParagraphs('مقال افتتاحي\r\n\r\n1. الوقائع\n2. الأسباب\n   \n3. الطلبات  ')).toEqual(['مقال افتتاحي', '1. الوقائع', '2. الأسباب', '3. الطلبات']);
  });

  it('reads the paragraphs of a Word document, numbering its numbered lists, without resolving any entity', () => {
    expect(docxParagraphs(docxBytes(['مقال افتتاحي', 'الوقائع', 'الأسباب'], { numbered: [1, 2] }))).toEqual(['مقال افتتاحي', '1. الوقائع', '2. الأسباب']);
    expect(docxParagraphs(docxBytes(['أ & ب < ج']))).toEqual(['أ & ب < ج']);
  });
});
