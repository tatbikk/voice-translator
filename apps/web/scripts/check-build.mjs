// Post-build checks (contract §6 and §9):
// 1. no app route may be prerendered: a static page carries no CSP nonce, so its
//    scripts would be blocked;
// 2. a build made without DEMO_BUILD=true must contain no demo route;
// 3. nor any code of src/demo: the server build is searched for the marker
//    string of src/demo/server/services.ts (review A-15). A demo build must
//    contain it, which shows that the search finds it when it is there.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const next = fileURLToPath(new URL('../.next/', import.meta.url));
const fail = (message) => {
  console.error(`check-build: ${message}`);
  process.exit(1);
};

// The single allowed exception: Next.js always prerenders the global error page
// (shown only when the root layout fails). Ours is plain HTML with links and
// needs no script, so the missing nonce does not matter there.
const ALLOWED_STATIC = new Set(['/_global-error']);

const prerender = JSON.parse(readFileSync(`${next}prerender-manifest.json`, 'utf8'));
const prerendered = Object.keys(prerender.routes ?? {}).filter((route) => !ALLOWED_STATIC.has(route));
if (prerendered.length > 0) {
  fail(`prerendered routes found (they would carry no CSP nonce): ${prerendered.join(', ')}`);
}

const manifestPath = `${next}server/app-paths-manifest.json`;
if (!existsSync(manifestPath)) fail('app-paths-manifest.json not found');
const appPaths = Object.keys(JSON.parse(readFileSync(manifestPath, 'utf8')));
const demoPaths = appPaths.filter((p) => p.includes('/demo'));
const demoBuild = process.env.DEMO_BUILD === 'true';
if (!demoBuild && demoPaths.length > 0) {
  fail(`demo routes present in a non-demo build: ${demoPaths.join(', ')}`);
}
// Read from the source, so that the two never drift apart.
const servicesSource = readFileSync(fileURLToPath(new URL('../src/demo/server/services.ts', import.meta.url)), 'utf8');
const marker = /DEMO_BUILD_MARKER = '([a-z0-9-]{16,})'/.exec(servicesSource)?.[1];
if (!marker) fail('DEMO_BUILD_MARKER not found in src/demo/server/services.ts');

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : [];
  });
}
const serverFiles = filesUnder(`${next}server`);
const withMarker = serverFiles.filter((file) => readFileSync(file).includes(marker));
if (!demoBuild && withMarker.length > 0) {
  fail(`code of src/demo present in a non-demo build: ${withMarker.map((f) => f.slice(next.length)).join(', ')}`);
}
if (demoBuild && withMarker.length === 0) {
  fail('the demo build does not contain the src/demo marker: the search for demo code cannot be trusted');
}
console.log(
  `check-build: ok (${appPaths.length} app paths, ${demoPaths.length} demo paths, ${serverFiles.length} server files searched, demo build: ${demoBuild})`,
);
