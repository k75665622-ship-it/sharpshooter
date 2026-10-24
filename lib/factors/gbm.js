'use strict';

/**
 * factors/gbm.js — evaluate the v6 gradient-boosted tree models in plain JavaScript.
 *
 * The models are trained in research/v6/train_final.py (LightGBM) and exported by
 * research/v6/export_models.js into a compact JSON form:
 *
 *   { name, objective: 'multiclass'|'binary'|'poisson', numClass, features: [names],
 *     categorical: { <feature>: [category names] }, trees: [ { k, n: [node, ...] } ] }
 *
 *   internal node  [featureIndex, threshold | [categories], flags, left, right, value]
 *                  flags: bit0 default-left, bits1-2 missing type (0 none, 1 zero, 2 NaN),
 *                  bit3 categorical split
 *   leaf           [value]
 *
 * Decisions follow LightGBM's own rules exactly (tree.h NumericalDecision /
 * CategoricalDecision), so JavaScript and Python agree to floating-point precision
 * (test/v6_unit.js checks this against predictions saved by the trainer).
 *
 * explain() returns per-feature contributions (the Saabas path method): along the
 * path a row takes, each split moves the expected value from the parent's to the
 * child's; that move is credited to the split's feature. Contributions plus the
 * tree bias sum exactly to the raw score.
 */

const FLAG_DEFAULT_LEFT = 1;
const FLAG_CAT = 8;

function missingType(flags) {
  return (flags >> 1) & 3;
}

function decide(node, x) {
  const [f, t, flags, l, r] = node;
  let v = x[f];
  if (flags & FLAG_CAT) {
    if (v == null || Number.isNaN(v) || v < 0) return r;
    return t.includes(Math.trunc(v)) ? l : r;
  }
  const mt = missingType(flags);
  const isNan = v == null || Number.isNaN(v);
  if (isNan && mt !== 2) v = 0;
  if ((mt === 1 && Math.abs(v) <= 1e-35) || (mt === 2 && isNan)) return flags & FLAG_DEFAULT_LEFT ? l : r;
  return v <= t ? l : r;
}

function leafOf(tree, x) {
  const n = tree.n;
  let i = 0;
  while (n[i].length > 1) i = decide(n[i], x);
  return n[i][0];
}

/** Map a feature object {name: value} to the model's input vector. */
function vectorise(model, feats) {
  const x = new Array(model.features.length);
  for (let i = 0; i < model.features.length; i++) {
    const name = model.features[i];
    const cats = model.categorical && model.categorical[name];
    const v = feats[name];
    if (cats) {
      const idx = cats.indexOf(v);
      x[i] = idx >= 0 ? idx : NaN;
    } else x[i] = v == null || !Number.isFinite(v) ? NaN : v;
  }
  return x;
}

/** Raw scores (one per class), before any base score is added. */
function raw(model, feats) {
  const x = Array.isArray(feats) ? feats : vectorise(model, feats);
  const k = model.numClass || 1;
  const s = new Array(k).fill(0);
  for (const t of model.trees) s[t.k] += leafOf(t, x);
  return s;
}

/**
 * Per-feature contributions to each class's raw score.
 * @returns {{bias:number[], contrib:Array<Object<string,number>>}}
 */
function explain(model, feats) {
  const x = Array.isArray(feats) ? feats : vectorise(model, feats);
  const k = model.numClass || 1;
  const bias = new Array(k).fill(0);
  const contrib = Array.from({ length: k }, () => ({}));
  for (const t of model.trees) {
    const n = t.n;
    let i = 0;
    if (n[0].length === 1) {
      bias[t.k] += n[0][0];
      continue;
    }
    bias[t.k] += n[0][5];
    while (n[i].length > 1) {
      const node = n[i];
      const j = decide(node, x);
      const childVal = n[j].length > 1 ? n[j][5] : n[j][0];
      const name = model.features[node[0]];
      contrib[t.k][name] = (contrib[t.k][name] || 0) + (childVal - node[5]);
      i = j;
    }
  }
  return { bias, contrib };
}

const softmax = (z) => {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
};
const sigmoid = (v) => 1 / (1 + Math.exp(-v));
const logit = (p) => {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return Math.log(q / (1 - q));
};

/**
 * Prediction on the response scale, starting from an optional base (the price):
 *   multiclass  base = probabilities -> softmax(log base + raw)
 *   binary      base = probability   -> sigmoid(logit base + raw)
 *   poisson     base = expected count (optional) -> base * exp(raw)
 */
function predict(model, feats, base) {
  const r = raw(model, feats);
  if (model.objective === 'multiclass') {
    const b = base ? base.map((p) => Math.log(Math.max(1e-6, p))) : new Array(r.length).fill(0);
    return softmax(r.map((v, i) => v + b[i]));
  }
  if (model.objective === 'binary') return sigmoid(r[0] + (base != null ? logit(base) : 0));
  if (model.objective === 'poisson') return (base != null ? base : 1) * Math.exp(r[0]);
  return r[0];
}

module.exports = { raw, explain, predict, vectorise, decide, softmax, sigmoid, logit };
