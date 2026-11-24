// Vitest global setup of the integration suite (vitest.integration.config.ts).
// Runs once, before any test file: loads the test configuration, refuses any
// database whose name does not end in "_test", bundles the command-line tools
// (dist-server/*.mjs: db-roles, seed, boot-check, verify-events) and recreates
// the schema. Each test file recreates it again in its beforeAll (reset.ts).
import { bundleServer } from './cli';
import { assertTestDatabase, loadTestEnv } from './env';
import { recreateSchema } from './schema';

export default async function setup(): Promise<void> {
  loadTestEnv();
  assertTestDatabase();
  bundleServer();
  await recreateSchema();
}
