# SHARPSHOOTER

A football prediction engine that runs on **live data from free, key-less APIs**.

It builds a Dixon-Coles bivariate Poisson model from real expected-goals data,  
detects visible *and* hidden patterns, screens every market against a set of  
bookmaker-trap gates, and then runs the match through **eleven market  
methodologies** (Over/Under 2.5, BTTS Yes/No, GG/NG 2+, Team Total Goals, Home Win,  
Draw, Away Win, Underdog Handicap +, Favourite Handicap −). A match is only  
predicted in a market it genuinely falls under. See [METHODOLOGY.md](METHODOLOGY.md).

---

## Quick start

```bash
cd sharpshooter
npm start          # or: node server.js
```

Then open **<http://127.0.0.1:3000>**

No `npm install`. No API keys. No sign-up. Zero dependencies — it uses Node's  
built-in `http` server and global `fetch`. Requires Node 18+ (for global `fetch`).

> **First run takes a moment.** The engine builds league scoring baselines from  
> live team statistics (~20 requests per league). Everything is cached to disk  
> for 12 hours, so subsequent loads are instant.

To run the checks:

```bash
npm run verify            # all offline checks, including the methodology suite
npm run backtest          # walk-forward backtest on openfootball results (needs network)
```

---

## Data sources — all free, all key-less

| # | Endpoint                                                             | What it provides                                                                              |
| - | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1 | `site.api.espn.com/.../soccer/{league}/scoreboard?dates=YYYYMMDD`    | Fixtures, live scores, form strings, records, **bookmaker odds with open *and* close prices** |
| 2 | `site.api.espn.com/.../soccer/{league}/summary?event={id}`           | Head-to-head series, last-5 games, standings, news, multi-book odds, venue                    |
| 3 | `sports.core.api.espn.com/.../teams/{id}/statistics`                 | **Real xG / xGA**, goals, shots, possession, clean sheets, cards, suspensions                 |
| 4 | `sports.core.api.espn.com/.../leagues/{league}/seasons/{year}/teams` | League team lists, used to build scoring baselines                                            |
| 5 | `api.infersports.dev/v1/events?date=YYYY-MM-DD`                      | Fixture list across ~70 competitions (keyless)                                                |
| 6 | `api.infersports.dev/v1/events/{id}/odds?format=decimal`             | **Asian handicap + totals at multiple lines, 1x2, half-time**, from ~6 Asian books + Pinnacle  |

| 7 | `raw.githubusercontent.com/openfootball/{country}/...`               | **Per-game results** (free, no key) for England 1–2, Germany 1–2, Spain 1–2, Italy 1–2, Austria 1 |
| 8 | `api.clubelo.com/{date}`                                             | **Club Elo ratings**, used only as an independent second opinion                              |

**54 competitions** are registered. The daily board polls **31 core competitions**;
the full registry is used to resolve cup teams back to their domestic leagues.

### Why two odds sources

ESPN publishes exactly **one** bookmaker (DraftKings) and exactly **three**
market types: moneyline, one total line, one spread line. That is not enough —
most of the ~63 markets the model derives would have no price at all, and an
unpriced market cannot be value-checked, so it can never be elected as a banker.
The banker would be structurally trapped in the same two or three market types.

InferSports fills the gap on a keyless free tier, and Asian books are the
sharpest soccer prices available anywhere:

| | ESPN / DraftKings | InferSports (Asian) |
|---|---|---|
| Books | 1 | ~6 (crown, hkjc, m8bet, macau, nova88, sbobet) |
| Total lines | 1 | **up to 5** (2.5 → 3.5, plus quarter lines) |
| Handicap lines | 1 | **up to 4** (−2 → +0.5) |
| Half-time markets | ✗ | ✓ |

Measured across a full 60-fixture board, comparing the same slate analysed with
and without the second source:

| | ESPN only | + InferSports |
|---|---|---|
| Markets derived | 3,780 | 3,780 (identical) |
| Markets price-verified | 706 (18.7%) | **880 (23.3%)** |
| Fixtures gaining verified markets | — | **39 of 60** |
| Best single gain | — | +8 markets (Brighton v Arsenal) |

The second source does **not** invent markets — it prices markets we already
derive. Half-time markets and the higher/lower total lines became priceable for
the first time.

