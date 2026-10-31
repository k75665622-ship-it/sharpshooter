# 🧭 METHODOLOGY v5.0 — THE CORE PLAYBOOK

> **The shared operating system behind every market methodology on Sharpshooter.**
> v5 keeps the discipline that made v3.0 work (Rules 1–36) and adds what the data proved:
> **Rules 37–42**, a new price ladder, calibrated numbers, and a live track record.
> Every rule here is enforced by the code in `lib/methodology/` — nothing is decoration.

---

## ⚠️ READ THIS FIRST — WHAT 46,121 REAL MATCHES TAUGHT US

v5 was not written from opinion. Every rule change was tested on **46,121 real matches**
(18 European divisions, 2019-20 → 2026-27, with real Bet365 and best-of-17-books prices),
fitting on 2019-23 and checking on **held-out 2023-26 seasons that were never used to tune anything**.

| Finding | What it means for you |
|---|---|
| The de-vigged bookmaker price is the most accurate forecast available. Blending our model into it made it *worse* at every weight. | The market is the **anchor** (Rule 37). Our model is a **witness**, not a rival. |
| Betting where our model disagreed with the bookmakers **lost money** — and the bigger the "edge", the bigger the loss (−13% to −29% ROI). | A model "edge" is usually model error. It is a **warning**, never value (Rule 42). |
| The only positive signal: a bookmaker paying **more than the multi-book fair price**, for selections rated 30–75% likely. Longshots at "generous" prices lost heavily. | Value is a **price**, not an opinion (Rule 39). Every pick shows the price you need. |
| Recent-form evidence that agrees with the price is already **in** the price. For Under 2.5 it actively selected *worse* picks. | Don't double-count streaks (Rule 38). |
| v4 probabilities drifted from reality (Team Totals claimed 70.9%, hit 66.7%). v5's are calibrated: hit rate ≈ stated probability on every market. | **A v5 "65%" means 65%.** Floors mean real-world hit rates (Rule 40). |
| Free data sources contain errors. openfootball's League Two file had **97 wrong scores**; Portugal had two wrong final-day results. | Every result is **cross-checked by ≥ 2 sources**; disputed results are dropped (Rule 41). |

### v4 → v5 on the same held-out matches

| | v4 | v5 |
|---|---|---|
| Strongest pick per fixture | 66.7% hit (said 67.7%) · 6,577 picks | **71.6% hit (said 70.9%) · 9,114 picks** |
| Over 2.5 | 62.4% · 2,105 | **64.7% · 2,499** |
| Under 2.5 | 57.5% · 532 | **61.7% · 925** |
| BTTS Yes | 61.7% · 957 | **63.9% · 1,121** |
| Home Win | 78.8% on only 198 picks | **77.7% on 1,574 picks** |
| Underdog +handicap | 70.4% | **75.9%** |
| Team Totals | 66.7% while claiming 70.9% | **68.5%, claiming 68.9%** |

More picks, more accurate, and honest. **Not** a money machine — see "The honest truth about profit" below.

---

## 🏗️ HOW A PREDICTION IS BUILT (v5)

```
 bookmaker prices ──► multi-book consensus ──► market-implied expected goals ─┐
   (Bet365, DraftKings, Pinnacle, market average, Asian books)               │ 90%
                                                                              ▼
 cross-verified results ──► Dixon-Coles ratings ─┐                     ENSEMBLE ──► one score matrix
 ESPN xG ──────────────────► xG formula ─────────┼──► model witness ──►   │ 10%        │
 ClubElo ──────────────────► Elo goals ──────────┘   (no price in it)                   ▼
                                                                    calibrated probabilities
                                                                    (fitted on 38,700 real matches)
                                                                              │
             ┌────────────────────────────────────────────────────────────────┤
             ▼                                                                ▼
   GENERAL PREDICTION (every fixture)                     13 MARKET METHODOLOGIES
   result · goals · BTTS · final score · best bet         hard gates → checklist → price ladder
```

Every market comes out with **three numbers**:

- **Probability** — calibrated, market-anchored: *how likely is it to happen?* This drives every floor.
- **Model** — the independent witness (ratings + xG + Elo, no price): *does a second opinion agree?*
- **Take at ≥** — the minimum price worth staking: fair odds × 1.03 (never below 1.25).

---

## 🪜 THE STATUS LADDER (v5)

| Status | Meaning | What you do |
|---|---|---|
| 🔒 **LOCK** | All hard gates + ≥ 70% of the checklist pass (v5.1; draw and final score ≥ 85%) **and** a real bookmaker price beats the multi-book fair price by ≥ 3%, in the 30–75% band, with ≥ 2 books behind the consensus. | Stake 1 unit if your bookmaker matches the price. |
| 🎯 **PREDICT** | All gates + checklist pass. No book beats the consensus. | Stake **only** if *your* bookmaker (e.g. SportyBet) pays the "take at" price or more. |
| 📝 **PAPER** | Qualifies, but the market has not earned real money yet (GG/NG 2+). | Record it. Don't stake. |
| 👀 **WATCH** | Close, but the evidence is thin or the checklist falls just short. | Nothing. |
| ❌ **REMOVE** | A hard gate failed. | Nothing. Reasons are shown. |

