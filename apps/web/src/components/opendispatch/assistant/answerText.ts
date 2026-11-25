// SPDX-License-Identifier: AGPL-3.0-only
// Assistant text as paragraphs and lists, no HTML

export type AnswerBlock = { readonly kind: 'p'; readonly text: string } | { readonly kind: 'ul' | 'ol'; readonly items: readonly string[] };

const BULLET = /^\s*[-*+•]\s+/;
const NUMBERED = /^\s*\d{1,2}[.)]\s+/;

/** One line without Markdown marks. */
export function plainLine(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*([^*\n]+?)\*/g, '$1$2')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}

/** Splits an answer into paragraphs and lists; Markdown is dropped, never rendered as HTML. */
export function answerBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (para.length > 0) blocks.push({ kind: 'p', text: para.join('\n') });
    if (list !== null) blocks.push(list);
    para = [];
    list = null;
  };
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*```/.test(raw) || /^\s*\|?\s*:?-{2,}/.test(raw)) continue;
    const kind = BULLET.test(raw) ? 'ul' : NUMBERED.test(raw) ? 'ol' : null;
    if (kind !== null) {
      const item = plainLine(raw.replace(kind === 'ul' ? BULLET : NUMBERED, ''));
      if (list === null || list.kind !== kind) {
        flush();
        list = { kind, items: [] };
      }
      if (item !== '') list.items.push(item);
      continue;
    }
    const line = plainLine(raw);
    if (line === '') {
      flush();
      continue;
    }
    if (/^\s*#{1,6}\s/.test(raw)) {
      flush();
      blocks.push({ kind: 'p', text: line });
      continue;
    }
    if (list !== null) flush();
    para.push(line);
  }
  flush();
  return blocks;
}
