// The pages of a list (independent review IR-11), written before the code: the
// page number in the address goes through a schema, anything else than a
// positive integer is the first page; a list cut says how many it shows of how
// many, and how to see the rest; a link to another page keeps the other lists
// of the screen where they were.
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '@/i18n/messages';
import { emptyKeyOf } from '@/components/shell/list-cut-lines';
import { cutOf, pageFrom, pageHref, pagesFrom, PAGE_SIZE, readSegmentedPage } from '@/server/lists/paging';

describe('the page number in the address', () => {
  it('is a positive integer, the first page otherwise', () => {
    expect(pageFrom('2')).toBe(2);
    expect(pageFrom('17')).toBe(17);
    expect(pageFrom(['3', '4'])).toBe(3);
    for (const wrong of [undefined, '', '0', '-3', '2.5', 'abc', '1e3x', '99999999999', ['x']]) expect(pageFrom(wrong), String(wrong)).toBe(1);
  });

  it('is read for every list of a screen by its own name, and nothing else is read', () => {
    expect(pagesFrom({ awaiting: '2', deadlines: 'x', other: '5' }, ['awaiting', 'deadlines', 'principal'])).toEqual({ awaiting: 2, deadlines: 1, principal: 1 });
  });
});

describe('the cut of a list', () => {
  it('is said only when the list does not fit in one page', () => {
    expect(cutOf({ rows: [], page: 1, pageSize: 10, total: 0, from: 0, to: 0 })).toBeNull();
    expect(cutOf({ rows: [], page: 1, pageSize: 10, total: 10, from: 1, to: 10 })).toBeNull();
  });

  it('gives the positions shown, the total, and the pages before and after', () => {
    expect(cutOf({ rows: [], page: 1, pageSize: 10, total: 13, from: 1, to: 10 })).toEqual({ from: 1, to: 10, total: 13, previous: null, next: 2 });
    expect(cutOf({ rows: [], page: 2, pageSize: 10, total: 13, from: 11, to: 13 })).toEqual({ from: 11, to: 13, total: 13, previous: 1, next: null });
    expect(cutOf({ rows: [], page: 2, pageSize: 10, total: 30, from: 11, to: 20 })).toEqual({ from: 11, to: 20, total: 30, previous: 1, next: 3 });
  });

  it('is worded in the message files, with the numbers and the way to the rest', () => {
    const ar = MESSAGES.ar;
    for (const key of ['lists.cut.label', 'lists.cut.summary', 'lists.cut.rest', 'lists.cut.previous', 'lists.cut.next']) expect(ar[key], key).toBeTruthy();
    for (const placeholder of ['{from}', '{to}', '{total}']) expect(ar['lists.cut.summary']).toContain(placeholder);
    expect(ar['lists.cut.label']).toContain('{list}');
  });

  it('has a page size for every list the review named', () => {
    for (const list of ['cases', 'drafts', 'incoming', 'referrals', 'awaiting', 'deadlines'] as const) expect(PAGE_SIZE[list]).toBeGreaterThan(0);
  });
});

describe('the link to another page', () => {
  it('keeps the pages of the other lists of the screen, and leaves out a first page', () => {
    expect(pageHref('/dashboard', { awaiting: 2, deadlines: 1 }, 'deadlines', 3)).toBe('/dashboard?awaiting=2&deadlines=3');
    expect(pageHref('/dashboard', { awaiting: 2, deadlines: 3 }, 'awaiting', 1)).toBe('/dashboard?deadlines=3');
    expect(pageHref('/cases', { page: 2 }, 'page', 1)).toBe('/cases');
    expect(pageHref('/cases', { page: 1 }, 'page', 2)).toBe('/cases?page=2');
  });
});

// Review of the IR-11 fix: a list in two parts (the referrals still open to the
// prosecution's conclusions, then the others) is read as one list, a page of
// it at a time, with one count and at most one read per part; and a box never
// says that nothing awaits while it counted files.
describe('a list read in parts, one after the other', () => {
  const part = (name: string, size: number, reads: string[]) => ({
    count: () => Promise.resolve(size),
    read: ({ skip, take }: { skip: number; take: number }) => {
      reads.push(`${name}:${String(skip)}+${String(take)}`);
      return Promise.resolve(Array.from({ length: Math.max(0, Math.min(take, size - skip)) }, (_, i) => `${name}${String(skip + i + 1)}`));
    },
  });

  it('gives the first part first, then the second, page after page, with the total of both', async () => {
    const reads: string[] = [];
    const first = await readSegmentedPage(4, 1, [part('a', 3, reads), part('b', 5, reads)]);
    expect(first).toMatchObject({ rows: ['a1', 'a2', 'a3', 'b1'], page: 1, total: 8, from: 1, to: 4 });
    const second = await readSegmentedPage(4, 2, [part('a', 3, reads), part('b', 5, reads)]);
    expect(second).toMatchObject({ rows: ['b2', 'b3', 'b4', 'b5'], page: 2, total: 8, from: 5, to: 8 });
    expect(reads).toEqual(['a:0+3', 'b:0+1', 'b:1+4']);
  });

  it('shows the last page for a page beyond it, reads nothing for an empty list, and skips an empty part', async () => {
    const reads: string[] = [];
    expect(await readSegmentedPage(4, 9, [part('a', 0, reads), part('b', 5, reads)])).toMatchObject({ rows: ['b5'], page: 2, total: 5, from: 5, to: 5 });
    expect(await readSegmentedPage(4, 1, [part('a', 0, reads), part('b', 0, reads)])).toMatchObject({ rows: [], page: 1, total: 0, from: 0, to: 0 });
    expect(reads).toEqual(['b:4+1']);
  });
});

describe('the empty text of a box', () => {
  const page = (total: number) => ({ rows: [], page: 1, pageSize: 10, total, from: total > 0 ? 1 : 0, to: 0 });

  it('says that nothing awaits only when nothing was counted', () => {
    expect(emptyKeyOf(page(0), { empty: 'e', changed: 'c' })).toBe('e');
    expect(emptyKeyOf(page(3), { empty: 'e', changed: 'c' })).toBe('c');
  });

  it('is worded in the message files, for the box and for the referrals', () => {
    const ar = MESSAGES.ar;
    for (const key of ['dashboard.awaiting.changedOnPage', 'prosecution.cutSummary', 'prosecution.order', 'prosecution.conclusionsNotOpen']) expect(ar[key], key).toBeTruthy();
    for (const placeholder of ['{from}', '{to}', '{total}']) expect(ar['prosecution.cutSummary']).toContain(placeholder);
  });
});
