"""
research/v6/train_final.py - choose settings on tuning seasons, report held-out, export.

    python3 research/v6/train_final.py <features.csv> <out_dir>

Models
  result       H/D/A from the de-vigged 1X2 price + factors (init score = log p)
  over25       Over 2.5 from the de-vigged O/U price + factors
  btts         BTTS from the price-implied BTTS + factors
  goals_h/a    home / away goals without any price (Poisson) - fixtures with no odds
  result_nomkt H/D/A without any price

Every setting (tree size, leaf size, learning rate, rounds) is chosen on TUNE (2019-23);
TEST (2023-07 onwards) is reported once. Two copies of each model are written:
  honest/  trained on 2005-2019 only (used by research/v6/backtest_decision.js)
  prod/    refitted on every season with the chosen settings (shipped in lib/factors/models)
"""
import json
import os
import sys
import time

import numpy as np
import pandas as pd
import lightgbm as lgb

FEAT_FILE, OUT = sys.argv[1], sys.argv[2]
os.makedirs(f'{OUT}/honest', exist_ok=True)
os.makedirs(f'{OUT}/prod', exist_ok=True)

TRAIN = ('2005-07-01', '2019-06-30')
TUNE = ('2019-07-01', '2023-06-30')
TEST = ('2023-07-01', '2099-01-01')
ALL = ('2005-07-01', '2099-01-01')

df = pd.read_csv(FEAT_FILE, low_memory=False)
ID = ['div', 'date', 'season', 'home', 'away', 'hg', 'ag', 'hthg', 'htag', 'oh', 'od', 'oa', 'mh', 'md', 'ma', 'oo', 'ou', 'mo', 'mu', 'ahl', 'ahh', 'aha']
FEATS = [c for c in df.columns if c not in ID]
MARKET = ['p1', 'pX', 'p2', 'pO25', 'ovr', 'ovrOU', 'disp1', 'dispX', 'disp2', 'dispO', 'dispU', 'lamH', 'lamA', 'lamT', 'ahLine']
NOMKT = [c for c in FEATS if c not in MARKET]
DIVS = sorted(df['div'].unique().tolist())
df['divc'] = pd.Categorical(df['div'], categories=DIVS)
df['res'] = np.where(df.hg > df.ag, 0, np.where(df.hg == df.ag, 1, 2))
df['o25'] = ((df.hg + df.ag) > 2.5).astype(int)
df['btts'] = ((df.hg > 0) & (df.ag > 0)).astype(int)


def rng(d, r):
    return d[(d.date >= r[0]) & (d.date <= r[1])]


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def sigmoid(x):
    return 1 / (1 + np.exp(-x))


def softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def boot(diff, n=1000, seed=1):
    r = np.random.default_rng(seed)
    m = len(diff)
    means = [diff[r.integers(0, m, m)].mean() for _ in range(n)]
    return [float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))]


BASE = dict(bagging_fraction=0.8, bagging_freq=1, lambda_l2=10.0, verbose=-1, seed=7, num_threads=2, max_bin=63)
GRID = [
    dict(learning_rate=0.02, num_leaves=15, min_data_in_leaf=400, feature_fraction=0.5),
    dict(learning_rate=0.02, num_leaves=7, min_data_in_leaf=800, feature_fraction=0.5),
    dict(learning_rate=0.02, num_leaves=31, min_data_in_leaf=300, feature_fraction=0.4),
    dict(learning_rate=0.01, num_leaves=15, min_data_in_leaf=1000, feature_fraction=0.3),
]