**Changed from v4:** LOCK used to mean "our model disagrees with the price." The backtest proved that loses
money. LOCK now means "someone is paying more than the market's own fair price" — the only signal that held up.

---

## 📜 THE RULES

### Rules 1–27 (v3.0) — still in force

All 27 v3.0 rules remain the foundation. Where v5 changed *how* a rule is applied, it says so.

| # | Rule | v5 status |
|---|---|---|
| 1 | One weak leg kills everything | Each market adds its own "would I be surprised?" test (3-1 for Under, 1-1 for BTTS No). |
| 2 | Underdog attack test | Unchanged. |
| 3 | Shots are not goals — use xG | xG is now one of four model components. |
| 4 | Two-goal pathway | Unchanged (Over 2.5). Under 2.5's "zero-goal pathway" is now an **explanation**, not a gate (Rule 38). |
| 5 | Small sample size | Made mathematical: ratings use a ridge prior worth 6 games; newcomers start from a measured promoted-club prior. |
| 6 | Try to break your own pick | Every verdict lists the losing scorelines and their probability. |
| 7 | Don't chase odds with weak legs | Enforced: fair odds < 1.25 = "too short". |
| 8 / 16 | Three sources for load-bearing claims | Mechanised: results are cross-checked across ESPN, openfootball and football-data (Rule 41). |
| 9 | Narrative traps | Unchanged. |
| 10 / 11 | Market tournament · DC is not automatically safest | Double Chance is now its own methodology and must still pay ≥ 1.25. |
| 12 | Goal markets need their own audit | Unchanged. |
| 13 | Correlated evidence is not independent | Strengthened: the **independent witness** (Rule 42) and the **priced-in** rule (Rule 38). |
| 14 | Final stress test | Every verdict shows "how it could lose". |
| 15 / 18 / 19 | Rotation, key departures, debutants | Premier League: **real availability from Fantasy Premier League** with chance-of-playing %. Elsewhere: headline scanner. |
| 17 | 1 pick a day · 3 losing days → 5-day cooldown | **Enforced by the Track Record tab.** |
| 20 | Regression trap | Unchanged; Rule 38 extends it. |
| 21 | Draw machine test | Unchanged (Draw methodology). |
| 22 | Don't fight the favourite without evidence | The favourite is read from the **multi-book consensus**, not one book. |
| 23 | Default to goals markets | Unchanged as guidance; result markets carry the extra Elo witness. |
| 24 | Single-pick default | Unchanged. |
| 25 / 26 | Heavy-favourite score pressure · low-block underdog | Unchanged; the low-block gate was measured as one of the most valuable gates (failing it cost Over 2.5 picks 4.4 points of hit rate). |
| 27 | Streak anchoring | **Enforced by the Track Record tab.** |

### Rules 28–36 (v3.1, GG/NG 2+) — still in force, two corrections
See `GG-NG-2PLUS-v5.md`. Rule 30's 0.88 haircut is replaced by the **measured** haircut; Rule 34's
lifting condition (≥ 55% hit rate) was unreachable for a 22–35% market and is corrected.

### ⭐ Rule 37 — The Market Anchor
- The **multi-book consensus** (each book de-vigged separately, Pinnacle double-weighted, then averaged) is the
  base forecast. It carries **90%** of the weight when a price exists. (Measured optimum: 100%. The 10% model
  share costs 0.05% accuracy and keeps the line responsive to verified late news.)
- Without a price, the model components carry it: ratings 30% · xG 35% · Elo 35%.
- **Never** argue with a liquid, multi-book price because a stat looks good. The stat is already in the price.

### ⭐ Rule 38 — Priced-In Form (the Recency Guard)
- Evidence that **agrees with the price** is not new evidence — it is the reason the price is what it is.
- A streak (five Unders in a row, four clean sheets, three big wins) is the most priced-in evidence of all,
  and it **regresses**.
- **Measured:** Under 2.5 picks that passed the "recent low-scoring form" checks hit **1–1.6 points below**
  their stated probability; picks that *failed* them hit above it.
- Application: profiles and streaks become the **explanation** of a pick, not the **filter**. Where a price is
  built on an extreme streak (≥ 70% Unders **and** ≥ 45% clean sheets), the pick is removed.

### ⭐ Rule 39 — Value Is a Price, Not an Opinion
- A pick is **value** only when a real bookmaker pays **≥ 3% more than the multi-book fair price**, for a
  selection the market rates **30–75%** likely, with **≥ 2 books** behind the fair price.
- Below 30%: "generous" longshot prices are usually stale outliers — in testing they lost 16%.
- **Your rule at SportyBet:** every prediction shows **"Take at ≥ X"**. If SportyBet pays less than X, there
  is no bet, however good the pick looks.

