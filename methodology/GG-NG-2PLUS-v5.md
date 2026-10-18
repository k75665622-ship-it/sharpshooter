# 🏆 GG/NG 2+ (BOTH TEAMS 2+ GOALS) — METHODOLOGY v5.0

> **Upgraded from v3.1.** Every v3.1 rule (28–36) and the hard prohibition stay. v5 corrects three things the
> data showed were wrong or impossible, and the Track Record tab now builds the Rule 34 record for you.
> Core rules: `00-CORE-v5.md`. Code: `lib/methodology/goals.js` → `gg2`.

---

## 📊 WHAT 46,121 MATCHES SAY ABOUT THIS MARKET

| Measure | Value |
|---|---|
| Base rate (both sides 2+), 18 European divisions | **13–15%** (v3.1 said 8–12%) |
| Fixtures with calibrated P(GG 2+) ≥ 22% | **607 of 46,075 tested (1.3%)** — they hit **25.7%** (stated 23.7%) |
| … of which both sides ≥ 45% to score 2+ (Rule 30) | **250** — hit **27.2%** |
| Passing every v5 gate except live team news (not available historically) | **10** — hit **30.0%** (stated 27.9%) |

The modal-cluster insight (Rules 29, 36) is confirmed: the market is dominated by scorelines that lose this
bet, and the gates are as tight as v3.1 intended — about one candidate per league per season. The
probabilities are honest. The open question is only whether a price ever pays enough, and no free feed quotes
this market, so it stays **paper-only** until your own record proves it.

---

## 🔧 THE THREE v5 CORRECTIONS

### 1. Rule 30 — the 0.88 haircut is replaced by the measured one
The fixed 0.88 "game-script covariance haircut" was a guess. Calibrated on real results, the correction the
score matrix needs is **0.90–0.98** at the levels that matter (smallest near 20%, largest at 30%+). The site
shows the calibrated joint probability directly. The **45% per side** gate is unchanged.

### 2. Rule 33 — corroboration without a second bookmaker
No free feed quotes GG/NG 2+. Rule 33(c) allowed reconstruction from other lines; v5 does it twice,
independently, and requires both to agree:
- **market-implied**: P(GG 2+) from the bookmakers' implied expected goals (1X2 + Over/Under consensus)
- **model-only**: P(GG 2+) from ratings + xG + Elo, with no price in it

Both must be **≥ 20%** and within **1.35×** of each other. One estimate alone is "a quote, not a market".

### 3. Rule 34 — a lifting condition that can actually be met
v3.1: "40-leg paper record at ≥ 55% hit rate." A market whose qualifying probability is 22–35% **cannot** hit
55% — the rule could never be lifted, however good the method. v5:

> **Paper-only until 40 settled legs show a hit rate at or above their average stated probability AND a
> profit at the prices you recorded.**

The Track Record tab counts the legs and shows the Rule 34 status. **The 2-leg hard cap and the 1-unit fixed
stake never lift.**

---

## 🔍 THE GATE SET (all must pass)

| Gate | Rule | Pass criteria |
|---|---|---|
| **MODEL** | R35 | Calibrated P(GG 2+) **≥ 22%** |
| **SAMPLE** | R32 | ≥ **8** verified games per side |
| **GG3** | R30 | P(home ≥ 2) ≥ 45% **and** P(away ≥ 2) ≥ 45% |
| **GG1** | R33 | Two independent reconstructions agree (above) |
| **GG4** | R32 | xG, or 8+ verified results per side; plus team news |
| **GG5** | R36 | The losing cluster (1-1, 2-0, 2-1, 1-2 …) holds ≤ 45% of the probability |
| **GG6** | R31 | No favourite under 1.60 — unless it scores 3+ in ≥ 3/8 **and** the underdog 2+ in ≥ 3/8 |
| **GG7** | R15/18/19 | No rotation, debutants or key departures |
| **R29** | R29 | Each side scores 2+ in ≥ half its games and 3+ in ≥ a quarter. **BTTS form is inadmissible.** |

## ✅ CHECKLIST
Convolution probability · both blended λ ≥ 1.9 · 2+ goal frequency · league ≥ 2.8 goals · balanced, draw-live
game (2-2 is a draw) · real xG · low losing-cluster mass · **fair ≤ 0.77 × offered (Rule 28 — enter your price)** ·
independent witness.

## 💰 STAKING (unchanged — the rules that save the money)
- **Maximum 2 legs on any GG/NG 2+ selection. No exceptions.** (Rule 34)
- **1 unit, fixed. No Kelly.**
- **Minimum price = 1.30 × fair odds** (Rule 28). The verdict prints it.
- Paper until the Track Record tab says Rule 34 is met.

*v5.0 · from v3.1 · evidence: `research/` (calibration key GG2P; DIAG=gg2)*
