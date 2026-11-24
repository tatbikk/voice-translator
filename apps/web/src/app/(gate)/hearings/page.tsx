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
import { TABLE } from '@/components/ui/table-style';

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
      <form method="get" action="/hearings" className="card flex max-w-3xl flex-wrap items-end gap-x-4 px-5 pt-6 pb-1 sm:px-7">
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
          <div className={TABLE.wrap}>
            <table className={TABLE.table}>
              <caption className="sr-only">{t('screens.hearings')}</caption>
              <thead>
                <tr className={TABLE.headRow}>
                  <th scope="col" className={TABLE.th}>{t('hearings.columns.time')}</th>
                  <th scope="col" className={TABLE.th}>{t('hearings.columns.room')}</th>
                  <th scope="col" className={TABLE.th}>{t('hearings.columns.panel')}</th>
                  <th scope="col" className={TABLE.th}>{t('hearings.columns.cases')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.startsAt.toISOString()}-${row.room}`} className={TABLE.row}>
                    <td className={TABLE.td}>
                      {t('common.dateTime', { date: formatMoroccoDate(row.startsAt), time: formatMoroccoTime(row.startsAt) })}
                    </td>
                    <td className={TABLE.td}>{row.room}</td>
                    <td className={TABLE.td}>{row.panelName}</td>
                    <td className={TABLE.td}>
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