SPECS = {
    'result': dict(rows=lambda d: d[d.p1.notna() & d.pX.notna() & d.p2.notna()], target='res', feats=FEATS,
                   obj=dict(objective='multiclass', num_class=3, metric='multi_logloss'),
                   init=lambda d: np.log(np.clip(d[['p1', 'pX', 'p2']].values, 1e-6, 1))),
    'over25': dict(rows=lambda d: d[d.pO25.notna() & d.p1.notna()], target='o25', feats=FEATS,
                   obj=dict(objective='binary', metric='binary_logloss'), init=lambda d: logit(d.pO25.values)),
    'btts': dict(rows=lambda d: d[d.lamH.notna() & d.lamA.notna()], target='btts', feats=FEATS,
                 obj=dict(objective='binary', metric='binary_logloss'),
                 init=lambda d: logit((1 - np.exp(-d.lamH.values)) * (1 - np.exp(-d.lamA.values)))),
    'goals_h': dict(rows=lambda d: d, target='hg', feats=NOMKT, obj=dict(objective='poisson', metric='poisson'), init=None),
    'goals_a': dict(rows=lambda d: d, target='ag', feats=NOMKT, obj=dict(objective='poisson', metric='poisson'), init=None),
    'result_nomkt': dict(rows=lambda d: d, target='res', feats=NOMKT, obj=dict(objective='multiclass', num_class=3, metric='multi_logloss'), init=None),
}


def dataset(spec, d, ref=None):
    X = d[spec['feats'] + ['divc']]
    kw = dict(categorical_feature=['divc'], free_raw_data=False, params={'feature_pre_filter': False, 'max_bin': 63})
    if spec['init'] is not None:
        kw['init_score'] = spec['init'](d)
    if ref is not None:
        kw['reference'] = ref
    return lgb.Dataset(X, d[spec['target']], **kw)


def raw_pred(model, spec, d, it=None):
    return model.predict(d[spec['feats'] + ['divc']], raw_score=True, num_iteration=it)


def loss_vec(name, spec, model, d, it=None):
    """per-row log loss of model and of the price-only base (when there is one)."""
    y = d[spec['target']].values
    raw = raw_pred(model, spec, d, it)
    if name == 'result':
        p = softmax(raw + spec['init'](d))
        b = softmax(spec['init'](d))
        lm = -np.log(np.clip(p[np.arange(len(y)), y], 1e-12, 1))
        lb = -np.log(np.clip(b[np.arange(len(y)), y], 1e-12, 1))
        return lm, lb, p
    if name in ('over25', 'btts'):
        p = sigmoid(raw + spec['init'](d))
        b = sigmoid(spec['init'](d))
        f = lambda q: -(y * np.log(np.clip(q, 1e-12, 1)) + (1 - y) * np.log(np.clip(1 - q, 1e-12, 1)))
        return f(p), f(b), p
    if name == 'result_nomkt':
        p = softmax(raw)
        return -np.log(np.clip(p[np.arange(len(y)), y], 1e-12, 1)), None, p
    lam = np.exp(raw)
    from scipy.special import gammaln  # noqa
    ll = lam - y * np.log(lam) + gammaln(y + 1)
    return ll, None, lam


ONLY = [x for x in os.environ.get('ONLY', '').split(',') if x]
TOL = 2e-5  # a setting within 2e-5 tune log-loss of the best is a tie: the smaller model wins
if ONLY and os.path.exists(f'{OUT}/metrics.json'):
    metrics = json.load(open(f'{OUT}/metrics.json'))
    chosen = metrics.get('chosen', {})
else:
    metrics = {'splits': {'train': TRAIN, 'tune': TUNE, 'test': TEST}, 'models': {}}
    chosen = {}
