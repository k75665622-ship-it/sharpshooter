# 🔢 FINAL SCORE METHODOLOGY & THE GENERAL PREDICTION — v5.0 (new)

> Two new layers: a **predicted final score for every fixture**, and a **general prediction** (result, goals,
> both-teams-to-score, best bet) for every fixture — including the many that fall under no methodology.
> Code: `lib/scoreline.js`, `lib/methodology/score.js`, `lib/general.js`.

---

## 🔢 PART 1 — PREDICTING THE FINAL SCORE

### How the score distribution is built
1. The ensemble's expected goals (90% market-anchored, Rule 37) feed a Dixon-Coles score matrix.
2. For exact scores only, the matrix uses a constant correlation and **inflates the draw diagonal by 10%** —
   the combination with the best exact-score accuracy on the tuning seasons (it fixes Poisson's known
   under-count of 0-0, 1-1 and 2-2).
3. Half-time uses the same expected goals × 0.44.

### Two scores, on purpose
| | Rule | Exact hit (held-out 19,991 matches) | Right result | Right Over/Under 2.5 |
|---|---|---|---|---|
| **Most likely score** | the single highest-probability cell | **13.3%** | 38.4% | 49.5% |
| **Predicted final score** | the most likely score **inside** the predicted result **and** the predicted Over/Under side | 11.8% | **51.0%** | **57.2%** |

The single likeliest score is usually 1-1 or 1-0, so it maximises exact hits but contradicts the predicted
result most of the time. The **predicted final score** reads consistently with every other prediction on the
page, which is why it is the headline; the most likely single score is shown beside it. Every fixture also
shows the **score band** — the smallest set of scores holding ≥ 50% of the probability — and a 5 × 5 heat map.

### The Final Score methodology (when a score is a pick in its own right)
| Gate | Rule | Pass criteria |
|---|---|---|
| **MODEL** | CS1 | P(predicted score) ≥ **12%** |
| **RESULT** | CS2 | The predicted result is ≥ **52%** likely |
| **GOALS** | CS3 | The predicted Over/Under 2.5 side is ≥ **56%** likely |
| **CONC** | CS4 | The three likeliest scores hold ≥ **33%** |
| **WIT** | CS5 / R13 | The independent model predicts the same result |

Checklist: low expected total · result margin over the next outcome · predicted score among the two likeliest ·
strong evidence sample · bookmaker price behind the expected goals · independent witness.

**Measured (held-out):** qualifying scores landed **17.6%** of the time (stated 15.0%) — against 11.7% for all
fixtures. A correct score still misses about **five times in six**.

### Staking (CS6)
- **Quarter unit, single only.** Never in an accumulator.
- No free feed quotes correct scores: take it only at **≥ 1.03 × fair odds** (the take-at price shown).
- A correct score is **never** the fixture headline and never displaces a market pick.

---

## 🌐 PART 2 — THE GENERAL PREDICTION (every fixture)

The methodologies are strict by design — most fixtures fall under none of them. The general prediction makes
sure every match still gets the engine's honest view, from the **same calibrated matrix**, so it can never
contradict a methodology pick.

| Field | What it is |
|---|---|
| **Result** | Home / Draw / Away — the most likely, with all three probabilities |
| **Double chance** | The result call plus the draw |
| **Goals** | Over/Under 2.5 call (plus Over 1.5 / Under 3.5 when ≥ 75%) |
| **Both teams to score** | Yes / No |
| **Final score** | Predicted score, most likely score, half-time score, score band, 5 × 5 grid |
| **Best bet** | The methodology headline when one qualifies; otherwise the **most likely selection that still pays ≥ 1.30** among 18 liquid markets |
| **Confidence** | High / Medium / Low — from price coverage, data coverage, how strong the best bet is, and whether the witnesses agree |

### The evidence (held-out 2023-26, 19,043 fixtures)
| | Hit rate | Stated |
|---|---|---|
| Best bet, every fixture | **73.6%** | 72.7% |
| Best bet, High confidence | **75.0%** | 74.1% |
| Best bet, Medium confidence | 65.3% | 64.5% |
| Result call | 50.9% | 50.4% |
| Predicted score exactly right | 11.7% | 10.7% |

At Bet365 prices the best bet lost about 3% (the margin); at the best price across ~17 books it broke even.
**Use the general prediction to understand a match. Bet only at the take-at price.**

*v5.0 · evidence: `research/score_study.js`, `research/backtest_methods.js`*
