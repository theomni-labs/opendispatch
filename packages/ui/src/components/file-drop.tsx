// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { CloseOutlined, ExclamationCircleOutlined, FileTextOutlined, InboxOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useLabels, type LabelFn } from '../provider';
import { useFormat, type Formatters } from '../provider/use-format';
import { cx } from '../types';
import styles from './file-drop.module.css';

export type FileRejectReason = 'type' | 'size';

export interface FileRejection {
  file: File;
  reason: FileRejectReason;
}

export interface FileDropProps {
  /** As the <input accept> attribute: ".csv,text/plain,image/*". */
  accept?: string | undefined;
  /** Largest file in bytes. */
  maxSize?: number | undefined;
  hint?: string | undefined;
  multiple?: boolean | undefined;
  /** The files now chosen, after each change. */
  onFiles?: ((files: File[]) => void) | undefined;
  /** Files refused. When given, the component shows no message of its own. */
  onReject?: ((rejected: FileRejection[]) => void) | undefined;
  id?: string | undefined;
  className?: string | undefined;
}

type SizeFormat = Pick<Formatters, 'int' | 'num'>;

function fileSize(bytes: number, format: SizeFormat, label: LabelFn): string {
  if (bytes < 1024) return label('fileDrop.sizeBytes', { size: format.int(bytes) });
  if (bytes < 1024 * 1024) return label('fileDrop.sizeKb', { size: format.num(bytes / 1024, bytes < 10 * 1024 ? 1 : 0) });
  return label('fileDrop.sizeMb', { size: format.num(bytes / (1024 * 1024), 1) });
}

/** A limit rounded down to one decimal, so "up to 7.6 MB" never promises more than allowed. */
function sizeLimit(bytes: number, format: SizeFormat, label: LabelFn): string {
  const floor1 = (n: number) => format.num(Math.floor(n * 10 + 1e-9) / 10);
  if (bytes < 1024) return label('fileDrop.sizeBytes', { size: format.int(bytes) });
  if (bytes < 1024 * 1024) return label('fileDrop.sizeKb', { size: floor1(bytes / 1024) });
  return label('fileDrop.sizeMb', { size: floor1(bytes / (1024 * 1024)) });
}

function accepts(file: File, accept: string | undefined): boolean {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '')
    .some((part) => {
      if (part.startsWith('.')) return name.endsWith(part);
      if (part.endsWith('/*')) return type.startsWith(part.slice(0, -1));
      return type === part;
    });
}

/**
 * A drop zone in Ant Design's dragger style around a real <input type="file">: click or press it to browse, or drop
 * files on it. Refused files are explained in an alert; chosen files are listed with a remove button each.
 */
export function FileDrop({ accept, maxSize, hint, multiple = false, onFiles, onReject, id, className }: FileDropProps) {
  const label = useLabels();
  const format = useFormat();
  const generated = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = id ?? `file-drop-${generated}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const rejectId = `${inputId}-reject`;
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<{ round: number; lines: string[] } | null>(null);

  function take(list: FileList | null) {
    if (!list || list.length === 0) return;
    const accepted: File[] = [];
    const rejected: FileRejection[] = [];
    const lines: string[] = [];
    for (const file of Array.from(list)) {
      if (!accepts(file, accept)) {
        rejected.push({ file, reason: 'type' });
        lines.push(label('fileDrop.rejectType', { name: file.name }));
      } else if (maxSize !== undefined && file.size > maxSize) {
        rejected.push({ file, reason: 'size' });
        lines.push(label('fileDrop.rejectSize', { name: file.name, max: sizeLimit(maxSize, format, label) }));
      } else {
        accepted.push(file);
      }
    }
    if (rejected.length > 0) onReject?.(rejected);
    setRefused((previous) => (rejected.length > 0 && !onReject ? { round: (previous?.round ?? 0) + 1, lines } : null));
    if (accepted.length === 0) return;
    const next = multiple ? [...files, ...accepted] : accepted.slice(0, 1);
    setFiles(next);
    onFiles?.(next);
  }

  function remove(index: number) {
    const next = files.filter((_, i) => i !== index);
    setFiles(next);
    onFiles?.(next);
  }

  function onDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!over) setOver(true);
  }

  function onDragLeave(event: DragEvent<HTMLLabelElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setOver(false);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setOver(false);
    take(event.dataTransfer.files);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    take(event.target.files);
    event.target.value = '';
  }

  return (
    <div className={cx(styles.fileDrop, className)}>
      <label
        htmlFor={inputId}
        className={cx(styles.zone, over && styles.over)}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          className={styles.input}
          aria-describedby={[hintId, refused ? rejectId : undefined].filter(Boolean).join(' ') || undefined}
          onChange={onChange}
        />
        <InboxOutlined aria-label="" className={styles.zoneIcon} aria-hidden="true" />
        <span className={styles.prompt}>
          {over ? (
            label('fileDrop.dropToUpload')
          ) : (
            <>
              {label(multiple ? 'fileDrop.promptMany' : 'fileDrop.promptOne')}{' '}
              <span className={styles.browse}>{label('fileDrop.browse')}</span>
            </>
          )}
        </span>
        {hint ? (
          <span id={hintId} className={styles.hint}>
            {hint}
          </span>
        ) : null}
      </label>

      {refused ? (
        <div className={styles.refused}>
          <ExclamationCircleOutlined aria-label="" className={styles.refusedIcon} aria-hidden="true" />
          <div key={refused.round} id={rejectId} role="alert" className={styles.refusedText}>
            {refused.lines.map((line, index) => (
              <p key={`${String(index)}-${line}`}>{line}</p>
            ))}
          </div>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined aria-label="" aria-hidden="true" />}
            aria-label={label('fileDrop.dismiss')}
            onClick={() => {
              setRefused(null);
              inputRef.current?.focus();
            }}
          />
        </div>
      ) : null}

      {files.length > 0 ? (
        <ul role="list" className={styles.files} aria-label={label('fileDrop.selectedFiles')}>
          {files.map((file, index) => (
            <li key={`${file.name}-${String(file.size)}-${String(index)}`} className={styles.file}>
              <FileTextOutlined aria-label="" className={styles.fileIcon} aria-hidden="true" />
              <span className={styles.fileName} title={file.name}>
                {file.name}
              </span>
              <span className={styles.fileSize}>{fileSize(file.size, format, label)}</span>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined aria-label="" aria-hidden="true" />}
                aria-label={label('fileDrop.remove', { name: file.name })}
                onClick={() => remove(index)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
