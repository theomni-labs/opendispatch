// SPDX-License-Identifier: AGPL-3.0-only
import { Alert, Badge, Button } from '@opendispatch/ui';
import { Lock, OctagonAlert, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Reason } from './ReasonHint';
import { SignInCard } from './SignInCard';
import { SignInCardCopy } from './SignInCardCopy';
import styles from './SignInCard.module.css';

// The three messages of a sign-in that did not go through: the provider refused, no group rule gave a role
//, and something went wrong (with a reference code to
// share). Each is a page of its own so it can be linked to, refreshed and tested. Nothing on them is secret: the reference
// code is `ODP-` and eight characters and says nothing about the person.

export type SignInMessageKind = 'refused' | 'noRole' | 'error';

/** The reference code shape of the data layer and the sign-in action. Anything else in `?ref=` is ignored, never shown. */
export const REFERENCE_CODE = /^ODP-[0-9A-F]{8}$/;

/** The reference code a `ref` search parameter holds, or undefined when it is missing, repeated or not shaped like one. */
export function referenceFrom(param: string | string[] | undefined): string | undefined {
  return typeof param === 'string' && REFERENCE_CODE.test(param) ? param : undefined;
}

const PAGE: Readonly<Record<SignInMessageKind, string>> = { refused: 'refused', noRole: 'no-role', error: 'error' };

export function SignInCardMessage({ kind, reference }: { kind: SignInMessageKind; reference?: string | undefined }) {
  const t = useTranslations('signIn');
  const icon = kind === 'refused' ? <OctagonAlert /> : kind === 'noRole' ? <Lock /> : <TriangleAlert />;
  return (
    <SignInCard page={PAGE[kind]}>
      <Alert tone={kind === 'noRole' ? 'warning' : 'danger'} icon={icon} title={<h1 className={styles.alertTitle}>{t(`${kind}.title`)}</h1>}>
        {t(`${kind}.body`)}
      </Alert>
      {kind === 'noRole' ? <Reason icon={<Lock />}>{t('noRole.reason')}</Reason> : null}
      {kind === 'error' && reference !== undefined ? (
        <div className={styles.reference}>
          <span className={styles.code} data-reference="" translate="no">
            <Badge>{reference}</Badge>
          </span>
          <SignInCardCopy value={reference} />
        </div>
      ) : null}
      <div className={styles.actions}>
        <Button variant="primary" href="/sign-in">
          {t('again')}
        </Button>
        <Button variant="ghost" href="/sign-in">
          {t('back')}
        </Button>
      </div>
    </SignInCard>
  );
}
