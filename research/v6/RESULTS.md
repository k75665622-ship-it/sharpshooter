# v6 results (held-out 2023-07-01 → 2026-09-03 unless stated)

All numbers come from the scripts in this folder, using the production code. "Stated" is the average
probability the site gave; when hit ≈ stated, the site's percentages can be taken at face value.
"Best price" is the best of ~17 books in the archive; "Bet365" is one ordinary bookmaker.

## 1. Do 170 factors beat the bookmakers' price?

| Model (factor model on top of the price) | Held-out matches | Log-loss, v6 | Log-loss, price alone | Improvement | 95% interval |
|---|---|---|---|---|---|
| Result (H/D/A) | 29,191 | 1.0022 | 1.0025 | **0.030%** | −0.015% … +0.077% |
| Over 2.5 | 22,963 | 0.6761 | 0.6764 | **0.032%** | −0.018% … +0.081% |
| BTTS | 29,191 | 0.6843 | 0.6865 | **0.319%** | +0.21% … +0.42% |

Season by season (result model): +0.017%, +0.084%, −0.027%, +0.051%.

**Plain answer: barely.** The bookmakers' price already contains almost everything form, head-to-head, shots,
table position and Elo can tell you. The factors add a real but very small amount to result and goals forecasts,
and a clear improvement only for BTTS (whose price-implied baseline is cruder).

**Without a price, the factors carry the forecast:** result log-loss 1.0145, against 1.0767 for league base rates
and 1.0025 for the price — the factors recover **84%** of what the bookmakers know. That is what the site uses
for fixtures with no odds.

## 2. Which factor families matter (SHAP share of the model's decisions)

| Family | With a price (what moves the forecast away from it) | Without a price |
|---|---|---|
| Market & price (margin, book dispersion, implied goals) | 17.7% | — |
| Performance & luck (shots, shots on target, finishing) | 17.4% | 9.9% |
| League environment | 12.4% | 8.0% |
| Table & motivation | 10.2% | 14.1% |
| Goal trends | 8.7% | 11.3% |
| Beating the bookmakers (results vs the odds' expectation) | 7.0% | 8.2% |
| Form & trend | 6.6% | 5.5% |
| Strength & momentum (ClubElo) | 6.4% | **34.1%** |
| Discipline & set pieces | 5.3% | 3.9% |
| Head-to-head | 3.9% | 3.8% |
| Schedule & fatigue | 2.7% | 0.8% |

Head-to-head — often the first thing people look at — carries under 4% of the weight either way.

## 3. Does the factor model change which bets are worth taking? (`value_study.py`)

When v6 says the price **over-rates the favourite by 2+ points**, the favourite won **36.9%** against the price's
42.7% (v6 said 40.3%; 480 matches). When v6 says the favourite is **under-rated by 2+ points**, it won 60.0%
against the price's 57.8% (v6 60.3%; 3,080 matches). The factors' disagreements with the price point the right way.

## 4. The decision (`backtest_decision.js`, production code)

| Output | Matches | Hit | Stated | ROI Bet365 | ROI best price |
|---|---|---|---|---|---|
| Main pick | 28,455 | **72.7%** | 73.1% | −3.7% (7,789 priced) | +0.1% |
| v5 rule on the price alone (same matches) | 28,547 | 74.5% | 74.0% | −4.0% | −0.2% |
| Safer pick | 9,011 | 82.1% | 81.5% | −3.4% | +0.6% |
| **Value pick** (best price ≥ 5% above v6 fair) | 2,631 | 44.4% | 44.6% | −1.2% | **+6.6%** |
| Tuning seasons, value pick | 7,503 | 44.5% | 44.8% | −1.3% | +6.3% |

**Avoid list:** selections the factors flagged as over-rated won **50.3%** against the **52.8%** the price implied
(tuning seasons: 50.4% vs 54.0%). The traps are real in both periods.

**Confidence grades (main pick):** High 73.9% (stated 74.4%, 23,935) · Medium 67.6% (67.0%, 4,147) · Low 53.9% (56.0%, 373).

Settings, all chosen on 2019-23: main pick = most likely selection with fair odds ≥ 1.30, ranked by
probability + 2 × (v6 − price) — that weight traded 0.7 points of hit rate for 0.4 points of return on the tuning
seasons; a selection the factors rate 1.5+ points below the price is never the main pick; value needs the best
price 5% above the v6 fair price (3% gave +3.8%, 5% gave +6.3% on tuning).

## 5. Patterns and bookmaker traps (`patterns_study.js`, 46 rules)

Discovery 2005-23, confirmation 2023-26 (both needed).

| Verdict | Count | Rules |
|---|---|---|
| **Confirmed edge** | 2 | Heavy home favourite, 70%+ (said 77.4%, won 79.9% since 2023) · Favourite takes 60%+ of shots on target (said 59.0%, won 60.0%) |
| **Confirmed trap** | 1 | Underdog whose Elo rose 40+ in 90 days (said 25.1%, won 23.0%) |
| Weak (not confirmed since) | 6 | Favourite beating the odds lately · underdog beating the odds · favourite in a title race · best price far above Bet365 (favourite / underdog) · underdog in hot form |
| Unstable (reversed) | 2 | Elo doubts the favourite · low-total draws |
| **Priced in** | 35 | Win streaks, losing runs, "dead rubbers", relegation fights, revenge / bogey head-to-heads, promoted sides, short rest, red cards, hyped overs, goal-fest head-to-heads, cold unders, season openers and finales, … |

Most betting folklore is already in the price. The site shows which category any pattern firing on a match falls into.

## 6. The double-confirmed accumulator (`acca_study.js`)

A leg must qualify under a methodology (Lock/Predict) **and** the normal prediction must agree (its main pick, a safer
form of it, or its result/goals/BTTS call at 60%+), never a flagged trap. One leg per match; each day's most likely k legs.

| | Held-out 2023-26 | Tuning 2019-23 |
|---|---|---|
| Legs: hit (stated) | 72.5% (72.1%), 6,785 | 73.1% (72.7%), 9,431 |
| Methodology picks the normal prediction rejected | 66.6% (66.4%), 4,001 | 66.2% (66.6%), 6,021 |
| **Doubles**: hit (stated) · ROI Bet365 / best | **67.3% (63.7%)** · +2.1% / **+8.2%** (270 priced) | 64.6% (64.1%) · −0.7% / +6.1% (278) |
| Trebles | 51.5% (49.7%) · −1.3% / +8.0% (159) | 48.6% (50.6%) · −10.7% / −1.4% (145) |
| Four-folds | 39.2% (38.4%) · −10.5% / +0.4% (82) | 38.0% (39.5%) · −5.3% / +7.2% (84) |
| Five-folds | 30.3% (30.2%) · −34.7% / −26.1% (49) | 31.6% (31.0%) · −7.8% / +7.2% (45) |

The combined probability is reliable in both periods. Doubles were consistently around break-even at Bet365 and
positive at the best price; bigger accumulators were inconsistent (small priced samples, high variance), which is
why the site recommends the biggest accumulator that still has at least a 40% chance — usually the double.

Requiring the normal prediction's single **main pick** only (instead of its calls) left legs capped near 77% and
made worse accumulators (doubles 53.9%, −12.0% at Bet365); that variant was rejected.
