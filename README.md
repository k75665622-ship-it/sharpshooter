# SHARPSHOOTER v6

A football prediction engine that runs on **live data from free, key-less sources**.

Every fixture gets the **v6 normal prediction**: a polite crawler collects the match data (football-data.co.uk match
statistics and odds, ClubElo history, ESPN, Open-Meteo), **170 measured factors** are computed — form and trend, goal
trends, shots and luck, results against the bookmakers' expectation, Elo momentum, head-to-head, table and motivation,
schedule, discipline, league — and a factor model trained on **134,579 matches** turns them, together with the
bookmakers' price, into one calibrated forecast for every market. Each match then gets a **main pick**, a **safer
pick**, a **value pick** when a price beats fair, an **avoid list** of bookmaker traps, and every pattern that fires
with its **measured verdict**.

On top of that, **thirteen market methodologies** (Over/Under 2.5, BTTS, GG/NG 2+, team totals, home / draw / away,
double chance, Asian handicaps, final score) decide which markets a match genuinely survives, and the
**double-confirmed accumulator** takes only selections that pass a methodology **and** the normal prediction.
Every pre-match prediction is recorded and settled into a public **track record**.

See [`methodology/GENERAL-PREDICTION-v6.md`](methodology/GENERAL-PREDICTION-v6.md) (normal prediction and accumulator),
[METHODOLOGY.md](METHODOLOGY.md) and the playbooks in [`methodology/`](methodology/).

---

## High Banker — the day's safest picks, 3.0+ odds

The **High Banker** tab takes only selections that pass **every one of seven checks**, then builds the
**most likely slip that reaches 3.0 odds** from them. There is no fixed number of legs and no upper limit:
the tab also shows the most likely slips at **5+, 10+ and 20+** when the day's bankers reach them, and lists
every banker. When the bankers cannot reach 3.0 there is **no slip** — weaker picks are never added to make up
the odds.

| # | Check | What it asks |
|---|---|---|
| 1 | Data | a real bookmaker price, most of the 184 factors measurable, 10+ archived games for each team, a league match (not a cup tie) |
| 2 | Strength | the v6 model rates it at least **74%** AND the bookmakers' own margin-free price at least **72%** |
| 3 | No trap | the factors do not rate it below the price, it is not on the match's avoid list, no confirmed trap rule fires |
| 4 | Agrees | it is the normal prediction's main pick or a safer form of it — never a contradiction |
| 5 | Trends | no red flag: form slump, opponent on fire, poor venue form, bogey head-to-head, draw-heavy meetings, Elo doubting the price, both sides failing to score, low- or high-scoring trends against it, or a measured pattern against it |
| 6 | Price | it pays 1.15–1.60 (shorter legs add risk faster than they add odds) |
| 7 | Live | not kicked off, no confirmed absence on the side it depends on, price not drifting 8%+ against it |

A banker that also qualifies under one of the market methodologies is marked **★ Methodology** (triple-confirmed).
Each leg shows its checks, the model and bookmaker probabilities, and a "why it is a banker" list; picks that
looked strong but failed a check are listed with the reason.

**Measured, not promised.** The rule (`lib/banker.js`) was run over **76,528 priced matches** with models trained
only on 2005-19 (`research/v6/banker_dump.js`, `banker_study.js`). Every threshold was chosen on 2019-23; the
2023-26 seasons were then measured once:

| Held-out 2023-26 | Result | Stated |
|---|---|---|
| Banker legs | **77.8%** won (12,121 legs, ~13 a day) | 77.6% |
| 3.0+ slips | **33.6%** landed (547 slips, 5.0 legs, average odds 3.04) | 30.5% |
| Days with a 3.0+ slip | 58% | — |
| **Safer 2.0+ slips** | **48.9%** landed (650 slips, 3.2 legs, average odds 2.04) | 46.9% |
| 5+ / 10+ / 20+ slips | 18.1% / 8.4% / 5.0% landed | 17.6% / 8.3% / 3.9% |

A 3.0-odds slip is roughly a 1-in-3 shot even when every leg is a banker — odds always tell the truth about the
chance. With about five legs, one of them lets the slip down on most days, so the tab also builds the **safer
slip**: the most likely set of the same bankers reaching **2.0+** (about three legs). It lands about half the days
(2019-23: 49.2%; held-out 48.9%) against a third for the 3.0+ slip, at a smaller price — over many days the 3.0+ slip
returned more (2019-23: +8.6% against −0.7%), so both are shown and the choice is yours.

