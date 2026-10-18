# 🎯⚖️ TEAM TOTALS & ASIAN HANDICAPS — METHODOLOGY v5.0
### Team Total Goals · Underdog Handicap (+) · Favourite Handicap (−)

> Core rules: `00-CORE-v5.md`. Code: `lib/methodology/goals.js` → `teamGoals`, `lib/methodology/results.js` → `dogPlus`, `favMinus`.

---

## 📊 THE EVIDENCE (held-out 2023-26)

| Methodology | v4 | v5 |
|---|---|---|
| Team Total Goals | 66.7% while **claiming 70.9%** · 1,733 | **68.5% (said 68.9%) · 2,635** |
| Underdog Handicap (+) | 70.4% (said 71.8%) · 2,273 | **75.9% (said 72.8%) · 2,097** |
| Favourite Handicap (−) | 67.0% · 109 | **70.4% (said 68.5%) · 477** |

v4's Team Totals were over-confident by four points — the calibration fixes that. The underdog handicap is
the biggest accuracy gain in v5 (+5.5 points).

---

## 🎯 TEAM TOTAL GOALS

Each side gets three candidate selections, each with its own floor:

| Selection | Floor | The idea |
|---|---|---|
| **Over 1.5** | 55% | A side that scores 2+ regularly, against a defence that lets it |
| **Under 1.5** | 62% | A side that rarely scores 2+, against an opponent that defends |
| **Under 0.5** (fails to score) | 42% | The shutout leg of BTTS No |

### Over 1.5 — hard gates
2+ goals in ≥ 50% of games and blanks ≤ 15% (Rule 29 style) · the opponent concedes ≥ 1.2/game or 2+ in ≥ 3/8 ·
expected goals ≥ 1.70 · the opponent is not a low block (Rule 26) · no rotation, **not missing ≥ 25% of its
attacking output (FPL)**, not a heavy underdog.

### Under 1.5 — hard gates
0–1 goals in ≥ 62% of games · expected goals ≤ 1.15 · the opponent concedes ≤ 1.15/game · not a heavy
favourite (Rule 25) · 3+ goals in ≤ 12% of games.

### Under 0.5 — hard gates
Blanks in ≥ 25% of games (Rule 4) · weak attack (≤ 1.0/game or xG ≤ 1.0) · the opponent keeps clean sheets
≥ 30% · not on a 3-game scoring run · the shutting side has no rotation or defensive absences.

Checklists cover scoring rate, opposition, xG, venue profile, regression (goals vs xG), three-goal upside,
blank frequency, attackers missing (FPL), and the **independent witness**.

---

## ⚖️ UNDERDOG HANDICAP (+)

Lines **+0.5** (floor 55%), **+1** (66%), **+1.5** (74%) for the side the consensus rates lower.

### Hard gates
| Gate | Pass criteria (tighter on bigger lines) |
|---|---|
| **LOSSES** (R2) | The underdog avoids heavy defeats: lost by 2+ in ≤ 30% / 25% (+1), by 3+ in ≤ 12% (+1.5) |
| **MARGIN** (R19) | The favourite is not a big-margin side: won by 2+ in ≤ 40% (≤ 30% for +1.5) |
| **BLOW** (R14) | Model chance of losing the bet ≤ 45% / 26% / 18% |
| **SCORES** (R4) | The underdog can score (blanks ≤ 40%) |
| **NEWS** | Underdog's defence intact, no rotation or mass absences |
| **FALL** (R20) | Not 6+ winless while conceding 2.0+/game |

**Measured:** a low expected total and a low-block underdog both added ~1.5 points of accuracy — a +handicap
lives on games that stay tight.

`+1` pushes (stake returned) when the favourite wins by exactly one.

---

## ⚖️ FAVOURITE HANDICAP (−)

Lines **−1** (floor 50%) and **−1.5** (42%) for the consensus favourite only.

### Hard gates
| Gate | Pass criteria |
|---|---|
| **MARGIN** (R19) | Wins by 2+ in ≥ 30% (≥ 40% for −1.5) — check *how* it wins |
| **SCORE2** (R4) | Scores 2+ in ≥ 55% of games |
| **DOGLEAK** (R26) | The underdog concedes ≥ 1.3/game and is not a low block |
| **PUSH** (R14) | Model chance of a 2+ goal win ≥ 30% |
| **ELO** (R13) | Elo expectancy ≥ 68% (waived without a rating) |
| **NEWS / ATT** (R15) | No rotation; **< 20% of attacking output missing (FPL)** |
| **STREAK** (R20) | A win streak backed by the numbers, not reputation |

`−1` pushes on an exact one-goal win.

---

## 🛠️ CHEAT SHEET
**Team total:** the side's own 0/1/2+ distribution agrees, the opponent's defence agrees, attackers available.
**Underdog +:** a narrow-defeat side against a non-margin favourite in a low-total game.
**Favourite −:** a margin side, attack intact, against a leaky non-low-block underdog.
Always: your price ≥ take-at, 1 unit.

*v5.0 · evidence: `research/backtest_methods.js`*
