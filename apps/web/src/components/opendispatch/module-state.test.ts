// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseModuleState, parseReviewState } from './module-state';

describe('parseModuleState', () => {
  it('accepts the four states', () => {
    for (const state of ['empty', 'loading', 'error', 'noaccess'] as const) expect(parseModuleState(state)).toBe(state);
  });

  it('is empty by default and for anything else', () => {
    expect(parseModuleState(undefined)).toBe('empty');
    expect(parseModuleState('')).toBe('empty');
    expect(parseModuleState('filled')).toBe('empty');
    expect(parseModuleState('ERROR')).toBe('empty');
  });

  it('uses the first value when the parameter is repeated', () => {
    expect(parseModuleState(['error', 'loading'])).toBe('error');
    expect(parseModuleState([])).toBe('empty');
  });
});

// PHASE A DEMO TOOLING: a real screen shows its data unless the URL asks for one of the states.
describe('parseReviewState', () => {
  it('accepts the four states', () => {
    for (const state of ['empty', 'loading', 'error', 'noaccess'] as const) expect(parseReviewState(state)).toBe(state);
  });

  it('is undefined (the real content) with no parameter, and for anything unknown, filled included', () => {
    expect(parseReviewState(undefined)).toBeUndefined();
    expect(parseReviewState('')).toBeUndefined();
    expect(parseReviewState('filled')).toBeUndefined();
    expect(parseReviewState('ERROR')).toBeUndefined();
    expect(parseReviewState('error ')).toBeUndefined();
  });

  it('uses the first value when the parameter is repeated, and nothing for an empty list', () => {
    expect(parseReviewState(['loading', 'error'])).toBe('loading');
    expect(parseReviewState(['nope', 'error'])).toBeUndefined();
    expect(parseReviewState([])).toBeUndefined();
  });
});
