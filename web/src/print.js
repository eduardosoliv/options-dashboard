// Print the dashboard as it looks on screen. A paper-sized page is narrower
// than a desktop window, so the md/lg breakpoints drop to one widget per row,
// and recharts' ResponsiveContainer never re-measures for the print layout
// (ResizeObserver doesn't fire there), so charts keep their screen width and
// get clipped. Instead, just before printing, size the page to the current
// width of the dashboard's content (Letter proportions); the browser then
// scales that page to the paper, like a screenshot.

const MARGIN_PX = 24;
const LETTER_RATIO = 11 / 8.5;

/**
 * The @page rule that gives the print layout the same content width as the
 * screen.
 * @param {number} layoutWidth layout width in CSS px
 * @returns {string}
 */
export function pageRule(layoutWidth) {
  const width = Math.round(layoutWidth + 2 * MARGIN_PX);
  const height = Math.round(width * LETTER_RATIO);
  return `@page { size: ${width}px ${height}px; margin: ${MARGIN_PX}px; }`;
}

/**
 * Width the page needs to lay the dashboard out as on screen: its centred,
 * max-width column plus the wrapper's padding — not the whole window, or a
 * wide window leaves empty bands left and right. Falls back to the viewport.
 * @param {Document} doc
 * @returns {number}
 */
export function contentWidth(doc) {
  const viewport = doc.documentElement.clientWidth;
  const column = doc.querySelector('#root .mx-auto');
  const wrapper = column?.parentElement;
  if (!(column && wrapper)) return viewport;
  const style = doc.defaultView?.getComputedStyle(wrapper);
  const padding =
    (Number.parseFloat(style?.paddingLeft ?? '') || 0) +
    (Number.parseFloat(style?.paddingRight ?? '') || 0);
  const width = column.getBoundingClientRect().width + padding;
  return width > 0 ? Math.min(viewport, width) : viewport;
}

/**
 * Install the beforeprint/afterprint handlers. Returns an uninstall function.
 * @param {Window} win
 * @returns {() => void}
 */
export function installPrintLayout(win = window) {
  const doc = win.document;
  const style = doc.createElement('style');
  const before = () => {
    style.textContent = pageRule(contentWidth(doc));
    doc.head.append(style);
  };
  const after = () => style.remove();
  win.addEventListener('beforeprint', before);
  win.addEventListener('afterprint', after);
  return () => {
    win.removeEventListener('beforeprint', before);
    win.removeEventListener('afterprint', after);
    after();
  };
}