for name, spec in SPECS.items():
    if ONLY and name not in ONLY:
        continue
    rows = spec['rows'](df)
    tr, tu, te = rng(rows, TRAIN), rng(rows, TUNE), rng(rows, TEST)
    dtr = dataset(spec, tr)
    dtu = dataset(spec, tu, dtr)
    best = None
    fits = []
    for gi, g in enumerate(GRID):
        p = dict(BASE, **g, **spec['obj'])
        t0 = time.time()
        m = lgb.train(p, dtr, num_boost_round=4000, valid_sets=[dtu], callbacks=[lgb.early_stopping(200, verbose=False)])
        lm, lb, _ = loss_vec(name, spec, m, tu, m.best_iteration)
        score = float(lm.mean())
        print(f'{name} grid{gi} rounds={m.best_iteration} tune={score:.6f} ({time.time()-t0:.0f}s)', flush=True)
        fits.append((score, gi, m))
    top = min(f[0] for f in fits)
    # among settings tied with the best, the one with the fewest trees
    score, gi, m = sorted([f for f in fits if f[0] <= top + TOL], key=lambda f: f[2].best_iteration * f[2].num_model_per_iteration())[0]
    chosen[name] = dict(grid=gi, rounds=int(m.best_iteration), params=GRID[gi])
    # held-out, reported once
    lm, lb, pred = loss_vec(name, spec, m, te, m.best_iteration)
    rec = {'n_train': int(len(tr)), 'n_tune': int(len(tu)), 'n_test': int(len(te)), 'grid': gi, 'rounds': int(m.best_iteration), 'tune_logloss': score,
           'test_logloss': float(lm.mean())}
    if lb is not None:
        rec['test_market_logloss'] = float(lb.mean())
        rec['test_gain_pct'] = float((lb.mean() - lm.mean()) / lb.mean() * 100)
        rec['test_gain_ci95'] = boot(lb - lm)
        # per season stability
        rec['by_season'] = {}
        for s in sorted(te.season.unique()):
            k = (te.season == s).values
            rec['by_season'][str(int(s))] = {'n': int(k.sum()), 'gain_pct': float((lb[k].mean() - lm[k].mean()) / lb[k].mean() * 100)}
    if name == 'result':
        y = te.res.values
        rec['test_acc'] = float(np.mean(pred.argmax(1) == y))
        rec['test_market_acc'] = float(np.mean(te[['p1', 'pX', 'p2']].values.argmax(1) == y))
    if name == 'result_nomkt':
        y = te.res.values
        rec['test_acc'] = float(np.mean(pred.argmax(1) == y))
        pr = te.p1.notna().values
        pm = te[['p1', 'pX', 'p2']].values
        rec['test_priced_subset'] = {
            'n': int(pr.sum()),
            'nomkt_logloss': float(lm[pr].mean()),
            'market_logloss': float(-np.mean(np.log(np.clip(pm[pr][np.arange(pr.sum()), y[pr]], 1e-12, 1)))),
        }
        # base-rate reference: league H/D/A frequencies from train
        freq = tr.groupby('div').res.value_counts(normalize=True).unstack().reindex(columns=[0, 1, 2]).fillna(1 / 3)
        bp = freq.reindex(te['div']).values
        rec['test_baserate_logloss'] = float(-np.mean(np.log(np.clip(bp[np.arange(len(y)), y], 1e-12, 1))))
    print(name, json.dumps(rec), flush=True)
    metrics['models'][name] = rec
    m.save_model(f'{OUT}/honest/{name}.txt', num_iteration=m.best_iteration)
    # parity sample: JavaScript must reproduce these raw scores (test/v6_unit.js)
    samp = te.sample(n=min(300, len(te)), random_state=5)
    rs = raw_pred(m, spec, samp, m.best_iteration)
    rows_out = []
    for (_, r), sc in zip(samp.iterrows(), rs):
        feats = {c: (None if pd.isna(r[c]) else float(r[c])) for c in spec['feats']}
        feats['divc'] = r['div']
        rows_out.append({'f': feats, 'raw': [float(v) for v in np.atleast_1d(sc)]})
    with open(f'{OUT}/honest/{name}.parity.json', 'w') as fh:
        json.dump(rows_out, fh)
    with open(f'{OUT}/honest/{name}.json', 'w') as fh:
        json.dump(m.dump_model(num_iteration=m.best_iteration), fh)
    # production refit on every season with the chosen settings
    allr = rng(rows, ALL)
    pp = dict(BASE, **GRID[gi], **spec['obj'])
    mp = lgb.train(pp, dataset(spec, allr), num_boost_round=int(m.best_iteration * 1.1) + 1)
    mp.save_model(f'{OUT}/prod/{name}.txt')
    with open(f'{OUT}/prod/{name}.json', 'w') as fh:
        json.dump(mp.dump_model(), fh)

metrics['chosen'] = chosen
metrics['divisions'] = DIVS
metrics['features'] = {'with_market': FEATS, 'no_market': NOMKT}
with open(f'{OUT}/metrics.json', 'w') as fh:
    json.dump(metrics, fh, indent=1)
print('done')
