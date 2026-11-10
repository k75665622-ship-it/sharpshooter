# research/v7 — is there anything left to gain from the price, and where does the rule hold?

Scripts (plain Node, no dependencies; `Matches.csv` is the archive described in `research/v6/README.md`):

| Script | What it answers |
|---|---|
| `node research/v7/devig_study.js Matches.csv` | Which way of removing the bookmaker's margin gives the most accurate 1X2 and Over/Under probabilities (proportional, power, Shin, odds ratio, the v6 blend; Bet365 and best-of-books prices) |
| `node research/v7/solve_study.js Matches.csv out.json` | Does adding the Asian handicap line, or a different de-vig, to the expected-goals solve improve the markets the site derives (team goals, both teams to score, double chance, exact score...) |
| `node research/v7/guard_study.js slips.jsonl` | Would a live guard (lib/strongest/guard.js) have helped or hurt, replayed day by day (`slips.jsonl` from `research/v6/slips_study.js`) |
| `node research/v6/slips_report.js slips.jsonl out.json --models=lib/strongest/models.json` | The Strongest Picks record on the leagues the site gives picks in (now 34), slips included |

Results: [RESULTS.md](RESULTS.md).
