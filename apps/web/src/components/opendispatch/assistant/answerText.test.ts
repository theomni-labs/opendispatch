// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { answerBlocks, plainLine } from './answerText';

describe('answerBlocks', () => {
  it('drops Markdown marks and keeps the words', () => {
    expect(plainLine('## **الطلب المتوقع** 247.6 بلاغ، *أقل* من المعتاد `x`')).toBe('الطلب المتوقع 247.6 بلاغ، أقل من المعتاد x');
    expect(plainLine('2 * 3 = 6, x0.94')).toBe('2 * 3 = 6, x0.94');
  });

  it('splits paragraphs and lists', () => {
    const text = 'First line.\nSame paragraph.\n\n* one\n- **two**\n1. first\n2) second\n|---|---|\nAfter.';
    expect(answerBlocks(text)).toEqual([
      { kind: 'p', text: 'First line.\nSame paragraph.' },
      { kind: 'ul', items: ['one', 'two'] },
      { kind: 'ol', items: ['first', 'second'] },
      { kind: 'p', text: 'After.' },
    ]);
  });

  it('keeps markup as text: nothing is HTML', () => {
    expect(answerBlocks('<img src=x onerror=alert(1)>')).toEqual([{ kind: 'p', text: '<img src=x onerror=alert(1)>' }]);
  });
});
