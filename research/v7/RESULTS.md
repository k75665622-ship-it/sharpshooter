# v7 — measured results

Tuning seasons to 2023-06, held-out seasons from 2023-07, reported apart. Log-loss: lower is better.

## 1. Can the bookmakers' price be read more sharply?

Every probability on the site starts from the bookmakers' price, so the first question was whether the
price could be turned into probabilities more accurately. Three ideas were tested. **None earned a place.**

### 1a. Removing the margin (`devig_study.js`, 160,666 matches from 2012)

| Method (Bet365 1X2) | Tuning 2012-23 | Held-out 2023-26 |
|---|---|---|
| Proportional | 1.00437 (+0.044%) | 1.00290 (+0.044%) |
| **v6 blend (0.6 power + 0.4 proportional)** | **1.00393** | **1.00246** |
| Power | 1.00382 (-0.011%) | 1.00238 (-0.009%) |
| Shin | 1.00390 (-0.003%) | 1.00237 (-0.009%) |
| Odds ratio | 1.00392 (-0.001%) | 1.00249 (+0.002%) |
| Best-of-books ("Max") prices, any method | +0.69% to +0.70% | +0.22% to +0.23% |

Over/Under 2.5: every method within 0.02% of the blend. The best method beats the engine's by one part in
ten thousand, and after the engine's one-slope calibration the difference is nil (1b). Best-of-books prices
are clearly **worse** to de-vig than Bet365's: the best price on each outcome is an outlier, not a consensus.

Strong favourites, won minus stated (points): the blend under-rates 80%+ favourites by 2.1 (tuning) and 2.3
(held-out); pure power by 0.8 and 0.9. The engine's calibration (slope 1.08 on the result) already removes
this, which is why the downstream numbers do not move.

### 1b. The Asian handicap line (`solve_study.js`, 52,542 matches from 2019 with all three prices)

The expected goals were solved four ways and every derived market scored. Calibrated log-loss on the
held-out seasons against the v6 engine (negative = better):

| Market | Power de-vig | Power + handicap (weight 1) | Power + handicap (weight 2) | Handicap + total only |
|---|---|---|---|---|
| Home win | +0.005% | +0.020% | +0.068% | +0.116% |
| Away win | +0.004% | +0.014% | +0.057% | +0.104% |
| Over 1.5 / 2.5 / 3.5 | 0.000% / 0.000% / -0.001% | +0.002% / +0.004% / -0.001% | +0.004% / +0.006% / 0.000% | -0.001% / 0.000% / +0.001% |
| Both teams to score | +0.007% | -0.004% | -0.001% | +0.026% |
| Home / away to score | +0.005% / +0.008% | +0.030% / -0.004% | +0.066% / +0.015% | +0.128% / +0.054% |
| Home / away over 1.5 | +0.003% / +0.009% | +0.012% / -0.015% | +0.034% / -0.006% | +0.049% / +0.023% |
| Win by two | +0.009% | +0.011% | +0.029% | +0.049% |
| Exact score (raw) | +0.019% | +0.022% | +0.039% | +0.067% |

The handicap line adds nothing the 1X2 price does not already carry, and the more weight it gets the worse
the result. The solver keeps the option (`lib/market.js` `opts.handicap`, tested), switched off.

**Conclusion.** The price-to-probability step is at its ceiling on this data: the engine's de-vig, solve
and calibration are left as they are. The work went where it changes results: which leagues the rule can
be trusted in, and whether it keeps earning that trust live.

## 2. Where does the Strongest Picks rule hold? (38 divisions)

The v6.2 replay (`research/v6/slips_study.js`) priced every division of the archive, not only the 18 the
site gave picks in. The rule's picks, by group (won / stated):