**It also changes the output, and that is the point.** Because a multi-line
consensus feeds the ladder-fit total-goals expectancy, the sharpshooter score
moves: on the measured slate the Banker of the Day flipped from FC Dallas (79.6)
to Gimnasia La Plata (79.3), with individual score shifts of up to ±5. So this is
not cosmetic verification — a board priced from ESPN alone is a *different and
less well-cross-checked* board. The engine says so explicitly (see below).

Two design rules keep this safe:

- **ESPN keeps priority.** It is the source the fixture itself is built from, so
  where both quote the same market, ESPN's price wins. InferSports only fills
  gaps.
- **The consensus is the *median*, not the best price.** Taking the best price
  across six books would flatter expected value. The median is the honest read
  of where the market is; the best price is kept alongside for reference.
- **A wide cross-book spread is itself a trap signal.** If the book we priced
  from sits ≥12% away from the consensus, that is flagged — a single generous
  book is not the same thing as a good price.

### Rate limits, and what happens when they bite

**The limiter has already changed once under this client, so the code handles
both dialects.** That is not defensive padding — it is a real migration:

| | old | new |
|---|---|---|
| Limit header | `Ratelimit-Limit: 200` | `X-Ratelimit-Limit: 60` |
| Scope | `X-Ratelimit-Scope: daily` | *(none)* |
| Reset | `Ratelimit-Reset: 85020` — a **delta** | `X-Ratelimit-Reset: 1789721612` — an **absolute epoch** |
| Shape | 200 requests per day | ~60 requests per rolling window |

Three traps live in that table, and each one silently disables the source:

1. **`X-Ratelimit-*` is not `Ratelimit-*`.** `Headers.get` is case-insensitive
   but *not* prefix-insensitive, so both spellings must be read.
2. **`Number(null)` is `0`.** A missing header parsed naively becomes a hard `0`,
   and `remaining = 0` trips the budget guard — so the client goes dark while
   the API is perfectly healthy. Missing must mean `null`.
3. **Delta vs epoch.** Reading a delta as an epoch blocks for ~57 years; reading
   an epoch as a delta adds ~57 years to now. Detected by magnitude (>1e9 is an
   epoch), and the block is capped at 24 h so no malformed header can brick it.

What the client does:

- **Trips a breaker** on a long-window 429 (a daily quota will not reopen in the
  next second, so retrying just burns budget). One request instead of sixty.
- **Waits out a short-window 429** using the actual reset delta, then retries —
  a rolling window refills in seconds, so giving up there would be wrong.
- **Holds back a reserve only for `daily` scopes.** A reserve protects an
  unrecoverable budget; against a rolling window it just starves the board.
- **Skips unratable fixtures**, since they can never produce a prediction.
- **Mirrors the cache to disk**, so a restart inside the TTL window is free.
- **Never caches a failure**, which would otherwise assert "no fixtures today"
  for the whole TTL.

#### Why there is no cheaper pre-screen

The obvious optimisation is to analyse with ESPN first and only buy Asian odds
for the top candidates. This was **measured and rejected** — on a real slate it
would have skipped **5 of 9 bankers, including the Banker of the Day**:

| Pre-screen | Bankers missed |
|---|---|
| top 15 | 7 of 9 |
| top 25 | 5 of 9 |
| top 40 | 3 of 9 |

The reason is that the ESPN-only ranking is dominated by fixtures whose high
score comes from *unverified synthetic* prices. Those fixtures look excellent and
can never be elected, so the ranking is not merely noisy — it is systematically
pointed at the wrong fixtures. There is no cheap safe subset. The full-board
fetch is the cost of correctness.

#### Measured board coverage

Same 60-fixture slate, three ways:

| | Markets derived | Price-verified |
|---|---|---|
| ESPN only | 3,780 | 706 (18.7%) |
| + InferSports (measured earlier) | 3,780 | 880 (23.3%) |
| + InferSports (with the limiter fixed) | 3,780 | **981 (26.0%)** |

A full board costs ~48 requests and completes inside one rolling window with
room to spare. Tune with:

| Variable | Default | Purpose |
|---|---|---|
| `IS_TTL_ODDS` | 15 min | Asian odds cache life |
| `IS_TTL_EVENTS` | 30 min | event-list cache life |
| `IS_RESERVE` | 4 | calls held back from a **daily** breaker |
| `IS_PERSIST` | on | set `0` to disable the disk mirror |
| `IS_CACHE_DIR` | `data/infersports` | disk mirror location |

