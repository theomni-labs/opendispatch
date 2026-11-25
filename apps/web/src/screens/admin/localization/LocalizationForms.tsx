'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Card, DescriptionList, Field, FormSection, Menu, RadioGroup, SegmentedControl, Select, Stack, Tag, Tooltip, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, RotateCcw, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ConfirmDialog } from '@/components/opendispatch/patterns/ConfirmDialog';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { ReasonSwitch } from '@/components/opendispatch/ReasonSwitch';
import { resetLocalization } from './actions';
import styles from './Localization.module.css';
import { useLocalization } from './LocalizationState';
import { previewRows } from './preview';
import { CALENDARS, DIGIT_SYSTEMS, LOCALES, TIME_ZONE, WEEK_DAYS, type CalendarChoice, type DigitSystem, type LocaleChoice, type WeekDay } from './types';

// The forms of the Localization screen: the header (Save, and More with Reset to defaults), the settings
// form and the preview. The settings are STORED AND AUDITED, NOT APPLIED: digits, calendars and the first day of
// the week follow the design system's formatter and, and the default language follows the routing of. Every
// setting carries the "Not applied" tag; the preview and the fallback preview are labelled Illustrative. A role without `edit` sees
// every control disabled with the reason.

const isChoice = <T extends string>(values: readonly T[], value: string): value is T => (values as readonly string[]).includes(value);

/** The two header actions: Save (primary) and More (Reset to defaults). The State menu of the mockup is review tooling. */
export function LocalizationHeader() {
  const m = useTranslations('admin.localization');
  const t = useTranslations();
  const { draft, dirty, canEdit, review, save } = useLocalization();
  const [confirming, setConfirming] = useState(false);
  const reset = useAdminAction(resetLocalization, { successTitle: m('toast.reset'), onSuccess: () => setConfirming(false) });
  const roReason = canEdit ? null : t('opendispatch.gate.viewOnly');
  const saveReason = roReason ?? (review ? m('need.changes') : dirty ? null : m('need.changes'));
  const items: MenuEntry[] = [
    ...(canEdit ? [] : [{ type: 'heading', label: t('opendispatch.gate.viewOnly') } as const]),
    { label: m('reset'), icon: <RotateCcw />, disabled: !canEdit || review, onSelect: () => setConfirming(true) },
  ];
  return (
    <>
      <ReasonHint reason={saveReason} visible={false}>
        <Button
          variant="primary"
          startIcon={<Save />}
          loading={save.pending}
          onClick={() => {
            if (saveReason === null) save.run(draft);
          }}
        >
          {t('common.save')}
        </Button>
      </ReasonHint>
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          reset.reset();
        }}
        onConfirm={() => reset.run()}
        title={m('resetDialog.title')}
        description={m('resetDialog.desc')}
        confirmLabel={m('resetDialog.ok')}
        pending={reset.pending}
        error={<ActionError error={reset.error} onDismiss={reset.reset} />}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The settings form
// ---------------------------------------------------------------------------------------------

function SectionTag() {
  return <StubTag kind="notApplied" />;
}

