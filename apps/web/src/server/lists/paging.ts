import 'server-only';
import { z } from 'zod';

// The pages of a list (independent review IR-11). A list reads one page of
// what its query selects, in a stable order, with the number of all of them,
// and the screen says when the list does not fit in one page: how many it
// shows of how many, and how to see the rest. The page asked for comes from
// the address, through a schema; anything else than a positive integer is the
// first page, and a page beyond the last is the last.

/** The rows per page of each list. */
export const PAGE_SIZE = {
  /** «لائحة الملفات» */
  cases: 25,
  /** «مشاريع الإيداع» */
  drafts: 25,
  /** «الملفات الواردة» of the registry office */
  incoming: 10,
  /** each ground of «الإحالات» */
  referrals: 10,
  /** «ينتظر إجراء مني», in files */
  awaiting: 10,
  /** «آجال تقترب» */
  deadlines: 10,
} as const;

const LAST_PAGE_ASKED = 10_000;

/** A page number of the address. */
export const pageNumberSchema = z.coerce.number().int().min(1).max(LAST_PAGE_ASKED);

export interface Page<T> {
  readonly rows: readonly T[];
  /** the page shown, from 1 */
  readonly page: number;
  readonly pageSize: number;
  /** how many entries the query selects in all */
  readonly total: number;
  /** the positions, in the list's order, of the first and the last entry read for this page; 0 and 0 when there is none */
  readonly from: number;
  readonly to: number;
}

export interface ListCut {
  readonly from: number;
  readonly to: number;
  readonly total: number;
  readonly previous: number | null;
  readonly next: number | null;
}

/** The page number given in the address (the first of repeated values), the first page otherwise. */
export function pageFrom(value: unknown): number {
  const parsed = pageNumberSchema.safeParse(Array.isArray(value) ? value[0] : value);
  return parsed.success ? parsed.data : 1;
}

/** The page of each named list of a screen, read from the address; nothing else is read. */
export function pagesFrom<K extends string>(params: Readonly<Record<string, unknown>>, keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, pageFrom(params[key])])) as Record<K, number>;
}

/** What the screen says of a list that does not fit in one page; null when it does. */
export function cutOf(page: Page<unknown>): ListCut | null {
  if (page.page === 1 && page.total <= page.pageSize) return null;
  return {
    from: page.from,
    to: page.to,
    total: page.total,
    previous: page.page > 1 ? page.page - 1 : null,
    next: page.to < page.total ? page.page + 1 : null,
  };
}

/** The address of another page of one list, keeping the pages of the other lists of the screen. */
export function pageHref(path: string, pages: Readonly<Record<string, number>>, key: string, page: number): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...pages, [key]: page })) if (value > 1) query.set(name, String(value));
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/** One part of a list: how many entries it has, and how to read some of them, in its own order. */
export interface ListPart<R> {
  readonly count: () => Promise<number>;
  readonly read: (window: { skip: number; take: number }) => Promise<R[]>;
}

/**
 * Reads one page: the number of entries first, then the page asked for, or the
 * last one if it lies beyond. The reader gets how many to skip and to take.
 */
export function readPage<R>(
  pageSize: number,
  asked: number,
  count: ListPart<R>['count'],
  read: ListPart<R>['read'],
): Promise<Page<R>> {
  return readSegmentedPage(pageSize, asked, [{ count, read }]);
}

/**
 * Reads one page of a list made of parts shown one after the other (the
 * referrals still open to the conclusions, then the others: review of the
 * IR-11 fix): the number of each part first, then, from the parts the page
 * covers, what falls in it. One count and at most one read per part.
 */
export async function readSegmentedPage<R>(pageSize: number, asked: number, parts: readonly ListPart<R>[]): Promise<Page<R>> {
  const counts: number[] = [];
  for (const part of parts) counts.push(await part.count());
  const total = counts.reduce((sum, n) => sum + n, 0);
  const last = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(asked)), last);
  const start = (page - 1) * pageSize;
  const rows: R[] = [];
  let skip = start;
  for (const [index, part] of parts.entries()) {
    const size = counts[index] ?? 0;
    if (rows.length >= pageSize) break;
    if (skip >= size) {
      skip -= size;
      continue;
    }
    const take = Math.min(pageSize - rows.length, size - skip);
    rows.push(...(await part.read({ skip, take })));
    skip = 0;
  }
  return { rows, page, pageSize, total, from: rows.length > 0 ? start + 1 : 0, to: start + rows.length };
}

/** The page of a list the subject may not see, or that selects nothing. */
export function emptyPage<T>(pageSize: number): Page<T> {
  return { rows: [], page: 1, pageSize, total: 0, from: 0, to: 0 };
}

/** The same page with its rows mapped (and some left out by the core); the positions stay those of the query. */
export function withRows<R, T>(page: Page<R>, rows: readonly T[]): Page<T> {
  return { ...page, rows };
}