When the source genuinely is unavailable, the engine does not pretend otherwise.
`dataProvenance.asianNote` carries the reason and the UI shows it:

> ⚠ Asian book pricing unavailable — daily quota exhausted — ESPN pricing only.
> Multi-line handicap, half-time and higher/lower totals are unquoted on this
> fixture, so they cannot be value-verified or elected.

The board still works — it is priced from ESPN alone, and says so.


---

## The pipeline

```
  fixtures + odds
        │
        ▼
  xG / xGA per team  ──►  shrunk attack & defence ratings
        │                      (Bayesian shrinkage, K=8)
        ▼
  expected goals (λ_home, λ_away)
        │   blended with: recent form (18%), H2H (8%), home/away splits
        ▼
  Dixon-Coles score matrix  (ρ tuned to match tempo)
        │
        ▼
  70+ markets derived from ONE consistent matrix
        │
        ├─► patterns: visible + hidden
        ├─► line movement: open → close drift
        └─► trap screening: 11 gates
                │
                ▼
        sharpshooter score (0–100) per market
                │
                ▼
        ONE banker elected per match
```

### Why one shared matrix matters

Every market is derived from the same score matrix, so the model can never  
produce self-contradictory picks (e.g. "home win" *and* "under 2.5" in a game  
it expects to finish 3-0). That consistency is what makes the banker selection  
meaningful.

### Attack / defence ratings

```
attack  = 0.68 × (team xG per game  / league avg xG)  +  0.32 × (goals per game / league avg)
defence = 0.68 × (team xGA per game / league avg xG)  +  0.32 × (conceded per game / league avg)
```

xG is weighted higher than actual goals because it is the better predictor —  
goals contain finishing luck that does not repeat. Both are then **shrunk  
toward 1.0** based on games played (`w = GP / (GP + 8)`), so a team with four  
games played cannot dominate the model.

Where a league does not publish xG (some smaller divisions report 0.0), the  
model falls back to goals-only ratings rather than silently diluting toward a  
meaningless 1.0.

### Dixon-Coles correction

Independent Poisson under-predicts 0-0 and 1-1 and over-predicts 1-0 / 0-1.  
The Dixon-Coles τ adjustment fixes this. ρ is tuned to the match's expected  
tempo: tighter, lower-scoring games get a stronger correction.

---

## Markets derived

1X2 · Double Chance (1X, 12, X2) · Draw No Bet · Asian Handicap (−2 … +2, with  
push handling) · Over/Under 0.5–4.5 · Both Teams To Score · Team Totals · Half  
Time Result · Correct Score (top 12)

**70+ markets per match.**

---

## Pattern detection

### Visible

Form strings, recent goal output, H2H record, H2H BTTS/over rates, table gap,  
combined xG.

### Hidden

| Signal                   | What it detects                                                 |
| ------------------------ | --------------------------------------------------------------- |
| **Regression to mean**   | Goals scored vs xG divergence — teams running hot are due a dip |
| **Defensive regression** | Goals conceded vs xGA — flattered or unlucky defences           |
| **Momentum shift**       | Last-3 form vs last-5 form trajectory                           |
| **Clean sheet streak**   | Consecutive shutouts                                            |
| **Scoring drought**      | Failed to score in every recent game                            |
| **Home fortress**        | Home scoring rate vs overall rate                               |
| **Travel weakness**      | Away scoring rate vs overall rate                               |
| **Shot quality**         | Shots-on-target ratio differential                              |
| **Shot volume**          | Shots per game differential                                     |
| **Discipline risk**      | Red cards and suspensions                                       |
| **Style clash**          | Possession profile contrast                                     |
| **League environment**   | League-wide goals per game and home share                       |

---


## Bookmaker trap screening

Eleven gates. Any `veto`-severity flag removes the market from banker  
consideration entirely.

| Gate                      | Trigger                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| **Margin trap**           | 1X2 overround > 10% — the book is loading the market                    |
| **Short-price trap**      | Priced ≤ 1.30 but the model gives it < 60%                              |
| **Model/market conflict** | Market implies ≥ 12% more than the model does                           |
| **Reverse line movement** | Price drifted ≥ 7% from open — money is going the other way             |
| **xG over-performance**   | The side being backed scores ≥ 35% more than xG                         |
| **Small sample**          | Either team has played fewer than 3 games                               |
| **Fixture congestion**    | A side played within 3 days                                             |
| **Unverifiable price**    | No bookmaker quote — value cannot be checked                            |
| **Low liquidity**         | Tier-4 league without a quoted price                                    |
| **Missing statistics**    | No season data for one or both teams                                    |
| **Draw trap**             | Very tight model spread where the draw is live                          |
| **Team-news disruption**  | Two or more confirmed absences reported on the side the pick depends on |

