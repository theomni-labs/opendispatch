// SPDX-License-Identifier: AGPL-3.0-only
// Hand-written SVG charts for the by-eye calibration checks. No chart dependency. Deterministic output.
// PURE TypeScript, no Node imports.

export interface Series {
  readonly label: string;
  readonly values: readonly number[];
  readonly kind: 'bars' | 'line';
  readonly color: string;
}

export interface Marker {
  /** Position on the x axis, in the same units as the category index (fractional allowed). */
  readonly at: number;
  readonly label: string;
}

export interface ChartSpec {
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  readonly categories: readonly string[];
  readonly series: readonly Series[];
  readonly yLabel: string;
  /** Show every n-th category label. */
  readonly labelEvery: number;
  readonly markers?: readonly Marker[];
  readonly width?: number;
  readonly height?: number;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number): string => (Math.round(n * 100) / 100).toString();

/** Greedy word wrap on spaces. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line.length + word.length + 1 > width && line.length > 0) {
      lines.push(line);
      line = word;
    } else line = line.length === 0 ? word : `${line} ${word}`;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const m = v / exp;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return step * exp;
}

export function chartSvg(spec: ChartSpec): string {
  const W = spec.width ?? 960;
  const H = spec.height ?? 440;
  const subtitleLines = wrap(spec.subtitle, Math.floor((W - 92) / 6.4));
  const m = { top: 62 + subtitleLines.length * 15 + 14, right: 28, bottom: 64, left: 64 };
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;
  const n = spec.categories.length;
  const max = niceMax(Math.max(...spec.series.flatMap((s) => [...s.values])));
  const x = (i: number): number => m.left + (pw * (i + 0.5)) / n;
  const y = (v: number): number => m.top + ph - (ph * v) / max;
  const barW = Math.max(1, (pw / n) * 0.78);

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d" font-family="Arial, Helvetica, sans-serif">`);
  out.push(`<title id="t">${esc(spec.title)}</title>`);
  out.push(`<desc id="d">${esc(spec.description)}</desc>`);
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  out.push(`<text x="${m.left}" y="28" font-size="18" font-weight="bold" fill="#1f2933">${esc(spec.title)}</text>`);
  subtitleLines.forEach((line, i) => {
    out.push(`<text x="${m.left}" y="${48 + i * 15}" font-size="12" fill="#52606d">${esc(line)}</text>`);
  });

  // Legend
  let lx = m.left;
  const ly = 48 + subtitleLines.length * 15 + 8;
  for (const s of spec.series) {
    out.push(s.kind === 'bars' ? `<rect x="${lx}" y="${ly - 9}" width="12" height="10" fill="${s.color}"/>` : `<line x1="${lx}" y1="${ly - 4}" x2="${lx + 16}" y2="${ly - 4}" stroke="${s.color}" stroke-width="2.5"/>`);
    out.push(`<text x="${lx + 22}" y="${ly}" font-size="12" fill="#323f4b">${esc(s.label)}</text>`);
    lx += 40 + s.label.length * 6.4;
  }

  // Grid and y axis
  const ticks = 5;
  for (let i = 0; i <= ticks; i += 1) {
    const v = (max * i) / ticks;
    out.push(`<line x1="${m.left}" y1="${f(y(v))}" x2="${W - m.right}" y2="${f(y(v))}" stroke="#e4e7eb" stroke-width="1"/>`);
    out.push(`<text x="${m.left - 8}" y="${f(y(v) + 4)}" font-size="11" text-anchor="end" fill="#52606d">${f(v)}</text>`);
  }
  out.push(`<text transform="translate(16 ${f(m.top + ph / 2)}) rotate(-90)" font-size="12" text-anchor="middle" fill="#52606d">${esc(spec.yLabel)}</text>`);

  // Bars, then lines on top
  for (const s of spec.series.filter((k) => k.kind === 'bars')) {
    s.values.forEach((v, i) => {
      out.push(`<rect x="${f(x(i) - barW / 2)}" y="${f(y(v))}" width="${f(barW)}" height="${f(Math.max(0, m.top + ph - y(v)))}" fill="${s.color}"/>`);
    });
  }
  for (const s of spec.series.filter((k) => k.kind === 'line')) {
    const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${f(x(i))} ${f(y(v))}`).join(' ');
    out.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"/>`);
  }

  // Markers (vertical dashed lines)
  for (const mk of spec.markers ?? []) {
    const mx = m.left + (pw * (mk.at + 0.5)) / n;
    out.push(`<line x1="${f(mx)}" y1="${m.top}" x2="${f(mx)}" y2="${m.top + ph}" stroke="#7b1e3a" stroke-width="1.5" stroke-dasharray="5 4"/>`);
    out.push(`<text x="${f(mx + 4)}" y="${m.top + 12}" font-size="11" fill="#7b1e3a">${esc(mk.label)}</text>`);
  }

  // X axis
  out.push(`<line x1="${m.left}" y1="${m.top + ph}" x2="${W - m.right}" y2="${m.top + ph}" stroke="#7b8794" stroke-width="1"/>`);
  spec.categories.forEach((c, i) => {
    if (i % spec.labelEvery !== 0) return;
    out.push(`<line x1="${f(x(i))}" y1="${m.top + ph}" x2="${f(x(i))}" y2="${m.top + ph + 4}" stroke="#7b8794"/>`);
    out.push(`<text x="${f(x(i))}" y="${m.top + ph + 18}" font-size="11" text-anchor="middle" fill="#52606d">${esc(c)}</text>`);
  });
  out.push(`<text x="${W - m.right}" y="${H - 12}" font-size="11" text-anchor="end" fill="#7b8794">Synthetic data. Illustrative, never a measured result.</text>`);
  out.push('</svg>');
  return `${out.join('\n')}\n`;
}
