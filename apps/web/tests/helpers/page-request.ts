// A page of the App Router rendered in the integration suite, as the server
// renders it for one browser: the page's default export is called with its
// route parameters, and next/headers answers with the request of a test Client
// (its cookies, its address, and the path the request interceptor passes to the
// guards in x-mr-path). notFound() and redirect() of next/navigation throw as
// they do in Next.js; the outcome says which one ended the page.
//
// A test file replaces next/headers with this module's NEXT_HEADERS:
//   vi.mock('next/headers', async () => (await import('../helpers/page-request')).NEXT_HEADERS);
import { isValidElement, type ReactNode } from 'react';
import { appOrigin } from './env';
import type { Client } from './http';

let current = new Headers();

function cookieHeader(client: Client): string {
  return [...client.jar].map(([name, cookie]) => `${name}=${cookie.value}`).join('; ');
}

/** The module that stands for next/headers: the headers of the request set by renderPage. */
export const NEXT_HEADERS = {
  headers: () => Promise.resolve(current),
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const found = (current.get('cookie') ?? '')
          .split(';')
          .map((part) => part.trim().split('='))
          .find(([key]) => key === name);
        return found ? { name, value: found.slice(1).join('=') } : undefined;
      },
    }),
};

export type PageOutcome =
  | { readonly kind: 'rendered'; readonly tree: ReactNode }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'redirect'; readonly location: string };

type PageComponent = (props: { params: Promise<Record<string, string>>; searchParams: Promise<Record<string, string>> }) => Promise<ReactNode>;

/**
 * Calls the page's default export for `client` at `path`, with the route
 * parameters given. The tree a rendered page returns is not rendered to HTML:
 * the props its elements carry are what the server passes to the components.
 */
export async function renderPage(
  page: () => Promise<{ default: unknown }>,
  client: Client,
  path: string,
  params: Record<string, string>,
  searchParams: Record<string, string> = {},
): Promise<PageOutcome> {
  const headers = new Headers({ 'x-mr-path': path, origin: appOrigin() });
  const cookies = cookieHeader(client);
  if (cookies) headers.set('cookie', cookies);
  if (client.ip !== null) headers.set('x-real-ip', client.ip);
  current = headers;
  const component = (await page()).default as PageComponent;
  try {
    const tree = await component({ params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) });
    return { kind: 'rendered', tree };
  } catch (error) {
    const raw = (error as { digest?: unknown }).digest;
    const digest = typeof raw === 'string' ? raw : '';
    if (digest.endsWith(';404')) return { kind: 'not-found' };
    if (digest.startsWith('NEXT_REDIRECT')) return { kind: 'redirect', location: digest.split(';')[2] ?? '' };
    throw error;
  }
}

/** Every value of a prop named `name` in the element tree a page returned. */
export function propsNamed(tree: ReactNode, name: string): unknown[] {
  const found: unknown[] = [];
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (name in props) found.push(props[name]);
      for (const value of Object.values(props)) visit(value);
      return;
    }
    // Plain objects passed as props (the tabs of the case page) hold elements too.
    for (const value of Object.values(node as Record<string, unknown>)) {
      if (typeof value === 'object') visit(value);
    }
  };
  visit(tree);
  return found;
}
