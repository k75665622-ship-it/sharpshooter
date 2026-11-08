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

## 7. Strongest Picks v2: measured chances, form + price corners, and the possession model

`strongest_study.js` replays the **production** Strongest Picks code (`lib/strongest`, `lib/pace.js`) on all
76,528 priced matches from July 2019, walk-forward; every selection is settled on the real result (goals, halves,
corners, cards). On the 18 divisions where `research/build_states.js` rebuilds the site's own model-only view, the
goal views are exactly the engine's (calibrated ensemble, model-only witness, v6), with the calibration fitted on
2019-23 only.

**The old rule (v1), held-out 2023-26** — 29,191 matches:

| | Picks | Won | Stated |
|---|---|---|---|
| All Strongest Picks (97% of matches, ~31 a match day) | 28,361 | 84.1% | 84.5% |
| Team markets (team under 2.5, team to score, ...) | 18,600 | 84.7% | 84.4% |
| Corners | 2,366 | **79.3%** | 85.5% |
| Bookings | 2,091 | **82.4%** | 85.6% |

Goal picks were honest; corners and bookings, priced from form alone, were not (team corners −6.1 points, total
corners under −7.5, cards under −5.2), and a pick on nearly every match meant several losers every day.

**The possession model on its own** (`lib/pace.js`: average(own shots, opponent's shots conceded) × average(own goals
per shot, opponent's goals per shot allowed) — the NBA "efficiency × possessions" total, in football), log-loss on
the same matches (lower is better):

| Held-out 2023-26 | 1X2 | Over 2.5 | BTTS |
|---|---|---|---|
| Bookmakers | **0.9959** | 0.6755 | **0.6847** |
| v6 factors | **0.9954** | **0.6753** | 0.6853 |
| Stats view (ratings, xG proxy, Elo) | 1.0129 | 0.6811 | 0.6867 |
| Possession model | 1.0390 | 0.6862 | 0.6883 |

**The measured chance** (`strongest_fit.js`): per market, logit(chance) = a + b·logit(market) + c·(factors − market)
+ d·(stats − market) [+ e·(possession − market)], fitted on 2019-23. The v6 factors' disagreement with the price is
worth about 40% of its size (c ≈ 0.3-0.5); the form-only stats view's disagreement is **negative in every market**
(d < 0): when form disagrees with the bookmakers, the bookmakers are right more often. The possession term improved
the 2019-23 log-loss by 0.0001 per selection — under the 0.0005 a view must earn — so it is not used for goal
chances (held-out: 0.5465 with or without it).

**Corners and cards** (Poisson regression, negative-binomial dispersion; log-loss of the count):

| Held-out 2023-26 | Corners | Cards |
|---|---|---|
| Site's season view (form only) | 2.6352 | 2.1915 |
| Site's last-6 view (form only) | 2.6474 | 2.1939 |
| Form + price | 2.6280 | **2.1736** |
| Form + price + possession (shot volume) | **2.6272** | 2.1737 |

The bookmakers' strength gap is the largest single corner term (0.22), and with the possession model in, the
opponent's shots conceded is the next (0.20): a side facing a team that lets opponents shoot wins more corners.
Possession earned its place for corners (2019-23 gain 0.0006) but not for cards. Calibrated by family, the
held-out corner lines at 85%+ won 88.5% (team corners) where the old views claiming 89% won 83%.

**The bars** (`strongest_report.js --sim`, 2019-23 only): every chance bar from 75% to 84% was honest, so the bar
sets how strong the list is — 75%: 85.3% won (stated 84.9%), 34 a match day; 84%: 86.9% (86.7%), 22 a match day.
Production uses 84% (86% for corners and bookings). Requiring the possession model to agree removed 3% of picks,
which won exactly their stated 86.3%: neutral, kept as the requested check.

**The new rule (v2), held-out 2023-26 — reported once**, models fitted on 2019-23:

| | Picks | Won | Stated |
|---|---|---|---|
| All Strongest Picks (63% of matches, ~20 a match day) | 18,470 | **86.4%** | 86.7% |
| Elite (87%+) / Strong (84%+) | 8,197 / 10,273 | 87.5% / 85.4% | 88.0% / 85.6% |
| Team markets | 13,240 | 86.3% | 86.7% |
| Corners | 671 | **87.0%** | 87.0% |
| Bookings | 838 | **86.5%** | 87.0% |
| Matches on the 18 rebuilt divisions / elsewhere | 13,281 / 5,189 | 86.5% / 85.9% | 86.7% / 86.6% |

`lib/strongest/models.json` is then refitted on every season with the same variants (`FORCE_*`).

**Contexts** (`strongest_context.js`: league tier, time of season, favourite strength, expected goals, home/away).
Nearly every market held its measured chance in every context. The one consistent weak spot is **team under 1.5
goals** at the top of the range. In the pick band (84%+ measured, bookmakers at 88% or less) it won less than stated
in both periods: 2019-23 −0.9 points when the opponent was a 75%+ favourite (592 selections) and −1.6 otherwise
(1,767); 2023-26 −4.4 (490) and −1.7 (780). It did not meet the exclusion rule declared before the held-out check
(−1.5 or worse on 2019-23 with 1,000+ selections: the family pooled −1.4), and the held-out picks of it won 83.5%
against 86.4% stated (291). **At the site owner's request it was then kept off the list** (`config.excluded`); it
stays on the match cards. Because that choice was made after seeing 2023-26, its share of the record below is not a
clean out-of-sample test — it moves little either way (about 160 of 18,470 held-out picks). Over 1.5 goals with a heavy
favourite went the other way (+3.1 / +3.7).

**Final rule (with team under 1.5 kept off), same replay:** 2019-23: 28,824 picks, 86.9% won (stated 86.7%);
**2023-26: 18,309 picks (63% of matches, ~19 a match day), 86.4% won (stated 86.7%)** — Elite 87.6% (88.0%), Strong
85.5% (85.6%), corners 86.9% (87.0%), bookings 86.7% (87.0%). This is the record `lib/strongest/models.json` carries
for the page.

**The High Banker** (`banker_pace.js`, 2019-23): measured chances as leg probabilities lowered the 3.0+ slip's
landing rate (36.1% → 33.0%), and the possession check lowered it further (30.8-33.1%), so neither is used. A safer
2.0+ slip from the same bankers lands far more often — 2019-23: 49.2% (stated 48.2%, 3.2 legs); **held-out 48.9%**
(stated 46.9%, 650 slips) against 33.6% for the 3.0+ slip — at a lower return (−1.0% against +0.8% held-out).

## 8. Bet Builder: several selections from one match at 3.0+ odds

`betbuilder_study.js` replays the **production** Bet Builder (`lib/betbuilder.js`, `public/betbuilder-core.js`) on
the same 76,528 priced matches from July 2019, walk-forward. Each match is priced as on the site: the de-vigged Bet365
1X2 + over/under 2.5 price through `lib/ensemble.js` (calibration fitted on 2019-23), the possession view, and the
form + price corner and card models; every leg is settled on the full-time score, corners and cards, and a builder
lands only when every leg does. The joint model gives each builder one combined chance (the score grid for goal legs,
corners and cards independent of the goals, each leg nudged to its measured chance).

| | Tuning 2019-23 | **Held-out 2023-26** |
|---|---|---|
| Priced matches / with a builder | 47,337 / 26,865 (57%) | 29,191 / 21,063 (72%) |
| Builders a match day | 19.7 | 22.3 |
| **Landed (stated)** | 32.7% (32.8%) | **32.7% (32.8%)** |
| Stated 32-34% | 32.7% (32.9%) — 24,240 | 32.9% (32.9%) — 19,082 |
| Stated 30-32% | 32.0% (31.5%) — 2,568 | 30.1% (31.5%) — 1,936 |
| Goals + corners + cards | 33.2% (32.7%) — 11,086 | 32.9% (32.7%) — 10,124 |
| Goals + corners | 32.2% (32.8%) — 13,642 | 32.3% (32.8%) — 9,188 |
| Goals + cards / corners + cards | 33.1% / 32.4% (32.8% / 33.0%) | 33.5% / 32.4% (32.9% / 33.0%) |
| Goals only | 27.9% (32.5%) — 61 | 25.0% (32.6%) — 52 |
| 3 / 4 / 5 legs | 32.7% / 33.9% / 34.6% | 32.6% / 35.3% / 24.0% (20,787 / 249 / 25) |

Each leg on its own also won its stated chance (held-out: no draw 71.0% against 70.0% stated; cards over / under
73.4% / 73.2% against 72.5% / 72.9%; total corners over / under 71.1% / 69.8% against 70.5% / 69.9%; team corners
68.0% and 67.8% against 68.2%; away team to score 64.4% against 65.3%; under 3.5 goals 68.8% against 68.2%; both
teams to score 59.6% against 60.1%).

What the numbers say:

- **The combined chance is right.** Builders mixing goals, corners and cards landed as stated in both periods, so
  treating the three as independent holds at this level. Goals-only builders landed below their stated chance in both
  periods (113 builders in all, 0.3% of the total; about 1.4 standard errors) — too few to change the rule, worth
  watching in the live record.
- **No builder calibration.** Fitting logit(landed) = a + b·logit(stated) on the tuning builders gives a slope of
  0.40, only because nearly every builder is stated between 30% and 34% — too narrow a range to fit a slope. The stated
  chance is already right on average in both periods, so none is applied (`builder.cal` stays empty).
- **One in three.** A 3.0+ builder loses about two times in three; it only pays over time at a price above its fair
  odds, and bookmakers' bet builder prices carry a margin on every leg.

The rule's choices were made for reasons of logic, not to raise a number: the **fewest legs** (each leg costs margin
and is one more thing to go wrong), **no two legs of a kind pulling against each other** (a hedge looks safe leg by
leg and rarely lands as a whole), and **no passenger legs** — a leg the others already make certain was found in 1 of
47,928 builders and is now never used to pad a builder to three legs (the replay changed by that one builder). The
report prints both periods together, so the held-out record is not a strictly blind test of those choices; it is a
clean test of the combined chance, which nothing was fitted to.

Limits, stated: the archive cannot rebuild the v6 factor view or the stats view, so each leg's measured chance in the
replay rests on the price (and the possession view, weight 0), the v6 trap checks are off and the two-view rule is
relaxed to one; and the goal, corner and card calibrations in `lib/strongest/models.json` were fitted on every season,
so the held-out legs are slightly in-sample. Scorer legs have no history in the archive and stay out of the day's
builders.

## 9. v6.2: why the picks felt like they always lost, and what changed

A user's report: Strongest Picks "elite and solid both losing", the High Banker "never won", the final score "even
worse", team unders "losing a lot", several picks played together on one slip. Every product was replayed again
(`slips_study.js` + `slips_report.js` for the Strongest Picks and their slips, `backtest_methods.js` for the
methodologies and the final score, `betbuilder_study.js` for the builders), tuning 2019-07..2023-06 and held-out
2023-07..2026-09 apart.

**The single picks were not the problem.** At the old 84% bar the Strongest Picks won 86.5% on the held-out seasons
against 86.5% stated, the bet builders 32.7% against 32.8%, the High Banker legs 77.8% against 77.6%, season by season
with no drift. What lost was the way they were played:

| Old rule (84%), held-out, strongest first | Picks a match day | 1 pick | 2 | 3 | 5 | 8 | 10 | 15 | every pick |
|---|---|---|---|---|---|---|---|---|---|
| Landed | 20.8 | 87.2% | 75.4% | 68.3% | 51.7% | 31.7% | 25.1% | 11.9% | 31.6% (20.8 legs) |

Picks from different matches multiply: ten 86% picks land together a quarter of the time. More than half of the old
list (54%) was team unders paying 1.10-1.15, so a slip long enough to pay anything was long enough to lose.

**By market, every selection at 84%+ (match cards), won minus stated:**

| Market | Tuning 2019-23 | Held-out 2023-26 |
|---|---|---|
| Team under 2.5 (away / home) | 0.0 / -0.1 (61,918) | -0.4 / -0.5 (35,841) |
| Team under 1.5 (away / home) | -1.9 / -0.7 (2,898) | -3.5 / -3.3 (1,311) |
| Both teams to score: No | **-26.0** (71) | **-19.1** (19) |
| Away or draw & over 1.5 | -8.3 (41) | -7.1 (24) |
| Total corners under | -1.4 (712) | -1.5 (56) |
| Team to score (home / away) | +0.7 / +1.2 | +0.9 / +1.0 |
| Home or draw / away or draw | -0.9 / -0.4 | -0.5 / +0.1 |

**The v3.0 Strongest Picks rule** (chosen on the tuning seasons, `lib/strongest/config.js`): measured chance 88% (89%
corners and bookings), every view 75%+, the bookmakers at most 93% (fair odds 1.08+), and team unders, clean sheets,
BTTS No, away-or-draw & over 1.5 and total corners under kept off the list, the match cards and the bet builders:

| | Tuning 2019-23 | **Held-out 2023-26** |
|---|---|---|
| Picks won (stated) | 90.7% (90.7%) — 11,129 | **90.6% (90.6%) — 6,008** |
| Picks a match day | 9.3 | 7.8 |
| Elite 90%+ / Strong 88-90% | 91.6% / 89.2% | 91.6% / 89.0% |
| **Safe slip** (strongest first while the combined chance stays 75%+) | 80.4% (79.2%), 2.7 legs, fair odds 1.28 | **80.4% (79.5%), 2.7 legs, fair odds 1.28** — 613 days |
| Longer slip (60%+) | 68.6% (67.6%), 4.4 legs, 1.52 | 67.9% (68.2%), 4.3 legs, 1.51 |
| 2 / 3 / 5 / 10 picks | 85.3% / 77.7% / 65.3% / 38.1% | 83.4% / 80.5% / 65.6% / 40.0% |
| Every pick on one slip | 55.1%, 9.3 legs | 56.8%, 7.8 legs |

The rule was checked against variants without cards under, with a 90% bar for corners and bookings, and without
bookings at all: per pick 90.5-91.0% and the safe slip 80.2-80.9% in every case, so it was left as chosen. Cards under
did run under its chance on the held-out seasons at this bar (84.6% against 90.6%, 208 picks), after the 2020-21
empty-stadium seasons flattered it in tuning; it is worth watching in the live record.

**Leagues.** The rule is measured on the archive's 18 divisions only, so the site now gives Strongest Picks (and bet
builders) only there; elsewhere a measured chance is untested.

