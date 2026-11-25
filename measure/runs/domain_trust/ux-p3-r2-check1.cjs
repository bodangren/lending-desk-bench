const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/daniebo/.nvm/versions/node/v24.19.0/lib/node_modules/@playwright/test/node_modules/playwright-core');
const WT = '/home/daniebo/Desktop/lending-desk-bench-trust';
const OUT = '/home/daniebo/Desktop/lending-desk-bench/measure/runs/domain_trust';
const RES = 'http://127.0.0.1:8767/results.html';
const AXE = WT + '/harness/node_modules/axe-core/axe.min.js';
const preview = JSON.parse(fs.readFileSync(WT + '/measure/tracks/domain_trust/preview.json', 'utf8'));
const WORD = { safe: 'safe', unproven: 'unproven', unoptimized: 'Safe, not optimized', risk: 'risk' };
const CLS = { safe: 'cell-good', unproven: 'cell-dead', unoptimized: 'cell-mid', risk: 'cell-bad' };
const LET = 'ABCDEFGH'.split('');
const IDS = Object.keys(preview.models).sort();
const NMIN = preview.n_min;
let nPass = 0, nFail = 0;
const cut = (d, n) => { const s = typeof d === 'string' ? d : JSON.stringify(d); return s && s.length > n ? s.slice(0, n) + '...' : s; };
const rec = (id, ok, detail) => { if (ok) nPass++; else nFail++; console.log((ok ? 'PASS ' : 'FAIL ') + id + ' :: ' + cut(detail, 800)); };
const info = (id, detail) => console.log('INFO ' + id + ' :: ' + cut(detail, 1200));
function execKind(runId) {
  try {
    const j = JSON.parse(fs.readFileSync(WT + '/runs/' + runId + '/artifacts/provenance.json', 'utf8'));
    return j.executor && j.executor.pi && typeof j.executor.pi === 'object' ? 'pi' : 'opencode';
  } catch (e) { return 'missing'; }
}
async function openPage(browser, w, h, mobile) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  const page = await ctx.newPage();
  const log = { con: [], err: [], fail: [], bad: [] };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.con.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => log.err.push(String(e)));
  page.on('requestfailed', (r) => log.fail.push(r.url() + ' :: ' + ((r.failure() || {}).errorText || '')));
  page.on('response', (r) => { if (r.status() >= 400) log.bad.push(r.status() + ' ' + r.url()); });
  await page.goto(RES, { waitUntil: 'load' });
  await page.waitForSelector('#trust-table tbody tr', { timeout: 20000 });
  await page.waitForSelector('#trust-failures li', { timeout: 20000 });
  await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true));
  await page.waitForTimeout(1200);
  return { ctx, page, log };
}
async function kbd(page, w, mobile) {
  await page.evaluate(() => { window.scrollTo(0, 0); const a = document.activeElement; if (a && a !== document.body) a.blur(); });
  const trail = []; let reached = -1;
  for (let i = 1; i <= 400; i++) {
    await page.keyboard.press('Tab');
    const d = await page.evaluate(() => {
      const a = document.activeElement; const cs = getComputedStyle(a);
      return { tag: a.tagName.toLowerCase(), label: a.getAttribute('aria-label') || '', text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, inSec: !!a.closest('#domain-trust') };
    });
    trail.push(d);
    if (d.label === 'Domain trust matrix') { reached = i; break; }
  }
  const res = { reached, firstStops: trail.slice(0, 6).map((x) => x.tag + ':' + (x.label || x.text)).join(' | ') };
  if (reached > 0) {
    res.focusOutline = trail[trail.length - 1].outline;
    res.sectionStops = trail.filter((x) => x.inSec).map((x) => x.tag + ':' + (x.label || x.text));
    if (mobile) {
      const r = await page.evaluate(() => { const b = document.querySelector('#domain-trust .table-wrap').getBoundingClientRect(); return { y: b.y + window.scrollY, h: b.height }; });
      await page.screenshot({ path: path.join(OUT, 'ux-p3-r2-390-focus.png'), fullPage: true, clip: { x: 0, y: Math.max(0, r.y - 14), width: w, height: Math.min(r.h + 40, 900) } });
    }
    const before = await page.evaluate(() => document.querySelector('#domain-trust .table-wrap').scrollLeft);
    for (let k = 0; k < 4; k++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => document.querySelector('#domain-trust .table-wrap').scrollLeft);
    res.arrowScroll = { before, after };
    await page.keyboard.press('Tab');
    res.nextStop = await page.evaluate(() => { const a = document.activeElement; return a.tagName.toLowerCase() + ':' + (a.getAttribute('aria-label') || (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)); });
  }
  return res;
}
async function runWidth(browser, w, h, mobile) {
  const L = String(w);
  const { ctx, page, log } = await openPage(browser, w, h, mobile);
  info('viewport@' + L, { viewport: page.viewportSize(), dpr: await page.evaluate(() => window.devicePixelRatio) });
  const data = await page.evaluate(async () => {
    const d = await (await fetch('./assets/data/benchmark.json', { cache: 'no-cache' })).json();
    return { dt: d.domain_trust };
  });
  const dt = data.dt;
  const nameOf = {}; dt.models.forEach((m) => { nameOf[m.id] = m.name; });
  const chk = {}; Object.values(dt.checks).forEach((list) => list.forEach((c) => { chk[c.id] = c; }));
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const describeExp = (id, graded, failed) => {
    const i = chk[id] || {}; const parts = [id];
    if (i.kind) parts.push(i.kind + ': ' + (i.text || ''));
    parts.push('graded ' + graded + ' of ' + dt.rule.n_min + ' needed');
    if (failed !== undefined) parts.push('failed ' + failed);
    return parts.join(' — ');
  };
  const F = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    const sec = q('#domain-trust'); const table = q('#trust-table'); const wrap = sec.querySelector('.table-wrap');
    const top = (el) => el.getBoundingClientRect().top + window.scrollY;
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) => {
      const th = tr.querySelector('th'); const sub = th.querySelector('.subline');
      return { name: norm(th.childNodes[0].textContent), sub: sub ? norm(sub.textContent) : null, scope: th.getAttribute('scope'), cells: [...tr.querySelectorAll('td')].map((td) => ({ t: norm(td.textContent), c: td.className })) };
    });
    const a = sec.querySelector('.section-lede a'); const hint = sec.querySelector('.scroll-hint');
    const hcs = hint ? getComputedStyle(hint) : null;
    const ids = {}; document.querySelectorAll('[id]').forEach((e) => { ids[e.id] = (ids[e.id] || 0) + 1; });
    return {
      h2: norm(sec.querySelector('h2').textContent),
      heads: [...table.querySelectorAll('thead th')].map((th) => norm(th.textContent) + '|' + th.getAttribute('scope')),
      rows,
      lede: norm(sec.querySelector('.section-lede').textContent),
      link: a ? { href: a.getAttribute('href'), abs: a.href, text: norm(a.textContent) } : null,
      hint: hint ? { text: norm(hint.textContent), display: hcs.display, fontSize: hcs.fontSize, color: hcs.color, family: hcs.fontFamily.slice(0, 32) } : null,
      lis: [...sec.querySelectorAll('#trust-failures li')].map((li) => ({ m: li.querySelector('strong') ? norm(li.querySelector('strong').textContent) : null, t: norm(li.textContent) })),
      h3: sec.querySelector('#trust-failures h3') ? norm(sec.querySelector('#trust-failures h3').textContent) : null,
      tops: { score: top(q('#full-table')), heat: top(q('#heatmap')), trust: top(sec), armb: top(q('#arm-b-note')) },
      sectionOrder: [...document.querySelectorAll('main > section')].map((s) => s.id || norm((s.querySelector('h2') || {}).textContent || '')),
      region: { role: wrap.getAttribute('role'), label: wrap.getAttribute('aria-label'), tabindex: wrap.getAttribute('tabindex'), ox: getComputedStyle(wrap).overflowX, sw: wrap.scrollWidth, cw: wrap.clientWidth },
      dupIds: Object.entries(ids).filter(([, n]) => n > 1).map(([k]) => k),
      headings: [...document.querySelectorAll('#domain-trust h2, #domain-trust h3')].map((x) => x.tagName + ':' + norm(x.textContent)),
    };
  });
  // S1
  rec('S1 section Domain trust is below the score table @' + L, F.tops.trust > F.tops.score && F.tops.trust > F.tops.heat && F.sectionOrder.indexOf('domain-trust') > 0 && F.h2 === 'Domain trust', { tops: F.tops, order: F.sectionOrder, h2: F.h2, headings: F.headings });
  // S2
  const wantHeads = ['Model|col'].concat(LET.map((d) => d + '|col'));
  const rowNames = F.rows.map((r) => r.name);
  const okIds = JSON.stringify(dt.models.map((m) => m.id)) === JSON.stringify(IDS);
  const okNames = JSON.stringify(rowNames) === JSON.stringify(dt.models.map((m) => m.name)) && new Set(rowNames).size === rowNames.length;
  rec('S2 14 rows, 8 domain columns A-H, rows in id order @' + L, F.rows.length === 14 && IDS.length === 14 && JSON.stringify(F.heads) === JSON.stringify(wantHeads) && okIds && okNames && F.rows.every((r) => r.cells.length === 8 && r.scope === 'row'), { rows: F.rows.length, heads: F.heads.join(','), okIds, okNames, names: rowNames.join(' / ') });
  // S3
  const bad3 = [], clsBad = []; const tally = {};
  F.rows.forEach((r, i) => r.cells.forEach((c, j) => {
    const v = preview.models[IDS[i]].cells[LET[j]].verdict;
    if (c.t !== WORD[v]) bad3.push(IDS[i] + ' ' + LET[j] + ' want ' + WORD[v] + ' got ' + c.t);
    if (c.c !== CLS[v]) clsBad.push(IDS[i] + LET[j]);
    tally[c.t] = (tally[c.t] || 0) + 1;
  }));
  rec('S3 each of 112 cells shows the preview verdict as a word @' + L, bad3.length === 0 && F.rows.length * 8 === 112, { mismatches: bad3.slice(0, 8), tally, colorClassMismatch: clsBad.length });
  const snap = await page.locator('#trust-table').ariaSnapshot();
  const words = [...snap.matchAll(/^\s*- cell "([^"]*)"/gm)].map((m) => m[1]);
  const wantWords = []; IDS.forEach((id) => LET.forEach((d) => wantWords.push(WORD[preview.models[id].cells[d].verdict])));
  const nColH = [...snap.matchAll(/^\s*- columnheader /gm)].length, nRowH = [...snap.matchAll(/^\s*- rowheader /gm)].length;
  const regionN = await page.getByRole('region', { name: 'Domain trust matrix' }).count();
  rec('S3 accessibility snapshot holds each verdict word, in order @' + L, JSON.stringify(words) === JSON.stringify(wantWords) && nColH === 9 && nRowH === 14 && regionN === 1, { cells: words.length, columnheaders: nColH, rowheaders: nRowH, regionByName: regionN });
  info('aria-snapshot-head@' + L, snap.split('\n').slice(0, 16).join(' | '));
  // S4
  const samples = [['claude-haiku-5-5', 'D', 'unoptimized'], ['hy3', 'F', 'risk'], ['mimo-v2.6-flash', 'B', 'risk'], ['gpt-5.6-luna', 'B', 'unproven'], ['longcat-2.0', 'G', 'risk'], ['muse-spark-1.3-contributor', 'B', 'safe'], ['muse-spark-1.3-contributor', 'E', 'safe'], ['muse-spark-1.3-contributor', 'F', 'risk'], ['hy3', 'C', 'unproven']];
  const sres = samples.map(([id, d, want]) => { const pv = preview.models[id].cells[d].verdict; const got = F.rows[IDS.indexOf(id)].cells[LET.indexOf(d)].t; return { id, d, want, pv, got, ok: pv === want && got === WORD[want] }; });
  rec('S4 nine sampled cells equal the preview @' + L, sres.every((s) => s.ok), sres.map((s) => s.id + ' ' + s.d + '=' + s.got + (s.ok ? '' : ' WANT ' + s.want + '/' + s.pv)).join('; '));
  const li = (id, d) => F.lis.find((x) => x.m === nameOf[id] && x.t.startsWith(nameOf[id] + ' — ' + d + ' '));
  const lc = li('longcat-2.0', 'G'); const h3 = li('hy3', 'C');
  rec('S4 longcat-2.0 G list shows G.401 failed 3 of 3 @' + L, !!lc && /G\.401 — .*?graded 3 of 2 needed — failed 3(?!\d)/.test(lc.t), lc ? lc.t.slice(0, 200) : 'no li');
  rec('S4 hy3 C label reads "graded 1 of 2 needed", never "not graded" @' + L, !!h3 && /P\.n-plus-one — performance: .*?— graded 1 of 2 needed — failed 1(?!\d)/.test(h3.t) && !/not graded/i.test(h3.t), h3 ? h3.t.slice(0, 460) : 'no li');
  // S5
  const bad5 = [];
  F.rows.forEach((r, i) => {
    const m = dt.models[i]; const mm = /^(\d+) OpenCode · (\d+) Pi · (\d+) runs$/.exec(r.sub || '');
    const shown = mm ? { o: +mm[1], p: +mm[2], t: +mm[3] } : null;
    const ids = preview.models[IDS[i]].runs; const kinds = ids.map(execKind);
    const so = kinds.filter((k) => k === 'opencode').length, sp = kinds.filter((k) => k === 'pi').length, sm = kinds.filter((k) => k === 'missing').length;
    const armA = ids.filter((x) => x.startsWith('a-')).length, armB = ids.filter((x) => x.startsWith('b-')).length;
    const good = shown && shown.o === m.runs.opencode && shown.p === m.runs.pi && shown.t === m.runs.total && shown.t === ids.length && shown.o === so && shown.p === sp && sm === 0 && m.runs.arm_a === armA && m.runs.arm_b === armB;
    if (!good) bad5.push({ id: IDS[i], sub: r.sub, data: m.runs && [m.runs.opencode, m.runs.pi, m.runs.total, m.runs.arm_a, m.runs.arm_b], stored: [so, sp, sm], arms: [armA, armB] });
  });
  rec('S5 each row shows runs per executor, equal to data and to stored provenance @' + L, bad5.length === 0, bad5.length ? bad5 : F.rows.map((r) => r.name + ': ' + r.sub).join(' | '));
  // S6
  const exp6 = [];
  IDS.forEach((id) => LET.forEach((d) => { const c = preview.models[id].cells[d]; if (c.verdict !== 'safe') exp6.push({ id, d, c }); }));
  const seqOk = F.lis.length === exp6.length && exp6.every((e, k) => F.lis[k].m === nameOf[e.id] && F.lis[k].t.startsWith(nameOf[e.id] + ' — ' + e.d + ' ' + WORD[e.c.verdict]));
  const safeLeak = F.lis.filter((x) => /^.+? — [A-H] safe(?![,\w])/.test(x.t)).length;
  const previewBad = [], strictBad = []; let segsWant = 0;
  exp6.forEach((e, k) => {
    const cell = dt.models.find((m) => m.id === e.id).cells[e.d];
    const pf = Object.entries(e.c.failures).map(([a, b]) => a + '=' + b).sort().join(',');
    const df = cell.failures.map((f) => f.id + '=' + f.failed + '/' + f.graded).sort().join(',');
    const pg = e.c.gaps.slice().sort().join(','), dg = cell.gaps.map((g) => g.id).sort().join(',');
    const gapBad = cell.gaps.some((g) => g.graded >= dt.rule.n_min);
    if (pf !== df || pg !== dg || cell.verdict !== e.c.verdict || gapBad) previewBad.push(nameOf[e.id] + ' ' + e.d);
    segsWant += Object.keys(e.c.failures).length + e.c.gaps.length;
    const failedStr = cell.failures.map((f) => describeExp(f.id, f.graded, f.failed)).join(', ');
    const gapsStr = cell.gaps.map((g) => describeExp(g.id, g.graded)).join(', ');
    let want = nameOf[e.id] + ' — ' + e.d + ' ' + WORD[e.c.verdict];
    if (failedStr) want += ' · ' + failedStr;
    if (gapsStr) want += ' · ' + gapsStr;
    if (norm(want) !== (F.lis[k] || {}).t) strictBad.push(nameOf[e.id] + ' ' + e.d);
  });
  const segsGot = F.lis.reduce((n, x) => n + (x.t.match(/ — graded /g) || []).length, 0);
  const notGraded = F.lis.filter((x) => /not graded/i.test(x.t)).length;
  const longest = F.lis.reduce((a, x) => (x.t.length > a.len ? { len: x.t.length, who: x.t.slice(0, 40) } : a), { len: 0, who: '' });
  rec('S6 failure-mode list names each non-safe cell, once, with its checks @' + L, F.lis.length === 61 && exp6.length === 61 && seqOk && safeLeak === 0 && previewBad.length === 0 && strictBad.length === 0 && segsGot === segsWant && notGraded === 0, { lis: F.lis.length, expectedNonSafe: exp6.length, seqOk, safeLeak, previewVsDataBad: previewBad.length, pageVsDataBad: strictBad.slice(0, 5), coverageLabels: segsGot, coverageLabelsWanted: segsWant, notGradedLines: notGraded, h3: F.h3, longestLine: longest });
  // S7
  rec('S7 rule paragraph: safe means "no failure in the checks that ran"; links to methodology.html @' + L, F.lede.includes('no failure in the checks that ran') && F.lede.includes('not proof that a defect is absent') && !!F.link && F.link.href === './methodology.html#domain-trust' && F.link.abs.endsWith('/methodology.html#domain-trust'), { lede: F.lede, link: F.link });
  info('scroll-hint@' + L, F.hint);
  rec('A11Y region: scroll box is a labelled, focusable region; no duplicate ids @' + L, F.region.role === 'region' && F.region.label === 'Domain trust matrix' && F.region.tabindex === '0' && F.dupIds.length === 0, { region: F.region, dupIds: F.dupIds });
  // screenshots
  const box = await page.evaluate(() => { const s = document.getElementById('domain-trust').getBoundingClientRect(); const hn = document.querySelector('#domain-trust .scroll-hint').getBoundingClientRect(); const sy = window.scrollY; return { y: s.y + sy, h: s.height, hintBottom: hn.bottom + sy }; });
  const clipH = Math.min(box.h, box.hintBottom - box.y + 320);
  await page.screenshot({ path: path.join(OUT, 'ux-p3-r2-' + L + '.png'), fullPage: true, clip: { x: 0, y: Math.max(0, box.y - 6), width: w, height: clipH + 6 } });
  info('screenshot@' + L, { file: 'ux-p3-r2-' + L + '.png', clipHeightCssPx: clipH + 6, sectionHeight: Math.round(box.h) });
  if (!mobile) {
    const fm = await page.evaluate(([n1, n2]) => {
      const sy = window.scrollY; const lis = [...document.querySelectorAll('#trust-failures li')];
      const a = lis.find((l) => l.querySelector('strong') && l.querySelector('strong').textContent.trim() === n1);
      const b = lis.filter((l) => l.querySelector('strong') && l.querySelector('strong').textContent.trim() === n2 && /— G /.test(l.textContent)).pop();
      if (!a || !b) return null;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return { y: ra.top + sy, h: rb.bottom - ra.top };
    }, [nameOf['hy3'], nameOf['longcat-2.0']]);
    if (fm) {
      const hh = Math.min(fm.h + 16, 3400);
      await page.screenshot({ path: path.join(OUT, 'ux-p3-r2-failure-modes.png'), fullPage: true, clip: { x: 0, y: Math.max(0, fm.y - 8), width: w, height: hh } });
      info('screenshot-failure-modes', { file: 'ux-p3-r2-failure-modes.png', clipHeightCssPx: Math.round(hh), spans: 'hy3 first entry to longcat-2.0 G entry' });
    } else info('screenshot-failure-modes', 'hy3 or longcat G entry not found');
  }
  // S9 overflow
  const ov = await page.evaluate(() => {
    const de = document.documentElement; const iw = window.innerWidth;
    const wrap = document.querySelector('#domain-trust .table-wrap'); const sec = document.getElementById('domain-trust');
    const clipped = (el) => { let p = el.parentElement; while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; p = p.parentElement; } return false; };
    const offAll = [], offSec = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue;
      if ((r.right > iw + 1 || r.left < -1) && !clipped(el)) { const d = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + String(el.className).slice(0, 24) + ' right=' + Math.round(r.right); offAll.push(d); if (sec.contains(el)) offSec.push(d); }
    }
    const fl = document.getElementById('trust-failures');
    return { iw, docScrollW: de.scrollWidth, docClientW: de.clientWidth, bodyScrollW: document.body.scrollWidth, wrapScrollW: wrap.scrollWidth, wrapClientW: wrap.clientWidth, wrapOverflowX: getComputedStyle(wrap).overflowX, offendersPage: offAll.length, offendersSection: offSec.length, sample: offAll.slice(0, 4), failListScrollW: fl.scrollWidth, failListClientW: fl.clientWidth };
  });
  info('overflow@' + L, ov);
  rec('S9 no horizontal page overflow @' + L, ov.docScrollW <= ov.iw && ov.bodyScrollW <= ov.iw && ov.offendersSection === 0 && ov.failListScrollW <= ov.failListClientW, ov);
  if (mobile) {
    rec('S9 at 390 px the matrix scrolls inside its own box @' + L, ov.wrapOverflowX === 'auto' && ov.wrapScrollW > ov.wrapClientW, { scrollW: ov.wrapScrollW, clientW: ov.wrapClientW, overflowX: ov.wrapOverflowX });
    const sc = await page.evaluate(() => { const wrap = document.querySelector('#domain-trust .table-wrap'); wrap.scrollLeft = wrap.scrollWidth; const wr = wrap.getBoundingClientRect(); const hs = [...wrap.querySelectorAll('thead th')]; const last = hs[hs.length - 1].getBoundingClientRect(); const first = hs[0].getBoundingClientRect(); return { scrollLeft: Math.round(wrap.scrollLeft), maxScroll: wrap.scrollWidth - wrap.clientWidth, lastHeaderInsideBox: last.right <= wr.right + 1 && last.left >= wr.left, firstColumnScrolledOut: first.right <= wr.left + 1, pageScrollX: window.scrollX }; });
    info('matrix-scrolled@390', sc);
    const r2 = await page.evaluate(() => { const b = document.querySelector('#domain-trust .table-wrap').getBoundingClientRect(); return { y: b.y + window.scrollY, h: b.height }; });
    await page.screenshot({ path: path.join(OUT, 'ux-p3-r2-390-scrolled.png'), fullPage: true, clip: { x: 0, y: Math.max(0, r2.y - 14), width: w, height: Math.min(r2.h + 40, 900) } });
    await page.evaluate(() => { document.querySelector('#domain-trust .table-wrap').scrollLeft = 0; });
  }
  // NFR-6 contrast
  const con = await page.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); const p = m[1].split(',').map((s) => parseFloat(s)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const blend = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const wrap = document.querySelector('#domain-trust .table-wrap');
    let bg = parse(getComputedStyle(wrap).backgroundColor); if (bg.a < 1) bg = blend(bg, { r: 10, g: 13, b: 18, a: 1 });
    const out = {};
    for (const cls of ['cell-good', 'cell-dead', 'cell-mid', 'cell-bad']) {
      const td = document.querySelector('#trust-table td.' + cls); if (!td) { out[cls] = null; continue; }
      const cs = getComputedStyle(td); const cb = blend(parse(cs.backgroundColor), bg);
      const L1 = lum(parse(cs.color)), L2 = lum(cb);
      out[cls] = { font: cs.fontSize, ratio: Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100 };
    }
    return out;
  });
  info('contrast@' + L, con);
  // axe
  await page.addScriptTag({ path: AXE });
  const ax = await page.evaluate(async () => {
    const r = await window.axe.run(document.getElementById('domain-trust'), { resultTypes: ['violations', 'incomplete'] });
    const f = (v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.target.join(' ')) });
    return { violations: r.violations.map(f), incomplete: r.incomplete.map(f), passes: r.passes.length };
  });
  rec('AXE no violations in #domain-trust @' + L, ax.violations.length === 0, ax);
  // keyboard
  const kb = await kbd(page, w, mobile);
  rec('KBD Tab reaches the matrix scroll box, with a visible focus ring @' + L, kb.reached > 0 && /solid 2px/.test(kb.focusOutline || ''), kb);
  if (mobile) rec('KBD arrow keys scroll the focused matrix @' + L, kb.arrowScroll && kb.arrowScroll.after > kb.arrowScroll.before, kb.arrowScroll);
  // S10
  info('console@' + L, { consoleErrorsAndWarnings: log.con, pageErrors: log.err, failedRequests: log.fail, httpErrors: log.bad });
  rec('S10 no page error, no console error from the page @' + L, log.err.length === 0 && log.con.filter((x) => x.startsWith('error')).length === 0 && log.bad.length === 0, { pageErrors: log.err.length, consoleErrors: log.con.filter((x) => x.startsWith('error')).length, http4xx5xx: log.bad.length, failedRequests: log.fail.length });
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  info('browser', 'Chrome ' + browser.version());
  try { await runWidth(browser, 1280, 900, false); await runWidth(browser, 390, 844, true); } finally { await browser.close(); }
  console.log('SUMMARY pass=' + nPass + ' fail=' + nFail);
})().catch((e) => { console.error('SCRIPT_ERROR', (e && e.stack) || e); process.exit(1); });
