// SCRAM-SHA-256 password verifier (RFC 5802 and RFC 7677), in the form
// PostgreSQL stores in pg_authid.rolpassword:
//
//   SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>
//
// Given in CREATE ROLE / ALTER ROLE … PASSWORD, PostgreSQL stores such a
// verifier as is, so the runtime role's password never appears in the SQL text
// and cannot reach the server's statement log (review S-12).
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

export const SCRAM_ITERATIONS = 4096;
export const SCRAM_SALT_BYTES = 16;

/**
 * PostgreSQL applies SASLprep to the password before hashing it. For printable
 * ASCII, SASLprep changes nothing; other passwords are refused rather than
 * prepared differently from the server.
 */
export const SCRAM_PASSWORD = /^[\x20-\x7e]+$/;

const hmac = (key: Buffer, text: string) => createHmac('sha256', key).update(text, 'utf8').digest();

export function scramSha256Verifier(password: string, salt: Buffer = randomBytes(SCRAM_SALT_BYTES), iterations = SCRAM_ITERATIONS): string {
  if (!SCRAM_PASSWORD.test(password)) throw new Error('scram: the password must be printable ASCII');
  const salted = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
  const storedKey = createHash('sha256').update(hmac(salted, 'Client Key')).digest();
  const serverKey = hmac(salted, 'Server Key');
  return `SCRAM-SHA-256$${String(iterations)}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}
