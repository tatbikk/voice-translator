'use client';

import { useState } from 'react';
import { filerCounselByDefault, withPersonKind, type CardSection, type FilingCard } from '@mahkama/core';
import { apiGet } from '@/components/client/api';
import { Button } from '@/components/ui/Button';
import { CONTROL, Check, Choice, Field, type StepProps } from './parts';

// 3. «بطاقة الدعوى» (art. 77): the parties, the summary and the claims, typed by
// hand (decision 54); a company's data may be fetched from the commercial
// register by its full number. Each section is attested «مطابق للمقال»; the
// attestation holds as long as the section is unchanged. On the electronic
// channel a party that becomes a plaintiff starts with «ينوب المحامي المودع عن
// هذا الطرف» ticked (decision 67): the lawyer unticks the plaintiff, among
// several, who keeps another counsel. A natural person's address is his
// «الموطن» or his «محل الإقامة», with its locality (decision 69); a company's
// office keeps the register's locality only while it is the register's.

type Party = FilingCard['parties'][number];
type Claim = FilingCard['claims'][number];

const SIDES = ['PLAINTIFF', 'DEFENDANT', 'GUARANTOR'] as const;
const PERSON_KINDS = ['NATURAL', 'LEGAL', 'PUBLIC'] as const;
const PUBLIC_KINDS = ['STATE', 'LOCAL_AUTHORITY', 'PUBLIC_ESTABLISHMENT', 'OTHER_PUBLIC', 'STATE_JUDICIAL_AGENT', 'LOCAL_AUTHORITIES_AGENT'] as const;
const NATURES = ['DEBT', 'DAMAGES', 'LEGAL_INTEREST', 'PROVISIONAL_ENFORCEMENT', 'COSTS', 'OTHER'] as const;
const CAPACITIES = ['FULL', 'INCAPABLE', 'ABSENT'] as const;
const SECTIONS: readonly CardSection[] = ['PLAINTIFFS', 'DEFENDANTS', 'SUMMARY', 'CLAIMS'];

interface RegisterAnswer {
  readonly entry: {
    readonly number: string;
    readonly name: string;
    readonly legalForm: string | null;
    readonly legalRepresentative: string | null;
    readonly registeredOffice: string | null;
    readonly locality: string | null;
    readonly branch: string | null;
    readonly email: string | null;
  } | null;
  readonly source: { readonly implementation: 'real' | 'simulated'; readonly nameKey: string };
}

/** The next free key of a list («p1»، «p2»…): no clock, no randomness. */
function nextKey(prefix: string, keys: readonly string[]): string {
  let n = keys.length + 1;
  while (keys.includes(`${prefix}${String(n)}`)) n += 1;
  return `${prefix}${String(n)}`;
}

/** «48.600» or «48600,50» typed in dirhams, as centimes; null when empty or unreadable. */
function centsOf(text: string): number | null {
  const normalized = text.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (normalized === '') return null;
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
}

const dirhamsOf = (cents: number | null) => (cents === null ? '' : String(cents / 100));

