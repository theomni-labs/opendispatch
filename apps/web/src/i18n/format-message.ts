// SPDX-License-Identifier: AGPL-3.0-only
import { createTranslator } from 'next-intl';

export type MessageValues = Readonly<Record<string, string | number>>;

type Translate = (key: string, values?: MessageValues) => string;

// One ICU message, formatted as next-intl does
export function formatMessage(locale: string, message: string, values: MessageValues = {}): string {
  const t = createTranslator({
    locale,
    messages: { m: message },
    onError: (error) => {
      throw error;
    },
  }) as Translate;
  return t('m', values);
}
