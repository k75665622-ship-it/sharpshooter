# 🏆 OVER 2.5 GOALS — METHODOLOGY v5.0

> **Upgraded from v3.0** (your 4/5, +GHS 102 system). Same rules, same pre-flight spirit — now on calibrated,
> market-anchored probabilities, with real team news in the Premier League and a price you can act on.
> Core rules: `00-CORE-v5.md`. Code: `lib/methodology/goals.js` → `over25`.

---

## 📊 THE EVIDENCE (held-out 2023-26, never used to tune)

| | v3.0 / v4 logic | v5 |
|---|---|---|
| Qualifying picks | 2,105 | **2,499** |
| Hit rate | 62.4% (said 62.0%) | **64.7% (said 65.5%)** |
| ROI at Bet365 | −4.5% | −3.8% |
| ROI at best price (~17 books) | −2.4% | −1.6% |

The gate that earned its keep: **the low-block gate (Rule 26)** — Over picks that failed it hit **4.4 points
below** their stated probability. Keep respecting it.

---

## 🔍 HARD GATES (all must pass — unknown evidence fails)

| Gate | Rule | Pass criteria |
|---|---|---|
| **MODEL** | Rule 40 | Calibrated P(Over 2.5) **≥ 58%** (v3.0 said "model 60%+"; v5 numbers are calibrated, so 58% means 58%) |
| **SAMPLE** | Rule 5 | ≥ 5 verified games of evidence per side |
| **PATH** | Rule 4 | Two scoring pathways: both expected-goals ≥ 1.00, **or** one side ≥ 2.20 |
| **FAV** | Rule 25 | A heavy favourite (< 1.60) has scored 3+ in ≥ 35% of recent games — **or** ≥ 25% with the model giving it ≥ 32% to score 3+ (v5: one run of 1-0s is not a structural trait if the matrix says otherwise) |
| **LOWBLOCK** | Rule 26 | No side with Under 2.5 in ≥ 70% of games **and** blanks in ≥ 30% |
| **NEWS** | Rules 15, 18, 19 · pre-flight #2, #6, #7 | No rotation (< 3 days' rest), no side missing ≥ 25% of its attacking output (FPL), not attackers missing on both sides, no mass absences, no key departure or manager change |
| **STREAK** | Rules 20, 27 | An Over streak of 4+ must be backed by a model total ≥ 2.6 |

## ✅ CHECKLIST (≥ 70% of the known items must pass — v5.1; it was 85%)

| Item | Pass at |
|---|---|
| Both sides trending Over (last 8–12) | average Over rate ≥ ~52% |
| Expected total goals | ≥ ~2.65 |
| Head-to-head Over rate | ≥ ~48% (3+ meetings) |
| Defensive leakiness | ≥ ~1.2 conceded per game |
| Both attacks in intent | ≥ ~1.35 scored per game |
| No cautious profile | neither side Under in > ~57% |
| League goals environment | league Over rate ≥ ~48% |
| **Defensive disruption on both** (pre-flight #1) | defenders/keepers out on both sides — bonus only |
| **xG profile of the matchup** | blended xG for/against ≥ ~2.7 |
| **Independent witness** (Rule 42) | model-only ≥ floor − 3 pts |

## 🎯 STATUS
- **LOCK**: all of the above + a book paying ≥ 3% over the multi-book fair price (Rule 39).
- **PREDICT**: all of the above. Bet only at your bookmaker's price ≥ **take-at**.

---

## ✈️ PRE-FLIGHT CHECKLIST (v3.0 → v5 mapping)

| v3.0 check | Where it lives in v5 |
|---|---|
| 1. Defensive disruption on BOTH | Checklist bonus `DEFDIS` (FPL in the Premier League) |
| 2. Both teams FULL ATTACK | Gate `NEWS` (≥ 25% of xGI missing on either side fails) |
| 3. Favourite NOT heavy (or 3+ goal games) | Gate `FAV` |
| 4. Underdog NOT low block | Gate `LOWBLOCK` |
| 5. Model 60%+ AND edge 5%+ | Gate `MODEL` (calibrated 58%) + Rule 39 price test (the "+5% edge" was a model-vs-price test, which lost money — v5 replaces it with a *price*-vs-consensus test) |
| 6. No new-manager debut | Gate `NEWS` (departure / manager change) |
| 7. No captain/key player first match | Gate `NEWS` |

---

## ⚠️ HOW IT LOSES (shown on every verdict)

- The 2-0 / 1-0 trap: the favourite scores and manages the game (Rule 25). The verdict lists the losing
  scorelines and their combined probability.
- The low block holds for 60 minutes and the game never opens (Rule 26).
- An early red card or an early goal that makes both sides cautious.

## 🛠️ CHEAT SHEET
1. Calibrated Over ≥ 58%? 2. Two pathways? 3. Heavy favourite that actually scores 3? 4. Any low block?
5. Attacks intact (FPL)? 6. Streak backed by the model? 7. Your price ≥ take-at?
**All yes → 1 unit. Any no → SKIP.**

*v5.0 · from v3.0 (Days 6+) · evidence: `research/backtest_methods.js`*
