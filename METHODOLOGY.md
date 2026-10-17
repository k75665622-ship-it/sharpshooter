# Sharpshooter methodologies (v4.0)

Eleven market methodologies decide what the site predicts. This document is the
plain-English reference for them. The code is in `lib/methodology/`, and
`GET /api/methodology` returns the live thresholds.

The first five are built from the four methodologies supplied for this project
(Over 2.5 v2.0, Under 2.5 v2.5, BTTS No v2.5, GG/NG 2+ v3.1) plus a BTTS Yes
counterpart. The other six (Home Win, Draw, Away Win, Team Total Goals, Underdog
Handicap +, Favourite Handicap −) were written in the same style.

## How a prediction is made

For each fixture the engine builds one evidence view (model, per-game history,
Elo, news, bookmaker price), then runs all eleven methodologies against it.

1. **Hard gates.** Every gate must pass. A gate whose evidence is unknown **fails**
   (fail closed), so missing data can never produce a prediction.
2. **Checklist.** Each methodology scores a list of soft checks. A check passes at
   0.5 or more. Qualification needs **at least 85%** of the *known* checks to pass,
   and at least 60% of the checks must be known.
3. **Status ladder.** `LOCK` > `PREDICT` > `PAPER` > `WATCH` > `REMOVE`.
   - **LOCK**: gates and checklist pass, and a real bookmaker price shows an edge.
   - **PREDICT**: gates and checklist pass; no verified price edge.
   - **PAPER**: qualifies, but the market is on probation (see below). Log it, do not stake.
   - **WATCH**: close, but too thin or just under the pass ratio.
   - **REMOVE**: a hard gate failed, or the checklist is far off.
4. **Price test.** The edge needed scales with the price: `max(minRatio, 1 + 0.05 × price)`.
   Prices under 1.25 are "too short" and never count as an edge.
5. **Contradictions.** When two qualifying picks cannot both be right (Over and Under 2.5,
   Home Win and Draw, BTTS No and GG 2+, a team to blank and BTTS Yes, and so on), the
   higher-ranked one stays and the other is set aside, with the reason shown.
6. **Headline.** The strongest surviving prediction per fixture, ranked by status then score.

## What was improved before applying it

| Change | Why |
| --- | --- |
| Probabilities are **recalibrated** (logistic fit on 2023–24, validated on held-out 2025) | The raw model was over-confident on goals markets. Stated 66.8% now hits 66.5%. |
| Over/Under and Yes/No stay **complementary** after calibration | Prevents both sides of a market looking attractive. |
| Floors are set on the **calibrated** probability (57% for the O/U and BTTS markets) | Floors mean what they say. |
| **Pass ratio** (85%) replaces a summed score for qualification | A summed score let one strong item hide several failures. |
| Unknown evidence **fails closed** and is counted separately | A thin sample can no longer qualify by default. |
| **Streak rule** needs the streak to be backed by the model or Elo | Streak-chasing was the main source of bad favourites. |
| **Elo** is an independent witness, waived when no rating is found | A second opinion that does not depend on the same results. |
| **Edge multiple scales with price** and a 1.25 price floor | A flat margin over-rewarded very short prices. |
| **Draw is paper-only** | The walk-forward backtest showed no predictive value. |
| **GG/NG 2+ is paper-only**, max 2 legs, fixed 1-unit stake, 40 tracked legs before real money | It cannot be validated from results alone. |
| **Contradiction resolver** | Two methodologies could otherwise publish opposite picks for one match. |

## The eleven methodologies

Numbers are the defaults in code. Where a market has several selections (team total
per side, handicap lines), each selection has its own floor.

### Over 2.5 Goals
Floor 57%, min edge 1.08×. Gates: two credible scoring pathways; no heavy favourite
capping the total; no low-block side; no rotation or missing attackers on both sides;
no Over streak the model does not support. Checks: both sides trending Over, expected
total, head-to-head Over rate, leakiness, attacking intent, no cautious profile, league
goals environment.

### Under 2.5 Goals
Floor 57%, min edge 1.08×. Gates: a named route to under three goals; no heavy favourite
pushing for goals; no attacking chaos; no defender or keeper disruption on both sides;
no long scoring streak the model backs. Checks: defensive strength, low expected total,
Under form, head-to-head Under rate, clean-sheet habit, limited firepower, league environment.

### Both Teams To Score — Yes
Floor 57%, min edge 1.08×. Gates: both sides can score (each ≥ 70%, blanks ≤ 30%); no
clean-sheet fortress; the 1-0 / 0-0 trap is not live (≤ 28%); no heavy favourite shutting the
game down; no rotation or key attackers out. Checks: both attacks project, both defences
concede, BTTS form, head-to-head BTTS rate, open total, league environment.

