// SPDX-License-Identifier: AGPL-3.0-only
import type { LabelMap, LabelParams } from '@opendispatch/ui';

// The UI package's built-in strings (packages/ui/src/provider/labels.ts) live in messages/*.json
// under `ds`. The nested JSON follows the dots of the design system key: 'pagination.next' is message
// `ds.pagination.next`. This list has every key; ds-labels.test.ts fails when the design system adds, renames or
// removes one, so a new design system commit cannot leave a label in English on an Arabic page.
export const DS_LABEL_KEYS = [
  // Overlays (10)
  'combobox.placeholder',
  'combobox.empty',
  'combobox.show',
  'combobox.hide',
  'drawer.close',
  'modal.close',
  'tabs.sections',
  'toast.region',
  'toast.dismiss',
  'toast.dismissTitle',
  // Data and forms (42)
  'dataTable.bulkActions',
  'dataTable.selectAllRows',
  'dataTable.deselectAllRows',
  'dataTable.selectedCount',
  'dataTable.clearSelection',
  'dataTable.selectRow',
  'dataTable.emptyTitle',
  'dataTable.emptyDescription',
  'pagination.label',
  'pagination.range',
  'pagination.pageOf',
  'pagination.compact',
  'pagination.pageSize',
  'pagination.previous',
  'pagination.next',
  'pagination.goToPage',
  'filterBar.filteredBy',
  'filterBar.removeFilter',
  'filterBar.clearAll',
  'filterBar.clearFilter',
  'fileDrop.dropToUpload',
  'fileDrop.promptOne',
  'fileDrop.promptMany',
  'fileDrop.browse',
  'fileDrop.selectedFiles',
  'fileDrop.remove',
  'fileDrop.sizeBytes',
  'fileDrop.sizeKb',
  'fileDrop.sizeMb',
  'fileDrop.rejectType',
  'fileDrop.rejectSize',
  'fileDrop.dismiss',
  'formFooter.label',
  'formFooter.unsaved',
  'formFooter.clean',
  'quantityInput.decrease',
  'quantityInput.increase',
  'searchInput.placeholder',
  'searchInput.clear',
  'field.optional',
  'breadcrumbs.label',
  'pageHeader.back',
  // Display (7)
  'alert.dismiss',
  'avatar.more',
  'tag.remove',
  'tag.removeGeneric',
  'stepper.completed',
  'skeleton.loading',
  'descriptionList.empty',
  // Charts (23)
  'chart.noData',
  'chart.titled',
  'chart.listSeparator',
  'chart.compactThousand',
  'chart.compactMillion',
  'chartLegend.label',
  'lineChart.summary',
  'lineChart.markers',
  'lineChart.band',
  'lineChart.bandValue',
  'barChart.summary',
  'barChart.total',
  'donutChart.summary',
  'donutChart.item',
  'donutChart.empty',
  'sparkline.summary',
  'heatGrid.summary',
  'heatGrid.cell',
  'heatGrid.cellKind',
  'heatGrid.cellNoValue',
  'heatGrid.kindGap',
  'heatGrid.kindSurplus',
  'heatGrid.kindOk',
  // Shell (9)
  'railShell.nav',
  'railShell.skip',
  'railShell.menuOpen',
  'railShell.notifications',
  'railShell.notificationsUnread',
  'commandPalette.placeholder',
  'commandPalette.results',
  'commandPalette.empty',
  'commandPalette.count',
  // Dates (2)
  'duration.minuteShort',
  'dateInput.hijriCaption',
] as const;

export type DsLabelKey = (typeof DS_LABEL_KEYS)[number];

/** What next-intl's `t` from `useTranslations('ds')` looks like to this file. */
export type DsTranslate = (key: string, values?: LabelParams) => string;

/**
 * The `labels` map for <DesignSystemProvider>: for every key, a function that asks next-intl. Plural rules (Arabic
 * has six forms) and word order then live in the message, not in code. The provider passes the parameters of each
 * label ({n}, {page}, {count}, ...) straight through.
 */
export function buildDsLabels(t: DsTranslate): LabelMap {
  return Object.fromEntries(DS_LABEL_KEYS.map((key) => [key, (params: LabelParams) => t(key, params)]));
}
