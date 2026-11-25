// SPDX-License-Identifier: AGPL-3.0-only
import { Card } from '@opendispatch/ui';
import { date, monthName, weekdayNames } from '@opendispatch/ui/format';
import { getTranslations } from 'next-intl/server';
import { assistantAvailability } from '@/components/opendispatch/assistant/availability';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { NoMatch } from '@/components/opendispatch/patterns/NoMatch';
import { RecordNotice } from '@/components/opendispatch/patterns/RecordDrawer';
import { StatStrip } from '@/components/opendispatch/patterns/StatStrip';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { AddHolidayButton, CalendarHeader, HolidayModal, PolicyForm } from './CalendarForms';
import { CalendarPanel, HolidaysTable, PrayerPanel } from './CalendarPanels';
import { EventsPanel } from './EventsPanel';
import styles from './LeavePolicyCalendar.module.css';
import { HOLIDAY_KINDS, RANGE_KINDS } from './types';
import { loadCalendarView, loadEventsView } from './view';

// Leave Policy and Calendar. A Server Component: it reads through lib/data with the request context
// ModuleRoute built, and passes plain data to the client files. Tab, calendar, month, search, type filter, the prayer day, the
// open holiday and the "Add period" dialog live in the address (?tab= ?cal= ?month= ?q= ?type= ?sort= ?page= ?date=
// ?holiday=<id|new> ?blackout=new ?ev= ?evkind= ?pay=1); each is checked here against an allow-list. The grid is MonthGrid (Gregorian and Hijri, the
// Hijri days by the Umm al-Qura calendar; the reference table covers 2026 only). Dates are the design system's formatter and
// DateInput. `?state=empty|loading|error` (demo-mode review hook) shows those states without reading data.

const TABS = ['calendar', 'holidays', 'prayer', 'policy', 'events'] as const;
const EXPORT_FILE = 'holidays.csv';
const RECORD = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|new)$/i;

export async function LeavePolicyCalendarScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('admin.leave_policy_calendar');
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
        actions={<CalendarHeader canEdit={canEdit} recomputeFrom="" exportFilename={EXPORT_FILE} exportHeader={[]} exportRows={undefined} />}
        emptyAction={<AddHolidayButton canEdit={canEdit} variant="secondary" />}
      />
    );
  }

  const query = parseSearchParams(searchParams, {
    tab: param.enum(TABS),
    cal: param.enum(['gregorian', 'hijri']),
    month: param.pattern(/^\d{4}-\d{2}$/, 7),
    q: param.text(80),
    type: param.enum(HOLIDAY_KINDS),
    sort: param.sort(['name', 'gregorian']),
    date: param.pattern(/^\d{4}-\d{2}-\d{2}$/, 10),
    holiday: param.pattern(RECORD, 40),
    blackout: param.pattern(/^new$/, 3),
    ev: param.pattern(RECORD, 40),
    evkind: param.enum(RANGE_KINDS),
    pay: param.flag(),
    page: param.int(1, 1000),
  });
  const view = await loadCalendarView(ctx, { q: query.q, type: query.type, cal: query.cal, month: query.month, date: query.date, holiday: query.holiday?.toLowerCase(), locale });
  const tab = query.tab ?? 'calendar';
  const [events, assistant] = tab === 'events' ? await Promise.all([loadEventsView(ctx, view.today), assistantAvailability(ctx)]) : [undefined, null];
  const month = view.month;

  const title = month.mode === 'hijri' ? `${(locale === 'ar' ? month.monthNameAr : month.monthNameEn) ?? ''} ${month.year}`.trim() : `${monthName(`${month.key}-01`, { locale, timeZone: 'UTC' })} ${month.year}`;
  const other = month.mode === 'hijri' ? undefined : ('hijri' as const);
  const subtitle = `${date(month.span.from, { locale, ...(other === undefined ? {} : { calendar: other }) })} - ${date(month.span.to, { locale, ...(other === undefined ? {} : { calendar: other }) })}`;

  const tabs = (
    <UrlTabs
      id="lc"
      ariaLabel={m('tabs.label')}
      defaultTab="calendar"
      resetParams={['q', 'sort', 'holiday', 'type', 'blackout', 'ev', 'evkind', 'pay']}
      tabs={[
        { value: 'calendar', label: m('tab.calendar') },
        { value: 'holidays', label: m('tab.holidays'), count: view.counts.holidays },
        { value: 'prayer', label: m('tab.prayer') },
        { value: 'policy', label: m('tab.policy') },
        { value: 'events', label: m('tab.events') },
      ]}
    />
  );

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={view.sources}
      description={m('sub')}
      isEmpty={view.holidays.length === 0}
      emptyAction={<AddHolidayButton canEdit={canEdit} variant="secondary" />}
      overlays={<HolidayModal holiday={view.openHoliday} isNew={query.holiday?.toLowerCase() === 'new' && canEdit} canEdit={canEdit} today={view.today} />}
      tabs={tabs}
      actions={<CalendarHeader canEdit={canEdit} recomputeFrom={view.prayer.date} exportFilename={EXPORT_FILE} exportHeader={view.exportHeader} exportRows={view.exportRows} />}
    >
      <div className={styles.stack}>
        {view.unknownHoliday ? <RecordNotice param="holiday" message={m('notice.notFound')} /> : null}
        <StatStrip
          items={[
            { label: m('stat.holidays'), value: view.counts.holidays },
            { label: m('stat.ramadan'), value: view.counts.ramadanDays },
            { label: m('stat.national'), value: view.counts.daysToNationalDay ?? '-' },
            { label: m('stat.cities'), value: view.counts.cities },
          ]}
        />
        <TabPanel id="lc" value={tab}>
          {tab === 'calendar' ? (
            <CalendarPanel month={month} ramadan={view.ramadan} title={title} subtitle={subtitle} weekdays={weekdayNames({ locale })} />
          ) : tab === 'holidays' ? (
            <Card padding="none">
              <ListToolbar searchLabel={m('search')} filters={[{ key: 'type', label: m('col.type'), options: HOLIDAY_KINDS.map((kind) => ({ value: kind, label: m(`kind.${kind}`) })) }]} />
              <HolidaysTable rows={view.shownHolidays} caption={m('tab.holidays')} emptyState={<NoMatch title={m('nomatch')} clearParams={['q', 'type']} />} sort={query.sort} page={query.page} />
            </Card>
          ) : tab === 'prayer' ? (
            <PrayerPanel date={view.prayer.date} prev={view.prayer.prev} next={view.prayer.next} rows={view.prayer.rows} storedRange={view.prayer.storedRange} />
          ) : tab === 'events' && events !== undefined ? (
            <EventsPanel view={events} canEdit={canEdit} openId={query.ev?.toLowerCase()} openKind={query.evkind} payOpen={query.pay === true} assist={assistant === null ? null : { configured: assistant.configured, allowed: assistant.eventNotice }} />
          ) : (
            <Card padding="lg">
              <PolicyForm policy={view.policy} canEdit={canEdit} periodOpen={query.blackout === 'new' && canEdit} />
            </Card>
          )}
        </TabPanel>
      </div>
    </ScreenFrame>
  );
}
