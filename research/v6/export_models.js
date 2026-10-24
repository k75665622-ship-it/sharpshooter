'use strict';

/**
 * research/v6/export_models.js — LightGBM JSON dumps -> the compact form lib/factors/gbm.js reads.
 *
 *   node research/v6/export_models.js <model_dir> <metrics.json> <out_dir>
 *
 * Reads <model_dir>/{result,over25,btts,goals_h,goals_a,result_nomkt}.json (LightGBM
 * dump_model output) and writes one compact JSON per model. Category codes for the
 * league feature ('divc') are the pandas category order saved in metrics.json.
 */

const fs = require('fs');
const path = require('path');

const [, , dir, metricsFile, outDir] = process.argv;
if (!dir || !metricsFile || !outDir) {
  console.error('usage: node research/v6/export_models.js <model_dir> <metrics.json> <out_dir>');
  process.exit(1);
}
const metrics = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const MT = { None: 0, Zero: 1, NaN: 2 };
// leaf / node values: 8 significant digits (sum error ~1e-7 over a thousand trees)
const r8 = (v) => Number(Number(v).toPrecision(8));
// thresholds: live factor values are rounded to 4 decimals, so 6 decimals keep every split
// identical — except LightGBM's exact-zero splits at +-1e-35, which are kept as they are
const thr6 = (v) => (Math.abs(v) < 1e-20 ? v : Math.round(v * 1e6) / 1e6);

function compactTree(root) {
  const nodes = [];
  function walk(n) {
    const idx = nodes.length;
    if (n.leaf_value !== undefined) {
      nodes.push([r8(n.leaf_value)]);
      return idx;
    }
    nodes.push(null);
    const cat = n.decision_type === '==';
    let flags = (n.default_left ? 1 : 0) | ((MT[n.missing_type] || 0) << 1) | (cat ? 8 : 0);
    // thresholds keep full precision: LightGBM splits exact zeros at +-1e-35
    const thr = cat ? String(n.threshold).split('||').map(Number) : thr6(Number(n.threshold));
    const l = walk(n.left_child);
    const r = walk(n.right_child);
    nodes[idx] = [n.split_feature, thr, flags, l, r, r8(n.internal_value)];
    return idx;
  }
  walk(root);
  return nodes;
}

for (const name of ['result', 'over25', 'btts', 'goals_h', 'goals_a', 'result_nomkt']) {
  const file = path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) {
    console.log('skip', name);
    continue;
  }
  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  const numClass = dump.num_class || 1;
  const objective = /multiclass/.test(dump.objective) ? 'multiclass' : /binary/.test(dump.objective) ? 'binary' : /poisson/.test(dump.objective) ? 'poisson' : dump.objective;
  const trees = dump.tree_info.map((t, i) => ({ k: i % numClass, n: compactTree(t.tree_structure) }));
  const out = {
    name,
    objective,
    numClass,
    features: dump.feature_names,
    categorical: { divc: metrics.divisions },
    trees,
    rounds: dump.tree_info.length / numClass,
  };
  const target = path.join(outDir, `${name}.json`);
  fs.writeFileSync(target, JSON.stringify(out));
  console.log(name, objective, 'trees', trees.length, 'bytes', fs.statSync(target).size);
}
