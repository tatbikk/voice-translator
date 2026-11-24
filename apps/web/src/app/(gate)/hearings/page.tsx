import { formatMoroccoDate, formatMoroccoTime, moroccoCalendarDate } from '@mahkama/core';
import { translator } from '@/i18n/translate';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, SelectInput, TextInput } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { PageHeader } from '@/components/ui/PageHeader';
import { Frame } from '@/components/shell/Frames';
import { clock } from '@/server/clock';
import { requireGate } from '@/server/permissions/guard';
import { hearingsOn, publicCourts, type HearingRow } from '@/server/public/service';
import type { Metadata } from 'next';
import { screenMetadata } from '@/server/page-metadata';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.hearings');

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

// «جدول الجلسات»: time, room, panel and case numbers, never a party name.
export default async function HearingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const context = await requireGate('hearings');
  const t = translator(context.locale);
  const params = await searchParams;
  const courts = await publicCourts();
  const courtId = one(params.courtId) || (courts[0]?.id ?? '');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(one(params.date)) ? one(params.date) : moroccoCalendarDate(clock.now());

  let rows: HearingRow[] | null = null;
  let error: string | null = null;
  if (courts.some((c) => c.id === courtId)) {
    const result = await hearingsOn(context.clientIdHash, courtId, date);
    if (result.kind === 'ok') rows = result.value;
    else error = result.kind === 'throttled' ? t('errors.TOO_MANY_REQUESTS') : t('hearings.outOfRange');
  } else {
    error = t('hearings.chooseCourt');
  }

  return (
    <Frame context={context}>
      <PageHeader title={t('screens.hearings')} intro={t('hearings.intro')} />
      <form method="get" action="/hearings" className="flex max-w-3xl flex-wrap items-end gap-4">
        <div className="min-w-64 flex-1">
          <Field id="courtId" label={t('terms.court')}>
            <SelectInput id="courtId" defaultValue={courtId}>
              {courts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <div>
          <Field id="date" label={t('hearings.date')}>
            <TextInput id="date" type="date" defaultValue={date} dir="ltr" />
          </Field>
        </div>
        <div className="mb-5">
          <Button type="submit">{t('hearings.submit')}</Button>
        </div>
      </form>
      <div className="mt-6">
        {error ? <Notice tone="warning">{error}</Notice> : null}
        {rows && rows.length === 0 ? <EmptyState text={t('hearings.empty')} /> : null}
        {rows && rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-line bg-paper text-start">
              <caption className="sr-only">{t('screens.hearings')}</caption>
              <thead>
                <tr className="border-b border-line bg-ink-50">
                  <th scope="col" className="px-4 py-2 text-start">{t('hearings.columns.time')}</th>
                  <th scope="col" className="px-4 py-2 text-start">{t('hearings.columns.room')}</th>
                  <th scope="col" className="px-4 py-2 text-start">{t('hearings.columns.panel')}</th>
                  <th scope="col" className="px-4 py-2 text-start">{t('hearings.columns.cases')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.startsAt.toISOString()}-${row.room}`} className="border-b border-line align-top">
                    <td className="px-4 py-2">
                      {t('common.dateTime', { date: formatMoroccoDate(row.startsAt), time: formatMoroccoTime(row.startsAt) })}
                    </td>
                    <td className="px-4 py-2">{row.room}</td>
                    <td className="px-4 py-2">{row.panelName}</td>
                    <td className="px-4 py-2">
                      <ul>
                        {row.caseNumbers.map((n) => (
                          <li key={n}>
                            <bdi dir="ltr" className="ltr-run tabular-nums">
                              {n}
                            </bdi>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </Frame>
  );
}
