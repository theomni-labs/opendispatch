// SPDX-License-Identifier: AGPL-3.0-only
import { Card, Skeleton, SkeletonText } from '@opendispatch/ui';
import type { AdminModuleId, ModuleId } from '@/lib/access';
import styles from './ScreenSkeleton.module.css';

// The loading state of a screen: skeletons in the shape of the content, never a spinner alone.
// Four shapes, one per kind of screen, chosen per module below. `loading.tsx` picks the shape from the route, and
// ScreenFrame from the module for `?state=loading`. "Loading" is announced once, by the first skeleton, and the area is
// `aria-busy`. Usable from a Server or a Client Component.

export const SKELETON_SHAPE_NAMES = ['list', 'cards', 'form', 'detail'] as const;
export type SkeletonShape = (typeof SKELETON_SHAPE_NAMES)[number];

/**
 * The shape of each Admin module's screen while it loads. `list`: a table under filters (a card of rows, as the
 * mockups draw it). `cards`: a page of separate cards (health, feeds, versions). `form`: fields to fill. `detail`: one
 * record and its lines (the generic placeholder shape, the one ModuleStates' LoadingPanel draws). A module agent may change its own line when its screen is
 * better described by another shape.
 */
export const SKELETON_SHAPES: Readonly<Record<AdminModuleId, SkeletonShape>> = {
  'admin.users_roles': 'list',
  'admin.sign_in_identity': 'list',
  'admin.locations': 'list',
  'admin.agents_vehicles': 'list',
  'admin.classification_rules': 'list',
  'admin.shift_break_policies': 'list',
  'admin.leave_policy_calendar': 'list',
  'admin.forecast_model': 'detail',
  'admin.data_sources': 'cards',
  'admin.data_import_quality': 'list',
  'admin.audit_log': 'list',
  'admin.notifications_alerts': 'list',
  'admin.api_webhooks': 'list',
  'admin.security_compliance': 'list',
  'admin.system_health': 'cards',
  'admin.updates': 'detail',
  'admin.localization': 'form',
  'admin.ai_assistant': 'cards',
};

/** The shape for a module id, and `detail` (the generic one) for an Ops module, an unknown id or none. */
export function skeletonShapeOf(moduleId: ModuleId | undefined): SkeletonShape {
  if (moduleId === undefined || !Object.hasOwn(SKELETON_SHAPES, moduleId)) return 'detail';
  return (SKELETON_SHAPES as Readonly<Record<string, SkeletonShape>>)[moduleId] ?? 'detail';
}

export interface ScreenSkeletonProps {
  shape: SkeletonShape;
  /** A title bar above the shape, for a page that does not draw its own header yet (`loading.tsx`). */
  showTitle?: boolean;
  /**
   * The screen's real title, known even before its content streams in (the route already names the module).
   * Rendered as a real h1, not a skeleton bar: the route's own loading.tsx otherwise has no heading at all while
   * its Server Component resolves, which is the one thing every settled state (filled, or either no-access shape)
   * has in common — a page briefly without it is a real gap, not just a timing detail for a test to wait out.
   */
  title?: string | undefined;
}

const ROWS = 6;
const CARDS = 4;
const FIELDS = 5;

export function ScreenSkeleton({ shape, showTitle = true, title }: ScreenSkeletonProps) {
  // The first skeleton on the page carries the "Loading" announcement; the others are hidden from screen readers.
  // A real title takes over that role itself (screen readers announce a new heading on its own).
  const titleNode = !showTitle ? null : title !== undefined ? <h1 className="t-heading-l">{title}</h1> : <Skeleton announce height={28} width="min(16rem, 100%)" />;
  const announceFirst = !showTitle || title !== undefined;

  if (shape === 'detail') {
    return (
      <div className={styles.root} aria-busy="true" data-skeleton="detail">
        {titleNode}
        <Card padding="lg">
          <div className={styles.detail}>
            <div className={styles.row}>
              <Skeleton announce={announceFirst} width={40} height={40} radius="full" />
              <div className={styles.grow}>
                <SkeletonText lines={2} />
              </div>
            </div>
            <Skeleton height={72} radius="lg" />
            <SkeletonText lines={3} />
          </div>
        </Card>
      </div>
    );
  }

  if (shape === 'list') {
    return (
      <div className={styles.root} aria-busy="true" data-skeleton="list">
        {titleNode}
        <Card padding="lg">
          <div className={styles.rows}>
            {Array.from({ length: ROWS }, (_, row) => (
              <div key={row} className={styles.row}>
                <Skeleton announce={announceFirst && row === 0} width={32} height={32} radius="full" />
                <div className={styles.grow}>
                  <SkeletonText lines={2} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (shape === 'cards') {
    return (
      <div className={styles.root} aria-busy="true" data-skeleton="cards">
        {titleNode}
        <div className={styles.grid}>
          {Array.from({ length: CARDS }, (_, card) => (
            <Card key={card} padding="lg">
              <div className={styles.card}>
                <Skeleton announce={announceFirst && card === 0} height={16} width="40%" />
                <Skeleton height={72} radius="lg" />
                <SkeletonText lines={2} />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root} aria-busy="true" data-skeleton="form">
      {titleNode}
      <Card padding="lg">
        <div className={styles.fields}>
          {Array.from({ length: FIELDS }, (_, field) => (
            <div key={field} className={styles.field}>
              <Skeleton announce={announceFirst && field === 0} height={10} width="30%" />
              <Skeleton height={40} radius="md" />
            </div>
          ))}
          <Skeleton height={36} width={96} radius="md" />
        </div>
      </Card>
    </div>
  );
}
