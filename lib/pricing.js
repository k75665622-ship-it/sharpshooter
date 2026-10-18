'use strict';

/**
 * pricing.js — v5 price information per market.
 *
 * What the backtest taught (research/edge_study.js, research/shop_study.js):
 *   - Betting where OUR MODEL disagrees with the bookmakers lost money on held-out
 *     seasons, and lost MORE the larger the disagreement. Model/market disagreement
 *     is mostly model error.
 *   - The only positive signal was a PRICE that beats the de-vigged multi-book
 *     consensus, and only for selections the market rates 30-75% likely
 *     (longshots at a "generous" price lost heavily — the stale outlier trap).
 *
 * So v5 attaches to every market:
 *   consensus  the fair probability from the de-vigged book consensus, and how
 *              many books built it
 *   best       the best real price seen, and which book
 *   valuePrice the price you need to see (at YOUR bookmaker) for the pick to be
 *              worth staking: fair odds x 1.03, never below 1.25
 *   priceEdge  best x consensus-fair probability (>= 1.03 is a price edge)
 */

const VALUE_MARGIN = 1.03;
const MIN_PRICE = 1.25;
const EDGE_BAND = [0.3, 0.75];

function fairFor(key, cons) {
  if (!cons) return null;
  const x = cons.x12;
  let m;
  switch (true) {
    case key === '1': return x ? { p: x.fair.home, books: x.books, best: x.best && x.best.h } : null;
    case key === 'X': return x ? { p: x.fair.draw, books: x.books, best: x.best && x.best.d } : null;
    case key === '2': return x ? { p: x.fair.away, books: x.books, best: x.best && x.best.a } : null;
    case key === '1X': return x ? { p: x.fair.home + x.fair.draw, books: x.books, best: null } : null;
    case key === '12': return x ? { p: x.fair.home + x.fair.away, books: x.books, best: null } : null;
    case key === 'X2': return x ? { p: x.fair.draw + x.fair.away, books: x.books, best: null } : null;
    case key === 'DNB_H': return x ? { p: x.fair.home / (x.fair.home + x.fair.away), books: x.books, best: null } : null;
    case key === 'DNB_A': return x ? { p: x.fair.away / (x.fair.home + x.fair.away), books: x.books, best: null } : null;
    case (m = /^([OU])(\d+(?:\.\d+)?)$/.exec(key)) !== null: {
      const t = cons.totals && cons.totals[Number(m[2])];
      if (!t) return null;
      return m[1] === 'O'
        ? { p: t.fair.over, books: t.books, best: t.best && t.best.over }
        : { p: t.fair.under, books: t.books, best: t.best && t.best.under };
    }
    default: return null;
  }
}

/**
 * Attach v5 price information to every market (mutates and returns `markets`).
 * Markets the consensus does not cover keep whatever v4 attached (DK / Asian /
 * synthetic) and get a valuePrice from our own probability.
 */
function attach(markets, cons) {
  for (const mk of markets) {
    const f = fairFor(mk.key, cons);
    const bestFromV4 = mk.priceSource && String(mk.priceSource).startsWith('book') ? { price: mk.priceBest || mk.price, book: mk.priceSource === 'book' ? 'DraftKings' : mk.priceSource === 'book-asian' ? 'Asian books' : 'derived' } : null;
    const best = f && f.best ? f.best : bestFromV4;
    const consensus = f ? { prob: f.p, fairOdds: 1 / f.p, books: f.books } : null;
    const prob = mk.prob;
    mk.v5price = {
      consensus,
      best: best && best.price > 1 ? best : null,
      valuePrice: Math.max(MIN_PRICE, VALUE_MARGIN / prob),
      priceEdge: consensus && best && best.price > 1 ? best.price * consensus.prob : null,
    };
  }
  return markets;
}

/**
 * Price state for a methodology verdict.
 *   value      a real price beats the multi-book consensus by >= 3%, in the 30-75% band,
 *              with >= 2 books behind the consensus — the only state that can LOCK
 *   fair       priced, but no book beats consensus by enough (prediction, not a value bet)
 *   too-short  fair odds under 1.25: right or wrong, there is little to win (Rule 7)
 *   unpriced   no book quote for this market
 */
function priceState(mk) {
  if (!mk) return { state: 'unpriced', note: 'Market not derived for this fixture.' };
  const v = mk.v5price || {};
  const fairOdds = 1 / mk.prob;
  const base = {
    fairOdds,
    valuePrice: v.valuePrice,
    best: v.best ? v.best.price : null,
    bestBook: v.best ? v.best.book : null,
    consensusProb: v.consensus ? v.consensus.prob : null,
    books: v.consensus ? v.consensus.books : 0,
    priceEdge: v.priceEdge,
    // legacy fields the UI and older consumers read
    price: v.best ? v.best.price : null,
    ev: v.best ? mk.prob * v.best.price - 1 : null,
  };
  if (fairOdds < MIN_PRICE) {
    return { ...base, state: 'too-short', note: `Fair odds ${fairOdds.toFixed(2)} are below ${MIN_PRICE.toFixed(2)} — likely right, but too little to win (Rule 7). Use it inside a 2-leg double at most.` };
  }
  if (!v.best) {
    return { ...base, state: 'unpriced', note: `No book quote found. Only take it at ${v.valuePrice.toFixed(2)} or better.` };
  }
  const band = v.consensus && v.consensus.prob >= EDGE_BAND[0] && v.consensus.prob <= EDGE_BAND[1];
  if (v.priceEdge != null && v.priceEdge >= VALUE_MARGIN && band && v.consensus.books >= 2) {
    return { ...base, state: 'value', note: `${v.best.book} pays ${v.best.price.toFixed(2)}, ${((v.priceEdge - 1) * 100).toFixed(1)}% above the ${v.consensus.books}-book fair price ${v.consensus.fairOdds.toFixed(2)}.` };
  }
  return { ...base, state: 'fair', note: `Best seen ${v.best.price.toFixed(2)} (${v.best.book}). Value only at ${v.valuePrice.toFixed(2)} or better — check your bookmaker.` };
}

module.exports = { attach, priceState, fairFor, VALUE_MARGIN, MIN_PRICE, EDGE_BAND };
