// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Card, EmptyState, PageHeader } from '@opendispatch/ui';
import { Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { ModuleAccessResult, ModuleDef, ModuleId } from '@/lib/access';
import type { DataSource } from '@/lib/types';
import { DataSourceBadge } from './DataSourceBadge';
import { NoAccessPanel } from './ModuleStates';
import { RetryButton } from './RetryButton';
import { ScreenError } from './ScreenError';
import { ScreenSkeleton, skeletonShapeOf } from './ScreenSkeleton';
import { stateText } from './screen-text';
import type { ModuleState, ScreenState } from './module-state';
import styles from './ScreenFrame.module.css';

// assumption: in demo mode every record is synthetic. A screen that shows records of another source passes it.
const DEFAULT_SOURCES: readonly DataSource[] = ['SYNTHETIC'];

export interface ScreenFrameProps {
  def: ModuleDef;
  access: ModuleAccessResult;
  /**
   * PHASE A DEMO TOOLING: the state a person asked to review, from `parseReviewState`, decided on
   * the server. Undefined shows the content. The access model comes first: no access is no access whatever this says.
   */
  state?: ModuleState | undefined;
  /** The role's landing page, for the no-access state. */
  homeHref: string | undefined;
  /** The data_source of every record the screen shows. Default: SYNTHETIC. */
  sources?: readonly DataSource[];
  /** Badges after the data-source badge: a "Demo" or "Not applied" tag for the whole screen. */
  meta?: ReactNode;
  /** The header's buttons, at most two visible and the rest in a menu. Hidden in no access. */
  actions?: ReactNode;
  /** The header's one-line subtitle under the title (most mockups have one). Hidden in no access. */
  description?: ReactNode;
  /** Tabs under the header. Shown with the content only, as in the mockups. */
  tabs?: ReactNode;
  /** True when the data has nothing to show at all: the empty state replaces the content. */
  isEmpty?: boolean;
  /** The empty state's one action (for example "Invite user"), disabled with a reason for a view-only role. */
  emptyAction?: ReactNode;
  /** Drawers and dialogs: shown empty or filled. */
  overlays?: ReactNode;
  /**
   * A module with no screen yet: the generic `detail` skeleton and the roomier empty and error states of
   * docs/mockups/screens/_states.html, and an empty page by default. A real screen leaves this off.
   */
  placeholder?: boolean;
  /** The content. It is rendered only when the state is filled, so an async child fetches nothing for the others. */
  children?: ReactNode;
}

/**
 * The root of every module page. It owns what all 30 pages share, so a screen writes only its content:
 *   - the root element and its hooks, `data-module`, `data-state`, `data-access`, `data-reduced`, which the e2e specs read;
 *   - the PageHeader: the module's full title, the data-source badge, "View only" or "Reduced" from the access model,
 *     the screen's own badges and actions, and tabs;
 *   - the state switch: no access, loading, error, empty or the content, with the module's own text for each state.
 * A Server Component; its children may be async Server Components, which are not rendered (so not fetched) unless the
 * state is filled. Client components are children of the screen, never the other way round.
 */
export function ScreenFrame({ def, access, state, homeHref, sources = DEFAULT_SOURCES, meta, description, actions, tabs, isEmpty = false, emptyAction, overlays, placeholder = false, children }: ScreenFrameProps) {
  const t = useTranslations();
  const noAccess = state === 'noaccess' || access.access === 'none';
  const shown: ScreenState = noAccess ? 'noaccess' : (state ?? (isEmpty ? 'empty' : 'filled'));

  return (
    <div className={styles.page} data-module={def.id} data-state={shown} data-access={access.access} data-reduced={String(access.reduced)}>
      <PageHeader
        title={t(def.titleKey)}
        meta={
          noAccess ? undefined : (
            <>
              <DataSourceBadge sources={sources} />
              {access.access === 'view' ? <Badge icon={<Eye />}>{t('shell.access.view')}</Badge> : null}
              {access.reduced ? <Badge>{t('shell.access.reduced')}</Badge> : null}
              {meta}
            </>
          )
        }
        {...(noAccess || description === undefined ? {} : { description })}
        actions={noAccess ? undefined : actions}
        tabs={shown === 'filled' ? tabs : undefined}
      />
      {shown === 'noaccess' ? (
        <NoAccessPanel homeHref={homeHref} />
      ) : shown === 'loading' ? (
        <ScreenSkeleton shape={placeholder ? 'detail' : skeletonShapeOf(def.id)} showTitle={false} />
      ) : shown === 'error' ? (
        <ScreenError moduleId={def.id} compact={!placeholder} retry={<RetryButton />} />
      ) : shown === 'empty' ? (
        <ScreenEmpty moduleId={def.id} compact={!placeholder} action={emptyAction} />
      ) : (
        children
      )}
      {shown === 'empty' || shown === 'filled' ? overlays : null}
    </div>
  );
}

export interface ScreenEmptyProps {
  moduleId?: ModuleId | undefined;
  action?: ReactNode;
  compact?: boolean;
}

/**
 * The empty state of a screen: "Nothing here yet" (or the module's own title) and its description, with one action. A
 * screen whose content finds no rows renders this itself; ScreenFrame renders it for `isEmpty` and `?state=empty`.
 */
export function ScreenEmpty({ moduleId, action, compact = false }: ScreenEmptyProps) {
  const t = useTranslations();
  return (
    <Card padding="none">
      <EmptyState
        compact={compact}
        title={stateText(t, moduleId, 'empty', 'title') ?? t('states.empty.title')}
        description={stateText(t, moduleId, 'empty', 'desc')}
        action={action}
      />
    </Card>
  );
}
