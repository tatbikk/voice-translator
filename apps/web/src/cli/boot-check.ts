// The boot check on its own (npm run boot:check): prints the violations and
// exits 1 when the platform would refuse to start in the current configuration.
import { ConfigurationError } from '@/server/config/env';
import { closeDb } from '@/server/db';
import { evaluateBootFacts } from '@/server/boot/check';

try {
  const result = await evaluateBootFacts();
  console.log(JSON.stringify({ ok: result.ok, violations: result.ok ? [] : result.violations, warnings: result.warnings }));
  await closeDb();
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  const variables = error instanceof ConfigurationError ? error.variables : [];
  console.log(JSON.stringify({ ok: false, violations: ['CONFIGURATION'], variables }));
  process.exit(1);
}