**Final score.** On the methodology replay (29,191 held-out matches): the score inside the result and goals calls
(the old headline) was exactly right 11.7%, the single likeliest score 13.3% (stated 12.7%), one of the three
likeliest 34.1% (stated 33.1%), and the likeliest pair of total-goals counts ("2 or 3 goals") 46.8% (stated 46.3%).
The headline is now the single likeliest score, with the three likeliest and the goals range beside it. No model
gets one exact score right much more than 1 time in 8.

**Methodologies (v5.2).** Team Total Goals no longer offers team unders (under 1.5 won 1.0 points under its chance
held-out on 2,013 picks; "fails to score" 2.6 under on 688). Held-out, the fixture headline pick won 71.9% (stated
71.1%) on 11,820 picks; Team Total Goals (now team over 1.5 only) 69.2% (stated 68.4%); the Diamond tier 86.5%
(stated 84.4%).

**High Banker.** Its 3.0+ slip landed 33.6% and the safer 2.0+ 48.9% held-out: honest, and capped by the odds — a
3.0 slip cannot land much more than 1 time in 3. The tab now leads with the safest slip from the Strongest Picks and
says this in plain words.

**Bet Builder** (team unders and the other weak markets out of the legs): held-out 32.8% landed against 32.7% stated
(21,020 builders); tuning 32.6% against 32.7%.

**The live record.** Render's free disk is wiped on every restart and sleep, so the live record kept starting again
and nobody could check it. `lib/persist.js` mirrors the Strongest Picks, the safe slips, the bet builders and the High
Banker ledger to a `records` branch of a GitHub repository when `SHARPSHOOTER_RECORDS_REPO` and
`SHARPSHOOTER_RECORDS_TOKEN` are set, and restores them on start. Each new record entry carries the rule version, and
the page shows the current rule's record apart from older ones.

Limits, stated: the Strongest Picks replay is the price-anchored half of the rule (the archive cannot rebuild the v6
factor or stats views, so the site adds checks the replay does not); the chance and corner/card calibrations were
fitted on every season, so the held-out picks are slightly in-sample; and the report prints both periods together,
so the held-out numbers are a clean test of the stated chances but not a strictly blind test of every choice.
