import 'server-only';

export function isBackgroundRefresh(req: Request): boolean {
  return req.headers.get('x-background-refresh') === '1';
}

export function pathOf(req: Request): string {
  return new URL(req.url).pathname;
}
