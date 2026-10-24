# research/v6 — how the v6 normal prediction was built and tested

Everything the v6 match intelligence does — its 170 factors, the factor models, the decision thresholds, the
pattern verdicts and the accumulator rule — comes from these scripts. They are **not** run by the website;
their outputs are the files in `lib/factors/models/` and `lib/intel/*.json`.

## Data
The open **Club Football Match Data** archive (football-data.co.uk results, match statistics and odds, plus
ClubElo ratings): **238,854 matches, 38 divisions, July 2000 – September 2026**.

```bash
curl -L -o Matches.csv https://raw.githubusercontent.com/xgabora/Club-Football-Match-Data-2000-2025/main/data/Matches.csv
```

It is the same source, with the same columns, that the live crawler reads (`lib/crawler/sources/footballdata.js`),
so a factor means exactly the same thing in research and on the site.

## Splits (by date, never shuffled)
| Split | Seasons | Used for |
|---|---|---|
| train | 2005-06 .. 2018-19 | fitting the factor models |
| tune | 2019-20 .. 2022-23 | early stopping, every threshold and setting |
| held-out | 2023-24 .. 2026-27 (to 3 Sep 2026) | reported once; never used for a choice |

## Pipeline (run in order)

| Step | Script | Output |
|---|---|---|
| 1 | `node research/v6/build_features.js Matches.csv features.csv` | every factor for 222,203 matches, walk-forward, with the **production** factor code (`lib/factors`) — ~1 min |
| 2 | `python3 research/v6/train_final.py features.csv final/` | six LightGBM models: settings chosen on tune, reported on held-out (`honest/`), refitted on everything (`prod/`); `ONLY=goals_h` retrains one |
| 3 | `node research/v6/export_models.js final/prod final/metrics.json lib/factors/models` | the compact JSON the site evaluates (`lib/factors/gbm.js`); JS reproduces LightGBM to 1e-8 |
| 4 | `python3 research/v6/importance.py features.csv final/honest groups.json lib/intel/importance.json` | each factor family's measured share of the model's decisions (SHAP, held-out) |
| 5 | `node research/v6/patterns_study.js features.csv lib/intel/rules.json` | 46 popular patterns / traps, each tested on 2005-23 and confirmed on 2023-26 |
| 6 | `SHARPSHOOTER_V6_MODELS=<honest compact> DUMP_FILE=final_test.jsonl node research/v6/backtest_decision.js features.csv final_test.json 2023-07-01` | **the production decision code** (`lib/intel`) on every held-out match (also run on the tune window to set thresholds; `DECISION_OPTS` overrides them) |
| 7 | `node research/backtest_methods.js ...` (v5, now with fixture ids) then `node research/v6/acca_study.js methods_ids.json final_test.jsonl acca.json 2023-07-01` | the double-confirmed accumulator rule, with the production leg selection (`lib/intel/accumulator.js`) |
| 8 | `node research/v6/write_records.js <dir>` | `lib/intel/record.json` and `lib/intel/acca_record.json` (the numbers the site shows) |

Exploratory: `value_study.py` (does the factor model change which bets are worth taking? bucketed favourite
shifts and SHAP), `make_fd_fixture.py` (builds the football-data-format test fixtures from the archive).

## Honesty rules
- Walk-forward only: a match's factors come from the store **before** any match of that day is added.
- Every setting is chosen on tune and reported on held-out; the site's numbers are held-out numbers.
- Patterns are only called traps or edges when they hold in **both** periods.
- Factors that do not exist in the archive (live team news, true all-competition rest days, line-ups, weather)
  are shown as **context** on the site and never change a probability.

Results: [`RESULTS.md`](RESULTS.md).
