# 🧠 THE NORMAL PREDICTION — v6.0 (Match Intelligence) & the Double-Confirmed Accumulator

> Every fixture gets the v6 normal prediction: **170 measured factors**, a calibrated forecast for every market,
> a **main pick**, a **safer pick**, a **value pick** when a price beats fair, an **avoid list**, and every
> pattern that fires on the match with its **measured verdict**. Methodology picks are unchanged and sit alongside.
> Code: `lib/intel/`, `lib/factors/`, `lib/crawler/`. Evidence: `research/v6/RESULTS.md`.

---

## 📥 PART 1 — THE DATA (the crawler)

| Source (free, no key) | What it gives every fixture |
|---|---|
| **football-data.co.uk** — 6 seasons per league | full-time & half-time scores, shots, shots on target, corners, fouls, cards, Bet365 + best-of-market odds (pre-closing and closing) |
| football-data.co.uk `fixtures.csv` | the upcoming fixture's own Bet365 and best-of-market prices — exactly the prices the model was trained on |
| **ClubElo** — three snapshots a day | each club's rating now, 30 days ago and 90 days ago (momentum) |
| **ESPN** | fixtures, line-ups/news, all-competition last game (true rest days), venue |
| **Open-Meteo** | kick-off weather (context only — not in the model) |
| ESPN + openfootball + football-data | cross-verified results (v5, Rule 41) |

The crawler is polite by design: it obeys robots.txt, rate-limits every site (football-data: one file per second),
re-uses unchanged files (ETag / Last-Modified), keeps the last good copy when a source is down (and never caches a
failure), and pauses a failing source for 10 minutes. Sites whose terms forbid scraping are not used.

---

## 🔢 PART 2 — THE 170 FACTORS (eleven families)

| Family | Examples | Weight with a price | Weight without |
|---|---|---|---|
| Market & price | margin, best price vs Bet365, implied goals | 17.7% | — |
| Performance & luck | shots on target share, finishing vs chances, keeper luck | 17.4% | 9.9% |
| League environment | goals/game, home-win and draw rates | 12.4% | 8.0% |
| Table & motivation | position, gaps to title / Europe / drop, games left, nothing-to-play-for, promoted | 10.2% | 14.1% |
| Goal trends | scored/conceded, Over 2.5 / BTTS / clean-sheet / blank rates, half-time patterns | 8.7% | 11.3% |
| Beating the bookmakers | points, goal difference and goals against what the odds expected | 7.0% | 8.2% |
| Form & trend | pts/game last 5 / 10 / venue / season, trend slope, streaks | 6.6% | 5.5% |
| Strength & momentum | ClubElo, 30 / 90-day Elo change | 6.4% | 34.1% |
| Discipline & set pieces | red cards in the last 3 (suspensions), cards, fouls, corners | 5.3% | 3.9% |
| Head-to-head | 6-year record, goals, BTTS, draws, same-ground record | 3.9% | 3.8% |
| Schedule & fatigue | rest days, games in 21 days | 2.7% | 0.8% |

Weights are measured (SHAP, held-out seasons), not guessed. Every family is shown on the match page in plain
English with how hard it pulled on the main pick.

---

## 🎯 PART 3 — THE DECISION

| Output | Rule | Held-out record (2023-26) |
|---|---|---|
| **Main pick** | the most likely selection with fair odds ≥ **1.30**, ranked by probability + 2 × (v6 − price), never one the factors rate **1.5+ pts below the price**, never a confirmed trap | **72.7%** (stated 73.1%) · 28,455 |
| **Safer pick** | the smallest step up in safety that the main pick guarantees (Home win → 1X, Over 2.5 → Over 1.5) | 82.1% (81.5%) |
| **Value pick** | the best available price is **5%+ above the v6 fair price** and the factors agree with the direction | 44.4% (44.6%) · **+6.6% at the best price** · −1.2% at Bet365 |
| **Avoid** | 30%+ selections the factors rate **2+ pts below the price**, plus confirmed trap patterns | won 50.3% vs 52.8% implied |
| **Confidence** | High ≥ 70%, Medium 60-70%, Low < 60%, one level lower for no price, thin data or a cup tie | High 73.9% · Medium 67.6% · Low 53.9% |

**Take-at price** = v6 fair odds × 1.02. Below it, don't bet — even when the pick is right, the price is not.

### 🪤 Patterns and traps — measured, not folklore
46 popular beliefs were tested on 2005-23 and confirmed on 2023-26:
- **Confirmed edges (2):** heavy home favourites (70%+); favourites that dominate shots on target.
- **Confirmed trap (1):** underdogs whose Elo has jumped 40+ in 90 days — the market over-reacts.
- **Priced in (35):** streaks, losing runs, revenge and bogey head-to-heads, dead rubbers, relegation fights, promoted
  sides, short rest, recent red cards, hyped overs, goal-fest head-to-heads… the bookmakers already account for them.
- Weak (6) and unstable (2) are shown as such.

---

## 🔗 PART 4 — THE DOUBLE-CONFIRMED ACCUMULATOR

A selection becomes a leg **only** when:
1. it **qualifies under a methodology** — LOCK or PREDICT (never Paper, Watch or Remove), **and**
2. the **normal prediction agrees** — it is the normal **main pick**, a **safer form** of it, or it matches the
   normal prediction's **result / goals / BTTS call** with **60%+** probability, **and**
3. the normal prediction does **not** flag it as over-rated by the price, and no confirmed trap fires on it.

Never in an accumulator: draws, correct scores, paper markets (GG/NG 2+), two legs from one match, a match that has kicked off.

The site builds the best **double, treble, four-fold and five-fold** from the most likely legs, with the combined
probability, fair odds, best available combined price and the **take-at** price, and recommends the biggest one that
still has at least a **40%** chance — usually the double.

| Held-out 2023-26 | Hit (stated) | Bet365 | Best price |
|---|---|---|---|
| Legs | 72.5% (72.1%) | | |
| Doubles | **67.3% (63.7%)** | +2.1% | **+8.2%** |
| Trebles | 51.5% (49.7%) | −1.3% | +8.0% |
| Four-folds | 39.2% (38.4%) | −10.5% | +0.4% |
| Five-folds | 30.3% (30.2%) | −34.7% | −26.1% |

On the 2019-23 seasons doubles were −0.7% / +6.1% and trebles −10.7% / −1.4%: the probabilities are reliable in both
periods, the profit is only consistent for doubles at good prices. **Margins multiply in accumulators — the take-at
price matters more than anywhere else.**

---

## 🛠️ CHEAT SHEET
**Read the match:** main pick + confidence → what moved it → families → patterns & traps.
**Bet:** only at or above the take-at price; prefer the value pick when one exists; skip anything on the avoid list.
**Accumulator:** double-confirmed legs only, the recommended size, at or above its take-at price.

*v6.0 · evidence: `research/v6/`*
