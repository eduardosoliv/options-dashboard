// biome-ignore lint/correctness/noNodejsModules: test reads source files in Node, not the browser
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Chrome evaluates md:/lg: media queries against the paper, not the @page size
// print.js sets, so index.css re-applies each md:/lg:/xl: grid class for print.
// A new one used in a component without a print override would print as one
// column again.
const src = new URL('.', import.meta.url);
const css = readFileSync(new URL('index.css', src), 'utf8');
const printBlock = css.slice(css.indexOf('@media print'));

const components = readdirSync(src)
  .filter((f) => f.endsWith('.jsx') && !f.includes('.test.'))
  .map((f) => readFileSync(new URL(f, src), 'utf8'));
const used = new Set(
  components.flatMap((code) =>
    [...code.matchAll(/\b(?:md|lg|xl):grid-cols-\d+\b/g)].map((m) => m[0]),
  ),
);
const dashboard = readFileSync(new URL('TradingDashboard.jsx', src), 'utf8');
const section = readFileSync(new URL('AssignmentsSection.jsx', src), 'utf8');

describe('print CSS', () => {
  it('finds the responsive grid classes the dashboard uses', () => {
    expect(used.size).toBeGreaterThan(0);
  });

  it.each([...used])('re-applies %s for print', (cls) => {
    expect(printBlock).toContain(`.${cls.replace(':', '\\:')}`);
  });
});

// The white-paper print theme matches exact classes and colors from the
// components. If one changes there, its print rule silently stops applying.
describe('print theme hooks still exist in the components', () => {
  it.each([
    'bg-amber-500',
    'bg-emerald-500/20',
    'bg-rose-500/20',
    'bg-sky-500/20',
    'bg-zinc-700/50',
  ])('selected toggle fill %s is used by the dashboard and outlined for print', (cls) => {
    expect(dashboard).toContain(`'${cls} `);
    expect(printBlock).toContain(`button.${cls.replace('/', '\\/')}`);
  });

  it('darkens the Total line color the section actually uses', () => {
    expect(section).toContain("const TOTAL_COLOR = '#e4e4e7';");
    // biome-ignore lint/security/noSecrets: a hex color, not a secret
    expect(printBlock).toContain('[stroke="#e4e4e7"]');
  });

  it('whitens the hollow end-ring fill the section actually uses', () => {
    expect(section).toContain("'#111113'");
    // biome-ignore lint/security/noSecrets: a hex color, not a secret
    expect(printBlock).toContain('[fill="#111113"]');
  });

  it('keys the box selection on aria-pressed, which the boxes set', () => {
    expect(section).toContain('aria-pressed={active}');
    expect(printBlock).toContain('button[aria-pressed="true"]');
  });

  it('darkens the light label fills the dashboard sets inline', () => {
    expect(dashboard).toContain("fill: '#fafafa'");
    expect(dashboard).toContain("fill: '#e4e4e7'");
    expect(printBlock).toContain('rgb(250, 250, 250)');
    expect(printBlock).toContain('rgb(228, 228, 231)');
  });
});
