// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { refusalOf } from './refusal';

describe('refusalOf', () => {
  it('names a second assignment in plain words and keeps the code line as the detail', () => {
    const line = 'ALREADY_ASSIGNED: RD-260913-00901 already has an assignment (OpenDispatch).';
    expect(refusalOf({ code: 'conflict', message: line })).toEqual({ plain: 'taken', detail: line });
  });

  it('leaves any other refusal to the generic line, and drops a detail that is not the server\'s', () => {
    expect(refusalOf({ code: 'forbidden', message: 'Not allowed.' })).toEqual({ plain: 'other', detail: 'Not allowed.' });
    expect(refusalOf({ code: 'network', message: '' })).toEqual({ plain: 'other', detail: '' });
  });
});