export function CardStep({ view, t, busy, update }: StepProps) {
  const channel = view.draft.channel;
  const [parties, setParties] = useState<Party[]>(view.draft.card.parties.length > 0 ? [...view.draft.card.parties] : [blankParty([], channel)]);
  const [summary, setSummary] = useState(view.draft.card.summary);
  const [claims, setClaims] = useState<Claim[]>(view.draft.card.claims.length > 0 ? [...view.draft.card.claims] : [blankClaim([])]);
  const [amounts, setAmounts] = useState<string[]>(claims.map((c) => dirhamsOf(c.amountCents)));
  const [attested, setAttested] = useState<Set<CardSection>>(new Set(view.draft.attestations));
  const [sources, setSources] = useState<Record<string, string>>({});
  const [lookupError, setLookupError] = useState<Record<string, string>>({});
  const locked = view.claimsLocked;
  const paper = channel === 'PAPER';

  // A section changed is no longer attested: its box is ticked again after checking it
  // against the application (decision 54, audit G018).
  const unattest = (...sections: CardSection[]) => {
    setAttested((set) => {
      if (!sections.some((s) => set.has(s))) return set;
      const next = new Set(set);
      for (const s of sections) next.delete(s);
      return next;
    });
  };
  const sectionOf = (side: Party['side']): CardSection => (side === 'PLAINTIFF' ? 'PLAINTIFFS' : 'DEFENDANTS');
  const setParty = (index: number, patch: Partial<Party>) => {
    const before = parties[index];
    if (before) unattest(sectionOf(before.side), sectionOf(patch.side ?? before.side));
    setParties((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };
  const setClaim = (index: number, patch: Partial<Claim>) => {
    unattest('CLAIMS');
    setClaims((list) => list.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };
  // Whether the address of a natural person is his residence, not his domicile (G012): a card read
  // again shows the choice it was saved with.
  const [residents, setResidents] = useState<ReadonlySet<string>>(() => new Set(view.draft.card.parties.filter((p) => p.residence && !p.domicile).map((p) => p.key)));
  const placeFieldOf = (party: Party): PlaceField => (residents.has(party.key) ? 'residence' : 'domicile');
  /** The other choice: the address typed goes with it, and an address of the other kind takes its place. */
  const chooseKind = (index: number, field: PlaceField) => {
    const party = parties[index];
    if (!party || placeFieldOf(party) === field) return;
    setResidents((set) => {
      const next = new Set(set);
      if (field === 'residence') next.add(party.key);
      else next.delete(party.key);
      return next;
    });
    setParty(index, { domicile: party.residence, residence: party.domicile });
  };
  const fromRegister = (address: Party['domicile']) =>
    address?.source === 'COMMERCIAL_REGISTER' ? <p className="-mt-3 mb-4 text-sm text-text-muted">{t('filing.card.addressFromRegister')}</p> : null;

  const lookup = async (index: number) => {
    const party = parties[index];
    if (!party?.idNumber) return;
    const res = await apiGet<RegisterAnswer>(`/api/v1/registers/commercial?number=${encodeURIComponent(party.idNumber)}`, { csrf: true });
    // Every answer of the register carries its source, «مصدر محاكى» included when nothing is found (prompt, «السجلات»).
    if (res.ok) setSources((s) => ({ ...s, [party.key]: res.data.source.implementation === 'simulated' ? t('registers.simulatedSource') : t(res.data.source.nameKey) }));
    if (!res.ok || !res.data.entry) {
      setLookupError((e) => ({ ...e, [party.key]: t(res.ok ? 'filing.card.register.notFound' : 'errors.UNAVAILABLE') }));
      return;
    }
    const entry = res.data.entry;
    setLookupError((e) => ({ ...e, [party.key]: '' }));
    setParty(index, {
      name: entry.name,
      idNumber: entry.number,
      ...(entry.legalForm ? { legalForm: entry.legalForm } : {}),
      ...(entry.legalRepresentative ? { legalRepresentative: entry.legalRepresentative } : {}),
      ...(entry.registeredOffice
        ? { registeredOffice: { value: entry.registeredOffice, source: 'COMMERCIAL_REGISTER', ...(entry.locality ? { locality: entry.locality } : {}) } }
        : {}),
      ...(entry.branch ? { branch: { value: entry.branch, source: 'COMMERCIAL_REGISTER' } } : {}),
      ...(entry.email && !party.email ? { email: entry.email } : {}),
    });
  };

  const save = async () => {
    const card = {
      parties,
      summary,
      claims: claims.map((c, i) => ({ ...c, amountCents: centsOf(amounts[i] ?? '') })),
    };
    await update({ card, attest: SECTIONS.filter((s) => attested.has(s)) });
  };

  return (
    <div>
      <p className="mb-5 text-text-muted">{t('filing.card.intro')}</p>

      <h3 className="mb-3 text-lg font-semibold">{t('filing.card.parties')}</h3>
      {parties.map((party, index) => (
        <fieldset key={party.key} className="mb-6 rounded border border-line px-4 py-4">
          <legend className="px-1 font-semibold">{t('filing.card.party', { n: index + 1 })}</legend>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Field id={`${party.key}-side`} label={t('filing.card.side')}>
              <select
                id={`${party.key}-side`}
                className={CONTROL}
                value={party.side}
                onChange={(e) => {
                  const side = e.target.value as Party['side'];
                  // What belongs to a plaintiff alone does not follow a party to another side; and a party
                  // that becomes a plaintiff takes the default of a new plaintiff (decision 67).
                  setParty(index, side === 'PLAINTIFF' ? { side, ...counselDefault(channel, side) } : { side, representedByFiler: false, agent: undefined });
                }}
              >
                {SIDES.map((s) => (
                  <option key={s} value={s}>
                    {t(`filing.card.sides.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${party.key}-kind`} label={t('filing.card.personKind')}>
              <select
                id={`${party.key}-kind`}
                className={CONTROL}
                value={party.personKind}
                onChange={(e) => {
                  const personKind = e.target.value as Party['personKind'];
                  // What the card no longer shows for the new kind does not stay hidden with it: capacity, the
                  // public kind, and the addresses of another kind, which would be registered with their place
                  // and decide the time to appear (fix review M2; review of IR-08).
                  unattest(sectionOf(party.side));
                  setParties((list) => list.map((p, i) => (i === index ? withPersonKind(p, personKind) : p)));
                  // A natural person again starts with «الموطن» chosen, his addresses gone.
                  if (personKind !== 'NATURAL') setResidents((set) => (set.has(party.key) ? new Set([...set].filter((k) => k !== party.key)) : set));
                }}
              >
                {PERSON_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`filing.card.personKinds.${k}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {party.personKind === 'LEGAL' ? (
            <div className="mb-5">
              <Field id={`${party.key}-rc`} label={t('filing.card.registerNumber')}>
                <input id={`${party.key}-rc`} className={CONTROL} dir="ltr" value={party.idNumber ?? ''} onChange={(e) => { setParty(index, { idNumber: e.target.value }); }} />
              </Field>
              <Button variant="secondary" disabled={busy || !party.idNumber} onClick={() => void lookup(index)}>
                {t('filing.card.register.lookup')}
              </Button>
              {sources[party.key] ? <p className="mt-2 inline-block rounded-full border border-line-strong px-2.5 py-0.5 text-sm text-text-muted">{sources[party.key]}</p> : null}
              <p aria-live="polite" className={lookupError[party.key] ? 'mt-2 text-sm text-elapsed' : 'sr-only'}>
                {lookupError[party.key] ?? ''}
              </p>
            </div>
          ) : null}

          <div className="grid gap-x-6 sm:grid-cols-2">
            <Field id={`${party.key}-name`} label={t('filing.card.name')}>
              <input id={`${party.key}-name`} className={CONTROL} value={party.name} onChange={(e) => { setParty(index, { name: e.target.value }); }} />
            </Field>
            <Field id={`${party.key}-quality`} label={t('filing.card.quality')}>
              <input id={`${party.key}-quality`} className={CONTROL} value={party.quality ?? ''} onChange={(e) => { setParty(index, { quality: e.target.value }); }} />
            </Field>
            {party.personKind === 'NATURAL' ? (
              <>
                <Field id={`${party.key}-id`} label={t('filing.card.idNumber')}>
                  <input id={`${party.key}-id`} className={CONTROL} dir="ltr" value={party.idNumber ?? ''} onChange={(e) => { setParty(index, { idNumber: e.target.value }); }} />
                </Field>
                <Field id={`${party.key}-capacity`} label={t('filing.card.capacityStatus')} hint={t('filing.card.capacityHint')}>
                  <select
                    id={`${party.key}-capacity`}
                    className={CONTROL}
                    value={party.capacityStatus ?? ''}
                    onChange={(e) => { setParty(index, { capacityStatus: e.target.value === '' ? undefined : (e.target.value as Party['capacityStatus']) }); }}
                  >
                    <option value="">{t('filing.choose')}</option>
                    {CAPACITIES.map((c) => (
                      <option key={c} value={c}>
                        {t(`filing.card.capacities.${c}`)}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            ) : null}
            {party.personKind === 'LEGAL' ? (
              <Field id={`${party.key}-form`} label={t('filing.card.legalForm')}>
                <input id={`${party.key}-form`} className={CONTROL} value={party.legalForm ?? ''} onChange={(e) => { setParty(index, { legalForm: e.target.value }); }} />
              </Field>
            ) : null}
            {party.personKind !== 'NATURAL' ? (
              <Field id={`${party.key}-rep`} label={t('filing.card.legalRepresentative')}>
                <input id={`${party.key}-rep`} className={CONTROL} value={party.legalRepresentative ?? ''} onChange={(e) => { setParty(index, { legalRepresentative: e.target.value }); }} />
              </Field>
            ) : null}
            {party.personKind === 'PUBLIC' ? (
              // Required to pay and to file (decision 66): the card is saved without it, and the check before signature blocks.
              <Field id={`${party.key}-public`} label={t('filing.card.requiredField', { label: t('filing.card.publicEntityKind') })} hint={t('filing.card.publicEntityKindHint')}>
                <select
                  id={`${party.key}-public`}
                  className={CONTROL}
                  required
                  value={party.publicEntityKind ?? ''}
                  onChange={(e) => { setParty(index, { publicEntityKind: e.target.value === '' ? undefined : (e.target.value as Party['publicEntityKind']) }); }}
                >
                  <option value="">{t('filing.choose')}</option>
                  {PUBLIC_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`filing.card.publicKinds.${k}`)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>

          {party.personKind === 'NATURAL' ? (
            <NaturalPersonAddress
              party={party}
              field={placeFieldOf(party)}
              localities={view.localities}
              t={t}
              onKind={(field) => { chooseKind(index, field); }}
              onAddress={(field, address) => { setParty(index, field === 'residence' ? { residence: address } : { domicile: address }); }}
            />
          ) : (
            <>
              <Field id={`${party.key}-office`} label={t('filing.card.registeredOffice')}>
                <input
                  id={`${party.key}-office`}
                  className={CONTROL}
                  value={party.registeredOffice?.value ?? ''}
                  onChange={(e) => { setParty(index, { registeredOffice: typedOffice(e.target.value) }); }}
                />
              </Field>
              {fromRegister(party.registeredOffice)}
              {/* The branch is shown, and may be corrected or cleared, before the section is attested (audit G016). */}
              <Field id={`${party.key}-branch`} label={t('filing.card.branch')}>
                <input
                  id={`${party.key}-branch`}
                  className={CONTROL}
                  value={party.branch?.value ?? ''}
                  onChange={(e) => { setParty(index, { branch: e.target.value.trim() === '' ? undefined : typedOffice(e.target.value) }); }}
                />
              </Field>
              {fromRegister(party.branch)}
            </>
          )}

          {party.side === 'PLAINTIFF' ? (
            <div className="grid gap-x-6 sm:grid-cols-2">
              <Field id={`${party.key}-agent`} label={t('filing.card.agentName')} hint={t('filing.card.agentHint')}>
                <input
                  id={`${party.key}-agent`}
                  className={CONTROL}
                  value={party.agent?.name ?? ''}
                  onChange={(e) => { setParty(index, { agent: e.target.value.trim() === '' && !party.agent?.address ? undefined : { name: e.target.value, ...(party.agent?.address ? { address: party.agent.address } : {}) } }); }}
                />
              </Field>
              <Field id={`${party.key}-agentAddress`} label={t('filing.card.agentAddress')}>
                <input
                  id={`${party.key}-agentAddress`}
                  className={CONTROL}
                  value={party.agent?.address ?? ''}
                  onChange={(e) => { setParty(index, { agent: { name: party.agent?.name ?? '', address: e.target.value } }); }}
                />
              </Field>
            </div>
          ) : null}

          <div className="grid gap-x-6 sm:grid-cols-2">
            <Field id={`${party.key}-email`} label={t('filing.card.email')}>
              <input id={`${party.key}-email`} type="email" dir="ltr" className={CONTROL} value={party.email ?? ''} onChange={(e) => { setParty(index, { email: e.target.value }); }} />
            </Field>
            <Field id={`${party.key}-phone`} label={t('filing.card.phone')}>
              <input id={`${party.key}-phone`} type="tel" dir="ltr" className={CONTROL} value={party.phone ?? ''} onChange={(e) => { setParty(index, { phone: e.target.value }); }} />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            {party.side !== 'PLAINTIFF' ? null : (
              <Check checked={party.representedByFiler === true} onChange={(checked) => { setParty(index, { representedByFiler: checked }); }} label={t(paper ? 'filing.card.representedByPaperLawyer' : 'filing.card.representedByFiler')} />
            )}
            {parties.length > 1 ? (
              <Button
                variant="quiet"
                onClick={() => {
                  unattest(sectionOf(party.side));
                  setParties((list) => list.filter((_, i) => i !== index));
                  // A party added later may take the key again: it starts with «الموطن» chosen.
                  setResidents((set) => (set.has(party.key) ? new Set([...set].filter((k) => k !== party.key)) : set));
                }}
              >
                {t('filing.card.removeParty', { n: index + 1 })}
              </Button>
            ) : null}
          </div>
        </fieldset>
      ))}
      <Button variant="secondary" onClick={() => { unattest('DEFENDANTS'); setParties((list) => [...list, blankParty(list.map((p) => p.key), channel)]); }}>
        {t('filing.card.addParty')}
      </Button>

      <h3 className="mt-8 mb-3 text-lg font-semibold">{t('filing.card.section.SUMMARY')}</h3>
      <Field id="summary" label={t('filing.card.summary')}>
        <textarea id="summary" rows={6} className={CONTROL} value={summary} onChange={(e) => { unattest('SUMMARY'); setSummary(e.target.value); }} />
      </Field>

      <h3 className="mt-8 mb-3 text-lg font-semibold">{t('filing.card.section.CLAIMS')}</h3>
      {locked ? <p className="mb-4 text-text-muted">{t('filing.card.claimsLocked')}</p> : null}
      {claims.map((claim, index) => (
        <fieldset key={claim.key} className="mb-4 rounded border border-line px-4 py-4">
          <legend className="px-1 font-semibold">{t('filing.card.claim', { n: index + 1 })}</legend>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Field id={`${claim.key}-nature`} label={t('filing.card.claimNature')}>
              <select id={`${claim.key}-nature`} className={CONTROL} disabled={locked} value={claim.nature} onChange={(e) => { setClaim(index, { nature: e.target.value as Claim['nature'] }); }}>
                {NATURES.map((n) => (
                  <option key={n} value={n}>
                    {t(`case.claims.nature.${n}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${claim.key}-amount`} label={t('filing.card.amount')} hint={t('filing.card.amountHint')}>
              <input
                id={`${claim.key}-amount`}
                inputMode="decimal"
                dir="ltr"
                className={CONTROL}
                disabled={locked}
                value={amounts[index] ?? ''}
                onChange={(e) => { unattest('CLAIMS'); setAmounts((list) => list.map((a, i) => (i === index ? e.target.value : a))); }}
              />
            </Field>
          </div>
          <Field id={`${claim.key}-description`} label={t('filing.card.claimDescription')}>
            <input
              id={`${claim.key}-description`}
              className={CONTROL}
              disabled={locked}
              value={claim.description ?? ''}
              onChange={(e) => { setClaim(index, { description: e.target.value.trim() === '' ? undefined : e.target.value }); }}
            />
          </Field>
          {claims.length > 1 && !locked ? (
            <Button
              variant="quiet"
              onClick={() => {
                unattest('CLAIMS');
                setClaims((list) => list.filter((_, i) => i !== index));
                setAmounts((list) => list.filter((_, i) => i !== index));
              }}
            >
              {t('filing.card.removeClaim', { n: index + 1 })}
            </Button>
          ) : null}
        </fieldset>
      ))}
      {locked ? null : (
        <Button
          variant="secondary"
          onClick={() => {
            unattest('CLAIMS');
            setClaims((list) => [...list, blankClaim(list.map((c) => c.key))]);
            setAmounts((list) => [...list, '']);
          }}
        >
          {t('filing.card.addClaim')}
        </Button>
      )}

      <fieldset className="mt-8 mb-6 rounded border border-line px-4 py-4">
        <legend className="px-1 font-semibold">{t('filing.card.attestation')}</legend>
        <p className="mb-2 text-sm text-text-muted">{t('filing.card.attestationHint')}</p>
        <div className="flex flex-col">
          {SECTIONS.map((section) => (
            <Check
              key={section}
              checked={attested.has(section)}
              onChange={(checked) => {
                setAttested((set) => {
                  const next = new Set(set);
                  if (checked) next.add(section);
                  else next.delete(section);
                  return next;
                });
              }}
              label={t('filing.card.conforms', { section: t(`filing.card.section.${section}`) })}
            />
          ))}
        </div>
      </fieldset>

      <Button disabled={busy} onClick={() => void save()}>
        {t('filing.save')}
      </Button>
    </div>
  );
}

type Address = NonNullable<Party['domicile']>;
type PlaceField = 'domicile' | 'residence';
const PLACE_FIELDS: readonly PlaceField[] = ['domicile', 'residence'];
const PLACE_KINDS: Readonly<Record<PlaceField, 'DOMICILE' | 'RESIDENCE'>> = { domicile: 'DOMICILE', residence: 'RESIDENCE' };
/** The choice «خارج تراب المملكة» of the list of localities: never a locality code, which starts with a letter. */
const ABROAD = '@abroad';

/** A natural person's address as typed: declared by the lawyer, with the place the form shows beside it. */
function declared(address: Party['domicile'], value: string): Address {
  return { ...(address ?? { source: 'DECLARED' as const }), value, source: 'DECLARED' };
}

/**
 * An office or a branch as typed: declared, with no place. The form offers no locality for it, and the
 * register's locality does not stay hidden with an office the lawyer typed again, nor decide whether it
 * lies within the court's district (decision 69; review of IR-08).
 */
const typedOffice = (value: string): Address => ({ value, source: 'DECLARED' });

/** The address in the place chosen: a locality of the list, outside the Kingdom (its country typed next), or none. */
function placed(address: Party['domicile'], place: string): Address {
  const { locality: _locality, country, ...rest } = declared(address, address?.value ?? '');
  if (place === '') return rest;
  if (place === ABROAD) return { ...rest, country: country ?? '' };
  return { ...rest, locality: place };
}

/**
 * The address of a natural person: «الموطن» or «محل الإقامة» (art. 77), each kept as what it is
 * (G012), with its locality from the list of the first screen, or outside the Kingdom with its
 * country (arts. 88 and 89; independent review IR-08).
 */
function NaturalPersonAddress({
  party,
  field,
  localities,
  t,
  onKind,
  onAddress,
}: {
  party: Party;
  field: PlaceField;
  localities: readonly string[];
  t: StepProps['t'];
  onKind: (field: PlaceField) => void;
  onAddress: (field: PlaceField, address: Address) => void;
}) {
  const address = party[field];
  const place = address?.country !== undefined ? ABROAD : (address?.locality ?? '');
  return (
    <>
      <fieldset className="mb-5">
        <legend className="mb-2 font-medium">{t('filing.card.domicile')}</legend>
        <div className="flex flex-wrap gap-6">
          {PLACE_FIELDS.map((f) => (
            <Choice key={f} name={`${party.key}-addressKind`} checked={field === f} onChange={() => { onKind(f); }} label={t(`filing.card.addressKinds.${PLACE_KINDS[f]}`)} />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-x-6 sm:grid-cols-2">
        <Field id={`${party.key}-address`} label={t('filing.card.address')}>
          <input id={`${party.key}-address`} className={CONTROL} value={address?.value ?? ''} onChange={(e) => { onAddress(field, declared(address, e.target.value)); }} />
        </Field>
        <Field id={`${party.key}-locality`} label={t('filing.card.locality')} hint={t('filing.card.localityHint')}>
          <select id={`${party.key}-locality`} className={CONTROL} value={place} onChange={(e) => { onAddress(field, placed(address, e.target.value)); }}>
            <option value="">{t('filing.choose')}</option>
            {localities.map((code) => (
              <option key={code} value={code}>
                {t(`localities.${code}`)}
              </option>
            ))}
            <option value={ABROAD}>{t('filing.card.abroad')}</option>
          </select>
        </Field>
        {place === ABROAD ? (
          // Required: an address outside the Kingdom names its country, or the card is refused (review of IR-08).
          <Field id={`${party.key}-country`} label={t('filing.card.requiredField', { label: t('filing.card.country') })}>
            <input id={`${party.key}-country`} className={CONTROL} required value={address?.country ?? ''} onChange={(e) => { onAddress(field, { ...declared(address, address?.value ?? ''), country: e.target.value }); }} />
          </Field>
        ) : null}
      </div>
    </>
  );
}

/** The box «ينوب المحامي المودع عن هذا الطرف» of a party new to its side: ticked where the core says so, absent otherwise. */
function counselDefault(channel: 'ELECTRONIC' | 'PAPER', side: Party['side']): Pick<Party, 'representedByFiler'> {
  return filerCounselByDefault(channel, side) ? { representedByFiler: true } : {};
}

function blankParty(keys: readonly string[], channel: 'ELECTRONIC' | 'PAPER'): Party {
  const side = keys.length === 0 ? 'PLAINTIFF' : 'DEFENDANT';
  return { key: nextKey('p', keys), side, personKind: 'LEGAL', name: '', ...counselDefault(channel, side) };
}

function blankClaim(keys: readonly string[]): Claim {
  return { key: nextKey('c', keys), nature: 'DEBT', amountCents: null };
}
