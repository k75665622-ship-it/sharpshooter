'use strict';

/**
 * settle.js — settle any market key on a final regular-time score.
 * 1 = win, 0 = lose, null = push / void / unknown key.
 * Shared by the ledger (live track record) and the research backtests.
 */

function settle(key, hg, ag) {
  const t = hg + ag;
  let m;
  switch (true) {
    case key === '1': return hg > ag ? 1 : 0;
    case key === 'X': return hg === ag ? 1 : 0;
    case key === '2': return hg < ag ? 1 : 0;
    case key === '1X': return hg >= ag ? 1 : 0;
    case key === 'X2': return hg <= ag ? 1 : 0;
    case key === '12': return hg !== ag ? 1 : 0;
    case key === 'DNB_H': return hg === ag ? null : hg > ag ? 1 : 0;
    case key === 'DNB_A': return hg === ag ? null : ag > hg ? 1 : 0;
    case key === 'BTTS_Y': return hg > 0 && ag > 0 ? 1 : 0;
    case key === 'BTTS_N': return hg > 0 && ag > 0 ? 0 : 1;
    case key === 'GG2P': return hg >= 2 && ag >= 2 ? 1 : 0;
    case (m = /^([OU])(\d\.5)$/.exec(key)) !== null: return m[1] === 'O' ? (t > Number(m[2]) ? 1 : 0) : t < Number(m[2]) ? 1 : 0;
    case (m = /^TT([HA])_([OU])(\d\.5)$/.exec(key)) !== null: {
      const g = m[1] === 'H' ? hg : ag;
      return m[2] === 'O' ? (g > Number(m[3]) ? 1 : 0) : g < Number(m[3]) ? 1 : 0;
    }
    case (m = /^AH_([HA])_(-?\d+(?:\.\d+)?)$/.exec(key)) !== null: {
      const line = Number(m[2]);
      const d = m[1] === 'H' ? hg - ag + line : ag - hg - line;
      return d > 1e-9 ? 1 : d < -1e-9 ? 0 : null;
    }
    case (m = /^CS_(\d+)-(\d+)$/.exec(key)) !== null: return hg === Number(m[1]) && ag === Number(m[2]) ? 1 : 0;
    default: return null;
  }
}

module.exports = { settle };
