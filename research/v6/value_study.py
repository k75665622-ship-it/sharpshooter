"""
research/v6/value_study.py - does the factor model change WHICH bets are worth taking?

    python3 research/v6/value_study.py <features.csv> <model_dir>

For every held-out match and outcome, compare the v6 probability with the best price
(max of ~17 books) and with Bet365. A bet is "value" when p * price - 1 > threshold.
The control is price shopping alone (the de-vigged Bet365 probability against the
best price), which v5 found to be roughly break-even.
Also: where in the probability range the factor model moves the forecast, and SHAP
attributions summed by factor family.
"""
import json
import sys

import numpy as np
import pandas as pd
import lightgbm as lgb

FEAT_FILE, MD = sys.argv[1], sys.argv[2]
df = pd.read_csv(FEAT_FILE, low_memory=False)
df = df[(df.date >= '2023-07-01') & df.p1.notna()].copy()
df['divc'] = df['div'].astype('category')
ID = ['div', 'date', 'season', 'home', 'away', 'hg', 'ag', 'hthg', 'htag', 'oh', 'od', 'oa', 'mh', 'md', 'ma', 'oo', 'ou', 'mo', 'mu', 'ahl', 'ahh', 'aha']
FEATS = [c for c in df.columns if c not in ID and c != 'divc']
y = np.where(df.hg > df.ag, 0, np.where(df.hg == df.ag, 1, 2))

mres = lgb.Booster(model_file=f'{MD}/result.txt')
# categories must match training: rebuild with the training category order
train_cats = pd.read_csv(FEAT_FILE, usecols=['div'], low_memory=False)['div'].astype('category').cat.categories
df['divc'] = pd.Categorical(df['div'], categories=train_cats)
X = df[FEATS + ['divc']]
base = np.log(np.clip(df[['p1', 'pX', 'p2']].values, 1e-6, 1))
raw = mres.predict(X, raw_score=True)
z = raw + base
z = z - z.max(1, keepdims=True)
pv = np.exp(z) / np.exp(z).sum(1, keepdims=True)
pm = df[['p1', 'pX', 'p2']].values
best = df[['mh', 'md', 'ma']].values
b365 = df[['oh', 'od', 'oa']].values


def roi(sel, p_odds, won):
    n = int(sel.sum())
    if n == 0:
        return {'n': 0}
    ret = np.where(won[sel], p_odds[sel] - 1, -1)
    rng = np.random.default_rng(3)
    boots = [ret[rng.integers(0, n, n)].mean() for _ in range(500)]
    return {'n': n, 'hit': float(won[sel].mean()), 'roi': float(ret.mean()), 'ci95': [float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))]}


out = {'n_matches': int(len(df))}
won = np.zeros_like(pm, dtype=bool)
won[np.arange(len(y)), y] = True
for label, P in [('market_only', pm), ('v6', pv)]:
    for t in [0.0, 0.02, 0.05]:
        for band in [(0.0, 1.0), (0.30, 0.75)]:
            ok = np.isfinite(best) & (best > 1)
            ev = P * np.where(ok, best, 0) - 1
            sel = ok & (ev > t) & (P >= band[0]) & (P <= band[1])
            k = f'{label}|ev>{t}|band{band[0]}-{band[1]}'
            out[k] = {'best_price': roi(sel.ravel(), np.where(ok, best, 1).ravel(), won.ravel()),
                      'bet365': roi((sel & np.isfinite(b365)).ravel(), np.nan_to_num(b365, nan=1).ravel(), won.ravel())}
            print(k, json.dumps(out[k]))

# how far does v6 move the price, and is a move "real"? bucket by v6 - market on the favourite
fav = pm.argmax(1)
dfav = pv[np.arange(len(y)), fav] - pm[np.arange(len(y)), fav]
wf = (y == fav)
buckets = [(-1, -0.02), (-0.02, -0.01), (-0.01, -0.003), (-0.003, 0.003), (0.003, 0.01), (0.01, 0.02), (0.02, 1)]
out['favourite_shift'] = []
for lo, hi in buckets:
    s = (dfav > lo) & (dfav <= hi)
    if s.sum() < 50:
        continue
    row = {'shift': [lo, hi], 'n': int(s.sum()), 'market_said': float(pm[np.arange(len(y)), fav][s].mean()),
           'v6_said': float(pv[np.arange(len(y)), fav][s].mean()), 'won': float(wf[s].mean())}
    out['favourite_shift'].append(row)
    print('FAV', json.dumps(row))

# SHAP by factor family (result model, held-out)
contrib = mres.predict(X, pred_contrib=True)
nf = len(FEATS) + 1
names = FEATS + ['divc']
fam = {}
sys.path.insert(0, '.')
cat = json.load(open(f'{MD}/../catalog.json')) if False else None
mabs = np.zeros(nf)
for k in range(3):
    block = contrib[:, k * (nf + 1):(k + 1) * (nf + 1) - 1]
    mabs += np.abs(block).mean(0)
imp = sorted(zip(names, mabs), key=lambda x: -x[1])
out['shap_result_top'] = [[n, float(v)] for n, v in imp[:40]]
print('TOP SHAP', imp[:25])
json.dump(out, open(f'{MD}/value_study.json', 'w'), indent=1)
