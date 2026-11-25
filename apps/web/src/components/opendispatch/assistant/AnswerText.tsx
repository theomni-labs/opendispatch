// SPDX-License-Identifier: AGPL-3.0-only
import { answerBlocks } from './answerText';
import styles from './Assistant.module.css';

// An answer's text: paragraphs and lists only

export function AnswerText({ text }: { readonly text: string }) {
  return (
    <div className={styles.answerText} data-assistant="text">
      {answerBlocks(text).map((block, index) =>
        block.kind === 'p' ? (
          <p key={index} className={styles.text}>
            {block.text}
          </p>
        ) : block.kind === 'ul' ? (
          <ul key={index} className={styles.list}>
            {block.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          <ol key={index} className={styles.list}>
            {block.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}
