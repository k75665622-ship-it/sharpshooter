# 🏠🤝✈️ RESULT MARKETS — METHODOLOGY v5.0
### Home Win · Away Win · Draw · Double Chance

> Rule 23 still applies: goals markets are binary, result markets have three outcomes. So result methodologies
> carry **higher floors** and an extra **independent witness (ClubElo)**. v5 adds calibrated probabilities, the
> multi-book favourite, FPL availability and a brand-new Double Chance methodology.
> Core rules: `00-CORE-v5.md`. Code: `lib/methodology/results.js`.

---

## 📊 THE EVIDENCE (held-out 2023-26)

| Methodology | v4 | v5 | ROI Bet365 | ROI best price |
|---|---|---|---|---|
| Home Win | 78.8% · only 198 picks | **77.7% (said 75.8%) · 1,574 picks** | −0.1% | **+2.5%** |
| Away Win | 75.0% · 100 picks | **74.7% (said 72.6%) · 635 picks** | +1.3% | **+4.7%** |
| Draw | 33.5% (said 31.3%) | **31.4% (said 32.2%) · 245 picks** | −4.6% | −0.1% |
| Double Chance (new) | — | **77.0% (said 76.0%) · 1,783 picks** | −3.6% | +0.1% |

v5 finds **eight times as many** home-win picks at the same accuracy. Home and Away Win had the strongest
best-price ROI of any methodology in both test periods (Double Chance was just above zero in both) — but the
95% intervals still include zero, so no profit is claimed.

---

## 🏠✈️ HOME WIN / AWAY WIN

Candidates: the straight win, **and** Draw No Bet as the safer expression of the same view (Rule 11).

### Hard gates
| Gate | Rule | Pass criteria |
|---|---|---|
| **MODEL** | R40 | Calibrated win probability ≥ **55%** home / **50%** away (DNB: 65% / 62%) |
| **SAMPLE** | R5 | ≥ 6 verified games per side |
| **FIGHT** | R22 | Not backing against the **multi-book** favourite |
| **ELO** | R13 | ClubElo expectancy ≥ 55% (home) / 50% (away) — waived (and shown as waived) when the club has no rating |
| **NEWS** | R15, 18, 19 | No rotation, < 3 absences, no key departure, **≤ 30% of attacking output missing (FPL)**, first-choice keeper fit |
| **STREAK** | R20 | A 5+ win streak must be backed by the model (≥ 62%) or a 120+ Elo gap — never by reputation |
| **DOGATK** | R2 | The opponent is not scoring freely (≥ 85% of games, ≥ 1.6/game) with λ ≥ 1.4 |
| **VENUE** | R21 | Not poor at the venue: home wins ≥ 40% at home / away wins ≥ 30% away (needs 4+ venue games) |
| **LEAD** | R23 | Win probability ≥ **1.9 ×** the draw |

### Checklist
Points per game · venue record · goal-difference gap · xG advantage · Elo advantage · head-to-head · clean
sheets (limit the draw) · rest advantage · **availability advantage (FPL xGI missing, or headline absences)** ·
**independent witness**.

**Measured:** the clean-sheet item and the LEAD gate add accuracy (+1.0 and +0.8 points); the Elo gate
removes losers (failing it cost 2.2 points).

---

## 🤝 DRAW — now a real (half-stake) prediction

v4 kept Draw paper-only because its original backtest showed the profile drew *less* than average. On the
v5 test set the Draw probability is **honest** (said 32.2%, hit 31.4%, against a 26% base rate), so v5
publishes it — but **never as the fixture headline**, and at **half stake**: a qualifying draw still loses
about two times in three.

### Hard gates
| Gate | Pass criteria |
|---|---|
| **MODEL** | Calibrated P(draw) ≥ **29%** |
| **MACHINE** (R21) | Both sides draw ≥ 25% of their games (5+ game sample) |
| **BAL** (R22) | Home/away gap ≤ 12 points, no heavy favourite |
| **LOW** | Expected total ≤ 2.60 |
| **VENUE** (R21) | Draws hold at the relevant venues (average ≥ 22%) |
| **SCORE** | Neither side's λ ≥ 1.90 |
| **GAP** | Table positions ≤ 8 apart |

Checklist: draw frequency · balance · head-to-head draws · low scoring · league draw rate · 0-0 / 1-1 mass ·
Elo says even · no rotation · independent witness.

---

## 🛡️ DOUBLE CHANCE (new in v5)

Built for how Double Chance is actually used — as a "safety" bet — and held to **Rule 11** (it is not
automatically the safest market) and **Rule 7** (it must still be worth taking). In practice it only
qualifies in **genuinely competitive games**, because a clear favourite's 1X / X2 is priced below 1.25.

### Hard gates
| Gate | Pass criteria |
|---|---|
| **MODEL** | Calibrated P(1X or X2) ≥ **72%** |
| **PRICE** (R7) | Fair odds ≥ **1.25** |
| **SIDE** (R22) | The covered side is not a clear underdog (consensus gap < 20 points against it) |
| **NEWS** | As Home/Away Win, for the covered side |
| **ELO** | Covered side's expectancy ≥ 42% |
| **OPPWIN** (R2) | The opponent wins ≤ 65% of its games |
| **FORM** (R20) | Covered side not in freefall (≥ 60% losses with 1.8+ conceded) |

Checklist: unbeaten rate · venue record · draw-live game · concedes little · opponent attack modest ·
head-to-head avoid-defeat rate · Elo · independent witness.

**Before taking a Double Chance, compare Draw No Bet and the Asian +0.5 line** (shown on the same fixture).

---

## 🛠️ CHEAT SHEET
**Win:** calibrated ≥ floor? with the consensus favourite? Elo agrees? attack intact? not poor at the venue?
≥ 1.9 × the draw? your price ≥ take-at? → 1 unit. Otherwise SKIP — or look at Draw No Bet.

**Draw:** both sides draw-prone, balanced, low total? → half unit, single, never the day's headline.

**Double Chance:** a competitive game, ≥ 72%, fair odds ≥ 1.25? → 1 unit at your price ≥ take-at.

*v5.0 · evidence: `research/backtest_methods.js`*
