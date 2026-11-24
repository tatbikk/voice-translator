// Captures everything the application writes to the technical log while a test
// file runs (process.stdout/stderr and console), so that memo row 17 can check
// that no secret, code, token, password or e-mail ever reaches it. The original
// writers are still called: nothing is hidden from the test output.
const KEY = Symbol.for('mahkama.tests.logCapture');

interface CaptureState {
  chunks: string[];
}

type Holder = Record<symbol, CaptureState | undefined>;

function toText(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString('utf8');
  try {
    return JSON.stringify(chunk) ?? String(chunk);
  } catch {
    return String(chunk);
  }
}

/** Installs the capture once per process and starts a fresh buffer for the current test file. */
export function installLogCapture(): void {
  const holder = globalThis as unknown as Holder;
  const existing = holder[KEY];
  if (existing) {
    existing.chunks = [];
    return;
  }
  const state: CaptureState = { chunks: [] };
  holder[KEY] = state;

  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream) as (...args: unknown[]) => boolean;
    const patched = (...args: unknown[]): boolean => {
      state.chunks.push(toText(args[0]));
      return original(...args);
    };
    stream.write = patched as typeof stream.write;
  }

  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      state.chunks.push(args.map(toText).join(' '));
      original(...args);
    };
  }
}

export function capturedLogs(): string {
  const holder = globalThis as unknown as Holder;
  return holder[KEY]?.chunks.join('\n') ?? '';
}
