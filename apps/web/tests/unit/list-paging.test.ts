// The pages of a list (independent review IR-11), written before the code: the
// page number in the address goes through a schema, anything else than a
// positive integer is the first page; a list cut says how many it shows of how
// many, and how to see the rest; a link to another page keeps the other lists
// of the screen where they were.
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '@/i18n/messages';
import { cutOf, pageFrom, pageHref, pagesFrom, PAGE_SIZE } from '@/server/lists/paging';

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