Two further ideas were tested on 2019-23 and **left out** because they made the slips worse
(`research/v6/banker_pace.js`): ranking legs by the Strongest Picks' measured chance (slips landed 33.0% against
36.1%) and a possession-model check that drops legs the teams' shots and finishing do not back (30.8–33.1%). Both
remain switches in `lib/banker.js` (`useMeasured`, `paceGap`), off. Stricter bars were tested: 85%-sure legs need 6-7 per slip, so the slip lands no more often and exists on
far fewer days. Requiring agreement with the normal prediction is what lifts the slips above their stated chance
(2019-23: without it slips landed 31.9% against 32.7% stated; with it 36.1% against 31.7%), and the red-flag checks
widen that margin (from +1.7 to +4.4 points). Every banker and every slip is written to the track record before
kick-off (`High Banker` rows) and settled afterwards.

## Strongest Picks

The **Strongest Picks** tab lists, one per match, the selections with the highest **measured** chance that every
independent view agrees on. There is **no fixed number**: a weak day gives few picks.

Every fixture is priced across SportyBet's nine market groups — **Goals, Corners, Half, Players, Minutes, Team,
Match, Bookings, Special** — by views that do not share their inputs:

| Markets | Views |
|---|---|
| Goals, Half, Minutes, Team, Match, Special | **Market** (the site's ensemble: de-vigged multi-book price 90% + model 10%, calibrated) · **Stats** (verified-results ratings, ESPN xG and ClubElo, no price) · **v6 factors** (170 measured factors on top of the price) · **Possession** (`lib/pace.js`, below) |
| Corners, Bookings | **Form + price** (the teams' corner / card form, the bookmakers' strength gap and expected goals, and — for corners — the possession model's shot volume; fitted on 2019-23) · **Season** (last 20 league games, home/away split) · **Last 6** — from the football-data.co.uk archive, plus the referee's card rate (England/Scotland) and head-to-head |
| Players | team expected goals from the market and stats views × the player's share — Fantasy Premier League xG (Premier League) or ESPN's top scorers |

**The possession model** is football's version of the NBA total formula *points = offensive efficiency ×
possessions per game*. A football "possession that got somewhere" is a shot, and efficiency is goals per shot:
each side's expected goals = average(its shots a game, the shots its opponent concedes) × average(its goals per
shot, the goals per shot its opponent allows), each against the league at that venue, from the last 20 league
games and shrunk toward the league so a lucky run cannot run away. Measured on 2023-26 matches it never saw, it is
**weaker than the bookmakers on its own** (1X2 log-loss 1.039 against 0.996) and adds nothing to the goal-market
chances once the price is known — when it disagrees with the price, the price is usually right. It **does** help
corners (sides that take more shots, and opponents that concede more, mean more corners), so it is part of the corner
model; for goal picks it is one of the views that must agree, and every pick explains the teams' shots and finishing.

**The chance shown is measured** (`lib/strongest/calibrate.js`, `lib/strongest/models.json`): what selections like
it actually won on past matches, given what each view said — a per-market calibration fitted on 2019-23. Two things
it learned: the v6 factors' disagreement with the price is real but worth about 40% of its size, and a form-only
view that disagrees with the bookmakers is on the **wrong** side of them in every market measured.

**A pick qualifies when:** its measured chance is at least **84%** (**86%** for corners and bookings, which have no
bookmaker price of their own and are only priced when the bookmakers' read of the match exists); every view rates it at
least **75%**; the bookmakers' own probability is at most **88%** (it still pays 1.14+); the v6 layer does not flag it
as a trap or overrated by the price; no serious team news hits the side it backs; and the market has a measured record
(minute markets and scorers do not, so they stay on the match cards only). **Team under 1.5 goals** is kept off the
list too: at this level it won 1-3 points less than stated in both research periods, worst against a heavy favourite
(it stays on the match cards). Strength is the measured chance: **Elite** 87%+, **Strong** 84%+. Every number lives in
[`lib/strongest/config.js`](lib/strongest/config.js).

**Measured, not promised.** The rule was replayed with the production code on all 76,528 priced matches from July
2019 (`research/v6/strongest_study.js`), models and bars chosen on 2019-23 and the 2023-26 seasons measured once:

| Held-out 2023-26 (29,191 matches) | Old rule (v1) | **New rule (v2)** |
|---|---|---|
| Strongest Picks | 28,361 — 97% of matches, ~31 a match day | **18,309 — 63% of matches, ~19 a match day** |
| Won (stated) | 84.1% (84.5%) | **86.4% (86.7%)** |
| Corners | 79.3% (85.5%) — form alone overrated them | **86.9% (87.0%)** |
| Bookings | 82.4% (85.6%) | **86.7% (87.0%)** |
| Elite / Strong | — | 87.6% (88.0%) / 85.5% (85.6%) |

Even at 86%, about one pick in seven loses: a strong pick is not a certain one, and the page says so.

Each pick comes with the facts behind it (its measured record, prices, expected goals from every view, the possession
model's shots and finishing, last-10 form at its own line, head-to-head, table, referee, players, team news) and its
caveats. The tab also shows every match's nine-market card, near misses, the chance of combining the top picks, the
measured record above, and a **live track record**: every pick is written down before kick-off (data/strongest) and
settled from ESPN results and the football-data archive. Nothing is edited afterwards.

| Endpoint | Purpose |
|---|---|
| `GET /api/strongest?date=YYYY-MM-DD` | the day's Strongest Picks, near misses, combined chances and every match's nine-market card |
| `GET /api/strongest/record[?format=csv]` | the Strongest Picks track record |

`npm run test:strongest` runs its offline tests (maths, pick rules, reasons, settlement).

---

## What's new in v6

| | v5 | v6 |
|---|---|---|
| Normal prediction | price + model ensemble, most likely selection ≥ 1.30 | **170 measured factors** on top of the price; main / safer / value pick; avoid list; confidence with its measured hit rate |
| Data | results, odds, xG | + **crawler**: shots, shots on target, corners, cards, half-times, opening & closing odds (6 seasons), Elo momentum, weather |
| Factor weights | — | **measured** per family (what moves the forecast with a price, and without one) |
| Bookmaker traps | heuristic gates | **46 popular patterns tested**: 2 confirmed edges, 1 confirmed trap, 35 already priced in — shown with their evidence |
| Fixtures with no price | ratings + xG + Elo | factor-only model: recovers 84% of what the price knows |
| Accumulator | — | **double-confirmed**: methodology AND normal prediction agree; best 2-5 folds, take-at price, measured record |
| Explanations | — | every family in plain English, with how far it moved the pick; last-10 trends; head-to-head; table |

Held-out 2023-26 (29,206 matches, never used for any choice): main pick **72.7%** (stated 73.1%); value picks
**+6.6% at the best price** (2,631 bets; +6.3% on the tuning seasons); selections on the avoid list won **50.3%**
against the 52.8% the price implied; double-confirmed doubles **67.3%** (stated 63.7%). Full results:
[`research/v6/RESULTS.md`](research/v6/RESULTS.md).

**What the data says plainly:** the bookmakers' price already contains almost everything form, head-to-head and
the table can tell you. With a price, the factors improve the forecast by a small, measurable amount; the real gains
are the traps the site keeps you out of, the value it finds when a price beats fair, and fixtures with no price.

---

## What was new in v5

| | v4 | v5 |
|---|---|---|
| Forecast | xG-only model, single book | **Market-anchored ensemble** (multi-book consensus 90% + independent model 10%) |
| Probabilities | raw model | **Calibrated** per market on real results; checked on held-out seasons |
| LOCK means | model beats the price | **a real price beats the multi-book fair price by ≥ 3%** (the only edge that tested positive) |
| Methodologies | 11 | **13** (+ Double Chance, + Final Score) |
| Fixtures with a prediction | methodology picks only | **every analysable fixture** (general prediction) |
| Results data | openfootball only | **cross-verified** across openfootball, football-data.co.uk and ESPN |
| Team news | ESPN headlines | + **Fantasy Premier League** chance-of-playing (Premier League) |
| Odds | DraftKings + Asian books | + Bet365 via ESPN, + football-data fixtures (Bet365, Pinnacle, William Hill, Bwin, average) |
| Track record | none | **ledger** of every pre-match pick, settled automatically, CSV export |

Held-out 2023-26 backtest (same matches, v5 code vs v4 code): strongest pick per fixture **71.6% hit (said
70.9%) on 9,114 picks** vs v4 66.7% (said 67.7%) on 6,577. Full table in [METHODOLOGY.md](METHODOLOGY.md);
reproduction in [`research/`](research/README.md). **Accuracy is not profit** — see Honest limitations.

### How to use a prediction
- **LOCK** — a bookmaker is paying more than the consensus fair price. Take it at the quoted price.
- **PREDICT** — qualifies. Bet only if your bookmaker pays at least the **"take at ≥"** price shown.
- **PAPER** — tracked, not staked (GG/NG 2+ until its record proves itself).
- **Every Match** tab — the general prediction for every fixture, including the predicted final score.
- **Track Record** tab — every settled pre-match prediction, per methodology, downloadable as CSV.

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
npm run verify            # all offline checks, including the methodology, v5 and v6 suites
npm run test:e2e          # whole server against stubbed live sources (offline)
npm run demo:offline      # run the site on stubbed data, no internet needed
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
| 9 | `football-data.co.uk/mmz4281/{season}/{div}.csv`, `/new/{CC}.csv`    | **Per-game results + closing odds** from ~6 books, 22 leagues — the second results witness      |
| 10 | `football-data.co.uk/fixtures.csv`                                  | **Upcoming-fixture odds** (Bet365, Pinnacle, William Hill, Bwin, market average)               |
| 11 | `site.api.espn.com/.../scoreboard?dates=YYYYMMDD-YYYYMMDD`          | Season results by month — the third results witness, and the ledger's settlement source        |
| 12 | `fantasy.premierleague.com/api/bootstrap-static/`                   | **Premier League availability**: chance of playing, each player's share of team xG involvement |

| 13 | `api.open-meteo.com` + `geocoding-api.open-meteo.com`             | **Kick-off weather** (temperature, rain, wind) — context only, never a model input               |

**The v6 crawler** (`lib/crawler/`) fetches the football-data archive (6 seasons per league: shots, corners, cards,
half-times, Bet365 + best-of-market odds), football-data's upcoming-fixture prices, three ClubElo snapshots a day
(now / 30 / 90 days) and Open-Meteo. It obeys robots.txt, rate-limits every host (football-data: one file a second),
revalidates unchanged files with ETag / Last-Modified, serves the last good copy when a source is down (never caching
a failure), and pauses a failing host for 10 minutes. `GET /api/crawler` shows every host's requests, cache hits,
304s, stale serves and robots blocks. Sites whose terms forbid scraping (Transfermarkt, FBref, Sofascore) are not used.

**Rule 41 — verified data.** A result is used only when the sources agree: `verified` (2+ sources match),
`verified-majority`, or `corrected` (one source outvoted). Disputed results are dropped. Team names are mapped
between sources automatically from identical same-day scores, and ambiguous names are refused rather than guessed.

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

v5 pipeline (per fixture):

```
  verified results (3 sources) ──► Dixon-Coles ratings ─┐
  ESPN xG / xGA ────────────────► xG goal rates ───────┤
  ClubElo ──────────────────────► Elo difference ──────┼─► model (10%)
  multi-book odds (ESPN, football-data, InferSports) ──► de-vigged consensus ─► market goal rates (90%)
        │
        ▼
  ensemble goal rates ─► ONE score matrix ─► calibrated markets ─► take-at prices
        │
        ├─► 13 methodologies (gates → checklist + independent witness → LOCK / PREDICT / PAPER / WATCH / REMOVE)
        ├─► general prediction + predicted final score (every fixture)
        └─► ledger (recorded pre-match, settled after full time)
```

The v4 pipeline below is still used for patterns, trap screening, the legacy banker and the xG component:

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
| `GET /api/predictions?date=&limit=`      | Methodology predictions grouped by market, plus a `general` prediction for every fixture |
| `GET /api/methodology`                   | The thirteen methodologies, thresholds, and the v4-vs-v5 backtest record |
| `GET /api/ledger`                        | Track record of recorded pre-match predictions (settles finished games; `?format=csv` to download) |
| `GET /api/accumulator?date=`             | v6 double-confirmed accumulator: legs, best 2-5 folds, take-at prices, measured record |
| `GET /api/banker?date=`                  | High Banker: every banker with its seven checks, the most likely 3.0+ slip, bigger 5+/10+/20+ slips, near misses, measured record |
| `GET /api/crawler`                       | v6 crawler status per source (requests, cache hits, 304s, stale serves, robots, pauses) |
| `GET /api/intel-research`                | v6 research record: decision backtest, accumulator backtest, factor importance, pattern verdicts |
| `GET /api/bankers?date=&limit=`          | Legacy banker election (superseded)           |
| `GET /api/strongest?date=`               | Strongest Picks: nine SportyBet market groups per match, one pick per match when every view agrees |
| `GET /api/strongest/record`              | Strongest Picks track record (`?format=csv` to download) |

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
│   ├── ratings.js      time-decayed Dixon-Coles ratings (MLE)
│   ├── market.js       de-vig, multi-book pooling, market-implied goal rates
│   ├── ensemble.js     market + model blend, calibration, derived markets
│   ├── calibration.json  per-market calibration (generated by research/)
│   ├── sources/        verified results (3 sources), odds consensus, FPL, name mapping
│   ├── evidence.js     per-fixture verified history + ratings
│   ├── pricing.js      take-at price and price-beats-consensus test
│   ├── scoreline.js    predicted / most likely / half-time score
│   ├── general.js      general prediction for every fixture
│   ├── ledger.js       pre-match record + settlement (picks, value picks, accumulators)
│   ├── crawler/        v6 polite crawler: http.js (robots, rate limits, conditional GET, cache),
│   │                   sources/ (football-data, ClubElo momentum, Open-Meteo), warehouse.js
│   ├── factors/        v6 factor engine: records, history store, 170 factors, tree-model evaluator, models/
│   ├── intel/          v6 normal prediction: predict, decision, rules (patterns), explain, accumulator
│   ├── methodology/    core framework + the thirteen market methodologies
│   ├── strongest/      Strongest Picks: config, inputs (archive, players, line-ups), markets (nine groups),
│   │                   calibrate + models.json (measured chances, form + price corners and cards),
│   │                   picks (rules), reasons, record (track record), index (the day)
│   ├── pace.js         the possession model: shots a game x goals per shot (Strongest Picks, v6 report)
│   ├── banker.js       the High Banker: seven checks, the 3.0+ slip, the safer 2.0+ slip, bigger slips
│   └── engine.js       orchestration + methodology layer + legacy banker
├── METHODOLOGY.md      summary of all thirteen methodologies
├── methodology/        full v5 playbooks (one per market)
├── research/           backtests and studies behind every v5 number; research/v6/ for v6
├── test/               v5 unit tests, offline end-to-end test, fixtures
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

- **More factors are not a crystal ball.** 170 factors improve on the bookmakers' price by a small amount (result and
  goals log-loss about 0.03%, BTTS 0.32%). Most betting folklore (streaks, revenge, dead rubbers, hyped overs) is
  already priced in — the site says so whenever such a pattern fires.
- **The live crawler** could not reach its sources from the build environment; it is tested offline against the
  sources' exact formats (`test/v6_unit.js`, `test/e2e_offline.js`). Watch `/api/crawler` on the first live run.
  The first deep analysis of a league waits for its archive download (one file a second); after that it is cached.
- **Accuracy is not profit.** The bookmaker consensus is the best single forecast available, and betting where
  a model disagrees with it *lost* 13–29% in testing. At Bet365 prices no methodology made a reliable profit;
  at the best of ~17 books, Home Win (+2.5%) and Away Win (+4.7%) were positive but their intervals include
  zero. LOCK only says a price beats the consensus. Use the take-at price.
- **Team news.** Fantasy Premier League gives real availability for the Premier League only. Elsewhere the
  engine reads ESPN headlines — check lineups yourself.
- **Live free-source paths** (ESPN, football-data, FPL, ClubElo, InferSports) were not reachable from the build
  sandbox. Their parsers are tested on their exact live shapes, offline (`test/e2e_offline.js`); watch the first
  real run and `/api/health`.
- **The ledger lives on disk.** On a host with an ephemeral disk (Render's free tier) it resets on redeploy —
  download the CSV from the Track Record tab to keep it.
- **Draw is half-stake and Final Score quarter-stake**, because they lose most of the time even when right to
  pick. **GG/NG 2+ stays paper** until its own record passes Rule 34.
- **Cross-league ties and early season** are the weakest spots; the engine flags them and the gates get stricter.
- **Nothing is guaranteed.** This is an analytical tool. It quantifies probability; it does not predict the future.

## 24-hour day database (resets 05:00 Ghana time)

The day's predictions are saved twice, and both copies are wiped when the prediction day changes at **05:00 Ghana time** (Africa/Accra):

- **In your browser** (IndexedDB, `public/daycache.js`): predictions, the fixture board, Strongest Picks and every match you open. Come back later, even after closing the browser, and they appear **instantly** while a fresh copy loads quietly in the background.
- **On the server** (`data/daybook/<day>/`, `lib/daybook.js`): every visitor gets the saved day at once, rebuilt in the background when it is more than 3 minutes old.

**Played matches stay.** A match that has kicked off keeps the prediction made *before* kick-off (frozen, never re-predicted) and gets a ✓ / ✕ for the main pick, value pick, methodology pick, result, goals, BTTS and exact score, plus a "Today so far" scoreboard on Every Match. The morning accumulator is kept with each leg ticked or crossed; a newer one for the matches still to play sits beside it. The merge and settle rules live in `public/shared.js`, used by both server and browser.

`GET /api/daybook` shows what is stored. `GET /api/warmup` builds the day in the background (it does nothing when the saved copy is under 15 minutes old). On Render's free tier the server disk is wiped when the service sleeps, so the browser copy is what keeps your day; to keep the server copy too, point a free cron service at `/api/warmup` at 05:05 and at `/api/health` every 10 minutes. Change the reset with `DAYBOOK_TZ` / `DAYBOOK_RESET_HOUR`.
