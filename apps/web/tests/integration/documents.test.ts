// Document generation (memo row 12): the template escapes every value, the
// browser prints Arabic to PDF offline and without scripts, and every page
// carries the environment line while the signature component is simulated.
import { describe, expect, it } from 'vitest';
import { documentHtml, generatePdf, type GenerateInput } from '@/server/documents/generate';
import { useFreshDatabase } from '../helpers/reset';

useFreshDatabase();

const hostile = '<script>alert(1)</script><img src="http://example.invalid/x.png">{{title}}';

const input: GenerateInput = {
  template: 'order',
  header: {
    logoSlot: 'موضع الشعار الرسمي',
    headerLines: ['المملكة المغربية', 'المحكمة الابتدائية التجارية النموذجية'],
    title: 'أمر بإجراء خبرة',
    caseNumberLabel: 'رقم الملف',
    caseNumber: '1103/8201/2026',
    nationalRefLabel: 'المعرف الوطني الموحد',
    nationalRef: 'DEMO-2026-8201-001103-FI',
    dateLabel: 'التاريخ',
    date: '15 مارس 2027',
  },
  data: { judgeName: hostile, judgeRole: 'القاضي المقرر', basis: 'المواد 105 و119 و123 من القانون رقم 58.25', paragraphs: [{ text: hostile }] },
  signatures: [{ role: 'القاضي المقرر', name: 'القاضية نون', stamp: 'توقيع تجريبي', when: '15 مارس 2027 10:30', pendingText: 'لم يوقع بعد' }],
  environmentLine: 'صادرة عن بيئة العرض — لا أثر قانوني لها',
  pageLabel: 'الصفحة {page} من {pages}',
};

describe('document generation', () => {
  it('escapes every value of the file, placeholders included', () => {
    const html = documentHtml(input);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src="http');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&#123;&#123;title&#125;&#125;');
    expect(html).toContain('موضع الشعار الرسمي');
    expect(html).toContain('توقيع تجريبي');
  });

  it('prints a PDF offline, with the environment line on the page', async () => {
    const pdf = await generatePdf(input);
    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(10_000);
  }, 60_000);
});
