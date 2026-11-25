// SPDX-License-Identifier: AGPL-3.0-only
// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
import { describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit';
import { ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { cancelImportUpload, completeImportUpload, createImportUpload, getImportUpload, putImportUploadChunk, startImportStep } from './import-uploads';
import { getImportJob } from './imports';
import { ctxFor, withTempDemoState } from './test-support';

const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

const HEADER = 'RecordID,CaseNumber,RegisteredTime,CityID,CityNameEn,ZoneID,ZoneNameEn,SubZoneID,SubZoneNameEn,Latitude,Longitude,CaseTypeID,CaseTypeNameEn,PartyCount,AssignedTime,ArrivalTime,ClosingTime';

// SYNTHETIC rows, built here, never read from disk
function syntheticCsv(rows: number): Uint8Array<ArrayBuffer> {
  const lines = [HEADER];
  for (let i = 0; i < rows; i++) lines.push(`${String(9700000 + i)},RD-260921-${String(i)},2026-09-21 08:00:00,101,Riyadh,2001,Riyadh Central,30001,Juniper Square,24.71,46.68,1,Standard case,2,2026-09-21 08:03:00,2026-09-21 08:12:00,2026-09-21 08:40:00`);
  return new TextEncoder().encode(`${lines.join('\n')}\n`);
}

const streamOf = (bytes: Uint8Array<ArrayBuffer>) => ({ stream: new Blob([bytes]).stream(), length: bytes.length });

describe.skipIf(!hasApi)('chunked import upload (live, real api, Postgres and MinIO)', () => {
  if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: import-uploads.live.test.ts is skipped, not faked.');
  withTempDemoState();
  const admin = () => ctxFor('administrator');

  it('takes an 8 MiB-chunked file out of order, joins it and makes an uploaded job; the upload is audited', async () => {
    const file = syntheticCsv(60000);
    const s = await createImportUpload(admin(), { file_name: 'synthetic_chunked.csv', size: file.length, mapping_version: 'generic_csv_v1', data_source: 'SYNTHETIC' });
    expect(s).toMatchObject({ chunk_size: 8 * 2 ** 20, chunk_count: Math.ceil(file.length / (8 * 2 ** 20)), received_chunks: [], data_source: 'SYNTHETIC' });
    expect(s.chunk_count).toBeGreaterThan(1);
    for (const i of [...Array(s.chunk_count).keys()].reverse()) {
      await putImportUploadChunk(admin(), s.id, i, streamOf(file.subarray(i * s.chunk_size, (i + 1) * s.chunk_size)));
    }
    expect((await getImportUpload(admin(), s.id)).received_bytes).toBe(file.length);
    const job = await completeImportUpload(admin(), s.id);
    expect(job).toMatchObject({ status: 'uploaded', row_count: 60000, file_name: 'synthetic_chunked.csv', data_source: 'SYNTHETIC' });
    const audit = await listAuditEvents(admin(), { limit: 200 });
    expect(audit.items.some((e) => e.action === 'import.uploaded' && e.entity_id === job.id)).toBe(true);
    await expect(getImportUpload(admin(), s.id)).rejects.toBeInstanceOf(NotFoundError);

    // validate in the background, polled; a second start is refused
    const running = await startImportStep(admin(), job.id, { step: 'validate' });
    expect(running).toMatchObject({ step: 'validate', step_state: 'running', step_rows_total: 60000 });
    let now = running;
    for (let i = 0; i < 100 && now.step_state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 200));
      now = await getImportJob(admin(), job.id);
    }
    expect(now).toMatchObject({ status: 'validated', step_state: 'succeeded', step_rows_done: 60000, row_count: 60000 });
    await expect(startImportStep(ctxFor('planner'), job.id, { step: 'compare' })).rejects.toBeInstanceOf(ForbiddenError);
  }, 60_000);

  it('refuses a wrong length, a missing chunk, over 1 GB, and anyone but an editor', async () => {
    await expect(createImportUpload(admin(), { file_name: 'huge.csv', size: 2 ** 30 + 1, mapping_version: 'generic_csv_v1' })).rejects.toBeInstanceOf(InvalidInputError);
    await expect(createImportUpload(ctxFor('planner'), { file_name: 'p.csv', size: 10, mapping_version: 'generic_csv_v1' })).rejects.toBeInstanceOf(ForbiddenError);
    const file = syntheticCsv(10);
    const s = await createImportUpload(admin(), { file_name: 'short.csv', size: file.length, mapping_version: 'generic_csv_v1' });
    await expect(putImportUploadChunk(admin(), s.id, 0, streamOf(file.subarray(1)))).rejects.toBeInstanceOf(InvalidInputError);
    await expect(putImportUploadChunk(ctxFor('planner'), s.id, 0, streamOf(file))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(completeImportUpload(admin(), s.id)).rejects.toThrow(/have not arrived/);
    await cancelImportUpload(admin(), s.id);
    await expect(getImportUpload(admin(), s.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
