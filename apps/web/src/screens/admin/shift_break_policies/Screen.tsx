// SPDX-License-Identifier: AGPL-3.0-only
import { Button, Card, Tag } from '@opendispatch/ui';
import { date, weekday } from '@opendispatch/ui/format';
import { getTranslations } from 'next-intl/server';
import { ChevronRight } from 'lucide-react';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { NoMatch } from '@/components/opendispatch/patterns/NoMatch';
import { RecordNotice } from '@/components/opendispatch/patterns/RecordDrawer';
import { StatStrip } from '@/components/opendispatch/patterns/StatStrip';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { daySegments, hoursOf, type RibbonSegment } from '@/components/opendispatch/ribbon-geometry';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import { TimeRibbon } from '@/components/opendispatch/TimeRibbon';
import type { ScreenProps } from '@/screens/types';
import { AddPatternButton, BreakDialog, EditBreakRuleButton, PatternDrawer, PrayerPolicyFields, RamadanSwitch, ShiftsHeader } from './ShiftsForms';
import { HoursSwitch, PatternsTable } from './ShiftsTables';
import styles from './ShiftBreakPolicies.module.css';
import { patternName, patternShortName, type BreakRow, type HoursMode, type PatternKind, type PatternRow } from './types';
import { loadShiftsView } from './view';

// Shift and Break Policies. A Server Component: it reads through lib/data with the request context ModuleRoute
// built, and passes plain data to the client files. Search, kind and status filters, sort, page, the open pattern, the week's hours
// mode and the break rule dialog live in the address (?q= ?kind= ?status= ?sort= ?page= ?pattern=<id|new> ?hours=ramadan ?break=1);
// each is checked here against an allow-list. The week strip and the break rule card draw a day with TimeRibbon (left to right in
// both languages). All shift times are assumptions; the Ramadan switch is fixed On and labelled Not applied.

const EXPORT_FILE = 'shift-patterns.csv';
const RECORD = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|new)$/i;

const addDays = (iso: string, days: number): string => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The segments of one kind of shift in one hours mode: each active pattern that runs in it, split at midnight. */
function segmentsOf(all: readonly PatternRow[], kind: PatternKind, mode: HoursMode, locale: string): RibbonSegment[] {
  return all
    .filter((p) => p.kind === kind && p.status === 'active')
    .flatMap((p) => {
      const hours = mode === 'ramadan' ? p.ramadan : p.normal;
      return hours === null ? [] : daySegments(hoursOf(hours.start), hoursOf(hours.end), patternName(p, locale), p.tone, true);
    });
}

const SWATCH = [undefined, undefined, 'sw2', 'sw3', 'sw4', 'sw5', 'sw6'] as const;

export async function ShiftBreakPoliciesScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('admin.shift_break_policies');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';

  if (state !== undefined) {
    return (
      <ScreenFrame
        def={def}
        access={access}
        state={state}
        homeHref={homeHref}
        description={m('sub')}
        actions={<ShiftsHeader canEdit={canEdit} exportFilename={EXPORT_FILE} exportHeader={[]} exportRows={undefined} />}
        emptyAction={<AddPatternButton canEdit={canEdit} variant="secondary" />}
      />
    );
  }

  const query = parseSearchParams(searchParams, {
    q: param.text(80),
    kind: param.enum(['field', 'remote']),
    status: param.enum(['active', 'draft']),
    sort: param.sort(['pattern', 'kind', 'status']),
    pattern: param.pattern(RECORD, 40),
    hours: param.enum(['normal', 'ramadan']),
    break: param.flag(),
    page: param.int(1, 1000),
  });
  const view = await loadShiftsView(ctx, { q: query.q, kind: query.kind, status: query.status, pattern: query.pattern?.toLowerCase() });
  const mode: HoursMode = query.hours ?? 'normal';
  const breakLabel = (rule: BreakRow): string => (rule.code === 'BRK-STD' ? m('brk.std') : rule.code === 'BRK-RAM' ? m('brk.ram') : locale === 'ar' && rule.nameAr ? rule.nameAr : rule.name);
  const standard = view.breaks.find((b) => b.code === 'BRK-STD') ?? view.breaks[0];
  const ramadanRule = view.breaks.find((b) => b.code === 'BRK-RAM') ?? view.breaks[1];
  const shortText = (rule: BreakRow | undefined): string => (rule === undefined ? '-' : m('brk.short', { m: rule.minutes, h: rule.afterHours }));

  const active = view.all.filter((p) => p.status === 'active');
  const running = (p: PatternRow) => (mode === 'ramadan' ? p.ramadan : p.normal) !== null;
  const legend = active.filter(running);
  const days = Array.from({ length: 7 }, (_, i) => addDays(view.today, i));
  const fieldNormal = active.filter((p) => p.kind === 'field' && p.normal !== null).length;
  const fieldRamadan = active.filter((p) => p.kind === 'field' && p.ramadan !== null).length;

  // The break rule card draws the first active field shift with its break: the shift, then the break after the hours worked.
  const sample = active.find((p) => p.kind === 'field' && p.normal !== null);
  const breakSegments: RibbonSegment[] = [];
  let breakRange: { start: number; end: number } | undefined;
  if (sample?.normal != null && standard !== undefined) {
    const from = hoursOf(sample.normal.start);
    const to = hoursOf(sample.normal.end);
    const at = from + standard.afterHours;
    breakRange = { start: from, end: to <= from ? to + 24 : to };
    breakSegments.push({ from, to: Math.min(at, breakRange.end), label: sample.name, tone: sample.tone, data: true });
    if (at < breakRange.end) {
      breakSegments.push({ from: at, to: Math.min(at + standard.minutes / 60, breakRange.end), label: m('shared.kind.break'), tone: 4 });
      if (at + standard.minutes / 60 < breakRange.end) breakSegments.push({ from: at + standard.minutes / 60, to: breakRange.end, label: sample.name, tone: sample.tone, data: true });
    }
  }

  const noMatch = <NoMatch title={m('nomatch')} clearParams={['q', 'kind', 'status']} />;
  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={view.sources}
      description={m('sub')}
      isEmpty={view.all.length === 0}
      emptyAction={<AddPatternButton canEdit={canEdit} variant="secondary" />}
      overlays={
        <>
          <PatternDrawer pattern={view.open} isNew={query.pattern?.toLowerCase() === 'new' && canEdit} canEdit={canEdit} breaks={view.breaks} codes={view.all.map((p) => p.code)} />
          <BreakDialog open={query.break === true && canEdit} canEdit={canEdit} breaks={view.breaks} />
        </>
      }
      actions={<ShiftsHeader canEdit={canEdit} exportFilename={EXPORT_FILE} exportHeader={view.exportHeader} exportRows={view.exportRows} />}
    >
      <div className={styles.stack}>
        {view.unknownPattern ? <RecordNotice param="pattern" message={m('notice.notFound')} /> : null}
        <StatStrip
          items={[
            { label: m('stat.active'), value: view.counts.active },
            { label: m('stat.draft'), value: view.counts.draft },
            { label: m('stat.breaks'), value: view.counts.breaks },
            { label: m('stat.mode'), value: m(view.ramadan.today ? 'mode.ramadan' : 'mode.normal') },
          ]}
        />
        <Card padding="none">
          <div className={`${styles.cardHead} ${styles.padded}`}>
            <h2 className={styles.cardTitle}>{m('tbl.title')}</h2>
            <Tag color="gold">{m('assumption')}</Tag>
          </div>
          <ListToolbar
            searchLabel={m('search')}
            filters={[
              { key: 'kind', label: m('f.kind'), options: [{ value: 'field', label: m('kind.field') }, { value: 'remote', label: m('kind.remote') }] },
              { key: 'status', label: t('common.status'), options: [{ value: 'active', label: m('status.active') }, { value: 'draft', label: m('status.draft') }] },
            ]}
          />
          <PatternsTable rows={view.patterns} breaks={view.breaks} caption={m('tbl.title')} canEdit={canEdit} emptyState={noMatch} exportHeader={view.exportHeader} exportRows={view.exportRows} exportFilename={EXPORT_FILE} sort={query.sort} page={query.page} />
        </Card>

        <Card padding="lg">
          <div className={styles.stack}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>{m('week.title')}</h2>
              <HoursSwitch mode={mode} />
            </div>
            <div className={styles.week}>
              {days.map((day) => (
                <div key={day} className={styles.day}>
                  <div>
                    <span className={styles.dayName}>{weekday(day, { locale })}</span> <span className={styles.muted} translate="no">{date(day, { locale })}</span>
                    <span className={styles.dayMeta} translate="no">{date(day, { locale, calendar: 'hijri' })}</span>
                  </div>
                  <ul className={styles.legend}>
                    {legend.map((p) => (
                      <li key={p.id} className={styles.legendItem}>
                        <span className={`${styles.swatch} ${styles[SWATCH[p.tone] ?? 'swatch'] ?? ''}`} />
                        <span translate="no">{patternShortName(p, locale)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className={styles.ribbons}>
              {(['field', 'remote'] as const).map((kind) => (
                <div key={kind}>
                  <span className={styles.ribbonLabel}>{m(`kind.${kind}`)}</span>
                  <TimeRibbon label={`${m(`kind.${kind}`)}: ${m(`mode.${mode}`)}`} segments={segmentsOf(view.all, kind, mode, locale)} tickEvery={4} />
                </div>
              ))}
            </div>
            <ul className={styles.legend}>
              {legend.map((p) => {
                const hours = mode === 'ramadan' ? p.ramadan : p.normal;
                return (
                  <li key={p.id} className={styles.legendItem}>
                    <span className={`${styles.swatch} ${styles[SWATCH[p.tone] ?? 'swatch'] ?? ''}`} />
                    <span translate="no">{patternShortName(p, locale)}</span>
                    <span className={styles.muted} translate="no" dir="ltr">
                      {hours === null ? '' : `${hours.start} - ${hours.end}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>

        <div className={styles.two}>
          <Card padding="lg">
            <div className={styles.stack}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>{m('brk.title')}</h2>
                <EditBreakRuleButton canEdit={canEdit} />
              </div>
              <div className={styles.kv}>
                <span className={styles.kvLabel}>{standard === undefined ? m('brk.std') : breakLabel(standard)}</span>
                <span className={styles.kvValue}>{shortText(standard)}</span>
              </div>
              {ramadanRule === undefined ? null : (
                <div className={styles.kv}>
                  <span className={styles.kvLabel}>{breakLabel(ramadanRule)}</span>
                  <span className={styles.kvValue}>{shortText(ramadanRule)}</span>
                </div>
              )}
              {breakRange === undefined ? null : <TimeRibbon label={m('brk.title')} start={Math.floor(breakRange.start)} end={Math.ceil(breakRange.end)} tickEvery={2} segments={breakSegments} />}
              <PrayerPolicyFields mode={view.prayer.mode} windowMinutes={view.prayer.windowMinutes} canEdit={canEdit} />
            </div>
          </Card>

          <Card padding="lg">
            <div className={styles.stack}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>{m('ram.title')}</h2>
                <Button variant="link" size="sm" href="/admin/leave-policy-calendar" endIcon={<ChevronRight />}>
                  {m('ram.calendar')}
                </Button>
              </div>
              <div className={styles.kv}>
                <span className={styles.kvLabel}>{view.ramadan.window === null ? m('ram.title') : m('ram.windowYear', { year: view.ramadan.window.hijriYear })}</span>
                <span className={styles.kvValue} translate="no">
                  {view.ramadan.window === null ? '-' : `${date(view.ramadan.window.from, { locale })} - ${date(view.ramadan.window.to, { locale })}`}
                </span>
              </div>
              <div className={styles.kv}>
                <span className={styles.kvLabel}>{m('ram.next')}</span>
                <span className={styles.kvValue} translate="no">
                  {view.ramadan.next === null ? '-' : date(view.ramadan.next, { locale })}
                </span>
              </div>
              <div className={styles.kv}>
                <span className={styles.kvLabel}>{m('ram.shifts.label')}</span>
                <span className={styles.kvValue}>{m('ram.shiftsCount', { ramadan: fieldRamadan, normal: fieldNormal })}</span>
              </div>
              <RamadanSwitch />
            </div>
          </Card>
        </div>
      </div>
    </ScreenFrame>
  );
}
