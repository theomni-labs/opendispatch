// SPDX-License-Identifier: AGPL-3.0-only
import { Button, Card, EmptyState } from '@opendispatch/ui';
import { Lock, SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ScreenSkeleton } from './ScreenSkeleton';
import { SignOutButton } from './SignOutButton';

// The page states drawn as in docs/mockups/screens/_states.html: empty, loading, error and no access,
// plus the 404. Filled and disabled states arrive with the real screens. Every string comes from the messages; no
// stack trace. The card has no padding of its own: the empty state carries it (the mockup's card pad none).

/** Nothing to show yet. The placeholder pages  render this by default. */
export function EmptyPanel() {
  const t = useTranslations('states');
  return (
    <Card padding="none">
      <EmptyState title={t('empty.title')} />
    </Card>
  );
}

/**
 * Skeletons with the shape of the content, never a spinner alone: a title (unless the page already shows one), then a
 * card with a header row, a block and three lines. "Loading" is announced once, by the first skeleton. This is the generic
 * `detail` shape of ScreenSkeleton, which also has the list, cards and form shapes of the Admin screens.
 */
export function LoadingPanel({ showTitle = true }: { showTitle?: boolean }) {
  return <ScreenSkeleton shape="detail" showTitle={showTitle} />;
}

/** The error state: what happened in one line and one way out. Pass the retry button (a client component, or error.tsx's reset). */
export function ErrorPanel({ retry }: { retry: ReactNode }) {
  const t = useTranslations('states');
  return (
    <Card padding="none">
      <EmptyState tone="danger" title={t('error.title')} description={t('error.desc')} action={retry} />
    </Card>
  );
}

/**
 * The person's role has no access. `homeHref` is their landing page. Without one (an empty menu) they can only sign
 * out: there is no default role to fall back to and nothing to redirect to, so no redirect loop.
 * `pageLevel`: the panel is the whole page (a console layout with no access), so its title is the page's h1; inside
 * ModulePage the header already has the h1.
 */
export function NoAccessPanel({ homeHref, pageLevel = false }: { homeHref: string | undefined; pageLevel?: boolean }) {
  const t = useTranslations();
  return (
    <Card padding="none">
      <EmptyState
        icon={<Lock />}
        title={t('states.noAccess.title')}
        {...(pageLevel ? { headingLevel: 1 as const } : {})}
        description={t('states.noAccess.desc')}
        action={homeHref === undefined ? <SignOutButton /> : <Button href={homeHref}>{t('common.goHome')}</Button>}
      />
    </Card>
  );
}

/** 404. `homeHref` is where Go home leads: the landing page, or the demo start page. */
export function NotFoundPanel({ homeHref }: { homeHref: string }) {
  const t = useTranslations();
  return (
    <Card padding="none">
      <EmptyState icon={<SearchX />} headingLevel={1} title={t('states.notFound.title')} description={t('states.notFound.desc')} action={<Button href={homeHref}>{t('common.goHome')}</Button>} />
    </Card>
  );
}
