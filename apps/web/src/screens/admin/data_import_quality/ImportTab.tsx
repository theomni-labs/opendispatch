'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Card, DescriptionList, Field, FileDrop, Badge, Progress, SegmentedControl, Stat, StatusPill, Stepper, Tag, useFormat, useToast, type Tone } from '@opendispatch/ui';
import { CircleCheck, CircleX, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { ActionError, errorTitleKey } from '@/components/opendispatch/patterns/ActionError';
import { ConfirmDialog } from '@/components/opendispatch/patterns/ConfirmDialog';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { useRouter } from '@/i18n/navigation';
import { STEP_LABEL, type StepName, type StepView } from './importSteps';
import { IMPORT_FILE_MAX_BYTES } from './chunkedUpload';
import { MappingHelp } from './MappingHelp';
import { UPLOAD_SOURCES, type ImportHelp, type CompareOutcome, type CutOverOutcome, type DryRunOutcome, type JobRow, type JobStatus, type MappingView, type RollbackOutcome, type UploadSource } from './types';
import styles from './DataImport.module.css';
import { useDateTime } from '@/components/opendispatch/useDateTime';
import { useChunkedUpload } from './useChunkedUpload';
import { useImportStep } from './useImportStep';

// The Import tab: the upload card, the current
// job with its five steps (Upload, Validate, Compare, Dry run, Cut over) and the mapping. The step is the job's status; the
// primary button does the next one. The file is checked twice: the drop area refuses a wrong type or size in the browser, and
// the api refuses it again (CSV only, at most 1 GB). It goes in 8 MB parts, with a progress bar, a cancel and a retry.

const STATUS_TONE: Readonly<Record<JobStatus, Tone>> = { cut_over: 'success', validated: 'info', compared: 'info', dry_run_done: 'accent', uploaded: 'neutral', validating: 'neutral', failed: 'danger', rolled_back: 'neutral' };
/** Which step is current for each status (0 upload, 1 validate, 2 compare, 3 dry run, 4 cut over, 5 all done). */
const STEP: Readonly<Record<JobStatus, number>> = { uploaded: 1, validating: 1, validated: 2, compared: 3, dry_run_done: 4, cut_over: 5, failed: 1, rolled_back: 1 };

interface Results {
  readonly compare?: CompareOutcome;
  readonly dry?: DryRunOutcome;
  readonly cut?: CutOverOutcome;
  readonly rolled?: RollbackOutcome;
}

/** The step the primary button starts. */
const NEXT_STEP: Partial<Record<JobStatus, StepName>> = { uploaded: 'validate', validating: 'validate', validated: 'compare', compared: 'dry_run', dry_run_done: 'cut_over' };

/** What the last finished step showed. */
function resultsOf(view: StepView | null): Results {
  const o = view?.outcome;
  if (o === null || o === undefined) return {};
  if (o.kind === 'compare') return { compare: o.value };
  if (o.kind === 'dry_run') return { dry: o.value };
  if (o.kind === 'cut_over') return { cut: o.value };
  if (o.kind === 'rollback') return { rolled: o.value };
  return {};
}

export interface ImportTabProps {
  readonly job: JobRow | null;
  readonly mapping: MappingView | null;
  /** Demo install: uploads default to Synthetic. */
  readonly demo: boolean;
  readonly canEdit: boolean;
  /** Assistant features; null hides them. */
  readonly help?: ImportHelp | null | undefined;
}

export function ImportTab({ job, mapping, canEdit, demo, help = null }: ImportTabProps) {
  const [source, setSource] = useState<UploadSource>(demo ? 'SYNTHETIC' : 'IMPORTED');
  const m = useTranslations('admin.data_import_quality');
  const t = useTranslations();
  const pa = useTranslations('patterns.action');
  const format = useFormat();
  const dateTime = useDateTime();
  const toast = useToast();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [tooBig, setTooBig] = useState<string | null>(null);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const zone = useRef<HTMLDivElement>(null);

  const upload = useChunkedUpload(
    (outcome) => {
      toast({ title: m('toast.uploaded'), description: outcome.file, tone: 'success' });
      url.update({ job: outcome.jobId, tab: null });
    },
    () => toast({ title: m('up.cancelled'), tone: 'info' }),
  );
  const sending = upload.state.phase !== 'idle';
  const router = useRouter();
  const done = (view: StepView) => {
    const o = view.outcome;
    if (view.state === 'succeeded' && o !== null) {
      if (o.kind === 'validate') toast({ title: m('toast.validated.title'), description: m('toast.validated.desc', { e: o.value.errors, w: o.value.warnings }), tone: o.value.status === 'failed' ? 'danger' : 'info' });
      if (o.kind === 'compare') toast({ title: m('toast.compared.title'), description: m('toast.compared.desc', { n: o.value.added }), tone: 'info' });
      if (o.kind === 'dry_run') toast(o.value.blocking > 0 ? { title: m('toast.blocked'), description: m('dry.blockedBody', { n: o.value.blocking }), tone: 'danger' } : { title: m('toast.dry'), tone: 'success' });
      if (o.kind === 'cut_over') toast({ title: m('toast.cut'), description: m('cut.body', { add: o.value.inserted, upd: o.value.updated }), tone: 'success' });
      if (o.kind === 'rollback') toast({ title: m('toast.rolledBack'), description: m('rb.doneBody', { del: format.int(o.value.deleted), res: format.int(o.value.restored) }), tone: 'success' });
    }
    router.refresh();
  };
  const run = useImportStep(job?.id ?? null, job?.step ?? null, done);
  const failure = run.error;
  const clear = () => {
    upload.reset();
    run.reset();
  };

  function take(files: File[]) {
    setTooBig(null);
    const file = files[0];
    if (file === undefined || !canEdit || mapping === null) return;
    if (file.size > IMPORT_FILE_MAX_BYTES) {
      setTooBig(file.name);
      return;
    }
    upload.start(file, { mapping_version: mapping.version, data_source: source });
  }

  const view = run.view !== null && run.view.jobId === job?.id ? run.view : null;
  const status = view?.status ?? job?.status;
  const mine = resultsOf(view);
  const stepping = run.starting || run.running;
  const busy = sending || stepping;
  const editReason = gate.edit.reason;

  function next() {
    if (job === null || editReason !== null) return;
    if (job.status === 'failed' || job.status === 'rolled_back') {
      zone.current?.querySelector<HTMLInputElement>('input[type="file"]')?.click();
      return;
    }
    clear();
    const step = NEXT_STEP[status ?? job.status];
    if (step !== undefined) run.start(step);
  }

  function askRollback() {
    if (editReason !== null) return;
    run.reset();
    setConfirmRollback(true);
  }

  const nextLabel = status === 'uploaded' || status === 'validating' ? m('act.validate') : status === 'validated' ? m('act.compare') : status === 'compared' ? m('act.dryrun') : status === 'dry_run_done' ? m('act.cutover') : status === 'cut_over' ? m('act.done') : m('act.again');
  const nextReason = editReason ?? (status === 'cut_over' ? m('act.doneTip') : null);
  const blocked = status === 'compared' && mine?.dry !== undefined && mine.dry.blocking > 0;
  const passed = status === 'dry_run_done';
  const cmp = mine?.compare;
  const limit = format.num(IMPORT_FILE_MAX_BYTES / 2 ** 30);
  const mb = (bytes: number) => format.num(Math.floor(bytes / 2 ** 20));
  const up = upload.state;
  const when = (iso: string | null) => (iso === null ? '' : dateTime(iso));
  const signed = (n: number) => `${n > 0 ? '+' : ''}${format.int(n)}`;

  return (
    <div className={styles.grid2}>
      <div className={styles.col}>
        <Card padding="lg">
          <div className={styles.cardInner}>
            <div className={styles.head}>
              <h2 className={styles.cardTitle}>{m('up.title')}</h2>
              {mapping === null ? null : (
                <Tag color="gray">
                  <span translate="no">{mapping.label}</span>
                </Tag>
              )}
            </div>
            <div className={styles.stackTight} ref={zone}>
              <fieldset className={styles.plainFieldset} disabled={!canEdit || mapping === null || busy}>
                <Field label={m('up.source')}>
                  <SegmentedControl
                    size="sm"
                    value={source}
                    onChange={(next) => setSource(UPLOAD_SOURCES.find((s) => s === next) ?? source)}
                    options={UPLOAD_SOURCES.map((value) => ({ value, label: t(`dataSource.${value}`) }))}
                  />
                </Field>
                <FileDrop accept=".csv" maxSize={IMPORT_FILE_MAX_BYTES} hint={m('up.hintLimit', { max: limit })} onFiles={take} />
              </fieldset>
              {editReason === null ? null : <Reason>{editReason}</Reason>}
              {mapping === null ? <Reason>{m('up.noMapping')}</Reason> : null}
              {tooBig === null ? null : <Alert tone="danger">{m('up.tooBig', { name: tooBig, max: limit })}</Alert>}
              <ActionError error={upload.error} onDismiss={upload.reset} />
              {up.phase === 'uploading' || up.phase === 'joining' ? (
                <div className={styles.stackTight}>
                  <Progress label={<bdi translate="no">{up.name}</bdi>} showValue value={up.sent} max={up.size} />
                  <div className={styles.between}>
                    <span className={styles.meta}>{up.phase === 'joining' ? m('up.joining') : m('up.sent', { sent: mb(up.sent), total: mb(up.size) })}</span>
                    <Button variant="ghost" size="sm" disabled={up.phase === 'joining'} onClick={upload.cancel}>
                      {m('up.cancel')}
                    </Button>
                  </div>
                </div>
              ) : null}
              {up.phase === 'failed' ? (
                <Alert
                  tone="danger"
                  icon={<CircleX />}
                  title={m('up.failed')}
                  action={
                    <div className={styles.inline}>
                      <Button variant="secondary" size="sm" onClick={upload.retry}>
                        {m('up.retry')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={upload.cancel}>
                        {m('up.cancel')}
                      </Button>
                    </div>
                  }
                >
                  {up.part === null ? null : `${m('up.failedBody', { part: format.int(up.part + 1), parts: format.int(up.parts) })} `}
                  {pa(errorTitleKey(up.failure))}
                </Alert>
              ) : null}
            </div>
          </div>
        </Card>

        {job === null ? null : (
          <Card padding="lg">
            <div className={styles.cardInner}>
              <div className={styles.head}>
                <div className={styles.headTitle}>
                  <h2 className={styles.cardTitle} translate="no">
                    {job.file}
                  </h2>
                  <StatusPill status={m(`status.${job.status === 'validating' ? 'uploaded' : job.status}`)} tone={STATUS_TONE[job.status]} size="sm" />
                </div>
              </div>
              <Stepper
                current={STEP[job.status]}
                steps={[{ label: m('step.upload') }, { label: m('step.validate') }, { label: m('step.compare') }, { label: m('step.dryrun') }, { label: m('step.cutover') }]}
              />

              {view !== null && view.state === 'running' && view.step !== null ? (
                <div className={styles.stackTight}>
                  <Progress
                    label={m('run.title', { step: m(STEP_LABEL[view.step]) })}
                    showValue={view.total !== null}
                    value={view.total === null ? 0 : view.done}
                    max={view.total ?? 1}
                  />
                  <span className={styles.meta}>{view.total === null ? m('run.working') : m('run.rows', { done: format.int(view.done), total: format.int(view.total) })}</span>
                </div>
              ) : null}

              {job.status === 'failed' ? null : (
                <div className={styles.stackTight}>
                  <span className={styles.strong}>{m('step.validate')}</span>
                  {job.status === 'uploaded' || job.status === 'validating' ? (
                    <span className={styles.meta}>{m('notValidated')}</span>
                  ) : (
                    <div className={styles.inline}>
                      <StatusPill status={m('sev.error')} tone="danger" size="sm" />
                      <bdi translate="no">{format.int(job.errors)}</bdi>
                      <StatusPill status={m('sev.warning')} tone="warning" size="sm" />
                      <bdi translate="no">{format.int(job.warnings)}</bdi>
                      <StatusPill status={m('sev.info')} tone="info" size="sm" />
                      <bdi translate="no">{format.int(job.info)}</bdi>
                    </div>
                  )}
                </div>
              )}

              {cmp !== undefined && (status === 'compared' || status === 'dry_run_done' || status === 'cut_over') ? (
                <div className={styles.stack}>
                  <span className={styles.strong}>{m('step.compare')}</span>
                  <div className={styles.stats3}>
                    <Stat label={m('cmp.before')} value={<bdi translate="no">{format.int(cmp.existing)}</bdi>} />
                    <Stat label={m('cmp.change')} value={<bdi translate="no">{signed(cmp.added + cmp.changed)}</bdi>} />
                    <Stat label={m('cmp.after')} value={<bdi translate="no">{format.int(cmp.existing + cmp.added)}</bdi>} />
                  </div>
                  <DescriptionList
                    dense
                    columns={3}
                    items={[
                      { label: m('cmp.new'), value: <bdi translate="no">{format.int(cmp.added)}</bdi> },
                      { label: m('cmp.changed'), value: <bdi translate="no">{format.int(cmp.changed)}</bdi> },
                      { label: m('cmp.unchanged'), value: <bdi translate="no">{format.int(cmp.unchanged)}</bdi> },
                      { label: m('cmp.skipped'), value: <bdi translate="no">{format.int(Math.max(0, cmp.incoming - cmp.added - cmp.changed - cmp.unchanged))}</bdi> },
                      { label: m('cmp.missing'), value: <bdi translate="no">{format.int(cmp.missing)}</bdi> },
                    ]}
                  />
                </div>
              ) : (status === 'compared' || status === 'dry_run_done') && cmp === undefined ? (
                <div className={styles.stackTight}>
                  <span className={styles.strong}>{m('step.compare')}</span>
                  <div className={styles.inline}>
                    <span className={styles.meta}>{m('cmp.lost')}</span>
                    <ReasonHint reason={editReason} visible={false} quiet>
                      <Button variant="ghost" size="sm" loading={stepping} onClick={() => editReason === null && job !== null && run.start('compare')}>
                        {m('cmp.again')}
                      </Button>
                    </ReasonHint>
                  </div>
                </div>
              ) : null}

              {blocked || passed ? (
                <div className={styles.stackTight}>
                  <span className={styles.strong}>{m('step.dryrun')}</span>
                  <Alert
                    tone={blocked ? 'danger' : 'success'}
                    icon={blocked ? <CircleX /> : <CircleCheck />}
                    title={blocked ? m('dry.blocked') : m('dry.passed')}
                    {...(blocked ? { action: <Button variant="secondary" size="sm" onClick={() => url.update({ tab: 'issues', job: job.id, severity: 'error', status: null })}>{m('viewIssues')}</Button> } : {})}
                  >
                    {blocked ? m('dry.blockedBody', { n: mine?.dry?.blocking ?? job.blocking }) : mine?.dry === undefined ? m('dry.passedShort') : m('dry.passedBody', { add: mine.dry.wouldInsert, upd: mine.dry.wouldUpdate, skip: mine.dry.wouldSkip })}
                  </Alert>
                </div>
              ) : null}

              {status === 'cut_over' ? (
                <Alert tone="success" icon={<CircleCheck />} title={m('cut.title')}>
                  {mine?.cut === undefined ? m('cut.bodyRows', { n: format.int(job.rows), when: when(job.cutOverAt) }) : m('cut.body', { add: mine.cut.inserted, upd: mine.cut.updated })}
                </Alert>
              ) : null}

              {status === 'rolled_back' ? (
                <Alert tone="info" icon={<Undo2 />} title={m('rb.doneTitle')}>
                  {mine?.rolled === undefined ? m('rb.doneShort') : m('rb.doneBody', { del: format.int(mine.rolled.deleted), res: format.int(mine.rolled.restored) })}
                </Alert>
              ) : null}

              {status === 'failed' ? (
                <Alert tone="danger" icon={<CircleX />} title={m('fail.title')} {...(help !== null && help.mapping ? { action: <MappingHelp jobId={job.id} file={job.file} help={help} editReason={editReason ?? (job.stored ? null : m('ai.noFile'))} /> } : {})}>
                  {m('fail.body')}
                </Alert>
              ) : null}

              <ActionError error={failure} onDismiss={clear} />

              <div className={styles.between}>
                <Button variant="ghost" onClick={() => url.update({ tab: 'issues', job: job.id, severity: null, status: null })}>
                  {m('viewIssues')}
                </Button>
                <div className={styles.inline}>
                  {status === 'cut_over' ? (
                    <ReasonHint reason={editReason} visible={false}>
                      <Button variant="secondary" startIcon={<Undo2 />} onClick={askRollback}>
                        {m('act.rollback')}
                      </Button>
                    </ReasonHint>
                  ) : null}
                  <ReasonHint reason={nextReason} visible={false}>
                    <Button variant="primary" loading={busy && status !== 'failed' && status !== 'rolled_back'} onClick={next}>
                      {nextLabel}
                    </Button>
                  </ReasonHint>
                </div>
              </div>
              <ConfirmDialog
                open={confirmRollback}
                onClose={() => setConfirmRollback(false)}
                onConfirm={() => job !== null && run.start('rollback', () => setConfirmRollback(false))}
                title={m('rb.title')}
                description={m('rb.desc', { n: format.int(job.rows) })}
                confirmLabel={m('rb.ok')}
                tone="danger"
                pending={run.starting}
                error={<ActionError error={run.error} onDismiss={run.reset} />}
              />
              {nextReason === null ? null : <Reason>{nextReason}</Reason>}
            </div>
          </Card>
        )}
      </div>

      <aside className={styles.col}>
        <Card padding="lg">
          <div className={styles.cardInner}>
            <div className={styles.head}>
              <h2 className={styles.cardTitle}>{m('map.title')}</h2>
              <Badge tone="warning" size="sm">
                {m('map.draft')}
              </Badge>
            </div>
            {mapping === null ? (
              <span className={styles.meta}>{t('common.none')}</span>
            ) : (
              <div className={styles.stackTight}>
                <Kv label={m('map.version')} value={mapping.label} />
                <Kv label={m('map.format')} value={mapping.format.toUpperCase()} />
                <Kv label={m('map.tz')} value="Asia/Riyadh" />
                <Kv label={m('map.required')} value={format.int(mapping.requiredColumns)} />
              </div>
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.kv}>
      <span className={styles.meta}>{label}</span>
      <span translate="no">{value}</span>
    </div>
  );
}
