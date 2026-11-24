// One function decides where a "return to" parameter or a stored notification
// link may lead: only to a path inside the platform. Anything else falls back
// to the home page.

// Code points refused anywhere in the path: C0 controls, DEL, and the Unicode
// space and format characters a browser may strip or reinterpret.
const FORBIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x0020],
  [0x007f, 0x00a0],
  [0x1680, 0x1680],
  [0x180e, 0x180e],
  [0x2000, 0x200f],
  [0x2028, 0x202f],
  [0x205f, 0x206f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];

function hasForbiddenCharacter(path: string): boolean {
  for (const ch of path) {
    if (ch === '\\') return true;
    const cp = ch.codePointAt(0) ?? 0;
    if (FORBIDDEN_RANGES.some(([from, to]) => cp >= from && cp <= to)) return true;
  }
  return false;
}

function acceptable(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !hasForbiddenCharacter(path);
}

export function safeInternalPath(value: unknown, appOrigin: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return '/';
  if (!acceptable(value)) return '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return '/';
  }
  if (!acceptable(decoded)) return '/';
  let origin: string;
  let url: URL;
  try {
    origin = new URL(appOrigin).origin;
    url = new URL(value, origin);
  } catch {
    return '/';
  }
  if (url.origin !== origin) return '/';
  // The result is checked again: dot segments ("/.//x", "/%2e//x", "/a/..//x")
  // can resolve to a path that starts with "//", which a browser reads as
  // another site. Such a result, or one that resolves elsewhere, is refused.
  const result = `${url.pathname}${url.search}${url.hash}`;
  if (!acceptable(result)) return '/';
  try {
    if (new URL(result, origin).origin !== origin) return '/';
  } catch {
    return '/';
  }
  return result;
}