---


## Team-news scanner

ESPN's match summary carries a handful of editorial headlines per fixture. Those  
headlines are the only free, key-less source of team news, so they are treated as  
a **risk signal** — never as ground truth.

`lib/news.js` scans each headline and description for risk language, then  
attributes the finding to a side. A finding only penalises a market when it lands  
on the side that market actually depends on.

| Severity | Language matched                                                                   | Effect on a market that depends on that side |
| -------- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| `high`   | red card, sent off, suspended, banned, ACL, out for the season, ruled out, a doubt | −10 to the score                             |
| `medium` | injured, hamstring, groin, ankle, knock, illness, sold, transferred, departed      | −4                                           |
| `info`   | rotation, rested                                                                   | no penalty                                   |
| `veto`   | **two or more** `high` findings on the same side                                   | market removed from banker consideration     |

Two design rules keep this honest:

- **Word order decides attribution.** Real headlines name both teams —  
  *"Besiktas key midfielder suspended for Marseille clash"*. The risk word sits  
  next to the team it applies to, so the team named closest *before* the risk  
  word owns it. A joint statement (*"Besiktas and Marseille both lose key men"*)  
  stays unattributed.
- **Risk on the opposing side is never penalised.** It may in fact help the  
  selection, so it is surfaced as information only. Unattributable items are  
  likewise informational, so generic editorial copy (transfer gossip, a  
  competition-wide ban story) can never block a pick.

When a `veto` fires, the engine re-elects the safest remaining market on that  
fixture — or elects nothing. That is the "switch to a different option" path.

---

## Caveats are always shown

A banker is only trustworthy if its weaknesses sit next to it. Every elected  
market carries its surviving caveats — cross-league fixtures, thin samples, the  
negative-EV disclosure, any team-news finding, and data-quality gaps (no xG  
published, few games played) — rendered on the Banker of the Day hero, on each  
banker card, and in the match detail panel.

A banker is selected for **safety, not value**. When the model broadly agrees  
with the book, expected value sits near zero or slightly negative once the margin  
is paid, and the card says so explicitly rather than implying unearned edge.

---

## Banker election (legacy)

> Superseded by the methodology layer (`/api/predictions`). The banker is still
> computed and served at `/api/bankers` for compatibility, but the website no
> longer uses it.

A market becomes the banker only if it clears **all** of:

1. It is in the **curated eligible set** (extreme handicaps, Over 0.5 and  
   correct scores are excluded — they pay almost nothing and would otherwise  
   dominate any probability-weighted score)
2. It has a **real bookmaker price** — synthetic-only markets cannot be  
   value-verified, so they are never elected
3. Price ≥ 1.25
4. No `veto`-severity trap
5. Model probability above its **market-specific floor**  
   (1X2 ≥ 56%, Double Chance ≥ 78%, Totals ≥ 62%, …)
6. Sharpshooter score ≥ 70
7. Expected value not worse than −3%
8. Fewer than two `high`-severity traps

Exactly **one** market is elected per match — the safest, not the most  
profitable. If nothing qualifies, no banker is issued and the best near-miss is  
surfaced separately as a **lean**, explicitly labelled as not a banker. **That  
is a valid and intentional output.**

### Tiers

| Tier     | Score | Meaning                                          |
| -------- | ----- | ------------------------------------------------ |
| Platinum | ≥ 88  | Every gate cleared with room to spare            |
| Gold     | ≥ 80  | Strong across model, market and pattern checks   |
| Silver   | ≥ 70  | Solid but with a minor caveat attached           |
| Lean     | < 70  | Did **not** qualify. Shown for transparency only |


### Sharpshooter score

```
32%  probability safety (vs the market's floor)
16%  model ↔ market agreement
12%  xG consistency (our λ vs the market-implied λ)
12%  pattern support (directional, not just presence)
10%  form support
10%  sample confidence
 8%  H2H support
      − trap penalties   + small EV bonus
```