### ⭐ Rule 40 — Calibrated Numbers Only
- Every probability on the site is **calibrated** on real results, and the calibration was verified on seasons
  it never saw. When the hit rate ≈ the stated probability, the number can be taken at face value.
- Floors are therefore **real-world hit rates**: a 60% floor means "this kind of pick lands about 6 times in 10".
- Rule 35's format applies to **every market**, not just GG/NG 2+:
  ```
  Model 64% | Fair 1.56 | Take at ≥ 1.61 | Best seen 1.65 (Bet365) | 4 books
  ```

### ⭐ Rule 41 — Verified Data Only
- Every result the methodologies read is checked against **at least one other independent source**:
  ESPN, openfootball (GitHub) and football-data.co.uk.
- Same score → **verified**. Different score with two sources → **dropped** (wrong data is worse than missing data).
  Three sources → **the majority wins**.
- Team names are matched by **learning from shared results**, not hand-made alias lists — 20/20 Premier League
  clubs mapped correctly with zero aliases in testing.
- The detail panel shows how much of each team's evidence is verified.

### ⭐ Rule 42 — The Witness Conflict
- The **independent model** (ratings + xG + Elo, no price) is shown next to every probability.
- Agreement is a checklist item: it adds a little confidence.
- Disagreement of **10+ points** raises a flag. It is **never** treated as value: in testing, when the model
  disagreed with the bookmakers, the bookmakers were usually right.

---

## 📅 THE DAILY PROCESS (on the website)

1. **Check the Track Record tab first.** If the Rule 17 cooldown is active, paper-trade only today.
   If Rule 27 is active (3+ winning days), drop today's confidence one level. Same stake, always.
2. **Top Pick tab** — the strongest prediction of the day. Read "Why it qualifies" and "How it could lose".
3. **Check your bookmaker's price.** Is SportyBet paying the **"take at"** price or more?
   - Yes → it is a bet (1 unit).
   - No → it is a prediction, not a bet. Skip it.
4. **Open the match** and check the Availability / team news section and the data provenance chips.
   If a key player has been ruled out since the prediction was made, re-load the match.
5. **One selection a day** (Rule 17). A double only if both legs are LOCK or PREDICT at the take-at price,
   and never with GG/NG 2+ or a correct score.
6. **Lock window — 1 hour before kick-off:** confirm line-ups. Surprise rotation → skip.
7. **After the match**, the Track Record tab settles it automatically. Download the CSV weekly.

**No pick passes? That is the system working.** SKIP days are part of the method, not a failure of it.

---

## 💰 STAKING & DISCIPLINE (unchanged in spirit, now enforced)

- **1 unit (GHS 50) flat.** No Kelly escalation, no "making it back".
- 3 consecutive losing days on the daily top pick → **5-day cooldown** (the Track Record tab shows it).
- After 3+ consecutive winning days → **drop confidence one level** (Rule 27). Never raise the stake.
- Half unit on Draw picks. Quarter unit on correct scores. GG/NG 2+: paper until Rule 34 is met.
- ❌ Never bet to recover a loss. ❌ Never bet below the take-at price. ❌ Never bet when emotionally compromised.

---

## 🧾 THE HONEST TRUTH ABOUT PROFIT

At Bet365 prices, **no methodology made a reliable profit** in the held-out seasons; most lost 2–4%, which is
roughly the bookmaker's margin. With the **best price across ~17 books**, several were around break-even or
slightly positive (Home Win +2.5%, Away Win +4.7%) — but those intervals include zero.

What v5 genuinely delivers:
1. **Accurate, honest probabilities** — you know how often each kind of pick lands.
2. **More predictions** at a higher hit rate than v4.
3. **The price you need** to turn a good prediction into a bet worth making.
4. **A record that cannot flatter itself**, enforcing your own discipline rules.

Profit, if it comes, comes from **getting a better price than the consensus** and from **discipline** —
not from a model out-guessing the bookmakers.

---

## 📁 THE PLAYBOOKS

| File | Markets |
|---|---|
| `OVER-2.5-v5.md` | Over 2.5 Goals (from v3.0) |
| `UNDER-2.5-v5.md` | Under 2.5 Goals (from v2.5 UNDER) |
| `BTTS-v5.md` | BTTS No (from v2.5 BTTS NO) and BTTS Yes |
| `GG-NG-2PLUS-v5.md` | GG/NG 2+ (from v3.1) |
| `RESULTS-v5.md` | Home Win, Away Win, Draw, Double Chance |
| `TEAM-TOTALS-AND-HANDICAPS-v5.md` | Team Total Goals, Underdog +, Favourite − |
| `FINAL-SCORE-AND-GENERAL-v5.md` | Final Score methodology and the General Prediction |

---

*Version: 5.0 · Built 18 October 2026 · Evidence: `research/` (reproducible) · Code: `lib/methodology/`*

🦾 **Discipline + an honest price beats a confident opinion.**