| Leagues | Earlier period | Later period |
|---|---|---|
| The 18 main European divisions | 90.8% / 90.7% (8,525) | 90.5% / 90.6% (4,991) |
| England 5, Scotland 2-4 | 90.2% / 90.4% (533) | 92.0% / 90.4% (423) |
| 14 leagues with a 1X2 price only (USA, Mexico, Japan, China, Sweden, Norway, Denmark, Austria, Switzerland, Poland, Romania, Russia, Ireland, Finland) | 90.7% / 90.7% (1,054) | 92.4% / 90.7% (1,214) |
| **Brazil and Argentina** | **82.2% / 90.5%** (208) | **86.8% / 90.3%** (189) |

(Periods split at 2023-07 for the first two groups and at 2022-01 for the 1X2-only leagues, whose data ends
in December 2024.) In Brazil and Argentina the double chance won 82.7% when it said 90.3% (323 picks).

**Change:** the site now gives Strongest Picks (and bet builders) in **34 leagues**: the 18, England 5,
Scotland 2-4, and the twelve 1X2-only leagues it follows (Ireland and Finland are not followed). Brazil and
Argentina are named as measured-and-failed; every other league stays untested and gets no pick.

The record of the rule on those 34 divisions (`slips_report.js --models`, what the page shows):

| | Tuning 2019-23 | **Held-out 2023-26** |
|---|---|---|
| Picks won (stated) | 91.0% (90.7%) — 10,558 | **90.6% (90.6%) — 5,883** |
| Picks a match day | 9.4 | 7.8 |
| The day's single strongest pick | 93.5% of 1,125 days | **92.5% of 750 days** |
| Safe slip (75%+ combined) | 81.3% of 961 days, 2.7 legs | **81.0% of 601 days, 2.6 legs, fair odds 1.27** |
| Longer slip (60%+) | 70.2%, 4.3 legs | 67.9%, 4.3 legs, fair odds 1.51 |

## 3. The live guard (`guard_study.js`)

A rule measured on the past can drift live. The guard reads the rule's own settled picks and suspends a
market family or a league for 21 days when its last 120 picks (30 at least) won 2.5 standard errors less than
they said. Replayed day by day on all 38 divisions, with nothing excluded by hand:

| | Tuning 2019-23 | Held-out 2023-26 |
|---|---|---|
| No guard | 90.74% won, 11,129 picks | 90.56% won, 6,008 picks |
| Guard (z 2.5, last 120) | 90.82% won, 10,862 picks | 90.54% won, 5,991 picks |

On honest markets it is neutral: it costs about 2% of the picks in tuning and next to nothing held-out, and
changes the hit rate by less than a tenth of a point. What it buys is insurance: in the replay it found
**Argentina (twice) and Brazil on its own**, and cards under in 2021 and 2026, the cases section 2 and
v6.2 found by hand. Sixteen suspensions in seven years, about half of them noise on the two largest
families (which then came back). Looser settings (z 2) fired 41-56 times for no gain; z 3 missed Brazil.

## 4. What did not change, and why

- **The engine's probabilities** (section 1): nothing tested beat them.
- **The High Banker rule, the bet builder, the methodologies and the final score**: re-measured in v6.2
  (`research/v6/RESULTS.md` §9), all honest; a slip's landing rate is set by its odds, not by the rule.

Limits, stated: the 1X2-only leagues were replayed without an Over/Under price (the solve uses a prior
total), so their picks there were mostly double chance and team to score; live they have totals prices too.
Per-league samples are small, which is why leagues were judged in groups and the guard watches each one.

## 5. The methodologies at real prices, and the slip to lead with (`method_study.js`)

v7.1. Every qualified methodology pick of the archive (41,321 settled, 20,701 with a Bet365 price) was scored at
the Bet365 price and at the best price of the books. Held-out seasons 2023-26:

