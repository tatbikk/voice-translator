import { formatMoroccoDate, formatMoroccoTime, parseCaseNumberParts } from '@mahkama/core';
import { translator } from '@/i18n/translate';
import { Button } from '@/components/ui/Button';
import { Field, SelectInput, TextInput } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { PageHeader } from '@/components/ui/PageHeader';
import { Frame } from '@/components/shell/Frames';
import { requireGate } from '@/server/permissions/guard';
import { caseStatus, publicCourts } from '@/server/public/service';
import type { Metadata } from 'next';
import { screenMetadata } from '@/server/page-metadata';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.track');

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

// «تتبع الملف»: by court, number, code and year; answers with the procedural
// state and the next hearing only. A plain GET form: it works without script.
export default async function TrackPage({ searchParams }: { searchParams: Promise<Params> }) {
  const context = await requireGate('track');
  const t = translator(context.locale);
  const params = await searchParams;
  const courts = await publicCourts();
  const query = { courtId: one(params.courtId), number: one(params.number), code: one(params.code), year: one(params.year) };
  const submitted = query.courtId !== '' || query.number !== '';

  let outcome: { kind: 'none' } | { kind: 'error'; text: string } | { kind: 'found'; status: string; next: Date | null } = { kind: 'none' };
  if (submitted) {
    const number = parseCaseNumberParts(query.number, query.code, query.year);
    const court = courts.find((c) => c.id === query.courtId);
    if (!number || !court) {
      outcome = { kind: 'error', text: t('errors.INVALID_INPUT') };
    } else {
      const result = await caseStatus(context.clientIdHash, court.id, number);
      if (result.kind === 'throttled') outcome = { kind: 'error', text: t('errors.TOO_MANY_REQUESTS') };
      else if (result.kind === 'not-found') outcome = { kind: 'error', text: t('errors.CASE_NOT_FOUND') };
      else outcome = { kind: 'found', status: t(`states.${result.value.status}`), next: result.value.nextHearingAt };
    }
  }

  return (
    <Frame context={context}>
      <PageHeader title={t('screens.track')} intro={t('track.intro')} />
      <form method="get" action="/track" className="card max-w-2xl px-5 py-6 sm:px-7">
        <Field id="courtId" label={t('terms.court')}>
          <SelectInput id="courtId" defaultValue={query.courtId} required>
            <option value="" disabled>
              {t('terms.court')}
            </option>
            {courts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <p className="mb-3 text-sm text-text-muted">{t('track.hint')}</p>
        {/* The number reads left to right (number, code, year); each label stays on the right. */}
        <div className="grid grid-cols-3 gap-3" dir="ltr">
          <div dir="rtl">
            <Field id="number" label={t('terms.caseSerial')}>
              <TextInput id="number" dir="ltr" inputMode="numeric" defaultValue={query.number} maxLength={6} required />
            </Field>
          </div>
          <div dir="rtl">
            <Field id="code" label={t('terms.caseCode')}>
              <TextInput id="code" dir="ltr" inputMode="numeric" defaultValue={query.code} maxLength={4} required />
            </Field>
          </div>
          <div dir="rtl">
            <Field id="year" label={t('terms.caseYear')}>
              <TextInput id="year" dir="ltr" inputMode="numeric" defaultValue={query.year} maxLength={4} required />
            </Field>
          </div>
        </div>
        <Button type="submit">{t('track.submit')}</Button>
      </form>
      <div className="mt-8 max-w-2xl" aria-live="polite">
        {outcome.kind === 'error' ? <Notice tone="warning">{outcome.text}</Notice> : null}
        {outcome.kind === 'found' ? (
          <section aria-labelledby="track-result" className="card border-s-4 border-s-ink-800 px-5 py-5 sm:px-7">
            <h2 id="track-result" className="text-lg">
              {t('track.result.title')}
            </h2>
            <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
              <dt className="text-sm font-semibold text-text-muted">{t('track.result.status')}</dt>
              <dd className="font-medium text-ink-900">{outcome.status}</dd>
              <dt className="text-sm font-semibold text-text-muted">{t('track.result.nextHearing')}</dt>
              <dd>
                {outcome.next
                  ? t('common.dateTime', { date: formatMoroccoDate(outcome.next), time: formatMoroccoTime(outcome.next) })
                  : t('track.result.noHearing')}
              </dd>
            </dl>
          </section>
        ) : null}
      </div>
    </Frame>
  );
}
