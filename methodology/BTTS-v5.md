# 🚫✅ BOTH TEAMS TO SCORE — METHODOLOGY v5.0 (No and Yes)

> **BTTS No upgraded from v2.5 BTTS NO**, plus its mirror, **BTTS Yes**.
> Core rules: `00-CORE-v5.md`. Code: `lib/methodology/goals.js` → `bttsNo`, `bttsYes`.

---

## 📊 THE EVIDENCE (held-out 2023-26)

| | v4 | v5 |
|---|---|---|
| BTTS Yes | 61.7% (said 61.0%) · 957 picks | **63.9% (said 62.1%) · 1,121 picks** |
| BTTS No | 60.6% (said 59.7%) · 33 picks | 57.4% (said 60.4%) · 61 picks |

**BTTS No is rare and the hardest market on the site.** Calibration showed the raw model over-rates BTTS No
(it said 64%, it landed 57–59% in the band that matters) — v5 corrects that, which is why far fewer fixtures
reach the 58% floor. Small samples: treat the BTTS No hit rate as "about 58–60%", not a precise number.

---

## 🚫 BTTS NO

### The 1-1 trap — what the data said
v2.5's #1 rule ("can I picture 1-1? → remove") was a hard gate in v4: P(1-1) ≤ 12% **and** P(BTTS) ≤ 40%.
Tested on 939 candidates, it **removed ~75% of them while the survivors hit no more often** (60.2% vs 60.1%
stated). Low-scoring games — exactly the BTTS No games — are the games where 1-1 is most likely, so the gate
was fighting the market it serves. Once the probability is calibrated, the 1-1 is already priced in.

**v5:** the 1-1 trap is a **checklist item** (P(1-1) ≤ 13%). It can still sink a marginal pick; it no longer
vetoes every low-scoring fixture. You should still ask the Rule 1 question — the verdict prints P(1-1).

### Hard gates
| Gate | Rule | Pass criteria |
|---|---|---|
| **MODEL** | Rule 40 | Calibrated P(BTTS No) ≥ **58%** |
| **SAMPLE** | Rule 5 | ≥ 5 verified games per side |
| **PATH** | Rule 4 | The weaker attack can realistically blank: model P(blank) ≥ 38% **and** (blanked ≥ 25% of games, or < 1.0 scored/game, or xG < 1.0) |
| **DOGFORM** | Mistake 11 | The weaker side is not on a 3+ scoring run while scoring 2+ often |
| **FAV** | Rule 19 | A heavy favourite: clean sheets ≥ 40% **or** an underdog scoring ≤ 1.05/game |
| **CHAOS** | Rule 12 | Not both defences conceding ≥ 1.4/game |
| **NEWS** | Rule 15 | No defender/keeper loss on the side that must keep the clean sheet |

### Checklist
Underdog attack verified weak (goals + xG) · opposing defence holds (clean sheets) · blank frequency ·
sides rarely both score · head-to-head BTTS-No rate · low expected total · underdog attackers missing (FPL) ·
**recent games with a side kept to zero** (v5: counts shutouts directly — "Under 2.5 in 5/6" includes 1-1s,
Rule 13) · **the 1-1 trap** · **independent witness**.

### The 7 profiles
Unchanged as explanations: suffocating favourite + toothless underdog, low-block derby, nothing-to-play-for,
cup first leg, attacker-less underdog, tight tactical match, heavy-favourite blowout.

---

## ✅ BTTS YES

### Hard gates
| Gate | Pass criteria |
|---|---|
| **MODEL** | Calibrated P(BTTS) ≥ **58%** |
| **PATH** (Rule 4) | Each side scores in ≥ 70% of model outcomes; neither blanks in > 30% of games |
| **FORTRESS** | No side keeping clean sheets in ≥ 40% of games |
| **TRAP10** (Rule 1) | P(0-0, 1-0, 0-1) ≤ 28% |
| **FAV** (Rule 25) | A heavy favourite's opponent has scored in ≥ 60% of its games |
| **NEWS** (Rules 15, 18) | No rotation; no side missing ≥ 25% of its attacking output (FPL) |

### Checklist
Both attacks project (λ) · both defences concede · both sides trending BTTS · head-to-head BTTS rate ·
open expected total · league environment · defender/keeper disruption (bonus) · **independent witness**.

**Measured:** the PATH gate is the one that earns its place — picks passing it hit 1.6 points above their
stated probability.

---

## 🛠️ CHEAT SHEETS
**BTTS No:** calibrated ≥ 58%? weaker attack truly blanks? favourite's defence intact? not both leaking?
1-1 not the likeliest single score? your price ≥ take-at? → 1 unit. Otherwise SKIP.

**BTTS Yes:** calibrated ≥ 58%? both sides have a scoring route? no fortress? no heavy favourite shutting it
down? attacks intact? your price ≥ take-at? → 1 unit. Otherwise SKIP.

*v5.0 · from v2.5 BTTS NO · evidence: `research/backtest_methods.js` (DIAG=bttsNo)*
