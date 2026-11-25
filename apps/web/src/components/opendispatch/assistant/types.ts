// SPDX-License-Identifier: AGPL-3.0-only
// What the client parts show (plain data)

export interface AnswerMetaView {
  readonly provider: string;
  readonly model: string;
  readonly duration_ms: number;
}

export interface ExplanationView extends AnswerMetaView {
  readonly text: string;
  readonly sent: string;
}

export interface AnswerView extends AnswerMetaView {
  readonly answer: string;
  readonly refused: boolean;
  readonly capped: boolean;
  readonly tool_calls: readonly { readonly name: string; readonly input: Readonly<Record<string, unknown>>; readonly ok: boolean }[];
}

/** A shift handover, as the drawer shows it. */
export interface HandoverView extends AnswerMetaView {
  readonly window_from: string;
  readonly window_to: string;
  readonly text: string;
  readonly answer_path: 'checked' | 'checked_after_retry' | 'fallback_summary';
  readonly sent: string;
}

/** The unread alerts, grouped, with a summary. */
export interface AlertsDigestView extends AnswerMetaView {
  readonly unread: number;
  readonly groups: readonly { readonly category: string; readonly severity: string; readonly count: number }[];
  readonly text: string;
  readonly answer_path: 'checked' | 'checked_after_retry' | 'fallback_summary';
}

/** A rule draft, in the condition builder's terms. */
export interface RuleDraftView extends AnswerMetaView {
  readonly draft: {
    readonly name_en: string;
    readonly name_ar: string | null;
    readonly condition: {
      readonly match: 'all' | 'any';
      readonly predicates: readonly { readonly field: string; readonly operator: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'in'; readonly value: string | number | boolean | readonly (string | number)[] }[];
    };
    readonly condition_text_en: string;
    readonly outcome: 'remote_eligible' | 'field_mandatory' | 'field_preferred';
  };
  /** What the person wrote that no field could hold. */
  readonly unmapped?: readonly string[] | undefined;
}
