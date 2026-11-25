// Review P1-S-15, on the PDF documents themselves:
// - the line «صادرة عن بيئة العرض — لا أثر قانوني لها» is read in the printed
//   PDF, on every page of a document of several pages, and is absent when the
//   generator is told the signature is no longer simulated;
// - the browser that prints them sends no request at all, even for a page
//   full of references to the network (prompt, «المدخلات والملفات»).
import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentGenerationError, generatePdf, printPdf, type GenerateInput } from '@/server/documents/generate';
import { translator } from '@/i18n/translate';
import { pdfPages, readsRightToLeft } from '../helpers/pdf-text';
import { useFreshDatabase } from '../helpers/reset';

useFreshDatabase();

const t = translator('ar');
const LINE = t('documents.environmentLine');

const longOrder = (environmentLine: string | null): GenerateInput => ({
  template: 'order',
  header: {
    logoSlot: t('documents.logoSlot'),
    headerLines: ['المحكمة الابتدائية التجارية النموذجية'],
    title: 'أمر بإجراء خبرة حسابية',
    caseNumberLabel: t('documents.caseNumber'),
    caseNumber: '1103/8201/2026',
    nationalRefLabel: t('documents.nationalRef'),
    nationalRef: 'DEMO-2026-8201-001103-FI',
    dateLabel: t('documents.date'),
    date: '15 مارس 2027',
  },
  data: {
    judgeName: 'القاضية نون',
    judgeRole: 'القاضي المقرر',
    basis: 'المادتين 105 و119 من القانون رقم 58.25 المتعلق بالمسطرة المدنية',
    paragraphs: Array.from({ length: 60 }, (_, i) => ({ text: `الفقرة ${String(i + 1)}: بيان مهمة الخبير وما يتعين عليه إنجازه داخل الأجل المحدد له، بحضور الأطراف أو بعد التأكد من توصلهم بالاستدعاء.` })),
  },
  signatures: [{ role: 'القاضي المقرر', name: 'القاضية نون', stamp: 'توقيع تجريبي', when: '15 مارس 2027 10:30', pendingText: 'لم يوقع بعد' }],
  environmentLine,
  pageLabel: t('documents.pageLabel'),
});

describe('the environment line, read in the PDF (review P1-S-15)', () => {
  it('stands on every page of a document of several pages', async () => {
    const pages = pdfPages(await generatePdf(longOrder(LINE)));
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((page, i) => {
      expect(readsRightToLeft(page, LINE), `page ${String(i + 1)}`).toBe(true);
    });
    // The reader does find the body too: the check reads the page, not an empty list.
    expect(pages[0]?.some((text) => text.includes('الخبير'))).toBe(true);
  }, 90_000);

  it('is absent from every page once the signature is no longer simulated', async () => {
    const pages = pdfPages(await generatePdf(longOrder(null)));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(readsRightToLeft(page, LINE)).toBe(false);
      expect(page.join('')).not.toContain('بيئة العرض');
    }
  }, 90_000);
});

describe('the printing browser makes no network request (review P1-S-15)', () => {
  let server: Server;
  const seen: string[] = [];
  let base = '';

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('x');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  it('prints a page full of references to the network without reaching any of them', async () => {
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
      <link rel="stylesheet" href="${base}/style.css">
      <link rel="preload" href="${base}/preload.woff2" as="font">
      <link rel="prefetch" href="${base}/prefetch">
      <style>
        @import url('${base}/import.css');
        @font-face { font-family: remote; src: url('${base}/font.woff2'); }
        body { background: url('${base}/background.png'); font-family: remote; }
      </style>
      <script src="${base}/script.js"></script>
      </head><body>
      <p>نص الوثيقة</p>
      <img src="${base}/image.png" srcset="${base}/image-2x.png 2x">
      <iframe src="${base}/frame"></iframe>
      <object data="${base}/object"></object>
      <embed src="${base}/embed">
      <video src="${base}/video.mp4" poster="${base}/poster.png"></video>
      <audio src="${base}/audio.mp3"></audio>
      <svg><image href="${base}/svg-image.png" width="10" height="10"/></svg>
      <script>fetch('${base}/fetch'); new Image().src = '${base}/js-image';</script>
      </body></html>`;
    const pdf = await printPdf(html, { headerHtml: '<span></span>', footerHtml: `<img src="${base}/footer.png">` });
    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(seen, 'requests the browser sent').toEqual([]);

    // The server is reachable: the absence of requests is the browser's, not the server's.
    await new Promise<void>((resolve, reject) => {
      get(`${base}/probe`, (res) => {
        res.resume();
        res.on('end', resolve);
      }).on('error', reject);
    });
    expect(seen).toEqual(['/probe']);
  }, 90_000);

  it('stops printing when its job is aborted: an aborted signal prints nothing (review P2-S-15)', async () => {
    const margins = { headerHtml: '<span></span>', footerHtml: '<span></span>' };
    await expect(printPdf('<html><body><p>x</p></body></html>', margins, AbortSignal.abort())).rejects.toBeInstanceOf(DocumentGenerationError);
    const aborting = new AbortController();
    const printing = printPdf('<html><body><p>x</p></body></html>', margins, aborting.signal);
    aborting.abort();
    await expect(printing).rejects.toBeInstanceOf(DocumentGenerationError);
  }, 90_000);
});
