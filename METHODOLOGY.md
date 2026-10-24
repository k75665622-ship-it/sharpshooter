# Sharpshooter methodologies (v5.0) and the v6 normal prediction

**v6 — the normal prediction for every match** ([full playbook](methodology/GENERAL-PREDICTION-v6.md)): 170 measured
factors on top of the bookmakers' price → a calibrated forecast for every market → main pick (most likely selection
paying ≥ 1.30, never a flagged trap), safer pick, value pick (best price ≥ 5% above fair), avoid list, and every
pattern that fires with its measured verdict. Held-out 2023-26: main pick 72.7% (stated 73.1%); value picks +6.6% at
the best price; "avoid" selections won 50.3% vs 52.8% implied.

**v6 — the double-confirmed accumulator:** a leg must qualify under a methodology (LOCK or PREDICT) **and** the normal
prediction must agree (its main pick, a safer form of it, or its result / goals / BTTS call at 60%+), never a flagged
trap. Held-out doubles won 67.3% (stated 63.7%); combined probabilities are reliable, profit is only consistent for
doubles at good prices.

---

Thirteen market methodologies decide what the site predicts, and a general prediction covers every fixture.
This is the plain-English reference. The full playbooks — written in the style of the original v3.0 / v3.1 /
v2.5 personal playbooks, one per market — are in [`methodology/`](methodology/). The code is in
`lib/methodology/`, and `GET /api/methodology` returns the live thresholds and backtest record.

| Playbook | Markets |
|---|---|
| [`00-CORE-v5.md`](methodology/00-CORE-v5.md) | The shared rules (1–42), the status ladder, staking, the daily process |
| [`OVER-2.5-v5.md`](methodology/OVER-2.5-v5.md) | Over 2.5 (from v3.0) |
| [`UNDER-2.5-v5.md`](methodology/UNDER-2.5-v5.md) | Under 2.5 (from v2.5 UNDER) — redesigned |
| [`BTTS-v5.md`](methodology/BTTS-v5.md) | BTTS No (from v2.5 BTTS NO) and BTTS Yes |
| [`GG-NG-2PLUS-v5.md`](methodology/GG-NG-2PLUS-v5.md) | GG/NG 2+ (from v3.1) |
| [`RESULTS-v5.md`](methodology/RESULTS-v5.md) | Home Win, Away Win, Draw, Double Chance (new) |
| [`TEAM-TOTALS-AND-HANDICAPS-v5.md`](methodology/TEAM-TOTALS-AND-HANDICAPS-v5.md) | Team Totals, Underdog +, Favourite − |
| [`FINAL-SCORE-AND-GENERAL-v5.md`](methodology/FINAL-SCORE-AND-GENERAL-v5.md) | Final Score (new) and the v5 General Prediction |
| [`GENERAL-PREDICTION-v6.md`](methodology/GENERAL-PREDICTION-v6.md) | **v6**: the normal prediction (170 factors, decision, traps) and the double-confirmed accumulator |

## How a prediction is made

1. **One forecast.** The multi-book bookmaker consensus (Rule 37) is blended 90/10 with an independent model
   (Dixon-Coles ratings on cross-verified results, ESPN xG, ClubElo). The result is one score matrix, so no two
   markets can contradict each other.
2. **Calibrated numbers** (Rule 40). Every market probability is calibrated on real results and was checked on
   seasons the calibration never saw. A stated 65% lands about 65% of the time.
3. **Hard gates.** Every gate must pass. Unknown evidence fails (fail closed).
4. **Checklist.** At least 85% of the known items must pass, with at least 60% of items known. Every checklist
   includes the **independent witness** (Rule 42): the model with no price in it must not contradict the pick.
5. **Status ladder.**
   - **LOCK** — qualifies **and** a real bookmaker price beats the multi-book fair price by ≥ 3% (30–75% band,
     ≥ 2 books). (Rule 39)
   - **PREDICT** — qualifies. Bet only at your bookmaker's price ≥ the **take-at** price.
   - **PAPER** — qualifies, market not yet proven (GG/NG 2+).
   - **WATCH / REMOVE** — close / failed, with reasons.
