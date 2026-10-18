# research/ — how v5 was built and tested

Everything in v5's model weights, calibration and rule changes comes from these scripts.
They are **not** used by the website at runtime; their outputs are `lib/calibration.json`
and `lib/backtest.json`.

## Data
The open **Club Football Match Data 2000-2025** table (football-data.co.uk results with Bet365 and
best-of-~17-books odds, plus ClubElo ratings):

```bash
curl -L -o Matches.csv https://raw.githubusercontent.com/xgabora/Club-Football-Match-Data-2000-2025/main/data/Matches.csv
```

18 European divisions (E0-E3, D1-D2, SP1-SP2, I1-I2, F1-F2, N1, P1, B1, T1, G1, SC0), test fixtures from
2019-07-01: **46,121** matches. Tuning seasons 2019-20..2022-23; **held-out 2023-24..2026-27**.

## Pipeline (run in order)

| Step | Script | Output |
|---|---|---|
| 1 | `node research/build_states.js Matches.csv states.json` | every model component per fixture, walk-forward (no future data) |
| 2 | `node research/evaluate.js states.json` | log-loss of each component and blend; fits the Elo scale |
| 3 | `node research/calibrate_v5.js states.json` | market weight + per-market calibration fitted on tuning, checked on held-out |
| 4 | `node research/edge_study.js states.json` | does betting model-vs-market disagreement make money? (no) |
| 5 | `node research/shop_study.js states.json` | does price shopping vs the consensus make money? (marginally, 30-65% band) |
| 6 | `node research/agree_study.js states.json` | does model agreement add accuracy given the market? (a little) |
| 7 | `node research/score_study.js states.json` | exact-score distribution and the final-score pick rule |
| 8 | `SHARPSHOOTER_CALIBRATION=<tune-only calibration> node research/backtest_methods.js Matches.csv states.json methods.json` | **the production v5 methodology code**, walk-forward, settled on real results |
| 9 | `node research/ab_v4.js <v4 lib dir> Matches.csv states.json methods_v4.json` | the original v4 code on the same fixtures |
| 10 | `node research/report_methods.js methods.json` | per-methodology hit rate, stated probability, ROI |
| 11 | `node research/summarise.js methods.json methods_v4.json` | writes `lib/backtest.json` (shown on the Methodology tab) |
| 12 | `FIT_ALL=1 node research/calibrate_v5.js states.json` then `node research/write_calibration.js states.calib_all.json states.score.json` | production `lib/calibration.json`, refitted on all seasons |

`DIAG=under25,over25,...` on step 8 records every gate and checklist item, which is how the Under 2.5
redesign (Rule 38) and the BTTS No 1-1 trap change were found.

`<v4 lib dir>` is the pre-v5 `lib/` folder: `git archive <v4 commit> lib | tar -x -C /tmp/v4`.

## Honesty rules used throughout
- Walk-forward only: a fixture's inputs use results strictly before its date.
- Every parameter is chosen on tuning seasons and reported on held-out seasons. The held-out numbers on the
  site come from a calibration fitted on tuning seasons only; production then refits on everything.
- Historical team news, ESPN xG and rest days do not exist in the dataset, so the backtest tests the
  results + price + ratings half of each methodology (gates that need news are waived or fail closed).

## Headline results (held-out 2023-26)
See `RESULTS.md`.