### Both Teams To Score — No
Floor 57%, min edge 1.08×. Gates: the weaker attack can realistically blank; the 1-1 trap
is not live (P(1-1) ≤ 12%, P(BTTS) ≤ 40%); the weaker side is not on a scoring run; not both
defences leaking; no defender or keeper loss on the favourite side. Checks: underdog attack
verified weak, opposing defence holds, blank frequency, head-to-head, low total.

### GG/NG 2+ — Both Teams 2+ Goals (paper only)
Floor 22%, min edge 1.3×, sample ≥ 8 each, max 2 legs, 1 unit fixed. Gates: both sides can
score 2+ (convolution, each ≥ 45%); real xG or full results plus team news; scoreline mass
not parked on 1-1 / 2-0 / 2-1 / 1-2 (≤ 45%); no favourite under 1.60; no rotation; each side
scores 2+ in half its games and 3+ in a quarter. Always PAPER: v3.1 requires a 40-leg tracked record at ≥ 55% before real money.

### Team Total Goals
Selections per side: **Over 1.5**, **Under 1.5**, **Under 0.5 (fails to score)**. Each selection has its
own floor, shown on the Methodology tab and in each verdict. Over 1.5 needs a side that scores 2+
regularly against a defence that concedes, with no low block, no rotation and no heavy underdog.
Under 1.5 needs a side that rarely scores 2+ and an opponent that defends. Under 0.5 needs a
genuine blank profile and no big-score habit.

### Home Win
Floor 55%, min edge 1.1×. Gates: not fighting the bookmaker's favourite; Elo agrees (waived if
absent); no rotation or mass absences; any win streak is backed by the numbers; the opponent
cannot keep scoring through the game; not poor at home (wins ≥ 40%); win probability at least
1.9× the draw. Checks: points per game, venue record, goal-difference gap, xG advantage, Elo,
head-to-head, clean sheets, rest, opponent absences.

### Draw (paper only)
Floor 29%, min edge 1.15×. Gates: both sides draw often; genuinely balanced; low expected total
(≤ 2.60); draws hold at the relevant venues; neither side a scoring machine; table positions close.
**Always PAPER.** In the backtest this market had no predictive value, so it is shown for tracking only.

### Away Win
Floor 50%, min edge 1.1×. Same structure as Home Win, with the venue test applied to away form
(wins ≥ 30%).

### Underdog Handicap (+)
Lines +0.5, +1, +1.5. Calibrated floors are high (74% for the covering side). Gates: the underdog
avoids heavy defeats (≤ 12%); the favourite is not a big-margin side; the model puts a heavy
defeat at ≤ 18%; the underdog can score; defence intact; not in freefall. Checks: the handicap
covers the typical margin, underdog defence holds, narrow-defeat profile, favourite attack not elite,
low total, modest Elo gap.

### Favourite Handicap (−)
Lines −1, −1.5. Floor 50%. Gates: wins by 2+ regularly (≥ 30%); scores 2+ regularly (≥ 55%); the
opponent concedes and is not a low block; the model makes a 2+ goal win realistic (≥ 30%); Elo
agrees (waived if absent); no rotation; attack intact; any streak is backed by the numbers.

## Evidence the methodologies run on

- **Per-game results (free):** openfootball on GitHub. Covers England 1–2, Germany 1–2,
  Spain 1–2, Italy 1–2 and Austria 1. Used for 0/1/2+ goal distributions, streaks, clean
  sheets, venue splits and head-to-head. Other leagues fall back to ESPN's last five games.
- **Elo (free):** ClubElo CSV API, used only as an independent corroborating witness.
- **Model:** Dixon-Coles bivariate Poisson on xG, then calibrated.
- **Prices:** ESPN (DraftKings) and InferSports (Asian books) where quoted.
- **News:** ESPN headlines, scanned for rotation, absences and departures.

## What the tests show

- Calibration is honest overall: 66.8% stated vs 66.5% observed on held-out 2025 matches.
- The gates add real value for BTTS, and little for Over/Under 2.5.
- Draw has no predictive value, so it is paper-only.
- **Price edge and profit are untested.** There is no free historical odds feed, so nothing
  here proves the strategy makes money. LOCK means "the numbers show an edge against a
  quoted price", not "this will win".
- The live ESPN, ClubElo and InferSports paths could not be exercised in the build sandbox
  (only GitHub was reachable). They are covered by offline parsers and stubbed tests; the first
  real run should be watched.

Run `npm run backtest` to reproduce the backtest and `npm run test:methodology` for the checks.
