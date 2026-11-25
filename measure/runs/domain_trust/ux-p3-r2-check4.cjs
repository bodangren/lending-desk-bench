const fs = require('fs');
const WT = '/home/daniebo/Desktop/lending-desk-bench-trust';
const preview = JSON.parse(fs.readFileSync(WT + '/measure/tracks/domain_trust/preview.json', 'utf8'));
const data = JSON.parse(fs.readFileSync(WT + '/docs/assets/data/benchmark.json', 'utf8'));
const dt = data.domain_trust;
const bad = [];
dt.models.forEach((m) => {
  const p = preview.models[m.id];
  if (!p || JSON.stringify([...m.runs.run_ids].sort()) !== JSON.stringify([...p.runs].sort())) bad.push(m.id);
});
console.log('RUN_IDS committed export equals preview for each of ' + dt.models.length + ' models: ' + (bad.length === 0) + (bad.length ? ' bad=' + bad.join(',') : ''));
console.log('N_MIN committed=' + dt.rule.n_min + ' preview=' + preview.n_min + ' schema=' + dt.schema + ' generated_at=' + data.generated_at);
const ids = new Set(); Object.values(preview.models).forEach((p) => p.runs.forEach((r) => ids.add(r)));
console.log('preview unique run ids=' + ids.size);
const re = /^([ab])-(.+?)-(\d{4}w\d{2})(?:-r(\d+))?$/;
const slugs = new Set([...ids].map((r) => { const m = re.exec(r); return m ? m[2] : null; }).filter(Boolean));
console.log('catalog slugs in preview=' + slugs.size);
const dirs = fs.readdirSync(WT + '/runs');
const missing = [...ids].filter((r) => !dirs.includes(r));
console.log('preview run dirs missing on disk=' + missing.length + (missing.length ? ' ' + missing.join(',') : ''));
const extra = [];
dirs.forEach((d) => {
  const m = re.exec(d);
  if (!m || !slugs.has(m[2]) || ids.has(d)) return;
  let valid = 'n/a', results = false;
  try { valid = String(JSON.parse(fs.readFileSync(WT + '/runs/' + d + '/artifacts/score.json', 'utf8')).valid); } catch (e) { valid = 'no score.json'; }
  results = fs.existsSync(WT + '/runs/' + d + '/artifacts/results.json');
  extra.push(d + ' valid=' + valid + ' results.json=' + results);
});
console.log('stored run dirs of those catalog slugs that are NOT in the preview=' + extra.length);
extra.forEach((x) => console.log('  ' + x));
const eligibleExtra = extra.filter((x) => /valid=true results\.json=true/.test(x));
console.log('of those, valid=true with results.json (would join the matrix)=' + eligibleExtra.length);