| Methodology | Picks | Won | Said | Return, Bet365 | Return, best price |
|---|---|---|---|---|---|
| Home Win | 1,792 priced | 74.8% | 73.6% | -1.5% | +1.0% |
| Away Win | 615 priced | 72.5% | 70.6% | -0.2% | +2.9% |
| Double Chance | 3,213 | 76.4% | 76.0% | -3.7% | 0.0% |
| Over 2.5 Goals | 2,950 | 65.2% | 64.6% | -2.9% | -0.7% |
| Under 2.5 Goals (65% floor) | 283 | 68.6% | 67.3% | -3.0% | -0.5% |
| Draw | 245 | 31.4% | 32.3% | -4.6% | -0.1% |
| BTTS Yes | 1,412 | 63.0% | 62.1% | not quoted in the archive | |
| BTTS No | 125 | 59.2% | 60.2% | | |
| Team Total Goals (Over 1.5) | 1,887 | 69.2% | 68.4% | | |
| Underdog +handicap | 3,630 | 73.6% | 72.4% | | |
| Favourite -handicap | 721 | 70.7% | 67.5% | | |
| Final score | 414 | 17.9% | 15.0% | | |

(GG/NG 2+ stays paper-only.) Every methodology wins about what it says. What a single bookmaker's margin leaves
is a return between about zero and -5%; at the best price of the books it is about zero. Nothing here is a
money machine, and nothing is broken, with one exception:

**Under 2.5 Goals at 60-65%.** With the old 60% floor the methodology won 61.3% of 1,384 held-out picks where it
said 63.3%, and returned -8.0% at Bet365 (-5.8% at the best price). From 65% it wins what it says: 68.6% of 283
held-out (said 67.3%), 67.6% of 512 in the tuning seasons (said 67.0%). The floor is now 65% (methodology v5.3).
The floor was chosen after the held-out seasons had been seen, so this is a repair, not an out-of-sample result;
the live record will say whether it holds. The headline pick moved from 71.9% to 72.6% won, and from -3.5% to
-2.7% at Bet365.

One watch item, no change: the Bronze tier (picks at 50-60%) won 57.0% of 1,735 held-out picks where it said
58.3%, and the priced ones among them 55.9% of 605 (said 59.0%). In the tuning seasons the tier won 59.9% of
2,063, so the two periods disagree and the gap is within noise (1.1 to 1.6 standard errors). The tiers page shows
the tier's own record.

### Which slip should lead?

The safe slip pays about 1.3 and a single strongest pick about 1.08; the request was for odds worth staking
without throwing the chance away. Slips of the day's methodology picks, one per match, held-out 2023-26:

| Slip | Days | Landed | Said | Odds, Bet365 / best | Return, Bet365 / best |
|---|---|---|---|---|---|
| Two most likely methodology picks | 598 | 59.9% | 58.8% | 1.61 / 1.71 | -5.8% / +0.4% |
| **Double-confirmed double** | 596 | **67.3%** | 63.7% | fair 1.57 | +2.1% / +8.2% (270 priced days) |
| Three most likely methodology picks | 539 | 46.2% | 44.4% | 2.08 / 2.29 | -8.8% / +0.5% |
| **Double-confirmed treble** | 526 | **51.5%** | 49.7% | fair 2.01 | -1.3% / +8.0% (159 priced days) |
| Double-confirmed four-fold | 459 | 39.2% | 38.4% | fair 2.60 | -10.5% / +0.4% (82 priced days) |
| Two best by value (chance x odds) | 569 | 41.7% | 42.8% | 2.65 / 2.81 | -8.2% / -3.1% |

Double-confirmed = the pick passes a methodology and the normal prediction backs the same pick. Its legs won
72.5%; methodology picks the normal prediction disagreed with won 66.6%. The tuning seasons are a little lower
on the landing rates (double 64.6%, treble 48.6%) and on the return (double -0.7% at Bet365, +6.1% at the best
price).

So Today now leads with the **double-confirmed double** and lets the reader choose along the whole ladder (safe
slip, double, treble, 2.0+ and 3.0+ banker slips), each with its chance and its measured landing rate. Read the
returns with care: they rest on a few hundred fully priced days, so their standard error is 4 to 5 points, and
+2% and -1% both read as "about zero". The landing rates are solid; the returns say "about break-even at one
bookmaker, a little better at the best price", not "profit". Chasing value picks instead of likely ones made
slips worse, not better. That is why every ticket carries the lowest odds worth taking and an odds check.
