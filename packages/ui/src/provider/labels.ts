// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The components' own text. A label is a string with {name} placeholders, or a function for text that needs
 * plural rules. The application passes its translations to <DesignSystemProvider labels>; a key it leaves out
 * falls back to the English below, and a key that exists nowhere shows as the key itself.
 */

export type LabelParams = Readonly<Record<string, string | number>>;
export type LabelValue = string | ((params: LabelParams) => string);
export type LabelMap = Readonly<Record<string, LabelValue>>;
export type LabelKey = string;
export type LabelFn = (key: LabelKey, params?: LabelParams) => string;

const plural = (n: unknown, one: string, other: string): string => (Number(n) === 1 ? one : other);

export const DEFAULT_LABELS: LabelMap = {
  // overlays
  'combobox.placeholder': 'Select…',
  'combobox.empty': 'No matches',
  'combobox.show': 'Show options',
  'combobox.hide': 'Hide options',
  'drawer.close': 'Close',
  'modal.close': 'Close',
  'tabs.sections': 'Sections',
  'toast.region': 'Notifications',
  'toast.dismiss': 'Dismiss notification',
  'toast.dismissTitle': 'Dismiss',
  // data and forms
  'dataTable.bulkActions': 'Bulk actions',
  'dataTable.selectAllRows': 'Select all rows on this page',
  'dataTable.deselectAllRows': 'Deselect all rows on this page',
  'dataTable.selectedCount': '{n} selected',
  'dataTable.clearSelection': 'Clear',
  'dataTable.selectRow': 'Select row {id}',
  'dataTable.emptyTitle': 'No records found',
  'dataTable.emptyDescription': 'Try adjusting your search or filters.',
  'pagination.label': 'Pagination',
  'pagination.range': '{from} to {to} of {total}',
  'pagination.pageOf': 'Page {page} of {pages}',
  'pagination.compact': '{page} / {pages}',
  'pagination.pageSize': 'Rows per page',
  'pagination.previous': 'Previous page',
  'pagination.next': 'Next page',
  'pagination.goToPage': 'Page {page}',
  'filterBar.filteredBy': 'Filtered by',
  'filterBar.removeFilter': 'Remove filter {label}',
  'filterBar.clearAll': 'Clear all',
  'filterBar.clearFilter': 'Clear',
  'fileDrop.dropToUpload': 'Drop to upload',
  'fileDrop.promptOne': 'Drag a file here or',
  'fileDrop.promptMany': 'Drag files here or',
  'fileDrop.browse': 'browse',
  'fileDrop.selectedFiles': 'Selected files',
  'fileDrop.remove': 'Remove {name}',
  'fileDrop.sizeBytes': '{size} B',
  'fileDrop.sizeKb': '{size} KB',
  'fileDrop.sizeMb': '{size} MB',
  'fileDrop.rejectType': '{name} is not an accepted file type.',
  'fileDrop.rejectSize': '{name} is larger than {max}.',
  'fileDrop.dismiss': 'Dismiss message',
  'formFooter.label': 'Form actions',
  'formFooter.unsaved': 'Unsaved changes',
  'formFooter.clean': 'No unsaved changes',
  'quantityInput.decrease': 'Decrease',
  'quantityInput.increase': 'Increase',
  'searchInput.placeholder': 'Search',
  'searchInput.clear': 'Clear search',
  'field.optional': '(optional)',
  'breadcrumbs.label': 'Breadcrumb',
  'pageHeader.back': 'Back',
  // display
  'alert.dismiss': 'Dismiss',
  'avatar.more': '{n} more',
  'tag.remove': 'Remove {name}',
  'tag.removeGeneric': 'Remove',
  'stepper.completed': '(completed)',
  'skeleton.loading': 'Loading',
  'descriptionList.empty': '\u2014',
  // charts
  'chart.noData': 'No data',
  'chart.titled': '{title}. {summary}',
  'chart.listSeparator': ', ',
  'chart.compactThousand': '{n}K',
  'chart.compactMillion': '{n}M',
  'chartLegend.label': 'Legend',
  'lineChart.summary': (p) =>
    `Line chart of ${String(p['series'])} across ${String(p['count'])} ${plural(p['count'], 'point', 'points')} from ${String(
      p['first'],
    )} to ${String(p['last'])}, values from ${String(p['min'])} to ${String(p['max'])}.`,
  'lineChart.markers': 'Markers: {markers}.',
  'lineChart.band': 'Likely range',
  'lineChart.bandValue': '{low} to {high}',
  'barChart.summary': (p) => {
    const kind = Number(p['stacked']) === 1 ? 'Stacked' : 'Grouped';
    const direction = Number(p['horizontal']) === 1 ? ' horizontal' : '';
    const categories = `${String(p['categories'])} ${plural(p['categories'], 'category', 'categories')}`;
    const count = Number(p['seriesCount']);
    const names = String(p['names']);
    const series = count <= 1 ? ` for ${names}` : ` and ${String(count)} series (${names})`;
    return `${kind}${direction} bar chart of ${categories}${series}, values from ${String(p['min'])} to ${String(p['max'])}.`;
  },
  'barChart.total': 'Total',
  'donutChart.summary': 'Donut chart, total {total}: {items}.',
  'donutChart.item': '{label} {value} ({percent})',
  'donutChart.empty': 'Donut chart, no data.',
  'sparkline.summary': (p) =>
    `Trend of ${String(p['count'])} ${plural(p['count'], 'point', 'points')}, low ${String(p['min'])}, high ${String(
      p['max'],
    )}, latest ${String(p['latest'])}.`,
  'heatGrid.summary': (p) =>
    `Heat grid of ${String(p['rows'])} ${plural(p['rows'], 'row', 'rows')} by ${String(p['columns'])} ${plural(
      p['columns'],
      'column',
      'columns',
    )}, values ${String(p['min'])} to ${String(p['max'])}.`,
  'heatGrid.cell': '{row}, {column}: {value}',
  'heatGrid.cellKind': '{row}, {column}: {value}, {kind}',
  'heatGrid.cellNoValue': '{row}, {column}: no value',
  'heatGrid.kindGap': 'Gap',
  'heatGrid.kindSurplus': 'Surplus',
  'heatGrid.kindOk': 'Balanced',
  // shell
  'railShell.nav': 'Main navigation',
  'railShell.skip': 'Skip to main content',
  'railShell.menuOpen': 'Open menu',
  'railShell.notifications': 'Notifications',
  'railShell.notificationsUnread': (p) => `Notifications: ${String(p['count'])} unread`,
  'commandPalette.placeholder': 'Search',
  'commandPalette.results': 'Search results',
  'commandPalette.empty': 'No results',
  'commandPalette.count': (p) => `${String(p['count'])} ${plural(p['count'], 'result', 'results')}`,
  // dates
  'duration.minuteShort': 'min',
  'dateInput.hijriCaption': 'Hijri: {date}',
};

/** Fills {name} placeholders. A placeholder without a value stays as written. */
export function interpolate(template: string, params?: LabelParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}

/** The text for a key: from `map`, then the English defaults, then the key itself. */
export function resolveLabel(map: LabelMap, key: LabelKey, params?: LabelParams): string {
  const found = map[key] ?? DEFAULT_LABELS[key];
  if (found === undefined) return key;
  if (typeof found === 'function') return found(params ?? {});
  return interpolate(found, params);
}

export function createLabelFn(map: LabelMap): LabelFn {
  return (key, params) => resolveLabel(map, key, params);
}
