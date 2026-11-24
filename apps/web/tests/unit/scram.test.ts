// Review S-12: the role-provisioning step sends PostgreSQL a SCRAM-SHA-256
// verifier, never the runtime role's password. The verifier is checked against
// the example exchange of RFC 7677 §3 (user "user", password "pencil").
import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SCRAM_ITERATIONS, SCRAM_SALT_BYTES, scramSha256Verifier } from '@/cli/scram';

const FORMAT = /^SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2}):([A-Za-z0-9+/]+={0,2})$/;

function parse(verifier: string) {
  const m = FORMAT.exec(verifier);
  if (!m) throw new Error('not a SCRAM-SHA-256 verifier');
  return {
    iterations: Number(m[1]),
    salt: Buffer.from(m[2] ?? '', 'base64'),
    storedKey: Buffer.from(m[3] ?? '', 'base64'),
    serverKey: Buffer.from(m[4] ?? '', 'base64'),
  };
}

const hmac = (key: Buffer, text: string) => createHmac('sha256', key).update(text, 'utf8').digest();

describe('SCRAM-SHA-256 verifier (review S-12)', () => {
  it('has the form PostgreSQL stores: 4096 iterations, a random 16-byte salt, 32-byte keys', () => {
    const a = scramSha256Verifier('a-runtime-role-password');
    const b = scramSha256Verifier('a-runtime-role-password');
    const pa = parse(a);
    expect(pa.iterations).toBe(4096);
    expect(SCRAM_ITERATIONS).toBe(4096);
    expect(pa.salt.length).toBe(SCRAM_SALT_BYTES);
    expect(SCRAM_SALT_BYTES).toBe(16);
    expect(pa.storedKey.length).toBe(32);
    expect(pa.serverKey.length).toBe(32);
    expect(a, 'a new salt every time').not.toBe(b);
    expect(a).not.toContain('a-runtime-role-password');
  });

  it('matches the example exchange of RFC 7677', () => {
    const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
    const { storedKey, serverKey } = parse(scramSha256Verifier('pencil', salt, 4096));
    const authMessage = [
      'n=user,r=rOprNGfwEbeRWgbNEkqO',
      'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096',
      'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0',
    ].join(',');
    // The server proves itself with ServerKey…
    expect(hmac(serverKey, authMessage).toString('base64')).toBe('6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
    // …and checks the client's proof with StoredKey.
    const proof = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64');
    const signature = hmac(storedKey, authMessage);
    const clientKey = Buffer.from(proof.map((byte, i) => byte ^ (signature[i] ?? 0)));
    expect(createHash('sha256').update(clientKey).digest().equals(storedKey)).toBe(true);
  });

  it('refuses a password that SASLprep could change', () => {
    expect(() => scramSha256Verifier('mot-de-passe-été-long')).toThrow();
    expect(() => scramSha256Verifier('tab\tinside-the-password')).toThrow();
  });
});