export function LocalizationForm() {
  const m = useTranslations('admin.localization');
  const t = useTranslations();
  const { draft, setDraft, canEdit, save } = useLocalization();
  const langName = useId();
  const digitsName = useId();

  return (
    <Card padding="lg">
      <Stack gap={24}>
        <FormSection title={m('lang.title')} actions={<SectionTag />}>
          <RadioGroup
            name={langName}
            aria-label={m('lang.default')}
            value={draft.default_locale}
            disabled={!canEdit}
            onChange={(next) => {
              if (isChoice(LOCALES, next)) setDraft({ ...draft, default_locale: next as LocaleChoice });
            }}
            options={LOCALES.map((lang) => ({ value: lang, label: m(`lang.${lang}`), description: m(lang === 'ar' ? 'dir.rtl' : 'dir.ltr') }))}
          />
        </FormSection>
        <FormSection title={m('num.title')} actions={<SectionTag />}>
          <RadioGroup
            name={digitsName}
            aria-label={m('num.title')}
            value={draft.digit_system}
            disabled={!canEdit}
            onChange={(next) => {
              if (isChoice(DIGIT_SYSTEMS, next)) setDraft({ ...draft, digit_system: next as DigitSystem });
            }}
            options={[
              { value: 'western', label: m('num.western'), description: <span translate="no" dir="ltr">0 1 2 3 4 5 6 7 8 9</span> },
              { value: 'arabic_indic', label: m('num.arabic'), description: <span translate="no" dir="ltr" className={styles.digits}>{'٠ ١ ٢ ٣ ٤ ٥ ٦ ٧ ٨ ٩'}</span> },
            ]}
          />
        </FormSection>
        <FormSection title={m('date.title')} actions={<SectionTag />}>
          <Stack gap={16}>
            <Field label={m('date.primary')}>
              <SegmentedControl
                ariaLabel={m('date.primary')}
                value={draft.primary_calendar}
                options={CALENDARS.map((calendar) => ({ value: calendar, label: m(`cal.${calendar}`) }))}
                onChange={(next) => {
                  if (canEdit && isChoice(CALENDARS, next)) setDraft({ ...draft, primary_calendar: next as CalendarChoice });
                }}
              />
            </Field>
            <ReasonSwitch reason={canEdit ? null : t('opendispatch.gate.viewOnly')} checked={draft.show_secondary_calendar} label={m('date.secondary')} onCheckedChange={(next) => canEdit && setDraft({ ...draft, show_secondary_calendar: next })} />
            <div className={styles.narrow}>
              <Field label={m('date.week')}>
                <Select
                  value={draft.first_day_of_week}
                  disabled={!canEdit}
                  options={WEEK_DAYS.map((day) => ({ value: day, label: m(`day.${day}`) }))}
                  onChange={(event) => {
                    if (isChoice(WEEK_DAYS, event.target.value)) setDraft({ ...draft, first_day_of_week: event.target.value as WeekDay });
                  }}
                />
              </Field>
            </div>
          </Stack>
        </FormSection>
        <FormSection title={m('tz.title')}>
          <div className={styles.narrow}>
            <Field label={m('tz.title')} hint={m('tz.fixed')}>
              <Tooltip content={m('tz.fixed')}>
                <span tabIndex={0} className={styles.fixed}>
                  <Select value={TIME_ZONE} disabled aria-label={m('tz.title')} translate="no" options={[{ value: TIME_ZONE, label: `${TIME_ZONE} (UTC+03:00)` }]} />
                </span>
              </Tooltip>
            </Field>
          </div>
        </FormSection>
        <ActionError error={save.error} onDismiss={save.reset} />
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// The preview (Illustrative)
// ---------------------------------------------------------------------------------------------

const PREVIEW_ROWS = ['date', 'datetime', 'number', 'percent', 'time', 'week'] as const;

/** The same date and number in Arabic and in English under the settings the form holds. The default language carries a tag. */
export function LocalizationPreview() {
  const m = useTranslations('admin.localization');
  const { draft } = useLocalization();
  const blocks = (['ar', 'en'] as const).map((lang) => {
    const rows = previewRows(lang, draft);
    return (
      <div key={lang} className={styles.previewBlock} data-preview={lang}>
        <div className={styles.inline}>
          <strong>{m(`lang.${lang}`)}</strong>
          {draft.default_locale === lang ? (
            <Tag color="gray">
              {m('tag.default')}
            </Tag>
          ) : null}
        </div>
        <DescriptionList
          dense
          columns={1}
          items={PREVIEW_ROWS.map((row) => ({
            label: m(`pv.${row}`),
            value: (
              <span translate="no">
                <bdi lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                  {rows[row]}
                </bdi>
              </span>
            ),
          }))}
        />
      </div>
    );
  });
  return (
    <Card padding="lg">
      <Stack gap={16}>
        <div className={styles.headRow}>
          <h2 className={styles.sectionTitle}>{m('pv.title')}</h2>
          <span className={styles.inline}>
            <IllustrativeLabel />
            <StubTag kind="notApplied" />
          </span>
        </div>
        {blocks[0]}
        <hr className={styles.rule} />
        {blocks[1]}
      </Stack>
    </Card>
  );
}