**Calibration.** Clearing the floor is the stated bar for a banker, so the  
safety term is anchored at 0.6 for a market sitting exactly on its floor. A  
floor-level market with otherwise good evidence therefore lands right around the  
70 threshold, and only genuinely strong probabilities approach 1.0. This was  
tuned against live slates, not guessed.

**Trap severities.** `veto` disqualifies; `high` costs 10; `medium` costs 4;  
`info` costs nothing. Early-season sample size and unquoted prices are reported  
as `info` because they are *already* reflected in the sample component and in  
the verified-price requirement — charging twice for one weakness is what makes  
scoring models systematically under-confident.

---

## League strength correction

The model normalises each team against its **own** league's average. That is  
correct inside a league but wrong across leagues — a goal in the Greek league is  
not worth a goal in the Bundesliga.

A strength table (Premier League = 1.00, down to ~0.46) places both sides on a  
common scale for cup ties:

```
attackAbs  = attackRating  × strength(league)
defenceAbs = defenceRating ÷ strength(league)
```

Without this, the engine produced an absurd 67.7% home win for OFI Crete  
against Hoffenheim. With it, the same fixture lands at a sane 43%. Cross-league  
ties additionally carry a `cross_league` flag, because the correction reduces  
the distortion but does not eliminate the extra uncertainty.

---

## API

| Endpoint                                 | Purpose                                       |
| ---------------------------------------- | --------------------------------------------- |
| `GET /api/health`                        | Status, cache stats, active sources           |
| `GET /api/leagues`                       | Full league registry                          |
| `GET /api/matches?date=YYYY-MM-DD`       | Fixture board (fast, no deep analysis)        |
| `GET /api/analysis?league=&event=&year=` | Full deep report for one match                |
| `GET /api/predictions?date=&limit=`      | Methodology predictions for the day, grouped by market |
| `GET /api/methodology`                   | The eleven methodologies and their thresholds |
| `GET /api/bankers?date=&limit=`          | Legacy banker election (superseded)           |

---

## Project layout

```
sharpshooter/
├── server.js           zero-dependency HTTP server + routing
├── lib/
│   ├── leagues.js      54-competition registry
│   ├── espn.js         data layer: fetch, cache, coalesce, throttle
│   ├── model.js        odds maths, Poisson, Dixon-Coles, market derivation
│   ├── analysis.js     baselines, normalising, context, team index
│   ├── signals.js      patterns, trap gates, sharpshooter scoring
│   ├── history.js      free per-game results (openfootball)
│   ├── elo.js          ClubElo ratings
│   ├── methodology/    core framework + the eleven market methodologies
│   └── engine.js       orchestration + methodology layer + legacy banker
├── METHODOLOGY.md      reference for all eleven methodologies
├── backtest_methodology.js  walk-forward backtest
├── test_methodology.js      methodology checks
├── public/             front-end (vanilla JS, no build step)
└── data/               disk cache (auto-created)
```

---


## Verification

Every stage was validated against live data, and the following real defects were  
found and fixed in the process — worth recording, because each one silently  
corrupted output:

| Defect                                                                     | Effect if left in                                                                       |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Home/away baseline used *per-team* goals instead of *total* goals per game | Expected goals came out ~0.7 instead of ~1.4, inflating draws and blocking every banker |
| `impliedTotalLambda` bisection ran the wrong direction                     | xG-consistency component was permanently 0                                              |
| Cup competitions probed for team stats that never exist                    | ~36 wasted requests per cup match, repeated for every fixture                           |
| Team index built concurrently, so league priority was ignored              | Juventus resolved to the *Europa League* instead of Serie A                             |
| ESPN emits `null` placeholders in the odds array                           | Crash on unguarded access                                                               |
| Model/market conflict check was one-sided                                  | Missed a wildly overconfident model claiming +470% EV                                   |
| Scoring rewarded raw probability                                           | Bankers were degenerate picks like "Home +2" at 95% and 1.05                            |
| Leagues publishing xG as `0.0` were treated as genuine zeros               | Poisoned league baselines and ratings                                                   |
| A 600 ms backoff was applied to a *daily* rate limit                       | ~60 futile requests per board load, each spending quota that could not succeed          |
| `attachPrices` bailed out when both odds sources were absent               | A ratable fixture with no ESPN quote got blank prices; the guard was hiding an unguarded `odds.homeClose` that would have thrown |
| `/api/analysis` resolved fixtures from *today's* scoreboard only            | Date browsing only ever worked for the current day — every other date returned "Match not found" |
| The fixture that tripped the quota breaker was labelled "no coverage"      | Misattributed a quota problem to a coverage gap, sending you looking for the wrong fix   |
| A failed fetch was cached as a valid empty result                          | Asserted "this date has no fixtures" for the whole TTL, keeping the board in ESPN-only mode long after the source recovered |
| The odds cache was memory-only, against a *daily* quota                    | Every server restart re-spent the entire board (~60 calls) from a budget that cannot refresh until tomorrow |
| `Number(null) === 0` when parsing rate-limit headers                       | A *missing* header became `remaining = 0`, tripping the budget guard and silently disabling the whole source while the API was healthy |
| Only `Ratelimit-*` was read, never `X-Ratelimit-*`                         | The API's new limiter was invisible to the client — same silent blackout |
| The reset header was assumed to be a delta                                 | The new limiter sends an absolute epoch; read as a delta it would have blocked the source until **2083** |
| The cross-check audit hardcoded one fixture                                | It failed as soon as that match kicked off, since ESPN withdraws odds at kickoff |

