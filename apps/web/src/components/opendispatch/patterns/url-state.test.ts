// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { buildHref, hrefOf, normaliseQuery, patchQuery } from './url-state';

describe('normaliseQuery', () => {
  it('accepts a string with or without the question mark, or URLSearchParams', () => {
    expect(normaliseQuery('?a=1&b=2')).toBe('a=1&b=2');
    expect(normaliseQuery('a=1')).toBe('a=1');
    expect(normaliseQuery(new URLSearchParams('a=1'))).toBe('a=1');
    expect(normaliseQuery('')).toBe('');
  });

  it('keeps the first of a repeated key', () => {
    expect(normaliseQuery('q=a&q=b&tab=roles')).toBe('q=a&tab=roles');
  });
});

describe('patchQuery', () => {
  it('sets a value and keeps the rest', () => {
    expect(patchQuery('tab=roles', { role: 'planner' })).toBe('tab=roles&role=planner');
  });

  it('removes a key given null, undefined or an empty string', () => {
    expect(patchQuery('q=a&role=planner&status=active', { q: null, role: undefined, status: '' })).toBe('');
  });

  it('replaces a value in place', () => {
    expect(patchQuery('role=planner&q=x', { role: 'dispatcher' })).toBe('role=dispatcher&q=x');
  });

  it('sends the list back to page 1 when a filter, the search or the sort changes', () => {
    expect(patchQuery('page=3&role=planner', { role: 'dispatcher' })).toBe('role=dispatcher');
    expect(patchQuery('page=3', { q: 'nour' })).toBe('q=nour');
    expect(patchQuery('page=3', { sort: 'name:asc' })).toBe('sort=name%3Aasc');
  });

  it('keeps the page when the page itself, the open record or the invite flag changes', () => {
    expect(patchQuery('page=3', { id: '5' })).toBe('page=3&id=5');
    expect(patchQuery('page=3&id=5', { id: null })).toBe('page=3');
    expect(patchQuery('page=3', { new: '1' })).toBe('page=3&new=1');
    expect(patchQuery('page=3', { page: '4' })).toBe('page=4');
  });

  it('keeps the page on request', () => {
    expect(patchQuery('page=3', { role: 'planner' }, { keepPage: true })).toBe('page=3&role=planner');
  });

  it('encodes values, so a hostile value cannot add a parameter', () => {
    const query = patchQuery('', { q: 'a&role=administrator#x=y' });
    expect(new URLSearchParams(query).get('q')).toBe('a&role=administrator#x=y');
    expect([...new URLSearchParams(query).keys()]).toEqual(['q']);
  });
});

describe('hrefOf and buildHref', () => {
  it('has no question mark when the query is empty', () => {
    expect(hrefOf('/admin/users-roles', '')).toBe('/admin/users-roles');
    expect(hrefOf('/admin/users-roles', 'tab=roles')).toBe('/admin/users-roles?tab=roles');
  });

  it('builds the address from the path, the current query and a patch', () => {
    expect(buildHref('/admin/users-roles', 'tab=roles&q=x', { q: null })).toBe('/admin/users-roles?tab=roles');
    expect(buildHref('/admin/users-roles', '', { id: 'abc' })).toBe('/admin/users-roles?id=abc');
  });
});
