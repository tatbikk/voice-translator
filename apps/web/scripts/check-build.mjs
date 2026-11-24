// Post-build checks (contract §6 and §9):
// 1. no app route may be prerendered: a static page carries no CSP nonce, so its
//    scripts would be blocked;
// 2. a build made without DEMO_BUILD=true must contain no demo route.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const next = fileURLToPath(new URL('../.next/', import.meta.url));
const fail = (message) => {
  console.error(`check-build: ${message}`);
  process.exit(1);
};

const prerender = JSON.parse(readFileSync(`${next}prerender-manifest.json`, 'utf8'));
const prerendered = Object.keys(prerender.routes ?? {});
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
console.log(
  `check-build: ok (${appPaths.length} app paths, ${demoPaths.length} demo paths, demo build: ${demoBuild})`,
);
