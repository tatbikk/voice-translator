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
  docxFromXml,
  documentRels,
  docxWithManyEntries,
  jpegBytes,
  pdfBytes,
  pdfWithEmbeddedFile,
  pdfWithEscapedJavaScript,
  pdfWithJavaScript,
  pdfWithLaunch,
  plainZip,
  pngBytes,
  wordXml,
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

describe('a hostile Word document is read in linear time, or refused (review P2-S-01, P2-S-03)', () => {
  const docx = (name: string, bytes: Uint8Array) => inspectUpload(bytes, { declaredName: name, accept: ['docx'] });
  const timed = (fn: () => unknown): number => {
    const start = performance.now();
    try {
      fn();
    } catch {
      // a refusal is fine; only the time matters here
    }
    return performance.now() - start;
  };

  it('reads, in well under a second, the shapes that made the old expressions quadratic', () => {
    const n = 20_000;
    for (const body of [
      '<w:p '.repeat(n),
      '<w:p>'.repeat(n),
      `<w:p>${'<w:t>'.repeat(n)}</w:p>`,
      `<w:p>${'<w:numPr>'.repeat(n)}</w:p>`,
      `<w:p>${'<w:t xml:space="preserve" '.repeat(n)}</w:p>`,
      '<w:p a="'.repeat(n),
    ]) {
      const bytes = docxFromXml(wordXml(body));
      expect(timed(() => docx('maqal.docx', bytes)), body.slice(0, 20)).toBeLessThan(1000);
      expect(timed(() => docxParagraphs(bytes)), body.slice(0, 20)).toBeLessThan(1000);
    }
  });

  it('drops a character reference that names no character, instead of failing', () => {
    const bytes = docxFromXml(wordXml('<w:p><w:r><w:t>أ&#x110000;ب&#55296;ج&#1585;</w:t></w:r></w:p>'));
    expect(docx('maqal.docx', bytes).ok).toBe(true);
    expect(docxParagraphs(bytes)).toEqual(['أبجر']);
  });

  it('keeps reading the ordinary document: runs, tabs, breaks, numbered lists, nested text boxes', () => {
    const xml = wordXml(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>الوقائع</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve"> أولا</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>سطر</w:t><w:br/><w:t>ثان</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:numPr><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>الأسباب</w:t></w:r></w:p>' +
        '<!-- a comment > with a bracket --><w:p><w:r><w:t><![CDATA[ignored]]>نص</w:t></w:r></w:p>',
    );
    expect(docxParagraphs(docxFromXml(xml))).toEqual(['1. الوقائع\tأولا', 'سطر ثان', '2. الأسباب', 'نص']);
  });

  it('refuses a document that fetches from outside when opened: a remote template or a linked image', () => {
    const template = docxFromXml(wordXml('<w:p><w:r><w:t>نص</w:t></w:r></w:p>'), {
      documentRels: documentRels('attachedTemplate', 'https://attacker.example/t.dotm', true),
    });
    expect(docx('maqal.docx', template)).toMatchObject({ ok: false, reason: 'UNSAFE' });
    const image = docxFromXml(wordXml('<w:p><w:r><w:t>نص</w:t></w:r></w:p>'), { documentRels: documentRels('image', 'https://attacker.example/pixel.png', true) });
    expect(docx('maqal.docx', image)).toMatchObject({ ok: false, reason: 'UNSAFE' });
    // A hyperlink is followed only on a click: it stays.
    const link = docxFromXml(wordXml('<w:p><w:r><w:t>نص</w:t></w:r></w:p>'), { documentRels: documentRels('hyperlink', 'https://example.org/', true) });
    expect(docx('maqal.docx', link).ok).toBe(true);
  });

  it('refuses embedded objects, ActiveX controls, imported chunks and duplicate parts', () => {
    const text = wordXml('<w:p><w:r><w:t>نص</w:t></w:r></w:p>');
    const ole = docxFromXml(text, { extraEntries: [{ name: 'word/embeddings/oleObject1.bin', data: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) }] });
    const activeX = docxFromXml(text, { extraEntries: [{ name: 'word/activeX/activeX1.xml', data: new TextEncoder().encode('<ax/>') }] });
    const chunk = docxFromXml(wordXml('<w:p><w:r><w:t>نص</w:t></w:r></w:p><w:altChunk r:id="rId9"/>'));
    const object = docxFromXml(wordXml('<w:p><w:r><w:object><o:OLEObject ProgID="Package"/></w:object></w:r></w:p>'));
    const duplicate = docxFromXml(text, { duplicateDocument: true });
    for (const [name, bytes] of [['ole', ole], ['activeX', activeX], ['altChunk', chunk], ['object', object], ['duplicate', duplicate]] as const) {
      expect(docx('maqal.docx', bytes), name).toMatchObject({ ok: false, reason: 'UNSAFE' });
    }
  });

  it('refuses an object embedded in a header or under another name, whatever part declares it (verification of the review fixes)', () => {
    const text = wordXml('<w:p><w:r><w:t>نص</w:t></w:r></w:p>');
    const enc = (s: string) => new TextEncoder().encode(s);
    const header = '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:object><o:OLEObject ProgID="Package"/></w:object></w:r></w:p></w:hdr>';
    const inHeader = docxFromXml(text, { extraEntries: [{ name: 'word/header1.xml', data: enc(header) }] });
    const chunkInFooter = docxFromXml(text, { extraEntries: [{ name: 'word/footer1.xml', data: enc('<w:ftr><w:altChunk r:id="rId1"/></w:ftr>') }] });
    const headerRels = docxFromXml(text, {
      extraEntries: [
        { name: 'word/media/image2.emf', data: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) },
        { name: 'word/_rels/header1.xml.rels', data: enc(documentRels('oleObject', 'media/image2.emf', false)) },
      ],
    });
    for (const [name, bytes] of [['OLE in a header', inHeader], ['chunk in a footer', chunkInFooter], ['OLE relationship of a header', headerRels]] as const) {
      expect(docx('maqal.docx', bytes), name).toMatchObject({ ok: false, reason: 'UNSAFE' });
    }
    // A plain header stays.
    const plain = docxFromXml(text, { extraEntries: [{ name: 'word/header1.xml', data: enc('<w:hdr><w:p><w:r><w:t>رأس</w:t></w:r></w:p></w:hdr>') }] });
    expect(docx('maqal.docx', plain).ok).toBe(true);
  });

  it('accepts the printer settings Word writes, and no other binary part (fix review L8)', () => {
    const text = wordXml('<w:p><w:r><w:t>نص</w:t></w:r></w:p>');
    const printer = docxFromXml(text, { extraEntries: [{ name: 'word/printerSettings/printerSettings1.bin', data: new Uint8Array([0x01, 0x02]) }] });
    expect(docx('maqal.docx', printer).ok).toBe(true);
    for (const name of ['word/printerSettings/../vbaProject.bin', 'word/media/printerSettings1.bin', 'printerSettings/printerSettings1.bin', 'word/printerSettings/printerSettings1.bin.exe/x.bin']) {
      const other = docxFromXml(text, { extraEntries: [{ name, data: new Uint8Array([0x01]) }] });
      expect(docx('maqal.docx', other), name).toMatchObject({ ok: false });
    }
  });
});

describe('a PDF that opens, plays or fetches outside content is refused (review P2-S-12)', () => {
  const pdfWith = (action: string) =>
    new TextEncoder().encode(
      ['%PDF-1.4', `1 0 obj << /Type /Catalog /Pages 2 0 R /OpenAction << /S ${action} >> >> endobj`, '2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj', 'trailer << /Root 1 0 R >>', '%%EOF', ''].join('\n'),
    );
  it('refuses remote and embedded go-to actions, renditions, movies and sounds', () => {
    for (const action of ['/GoToR /F (http://example.org/x.pdf)', '/GoToE', '/Rendition', '/Movie', '/Sound']) {
      expect(inspectUpload(pdfWith(action), { declaredName: 'x.pdf', accept: ['pdf'] }), action).toMatchObject({ ok: false, reason: 'UNSAFE' });
    }
  });
  it('keeps an ordinary go-to inside the document and a link', () => {
    for (const action of ['/GoTo /D [2 0 R /Fit]', '/URI /URI (https://example.org/)']) {
      expect(inspectUpload(pdfWith(action), { declaredName: 'x.pdf', accept: ['pdf'] }).ok, action).toBe(true);
    }
  });
});
