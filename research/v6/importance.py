"""
research/v6/importance.py - how much each factor family drives the v6 models (held-out seasons).

    python3 research/v6/importance.py <features.csv> <model_dir> <groups.json> <out.json>

Mean absolute SHAP contribution per feature (LightGBM pred_contrib), summed by family and
normalised to shares. 'withMarket' = what moves the forecast away from the bookmakers' price
(result + Over 2.5 + BTTS models); 'factorsOnly' = what predicts the result with no price.
"""
import json
import sys

import numpy as np
import pandas as pd
import lightgbm as lgb

FEAT, MD, GROUPS, OUT = sys.argv[1:5]
groups = json.load(open(GROUPS))
metrics = json.load(open(f'{MD}/../metrics.json'))
df = pd.read_csv(FEAT, low_memory=False)
df = df[df.date >= '2023-07-01'].copy()
df['divc'] = pd.Categorical(df['div'], categories=metrics['divisions'])


def shares(model, d):
    feats = model.feature_name()
    X = d[feats]
    c = model.predict(X, pred_contrib=True)
    nf = len(feats)
    k = c.shape[1] // (nf + 1)
    tot = np.zeros(nf)
    for j in range(k):
        tot += np.abs(c[:, j * (nf + 1):(j + 1) * (nf + 1) - 1]).mean(0)
    fam = {}
    for f, v in zip(feats, tot):
        g = groups.get(f, 'other')
        fam[g] = fam.get(g, 0) + float(v)
    s = sum(fam.values())
    return {g: v / s for g, v in sorted(fam.items(), key=lambda x: -x[1])}, {f: float(v) for f, v in zip(feats, tot)}


out = {}
priced = df[df.p1.notna()]
wm = {}
per_feature = {}
for name in ['result', 'over25', 'btts']:
    m = lgb.Booster(model_file=f'{MD}/{name}.txt')
    d = priced if name != 'over25' else priced[priced.pO25.notna()]
    sh, pf = shares(m, d.sample(n=min(8000, len(d)), random_state=3))
    out[name] = sh
    per_feature[name] = dict(sorted(pf.items(), key=lambda x: -x[1])[:30])
    for g, v in sh.items():
        wm[g] = wm.get(g, 0) + v / 3
m = lgb.Booster(model_file=f'{MD}/result_nomkt.txt')
fo, pf = shares(m, df.sample(n=8000, random_state=3))
per_feature['result_nomkt'] = dict(sorted(pf.items(), key=lambda x: -x[1])[:30])
out['withMarket'] = {g: round(v, 4) for g, v in sorted(wm.items(), key=lambda x: -x[1])}
out['factorsOnly'] = {g: round(v, 4) for g, v in fo.items()}
out['topFeatures'] = per_feature
json.dump(out, open(OUT, 'w'), indent=1)
print('withMarket', out['withMarket'])
print('factorsOnly', out['factorsOnly'])
