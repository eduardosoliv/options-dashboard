// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { contentWidth, installPrintLayout, pageRule } from './print.js';

describe('pageRule', () => {
  it('sizes the page to the screen width plus margins, in Letter proportions', () => {
    expect(pageRule(1392)).toBe('@page { size: 1440px 1864px; margin: 24px; }');
  });
});

describe('installPrintLayout', () => {
  it('adds the @page rule before printing and removes it after', () => {
    const uninstall = installPrintLayout(window);
    window.dispatchEvent(new Event('beforeprint'));
    const rule = [...document.head.querySelectorAll('style')].find((s) =>
      s.textContent?.startsWith('@page'),
    );
    expect(rule).toBeDefined();
    window.dispatchEvent(new Event('afterprint'));
    expect(rule?.isConnected).toBe(false);
    uninstall();
  });

  it('stops reacting to print events once uninstalled', () => {
    installPrintLayout(window)();
    window.dispatchEvent(new Event('beforeprint'));
    const rules = [...document.head.querySelectorAll('style')].filter((s) =>
      s.textContent?.startsWith('@page'),
    );
    expect(rules).toHaveLength(0);
  });
});

describe('contentWidth', () => {
  it('uses the centred column plus wrapper padding, not the whole window', () => {
    document.body.innerHTML =
      '<div id="root"><div style="padding: 0 24px"><div class="mx-auto"></div></div></div>';
    const column = /** @type {HTMLElement} */ (document.querySelector('.mx-auto'));
    column.getBoundingClientRect = () => /** @type {DOMRect} */ ({ width: 1280 });
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: 1900,
      configurable: true,
    });
    expect(contentWidth(document)).toBe(1328);
  });

  it('falls back to the viewport when the column is missing', () => {
    document.body.innerHTML = '<div id="root"></div>';
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: 1000,
      configurable: true,
    });
    expect(contentWidth(document)).toBe(1000);
  });

  it('never exceeds the viewport, so a narrow window prints as it looks', () => {
    document.body.innerHTML =
      '<div id="root"><div style="padding: 0 24px"><div class="mx-auto"></div></div></div>';
    const column = /** @type {HTMLElement} */ (document.querySelector('.mx-auto'));
    column.getBoundingClientRect = () => /** @type {DOMRect} */ ({ width: 1280 });
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: 900,
      configurable: true,
    });
    expect(contentWidth(document)).toBe(900);
  });

  it('falls back to the viewport when the column has no layout yet', () => {
    document.body.innerHTML = '<div id="root"><div><div class="mx-auto"></div></div></div>';
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: 1200,
      configurable: true,
    });
    expect(contentWidth(document)).toBe(1200);
  });
});
