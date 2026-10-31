# 🔒 UNDER 2.5 GOALS — METHODOLOGY v5.0

> **Upgraded from v2.5 UNDER.** The biggest redesign in v5 — because the data demanded it.
> Core rules: `00-CORE-v5.md`. Code: `lib/methodology/goals.js` → `under25`.

---

## 📊 WHY UNDER 2.5 CHANGED THE MOST

v2.5 UNDER was built on "boring football" evidence: both sides trending Under, clean-sheet habits,
low scoring, a named low-scoring path, no chaos. We tested every one of those checks, one at a time, on
8,762 real Under candidates:

| Check (v2.5) | Picks that PASSED it hit… | Picks that FAILED it hit… |
|---|---|---|
| Both trending Under | 0.6 pts **below** their probability | 0.9 pts **above** |
| Clean-sheet habit | 1.1 pts below | 0.4 pts above |
| Defensive strength | 1.0 pts below | 0.7 pts above |
| A named route to Under (Rule 4) | 1.6 pts below | 1.4 pts above |
| No attacking chaos | 1.4 pts below | 1.0 pts above |

**Every "boring football" check selected *worse* Unders.** The bookmakers had already priced the boring
football into the Under price — then streaks regress. Stacking them as filters was Rule 13's double count.

| Held-out 2023-26 | v2.5 / v4 logic | v5 |
|---|---|---|
| Qualifying picks | 532 | **925** |
| Hit rate | 57.5% (said 61.5%) | **61.7% (said 64.1%)** |
| ROI at Bet365 | −10.0% | **−7.2%** |
| ROI at best price | −7.8% | −5.0% |

On the tuning seasons v5 Under is exactly honest (said 63.7%, hit 63.8%). The remaining held-out gap is the
2023-26 rise in scoring that the bookmakers were slow to follow; production v5 is recalibrated on all seasons
including 2023-26. **Under 2.5 is still the weakest goals market. Treat it with the most caution.**

---

## 🔍 HARD GATES (all must pass)

| Gate | Rule | Pass criteria |
|---|---|---|
| **MODEL** | Rule 40 | Calibrated P(Under 2.5) **≥ 60%** (raised from 57%) |
| **SAMPLE** | Rule 5 | ≥ 5 verified games per side |
| **FAV** | Rule 19 | A heavy favourite (< 1.60) scores 3+ in ≤ 25% of recent games (a 1-0 / 2-0 side, not a 3-1 side) |
| **NEWS** | Rule 15 (inverted) | No defender/keeper disruption on both sides, not 2+ on one side, first-choice keeper fit (FPL) |
| **THREE1** | Rule 1 | "If it finished 3-1, would I be surprised?" — P(4+ goals) **≤ 22%** |
| **STREAK** | Mistake 11 | No side scoring in 6+ straight games that the model also backs |
| **RECENCY** ⭐ | **Rule 38** | The price is NOT built on an extreme streak: not (≥ 70% Unders **and** ≥ 45% clean sheets across both sides) |

## ✅ CHECKLIST (≥ 70% of known items — v5.1; it was 85%)

| Item | Pass at |
|---|---|
| Low expected total | ≤ ~2.6 goals |
| Head-to-head Under rate | ≥ 50% (3+ meetings) |
| League environment | ≥ ~48% of league games stay Under |
| **Price not driven by recent form alone** (Rule 38) | recent Under rate ≤ ~72% |
| Attackers missing on both sides (Profile 5) | bonus only |
| Scoring not running far above xG (Profile 7) | where xG is published |
| **Independent witness** (Rule 42) | model-only ≥ floor − 3 pts |

## 🎭 THE 7 PROFILES — NOW THE EXPLANATION, NOT THE FILTER

The seven v2.5 profiles (suffocating favourite, low-block derby, nothing-to-play-for, cup first leg,
attacker-less match, tight tactical match, regression match) are still shown on every Under verdict as the
**reason** the game should stay low. They no longer decide whether it qualifies — the calibrated price and the
structural gates do.

---

## ⚠️ HOW IT LOSES
- The underdog scores first and the favourite has to chase — the game opens.
- A 3-1 that nobody expected: the verdict prints P(4+ goals) and the most likely losing scores.
- A recent run of 1-0s that was luck, not style (Rule 38).

## 🛠️ CHEAT SHEET
1. Calibrated Under ≥ 60%? 2. P(4+ goals) ≤ 22%? 3. Heavy favourite a 1-0/2-0 side? 4. Defences and keepers intact?
5. **Is the price built on a streak? → skip.** 6. Your price ≥ take-at?
**All yes → 1 unit. Any no → SKIP.**

*v5.0 · from v2.5 UNDER · evidence: `research/backtest_methods.js` (DIAG=under25)*
