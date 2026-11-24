import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { evaluateBuild, type BuildFacts } from '@mahkama/core';

// The build marker (review A-15): dist-server/build-info.json, written by
// scripts/bundle.mjs during `npm run build` with the value of DEMO_BUILD. Every
// process reads it at boot (web, worker, seed, db-roles, verify-events,
// release): a production process refuses a demo build, and a build it cannot
// identify.

export const BUILD_INFO_FILE = 'build-info.json';

const schema = z.strictObject({ demoBuild: z.boolean() });

export interface BuildInfo {
  readonly demoBuild: boolean;
}

/** The marker of the build being run, or null when it is missing or unreadable. */
export function readBuildInfo(): BuildInfo | null {
  for (const dir of [join(process.cwd(), 'dist-server'), join(process.cwd(), 'apps', 'web', 'dist-server')]) {
    const path = join(dir, BUILD_INFO_FILE);
    // The path is built from the working directory and constants, never from input.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!existsSync(path)) continue;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const parsed = schema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** The mode named by APP_MODE; anything but "demo" is held to the production rules. */
export function declaredMode(): 'demo' | 'production' {
  return process.env.APP_MODE === 'demo' ? 'demo' : 'production';
}

export function buildFacts(mode: 'demo' | 'production'): BuildFacts {
  const info = readBuildInfo();
  return {
    mode,
    // The web bundle also carries the flag, inlined by next.config.ts.
    demoRoutesBuilt: process.env.DEMO_ROUTES_BUILT === 'true' || info?.demoBuild === true,
    buildInfoPresent: info !== null,
  };
}

/**
 * The build check of a command-line tool: on a violation it prints the codes
 * (never a value) and stops the process.
 */
export function enforceBuild(processName: 'seed' | 'db-roles' | 'verify-events' | 'release'): void {
  const violations = evaluateBuild(buildFacts(declaredMode()));
  if (violations.length === 0) return;
  console.error(JSON.stringify({ level: 'error', msg: 'boot refused', process: processName, violations: violations.join(',') }));
  process.exit(1);
}
