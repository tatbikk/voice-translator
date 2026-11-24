// Vitest setup file of the integration suite: runs in the test process before
// every test file. Loads apps/web/.env.test the same way as the global setup,
// starts capturing the technical log of this file, and records the
// configuration secrets the leak checks look for.
import { loadTestEnv } from './env';
import { installLogCapture } from './log-capture';
import { trackEnvironmentSecrets } from './sensitive';

loadTestEnv();
installLogCapture();
trackEnvironmentSecrets();
