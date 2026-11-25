// docs/state-machine.md carries, between two markers, the table generated from
// the declarative file packages/core/src/procedure/transitions.ts: this test
// fails when they differ. To regenerate after a change of the table:
//   UPDATE_STATE_MACHINE_DOC=1 npx vitest run --config vitest.config.ts tests/unit/state-machine-doc.test.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROCEDURE_ACTIONS, type ProcedureAction } from '@mahkama/core';
import { MESSAGES } from '@/i18n/messages';

const DOC = fileURLToPath(new URL('../../../../docs/state-machine.md', import.meta.url));
const BEGIN = '<!-- BEGIN GENERATED: transitions.ts -->';
const END = '<!-- END GENERATED: transitions.ts -->';
const ar = MESSAGES.ar;

const RELATIONS: Readonly<Record<string, string>> = {
  COUNSEL: 'ينوب عن طرف',
  SUMMONS_HOLDER: 'يحمل رمز الاستدعاء',
  RAPPORTEUR: 'المقرر في الملف',
  PANEL: 'من هيئته',
  COURT_STAFF: 'من محكمته',
  PROSECUTION: 'أحيل عليها',
  COMMISSIONER: 'أحيل عليه أمام المحكمة الإدارية',
  EXPERT: 'الخبير المعين',
  LITIGANT: 'طرف قبل التبليغ الإلكتروني',
  ADMIN_PARTY: 'إدارة طرف',
  GARNISHEE: 'المحجوز لديه',
  NEXT_SIGNER: 'حل دوره في التوقيع',
  MINUTES_SIGNER: 'حل دوره في توقيع المحضر',
  CASSATION_ACCREDITED: 'مقبول للترافع أمام محكمة النقض',
  AGENT: 'العون المكلف',
};

const label = (key: string) => ar[key] ?? key;
const cell = (text: string) => text.replaceAll('|', '\\|');

function holders(action: ProcedureAction): string {
  return action.holders
    .map((h) => {
      const roles = h.roles.map((r) => label(`roles.${r}`)).join('، ');
      const relations = h.relations.map((r) => RELATIONS[r] ?? r).join('، ');
      return relations ? `${roles} (${relations})` : roles;
    })
    .join('؛ ');
}

function render(): string {
  const rows = PROCEDURE_ACTIONS.map((a) =>
    [
      label(`actions.${a.code}.label`),
      `\`${a.code}\``,
      String(a.station),
      a.statuses.map((s) => label(`states.${s}`)).join('، '),
      holders(a),
      a.signature ? 'نعم' : '',
      a.awaited ? 'نعم' : '',
      a.nextStatus ? label(`states.${a.nextStatus}`) : '',
      a.articles.length ? `م ${a.articles.join(' و')}` : '',
    ]
      .map(cell)
      .join(' | '),
  );
  return [
    BEGIN,
    '',
    '| الزر | الرمز | المحطة | الحالات | من يملكه | التوقيع | ينتظر | الحالة الموالية | السند |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r} |`),
    '',
    END,
  ].join('\n');
}

describe('docs/state-machine.md follows transitions.ts', () => {
  it('the generated table is up to date', () => {
    const doc = readFileSync(DOC, 'utf8');
    const start = doc.indexOf(BEGIN);
    const end = doc.indexOf(END);
    const expected = render();
    if (process.env.UPDATE_STATE_MACHINE_DOC === '1') {
      const next =
        start >= 0 && end > start
          ? doc.slice(0, start) + expected + doc.slice(end + END.length)
          : `${doc.trimEnd()}\n\n## الجدول المولد من الملف التصريحي\n\n${expected}\n`;
      writeFileSync(DOC, next);
      return;
    }
    expect(start, 'the generated block is missing').toBeGreaterThanOrEqual(0);
    expect(doc.slice(start, end + END.length)).toBe(expected);
  });
});