Diagnostic scripts kept in the repo:

```bash
node test_crosscheck.js                   # 3-way source audit, model self-consistency, determinism
node test_consensus_price.js              # Asian consensus -> market key mapping (offline)
node test_quota.js                        # daily-quota breaker, live
node test_news.js                         # team-news attribution and severity (offline)
node test_infersports.js                  # live fixture-matching rate
node test_engine.js                       # one match, full pipeline
node test_board.js                        # every fixture today
node test_banker.js                       # banker-eligible markets + scores
node test_day.js 20260920 eng.1,esp.1     # any date / any leagues
```

Observed calibration on live slates:

- **Thu 17 Sep** — 15 fixtures, 11 analysable, **1 banker**  
  (Besiktas v Marseille, Over 2.5 @ 1.57, 62.8%, Silver), 9 leans
- **Sun 20 Sep** — 20 top-flight fixtures, 20/20 analysable, **1 banker**  
  (Auxerre v Brest, Over 2.5 @ 1.74, 62.6%, Silver)
- **Sat 19 Sep** — 115 fixtures / 25 competitions, 60 analysable, **9 bankers**  
  spanning Draw No Bet, Asian Handicap and Over/Under — plus 51 leans.
  Banker of the Day: Gimnasia La Plata, Home (Draw No Bet) @ 1.41, 75.8%, score 79.3.

A strict banker definition producing a handful of picks per slate is the intended  
behaviour. If you want more picks, the `lean` tier is where they live.

---


## Honest limitations

- **No injury/suspension feed.** ESPN's soccer API does not expose a per-match  
  injury list. The engine reads cards and suspensions from season statistics and  
  surfaces recent team news in the UI — but you must check the lineup yourself  
  before acting. The app says so explicitly.
- **Cross-league ties are the model's weak point.** The strength table corrects  
  the gross distortion but is not a substitute for proper cross-league  
  calibration. Such fixtures carry a flag and rarely produce a banker.
- **Odds come from one book.** ESPN quotes DraftKings. Line movement is that  
  book's open→close, not a market-wide consensus. It is a real signal, but a  
  single-venue one.
- **ESPN quotes only three markets.** 1X2, one total line, one spread line.  
  Everything else is derived from our own model and cannot be value-verified —  
  which is why unquoted markets are barred from banker election.
- **Early season is noisy.** With four games played, ratings are shrunk hard  
  toward the mean. The model reports its own sample size and flags it.
- **Picks do not beat closing prices.** A backtest on real closing odds (19 leagues) returned  
  about −7% ROI, in line with betting blindly. The model's price edge lost money, so it no longer  
  promotes picks. `GET /api/price-backtest` reruns it.
- **Draw and GG/NG 2+ are paper-only** because the evidence does not support real stakes.
- **Live free-source paths** (ESPN, ClubElo, InferSports) were not reachable in the build  
  sandbox. They are covered by offline parsers and stubs; watch the first real run.
- **Per-game history covers nine leagues.** Elsewhere the methodologies use ESPN's last five  
  games, and the sample gates make them stricter.
- **Nothing is guaranteed.** This is an analytical tool. It quantifies  
  probability; it does not predict the future.
