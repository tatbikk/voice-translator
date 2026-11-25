import 'server-only';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEnv } from '../config/env';
import { log, errorFields } from '../log';
import { renderTemplate, type TemplateScope } from './templates';

// Document generation (prompt, «الاختيارات التقنية»): an HTML template filled
// with the file's data, then printed to PDF by a headless browser, the surest
// way to keep Arabic text and its direction intact. The browser runs isolated
// (prompt, «المدخلات والملفات»): JavaScript disabled, offline, every request
// refused; the fonts travel inside the page as data. The letterhead follows
// the visual identity (logo slot, header lines, the thick and thin rule), and
// while the signature component is simulated every page carries the fixed line
// «صادرة عن بيئة العرض — لا أثر قانوني لها» (prompt, rule 9).

export const TEMPLATE_NAMES = ['registration-receipt', 'order', 'judgment', 'application-copy', 'payment-receipt', 'filing-receipt'] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export interface DocumentHeader {
  readonly logoSlot: string;
  readonly headerLines: readonly string[];
  readonly title: string;
  readonly caseNumberLabel: string;
  readonly caseNumber: string;
  readonly nationalRefLabel: string;
  readonly nationalRef: string;
  readonly dateLabel: string;
  readonly date: string;
}

export interface SignatureBox {
  readonly role: string;
  readonly name: string;
  /** the visible stamp once signed («توقيع تجريبي» while simulated) */
  readonly stamp: string | null;
  readonly when: string | null;
  readonly pendingText: string;
}

export interface GenerateInput {
  readonly template: TemplateName;
  readonly header: DocumentHeader;
  readonly data: TemplateScope;
  readonly signatures: readonly SignatureBox[];
  /** the fixed demo line, or null once a real trust service signs */
  readonly environmentLine: string | null;
  /** «الصفحة {page} من {pages}» with the two placeholders */
  readonly pageLabel: string;
}

const here = dirname(fileURLToPath(import.meta.url));
function templatesDir(): string {
  // Bundled CLI tools run from dist-server; the web server from the sources' build.
  for (const candidate of [join(here, 'templates'), join(process.cwd(), 'src', 'server', 'documents', 'templates'), join(process.cwd(), 'dist-server', 'templates')]) {
    try {
      readFileSync(join(candidate, 'letterhead.html'));
      return candidate;
    } catch {
      // next candidate
    }
  }
  throw new Error('document templates not found');
}

const readTemplate = (name: string) => readFileSync(join(templatesDir(), `${name}.html`), 'utf8');

let fontsCss: string | null = null;
function fonts(): string {
  if (fontsCss) return fontsCss;
  const require = createRequire(import.meta.url);
  const naskh = require.resolve('@fontsource-variable/noto-naskh-arabic/files/noto-naskh-arabic-arabic-wght-normal.woff2');
  const plex = require.resolve('@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2');
  const plexBold = require.resolve('@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-600-normal.woff2');
  const face = (family: string, file: string, weight: string) =>
    `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${readFileSync(file).toString('base64')}) format('woff2');font-weight:${weight};}`;
  fontsCss = [face('Naskh', naskh, '400 700'), face('Plex Arabic', plex, '400'), face('Plex Arabic', plexBold, '600 700')].join('\n');
  return fontsCss;
}

/** The complete HTML of a document, before printing (also used by tests). */
export function documentHtml(input: GenerateInput): string {
  const body = renderTemplate(readTemplate(input.template), input.data);
  const scope: TemplateScope = {
    ...input.header,
    headerLines: input.header.headerLines.map((line) => ({ line })),
    signatures: input.signatures.map((s) => ({
      role: s.role,
      name: s.name,
      signed: s.stamp ? [{ stamp: s.stamp, when: s.when ?? '' }] : [],
      pending: s.stamp ? [] : [{ pendingText: s.pendingText }],
    })),
  };
  return renderTemplate(readTemplate('letterhead'), scope, { body, fonts: fonts() });
}

function headerFooter(text: string): string {
  return `<div style="width:100%;font-family:'Plex Arabic',sans-serif;font-size:8pt;color:#3a4757;text-align:center;direction:rtl"><style>${fonts()}</style>${text}</div>`;
}

export class DocumentGenerationError extends Error {
  constructor(readonly stage: 'launch' | 'render') {
    super(`document generation failed at ${stage}`);
    this.name = 'DocumentGenerationError';
  }
}

/** Prints the document to PDF in an isolated, offline browser. */
export async function generatePdf(input: GenerateInput, signal?: AbortSignal): Promise<Uint8Array> {
  const pageText = input.pageLabel.replace('{page}', '<span class="pageNumber"></span>').replace('{pages}', '<span class="totalPages"></span>');
  return printPdf(
    documentHtml(input),
    {
      headerHtml: headerFooter(input.environmentLine ? escapeLine(input.environmentLine) : ''),
      footerHtml: headerFooter(pageText),
    },
    signal,
  );
}

/**
 * Prints a page the server built to PDF, in the isolated browser: no script,
 * no network (offline, and every request aborted), no download, no service
 * worker. Exported for the test that gives it a page full of outbound
 * references (review P1-S-15); the platform calls it through generatePdf only.
 */
export async function printPdf(html: string, margins: { readonly headerHtml: string; readonly footerHtml: string }, signal?: AbortSignal): Promise<Uint8Array> {
  const { chromium } = await import('playwright-core');
  if (signal?.aborted) throw new DocumentGenerationError('launch');
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    const executablePath = getEnv().pdfBrowserPath ?? undefined;
    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      args: ['--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--no-zygote'],
    });
  } catch (error) {
    log.error('pdf browser launch failed', errorFields(error));
    throw new DocumentGenerationError('launch');
  }
  // A job past its time limit closes its browser: printing stops there (review P2-S-15).
  const closeOnAbort = () => void browser.close().catch(() => undefined);
  signal?.addEventListener('abort', closeOnAbort, { once: true });
  try {
    if (signal?.aborted) throw new DocumentGenerationError('render');
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true, acceptDownloads: false, serviceWorkers: 'block' });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: margins.headerHtml,
      footerTemplate: margins.footerHtml,
      margin: { top: '30mm', bottom: '22mm', left: '18mm', right: '18mm' },
    });
    return new Uint8Array(pdf);
  } catch (error) {
    log.error('pdf render failed', errorFields(error));
    throw new DocumentGenerationError('render');
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    await browser.close().catch(() => undefined);
  }
}

function escapeLine(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}