6. **Contradictions** between qualifying picks are resolved; the weaker is set aside with the reason.
7. **Headline** — the strongest surviving prediction per fixture (the Final Score and Draw never take it).
8. **General prediction** — result, double chance, goals, BTTS, predicted final score, best bet and confidence,
   for **every** analysable fixture.
9. **Track record** — every pre-match prediction is recorded and settled afterwards; Rules 17, 27 and 34 are
   enforced from it.

## What changed from v4, and why (all measured)

| Change | Evidence (held-out 2023-26 unless stated) |
|---|---|
| Market-anchored ensemble replaces the xG-only model | The de-vigged price was the most accurate forecast; v5's model components beat v4's formula on every market. |
| New Dixon-Coles ratings on verified results | Beat the v4 season-average formula on 1X2, O/U, BTTS and exact-score log-loss. |
| **LOCK = price beats consensus, not model beats price** | Betting model-vs-market disagreement lost 13–29%; price shopping in the 30–75% band was the only positive signal. |
| Calibration of every market, refit on all seasons for production | Hit rate ≈ stated probability on every methodology. |
| **Under 2.5 redesign** (Rule 38) | v4-style checks selected worse Unders; hit 57.5% → 61.7%, ROI −10.0% → −7.2%. |
| BTTS No 1-1 trap becomes a checklist item | As a gate it removed ~75% of candidates with no accuracy gain. |
| GG/NG 2+: measured haircut, two-reconstruction corroboration, achievable Rule 34 | v3.1's 0.88 haircut and "≥ 55% hit rate" lifting rule were not supported by the data. |
| Draw published again (half stake, never headline) | Its probability is now honest: said 32.2%, hit 31.4%. |
| Double Chance, Final Score and General Prediction added | DC 77.0% (said 76.0%); qualifying final scores 17.6% exact vs 11.7% base. |
| Cross-verified results from 3 free sources (Rule 41) | Caught 97 wrong League Two scores and 2 wrong Portuguese results in openfootball. |
| Premier League availability from Fantasy Premier League | Real chance-of-playing %, replacing headline guessing for that league. |

## The record (held-out 2023-26, v5 code vs v4 code on the same matches)

| Methodology | v5 hit (stated) · picks | v4 hit (stated) · picks |
|---|---|---|
| Strongest pick per fixture | **71.6% (70.9%) · 9,114** | 66.7% (67.7%) · 6,577 |
| Over 2.5 | 64.7% (65.5%) · 2,499 | 62.4% (62.0%) · 2,105 |
| Under 2.5 | 61.7% (64.1%) · 925 | 57.5% (61.5%) · 532 |
| BTTS Yes | 63.9% (62.1%) · 1,121 | 61.7% (61.0%) · 957 |
| BTTS No | 57.4% (60.4%) · 61 | 60.6% (59.7%) · 33 |
| Team Totals | 68.5% (68.9%) · 2,635 | 66.7% (70.9%) · 1,733 |
| Home Win | 77.7% (75.8%) · 1,574 | 78.8% (75.3%) · 198 |
| Away Win | 74.7% (72.6%) · 635 | 75.0% (71.3%) · 100 |
| Draw | 31.4% (32.2%) · 245 | 33.5% (31.3%) · 206 |
| Underdog + | 75.9% (72.8%) · 2,097 | 70.4% (71.8%) · 2,273 |
| Favourite − | 70.4% (68.5%) · 477 | 67.0% (67.4%) · 109 |
| Double Chance | 77.0% (76.0%) · 1,783 | — |
| Final Score (exact) | 17.6% (15.0%) · 437 | — |
| General best bet, every fixture | 73.6% (72.7%) · 19,043 | — |

## What the tests do NOT show
- **Profit.** At Bet365 prices no methodology made a reliable profit; at the best of ~17 books several were
  around break-even or slightly positive, with intervals that include zero. LOCK means "a price beats the
  consensus", not "this will win".
- **Team news, ESPN xG and rest days** do not exist in the historical data, so those gates were waived or
  failed closed in the backtest. They can only make live picks stricter.
- **The live free sources** (ESPN, football-data, FPL, ClubElo, InferSports) could not be reached from the
  build environment; they are covered by offline tests in their exact live shapes (`test/e2e_offline.js`).
  Watch the first live run.

Reproduce everything: [`research/README.md`](research/README.md). Full tables: [`research/RESULTS.md`](research/RESULTS.md).
