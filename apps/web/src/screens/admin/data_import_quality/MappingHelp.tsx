'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Checkbox, Drawer, Field, Input, Select, StatusPill, Textarea, useToast, type Tone } from '@opendispatch/ui';
import { Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { AnswerMeta } from '@/components/opendispatch/assistant/AnswerMeta';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { saveMapping, suggestMapping } from './actions';
import { missingRequired, nextVersion, renamesOf, VERSION_PATTERN } from './mappingHelp';
import type { Confidence, ImportHelp, MappingSuggestionView } from './types';
import styles from './ImportHelp.module.css';

// Suggest mapping

const CONFIDENCE_TONE: Readonly<Record<Confidence, Tone>> = { high: 'success', medium: 'warning', low: 'neutral' };

export interface MappingHelpProps {
  readonly jobId: string;
  readonly file: string;
  readonly help: ImportHelp;
  /** Null: the role may edit. */
  readonly editReason: string | null;
}

export function MappingHelp({ jobId, file, help, editReason }: MappingHelpProps) {
  const m = useTranslations('admin.data_import_quality');
  const a = useTranslations('opendispatch.assistant');
  const locale = useLocale();
  const toast = useToast();
  const url = useUrlState();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MappingSuggestionView | null>(null);
  const [fields, setFields] = useState<Readonly<Record<string, string>>>({});
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [apply, setApply] = useState(true);

  const suggest = useAdminAction(suggestMapping, {
    quiet: true,
    onSuccess: (s) => {
      setView(s);
      setFields(Object.fromEntries(s.columns.map((c) => [c.source, c.field ?? ''])));
      setVersion(nextVersion(s.baseVersion, s.versions));
    },
  });
  const save = useAdminAction(saveMapping, {
    quiet: true,
    onSuccess: (outcome) => {
      setOpen(false);
      toast({ title: m('ai.saved', { v: outcome.version }), ...(outcome.applied ? { description: m('ai.savedDesc') } : {}), tone: 'success' });
      if (outcome.applied) url.update({ job: jobId, tab: null });
    },
  });

  const reason = editReason ?? (help.configured ? null : a('off'));
  function start() {
    if (reason !== null) return;
    setView(null);
    save.reset();
    setOpen(true);
    suggest.run({ jobId, locale });
  }

  const missing = view === null ? [] : missingRequired(view, fields);
  const versionTaken = view !== null && view.versions.includes(version);
  const saveReason = editReason ?? (missing.length > 0 ? m('ai.missing') : !VERSION_PATTERN.test(version) ? m('ai.versionRule') : versionTaken ? m('ai.versionTaken') : null);
  const options = view === null ? [] : [{ value: '', label: m('ai.none') }, ...view.fields.map((f) => ({ value: f.field, label: f.field }))];
  const invalid = suggest.error?.reason === 'ASSISTANT_INVALID_OUTPUT';

  const footer = (
    <div className={styles.footer}>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        {m('ai.cancel')}
      </Button>
      <ReasonHint reason={view === null ? m('ai.waiting') : saveReason} visible={false}>
        <Button
          variant="primary"
          loading={save.pending}
          onClick={() => view !== null && saveReason === null && save.run({ jobId: apply ? jobId : undefined, version, baseVersion: view.baseVersion, notes, columns: renamesOf(view, fields), assisted: true })}
        >
          {m('ai.save')}
        </Button>
      </ReasonHint>
    </div>
  );

  return (
    <>
      <ReasonHint reason={reason}>
        <Button variant="secondary" size="sm" startIcon={<Sparkles />} onClick={start}>
          {m('ai.map')}
        </Button>
      </ReasonHint>
      <Drawer open={open} onClose={() => setOpen(false)} title={m('ai.mapTitle')} subtitle={<span translate="no">{view === null ? file : `${file} · ${view.baseVersion}`}</span>} width={640} footer={footer}>
        <div className={styles.drawerBody} data-assistant="import-mapping">
          {suggest.pending ? <p className={styles.muted} aria-live="polite">{a('working')}</p> : null}
          {invalid ? (
            <Alert tone="warning" title={m('ai.invalidTitle')}>
              {m('ai.mapInvalid')}
            </Alert>
          ) : (
            <ActionError error={suggest.error} onDismiss={suggest.reset} />
          )}
          {view === null ? null : (
            <>
              <AnswerMeta provider={view.provider} model={view.model} durationMs={view.duration_ms} illustrative={false} />
              {missing.length === 0 ? null : (
                <Alert tone="danger" title={m('ai.missing')}>
                  <span translate="no">{missing.join(locale === 'ar' ? '، ' : ', ')}</span>
                </Alert>
              )}
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{m('ai.col.file')}</th>
                      <th scope="col">{m('ai.col.field')}</th>
                      <th scope="col">{m('ai.col.conf')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.columns.map((c) => (
                      <tr key={c.source}>
                        <td>
                          <span className={styles.cellMain} translate="no">
                            {c.source}
                          </span>
                          <span className={styles.cellSub}>{c.reason}</span>
                        </td>
                        <td>
                          <Select
                            size="sm"
                            aria-label={`${m('ai.col.field')}: ${c.source}`}
                            translate="no"
                            options={options}
                            value={fields[c.source] ?? ''}
                            disabled={editReason !== null}
                            onChange={(event) => setFields((prev) => ({ ...prev, [c.source]: event.target.value }))}
                          />
                        </td>
                        <td>
                          <StatusPill status={m(`ai.conf.${c.confidence}`)} tone={CONFIDENCE_TONE[c.confidence]} size="sm" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Field label={m('ai.version')}>
                <Input value={version} translate="no" dir="ltr" maxLength={64} disabled={editReason !== null} invalid={saveReason === m('ai.versionRule') || versionTaken} onChange={(event) => setVersion(event.target.value.trim())} />
              </Field>
              <Field label={m('ai.notes')} optional>
                <Textarea value={notes} rows={3} maxLength={4000} disabled={editReason !== null} onChange={(event) => setNotes(event.target.value)} />
              </Field>
              <Checkbox label={m('ai.apply')} checked={apply} disabled={editReason !== null} onChange={(event) => setApply(event.target.checked)} />
              <ActionError error={save.error} onDismiss={save.reset} />
              <details className={styles.sent}>
                <summary>{a('sent')}</summary>
                <code className={styles.code} dir="ltr" translate="no">
                  {view.sent}
                </code>
              </details>
            </>
          )}
        </div>
      </Drawer>
    </>
  );
}
