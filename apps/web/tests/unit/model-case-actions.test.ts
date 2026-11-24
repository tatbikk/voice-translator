// Acceptance condition 2 of Phase 1 (docs/build-prompt.md, «المرحلة 1»): for
// every role and every situation of the model case, the available actions are
// exactly the buttons the study names, no more and no less. The expected
// buttons are read from tests/acceptance/model-case-actions.md, by their Arabic
// labels, and compared with what the core returns for the snapshot of
// tests/acceptance/model-case.fixture.ts. A second check proves that every
// action outside the list is refused by authorize() itself.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIONS, authorize, availableActions, type Resource } from '@mahkama/core';
import { MESSAGES } from '@/i18n/messages';
import { ACTORS, CONTEXT, ENVELOPE_SITUATIONS, SITUATIONS, subjectOf } from '../acceptance/model-case.fixture';

const SPEC = join(import.meta.dirname, '..', 'acceptance', 'model-case-actions.md');

interface Situation {
  readonly code: string;
  readonly expected: ReadonlyMap<string, readonly string[]>;
}

function parseSpecification(): Situation[] {
  const situations: Situation[] = [];
  let current: { code: string; expected: Map<string, string[]> } | null = null;
  for (const line of readFileSync(SPEC, 'utf8').split('\n')) {
    const heading = /^### ([A-Z]\d{2}) — /.exec(line);
    if (heading?.[1]) {
      current = { code: heading[1], expected: new Map() };
      situations.push(current);
      continue;
    }
    if (!current || !line.startsWith('| ') || line.startsWith('| ---') || line.startsWith('| الفاعل')) continue;
    const [actor, buttons] = line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());
    if (!actor) continue;
    if (!ACTORS[actor]) throw new Error(`${current.code}: unknown actor «${actor}»`);
    current.expected.set(actor, buttons ? buttons.split('، ').map((b) => b.trim()).filter(Boolean) : []);
  }
  return situations;
}

const situations = parseSpecification();
const label = (code: string) => MESSAGES.ar[`actions.${code}.label`] ?? `«${code} without label»`;

function resourceOf(code: string): Resource {
  const snapshot = SITUATIONS[code];
  if (snapshot) return { kind: 'case', snapshot };
  const envelope = ENVELOPE_SITUATIONS[code];
  if (envelope) return { kind: 'envelope', snapshot: envelope };
  throw new Error(`no fixture for situation ${code}`);
}

describe('model case: available actions', () => {
  it('covers every situation of the fixture, and the fixture every situation', () => {
    const specified = situations.map((s) => s.code).sort();
    const built = [...Object.keys(SITUATIONS), ...Object.keys(ENVELOPE_SITUATIONS)].sort();
    expect(specified).toEqual(built);
    expect(specified.length).toBeGreaterThanOrEqual(50);
  });

  for (const situation of situations) {
    describe(situation.code, () => {
      for (const actor of Object.keys(ACTORS)) {
        it(`${actor}: the buttons of the study, no more and no less`, () => {
          const resource = resourceOf(situation.code);
          const actual = availableActions(subjectOf(actor), resource, CONTEXT).map((rule) => label(rule.code));
          expect([...actual].sort()).toEqual([...(situation.expected.get(actor) ?? [])].sort());
        });
      }
    });
  }

  it('refuses through authorize() every action of the resource kind that is not listed', () => {
    const failures: string[] = [];
    for (const situation of situations) {
      const resource = resourceOf(situation.code);
      for (const actor of Object.keys(ACTORS)) {
        const subject = subjectOf(actor);
        const allowed = new Set(availableActions(subject, resource, CONTEXT).map((r) => r.code));
        for (const rule of Object.values(ACTIONS)) {
          if (rule.resourceKind !== resource.kind || allowed.has(rule.code)) continue;
          if (authorize(subject, rule.code, resource, CONTEXT).allowed) failures.push(`${situation.code} ${actor} ${rule.code}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('gives every case and envelope action a label, its confirmation lines and a legal basis', () => {
    for (const rule of Object.values(ACTIONS)) {
      if (rule.resourceKind !== 'case' && rule.resourceKind !== 'envelope') continue;
      expect(MESSAGES.ar[rule.labelKey], rule.labelKey).toBeTruthy();
      if (rule.confirm) {
        expect(MESSAGES.ar[rule.effectKey], rule.effectKey).toBeTruthy();
        expect(MESSAGES.ar[rule.notifiedKey], rule.notifiedKey).toBeTruthy();
      }
    }
  });

  it('never offers a case action to the system administrator or the legal validator', () => {
    for (const situation of situations) {
      for (const actor of ['مدبر النظام', 'المختص القانوني']) {
        expect(availableActions(subjectOf(actor), resourceOf(situation.code), CONTEXT)).toEqual([]);
      }
    }
  });
});
