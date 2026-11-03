// Hand-maintained data that stays on this machine (git-ignored: it reveals
// personal positions). Both files are optional, so a fresh clone still builds;
// the Assigned & Called section then shows "no price data" until they exist.
//   src/local/holdings.js  → export const HOLDINGS   (Fidelity lots)
//   src/local/assignmentsSample.js → export const SAMPLE_PRICES (price history)

/** @typedef {import('./assignments.js').Holdings} Holdings */
/** @typedef {import('./assignments.js').PriceHistory} PriceHistory */

const today = new Date().toISOString().slice(0, 10);
const modules =
  /** @type {Record<string, { HOLDINGS?: Holdings, SAMPLE_PRICES?: PriceHistory }>} */ (
    import.meta.glob(['./local/holdings.js', './local/assignmentsSample.js'], {
      eager: true,
    })
  );

/** @type {Holdings} */
export const HOLDINGS = modules['./local/holdings.js']?.HOLDINGS ?? {
  asOf: today,
  held: [],
  sold: [],
};

/** @type {PriceHistory} */
export const PRICES = modules['./local/assignmentsSample.js']?.SAMPLE_PRICES ?? {
  asOf: today,
  series: {},
};
