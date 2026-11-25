const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('/home/daniebo/.nvm/versions/node/v24.19.0/lib/node_modules/@playwright/test/node_modules/playwright-core');
const WT = '/home/daniebo/Desktop/lending-desk-bench-trust';
const OUT = '/home/daniebo/Desktop/lending-desk-bench/measure/runs/domain_trust';
const BASE = 'c4560f2e3078ef2b0b1869a4fe0597df792f3372';
const RES = 'http://127.0.0.1:8767/results.html';
const METH = 'http://127.0.0.1:8767/methodology.html';
let nPass = 0, nFail = 0;
const cut = (d, n) => { const s = typeof d === 'string' ? d : JSON.stringify(d); return s && s.length > n ? s.slice(0, n) + '...' : s; };
const rec = (id, ok, detail) => { if (ok) nPass++; else nFail++; console.log((ok ? 'PASS ' : 'FAIL ') + id + ' :: ' + cut(detail, 900)); };
const info = (id, detail) => console.log('INFO ' + id + ' :: ' + cut(detail, 1400));

async function renderScore(browser, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const log = { con: [], err: [], bad: [] };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.con.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => log.err.push(String(e)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.responseReceived', (e) => { if (e.response.status >= 400) log.bad.push(e.response.status + ' ' + e.response.url); });
  if (opts.html) await page.route('**/results.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: opts.html }));
  if (opts.json) await page.route('**/assets/data/benchmark.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: opts.json }));
  if (opts.favicon) await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
  await page.goto(RES, { waitUntil: 'load' });
  await page.waitForSelector('#full-table tbody tr', { timeout: 20000 });
  await page.waitForSelector('#arm-b-note h2', { timeout: 20000 });
  await page.waitForTimeout(800);
  const snap = await page.evaluate(() => {
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    return {
      head: [...document.querySelectorAll('#full-table thead th')].map((c) => norm(c.textContent)),
      rows: [...document.querySelectorAll('#full-table tbody tr')].map((tr) => [...tr.children].map((c) => norm(c.textContent))),
      provRows: document.querySelectorAll('#full-table tr.provisional-row').length,
      heat: [...document.querySelectorAll('#heatmap tr')].map((tr) => [...tr.children].map((c) => norm(c.textContent))),
      hist: norm((document.getElementById('history-results') || { textContent: '' }).textContent),
      armb: norm(document.getElementById('arm-b-note').textContent),
      hasTrust: !!document.getElementById('domain-trust'),
      charts: document.querySelectorAll('canvas').length,
    };
  });
  await ctx.close();
  return { snap, log };
}
function diffSnap(a, b) {
  const d = [];
  if (JSON.stringify(a.head) !== JSON.stringify(b.head)) d.push('head');
  if (a.rows.length !== b.rows.length) d.push('rowcount ' + a.rows.length + ' vs ' + b.rows.length);
  a.rows.forEach((r, i) => r.forEach((c, j) => { const o = (b.rows[i] || [])[j]; if (o !== c) d.push('row' + (i + 1) + ' col' + (j + 1) + ': [' + cut(c, 70) + '] vs [' + cut(o || '', 70) + ']'); }));
  if (JSON.stringify(a.heat) !== JSON.stringify(b.heat)) d.push('heatmap');
  if (a.hist !== b.hist) d.push('history');
  if (a.armb !== b.armb) d.push('armb');
  if (a.provRows !== b.provRows) d.push('provisional rows ' + a.provRows + ' vs ' + b.provRows);
  return d;
}
async function mutated(browser, mutate, evalFn) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const log = { dialogs: 0, err: [], mutErr: [] };
  page.on('dialog', (d) => { log.dialogs++; d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.err.push(String(e)));
  await page.route('**/assets/data/benchmark.json', async (r) => {
    const resp = await r.fetch(); const j = await resp.json();
    try { mutate(j); } catch (e) { log.mutErr.push(String(e)); }
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
  });
  await page.goto(RES, { waitUntil: 'load' });
  await page.waitForSelector('main > section, main .error', { timeout: 20000 });
  await page.waitForTimeout(900);
  const res = await page.evaluate(evalFn);
  await ctx.close();
  return { res, log };
}
const IMG = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const BOLD = '<b id="evil-b">BOLD</b><script>window.__xss2=1</script>';
function mutateStrings(j) {
  const dt = j.domain_trust;
  dt.models[0].name = 'EVILNAME ' + IMG;
  Object.values(dt.checks).forEach((list) => list.forEach((c) => { c.text = BOLD + ' ' + c.text; c.kind = c.kind + IMG; }));
  const oldId = 'P.dedup-item', newId = 'P.dedup-item' + IMG;
  Object.values(dt.checks).forEach((list) => list.forEach((c) => { if (c.id === oldId) c.id = newId; }));
  dt.models.forEach((m) => Object.values(m.cells).forEach((cell) => { cell.failures.forEach((f) => { if (f.id === oldId) f.id = newId; }); cell.gaps.forEach((g) => { if (g.id === oldId) g.id = newId; }); }));
  dt.models[1].cells.A.verdict = '<u id="evil-u">weird</u>';
}
function mutateNumbers(j) {
  const dt = j.domain_trust;
  dt.models[0].runs.opencode = '<i id="evil-n1">1</i>';
  dt.models[0].runs.pi = '<i id="evil-n2">1</i>';
  dt.models[0].runs.total = '<i id="evil-n3">2</i>';
  const cell = dt.models[2].cells.D;
  cell.failures[0].failed = '<i id="evil-n4">1</i>';
  cell.failures[0].graded = '<i id="evil-n5">9</i>';
  dt.rule.n_min = '<i id="evil-n6">2</i>';
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  info('browser', 'Chrome ' + browser.version());
  try {
    // ---------- S8: score table equals the base export ----------
    const baseHtml = execFileSync('git', ['-C', WT, 'show', BASE + ':docs/results.html'], { maxBuffer: 1e8 }).toString();
    const baseJsonTxt = execFileSync('git', ['-C', WT, 'show', BASE + ':docs/assets/data/benchmark.json'], { maxBuffer: 1e8 }).toString();
    const baseGen = JSON.parse(baseJsonTxt).generated_at;
    const headJsonTxt = fs.readFileSync(WT + '/docs/assets/data/benchmark.json', 'utf8');
    const headJ = JSON.parse(headJsonTxt);
    info('S8 inputs', { baseGeneratedAt: baseGen, headGeneratedAt: headJ.generated_at, baseHasTrust: !baseHtml.includes('Domain trust'), headScoreRows: headJ.models.length });
    const head = await renderScore(browser, {});
    const base = await renderScore(browser, { html: baseHtml, json: baseJsonTxt });
    const d1 = diffSnap(head.snap, base.snap);
    headJ.generated_at = baseGen;
    const headSameClock = await renderScore(browser, { json: JSON.stringify(headJ) });
    const d2 = diffSnap(headSameClock.snap, base.snap);
    info('S8 score table rows (HEAD)', head.snap.rows.map((r) => r[0] + ' ' + r[1].slice(0, 22) + ' score=' + r[2].slice(0, 12)).join(' | '));
    rec('S8 score table, heatmap, history and Skills note equal the base export (same clock) ', d2.length === 0 && head.snap.rows.length === base.snap.rows.length, { realClockDiffs: d1.slice(0, 6), sameClockDiffs: d2.slice(0, 6), headRows: head.snap.rows.length, baseRows: base.snap.rows.length, headProvisionalRows: head.snap.provRows, baseProvisionalRows: base.snap.provRows, baseHasNoTrustSection: !base.snap.hasTrust, headHasTrustSection: head.snap.hasTrust });
    info('console HEAD vs BASE', { headConsole: head.log.con, headHttp: head.log.bad, headErr: head.log.err, baseConsole: base.log.con, baseHttp: base.log.bad, baseErr: base.log.err });
    const stub = await renderScore(browser, { favicon: true });
    rec('S10 the only console error is the favicon.ico 404 (same on the base page)', head.log.con.length === 1 && head.log.bad.length === 1 && /favicon\.ico/.test(head.log.bad[0]) && base.log.bad.length === 1 && /favicon\.ico/.test(base.log.bad[0]) && stub.log.con.length === 0 && head.log.err.length === 0, { headBad: head.log.bad, baseBad: base.log.bad, stubbedFaviconConsole: stub.log.con });

    // ---------- escape: strings ----------
    const sEv = () => ({
      xss: window.__xss || 0, xss2: window.__xss2 || 0,
      imgs: document.querySelectorAll('#domain-trust img').length,
      evilB: !!document.getElementById('evil-b'), evilU: !!document.getElementById('evil-u'),
      scripts: document.querySelectorAll('#domain-trust script').length,
      rowHead: document.querySelector('#trust-table tbody tr th').textContent.replace(/\s+/g, ' ').trim().slice(0, 90),
      weirdCell: document.querySelector('#trust-table tbody tr:nth-child(2) td').textContent,
      failLiteralB: document.getElementById('trust-failures').textContent.includes('<b id="evil-b">BOLD</b>'),
      failLiteralImg: document.getElementById('trust-failures').textContent.includes('<img src=x'),
      idLiteral: document.getElementById('trust-failures').textContent.includes('P.dedup-item<img src=x'),
      failItems: document.querySelectorAll('#trust-failures li').length,
    });
    const sr = await mutated(browser, mutateStrings, sEv);
    rec('ESC strings: model name, check id, kind, text and verdict render as literal text', sr.log.mutErr.length === 0 && sr.res.xss === 0 && sr.res.xss2 === 0 && sr.res.imgs === 0 && !sr.res.evilB && !sr.res.evilU && sr.res.scripts === 0 && sr.res.rowHead.includes('<img src=x') && sr.res.weirdCell.includes('<u id="evil-u">weird</u>') && sr.res.failLiteralB && sr.res.failLiteralImg && sr.res.idLiteral && sr.log.dialogs === 0, { res: sr.res, dialogs: sr.log.dialogs, pageErrors: sr.log.err, mutateErrors: sr.log.mutErr });
    const nEv = () => ({ xss: window.__xss || 0, n1: !!document.getElementById('evil-n1'), n2: !!document.getElementById('evil-n2'), n3: !!document.getElementById('evil-n3'), n4: !!document.getElementById('evil-n4'), n5: !!document.getElementById('evil-n5'), n6: !!document.getElementById('evil-n6'), mainError: (document.querySelector('main .error') || { textContent: null }).textContent });
    const nr = await mutated(browser, mutateNumbers, nEv);
    const unescaped = Object.entries(nr.res).filter(([k, v]) => /^n\d$/.test(k) && v === true).map(([k]) => k);
    info('ESC numeric fields (runs.opencode, runs.pi, runs.total, failed, graded, rule.n_min)', { unescapedElementsCreated: unescaped, res: nr.res, dialogs: nr.log.dialogs, mutateErrors: nr.log.mutErr });

    // ---------- states ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await page.route('**/assets/data/benchmark.json', async (r) => { await new Promise((res) => setTimeout(res, 2500)); await r.continue(); });
      await page.goto(RES, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700);
      const loading = await page.evaluate(() => ({ loadingText: (document.querySelector('main .loading') || { textContent: null }).textContent, trustSection: !!document.getElementById('domain-trust') }));
      await page.waitForSelector('#trust-failures li', { timeout: 20000 });
      const after = await page.evaluate(() => ({ loading: !!document.querySelector('main .loading'), trustRows: document.querySelectorAll('#trust-table tbody tr').length }));
      rec('STATE loading: "Loading results…" shows first, the section appears with the data', loading.loadingText === 'Loading results…' && !loading.trustSection && !after.loading && after.trustRows === 14, { loading, after });
      await ctx.close();
    }
    const stateEv = () => ({
      error: (document.querySelector('main .error') || { textContent: null }).textContent,
      errorRole: (document.querySelector('main .error') || { getAttribute: () => null }).getAttribute('role'),
      scoreTable: !!document.getElementById('full-table'),
      trustSection: !!document.getElementById('domain-trust'),
      trustRows: document.querySelectorAll('#trust-table tbody tr').length,
      trustHeadCells: document.querySelectorAll('#trust-table thead th').length,
      failuresText: document.getElementById('trust-failures') ? document.getElementById('trust-failures').textContent.replace(/\s+/g, ' ').trim() : null,
      hint: !!document.querySelector('#domain-trust .scroll-hint'),
    });
    const sAbort = await mutated(browser, () => {}, stateEv).catch((e) => ({ res: { error: 'harness: ' + e.message }, log: {} }));
    void sAbort;
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(String(e)));
      await page.route('**/assets/data/benchmark.json', (r) => r.abort());
      await page.goto(RES, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('main .error', { timeout: 20000 });
      const res = await page.evaluate(stateEv);
      rec('STATE error: a failed data request shows one readable message', /Could not load benchmark data/.test(res.error || '') && !res.trustSection && errs.length === 0, { res, pageErrors: errs });
      await ctx.close();
    }
    const missing = await mutated(browser, (j) => { delete j.domain_trust; }, stateEv);
    info('STATE domain_trust block absent (legacy partial export)', missing.res);
    const empty = await mutated(browser, (j) => { j.domain_trust.models = []; }, stateEv);
    info('STATE domain_trust.models is empty', empty.res);
    const malformed = await mutated(browser, (j) => { j.domain_trust = { schema: 1, rule: { n_min: 2 } }; }, stateEv);
    info('STATE domain_trust malformed (no models, no checks)', malformed.res);

    // ---------- methodology page ----------
    for (const [w, h, mobile] of [[1280, 900, false], [390, 844, true]]) {
      const L = String(w);
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(String(e)));
      await page.goto(METH, { waitUntil: 'load' });
      await page.waitForSelector('#domain-trust h2', { timeout: 20000 });
      await page.waitForTimeout(600);
      const M = await page.evaluate(() => {
        const norm = (s) => s.replace(/\s+/g, ' ').trim();
        const sec = document.getElementById('domain-trust');
        const rows = [...sec.querySelectorAll('table tbody tr')].map((tr) => [...tr.children].map((c) => norm(c.textContent)));
        const ol = sec.querySelector('ol'); const wrap = sec.querySelector('.table-wrap'); const de = document.documentElement;
        const sy = window.scrollY; const r = sec.getBoundingClientRect();
        return {
          count: document.querySelectorAll('#domain-trust').length, nested: sec.querySelectorAll('section').length,
          h2: norm(sec.querySelector('h2').textContent), h3: [...sec.querySelectorAll('h3')].map((x) => norm(x.textContent)),
          ol: ol ? [...ol.querySelectorAll('li')].map((li) => norm(li.textContent).slice(0, 22)) : null,
          probeRows: rows.length, rowShapeOk: rows.every((x) => x.length === 3), firstRow: rows[0], lastRow: rows[rows.length - 1],
          notGraded: /not graded/i.test(sec.textContent), nmin: /N_MIN/.test(sec.textContent),
          kinds: ['spec', 'robustness', 'performance'].every((k) => new RegExp('\\b' + k + '\\b', 'i').test(sec.textContent)),
          iw: window.innerWidth, docScrollW: de.scrollWidth, wrapSw: wrap ? wrap.scrollWidth : null, wrapCw: wrap ? wrap.clientWidth : null,
          box: { y: r.y + sy, h: r.height },
        };
      });
      const orderOk = M.ol && M.ol.length === 4 && /^risk/i.test(M.ol[0]) && /^unproven/i.test(M.ol[1]) && /^unoptimized/i.test(M.ol[2]) && /^safe/i.test(M.ol[3]);
      rec('METH section id="domain-trust": ordered verdict list, 15-row probe table, not graded, N_MIN @' + L, M.count === 1 && M.nested === 0 && orderOk && M.probeRows === 15 && M.rowShapeOk && M.notGraded && M.nmin && M.kinds && M.docScrollW <= M.iw && errs.length === 0, M);
      const shot = mobile ? 'ux-p3-r2-methodology-390.png' : 'ux-p3-r2-methodology.png';
      await page.screenshot({ path: path.join(OUT, shot), fullPage: true, clip: { x: 0, y: Math.max(0, M.box.y - 6), width: w, height: Math.min(M.box.h + 12, mobile ? 2600 : 1500) } });
      info('screenshot methodology @' + L, shot);
      await ctx.close();
    }
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(RES, { waitUntil: 'load' });
      await page.waitForSelector('#trust-failures li', { timeout: 20000 });
      await Promise.all([page.waitForURL('**/methodology.html#domain-trust', { timeout: 15000 }), page.locator('#domain-trust .section-lede a').click()]);
      await page.waitForSelector('#domain-trust h2', { timeout: 15000 });
      await page.waitForTimeout(700);
      const measure = () => page.evaluate(() => { const nav = document.querySelector('.site-nav').getBoundingClientRect(); const t = location.hash.slice(1); const el = document.getElementById(t); const h = el.querySelector('h2').getBoundingClientRect(); return { hash: location.hash, navBottom: Math.round(nav.bottom), sectionTop: Math.round(el.getBoundingClientRect().top), h2Top: Math.round(h.top), h2Bottom: Math.round(h.bottom), scrollY: Math.round(window.scrollY) }; });
      const a1 = await measure();
      await page.evaluate(() => { location.hash = '#sources'; });
      await page.waitForTimeout(500);
      const a2 = await measure();
      info('ANCHOR landing position (sticky nav bottom vs section top / h2)', { domainTrust: a1, sourcesForComparison: a2 });
      rec('LINK click lands on methodology.html#domain-trust and the section heading is on screen', a1.hash === '#domain-trust' && a1.h2Bottom > 0 && a1.h2Top < 900, a1);
      await ctx.close();
    }

    // ---------- contrast of the new text, link style, domain titles ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(RES, { waitUntil: 'load' });
      await page.waitForSelector('#trust-failures li', { timeout: 20000 });
      await page.waitForTimeout(800);
      const C = await page.evaluate(async () => {
        const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); const p = m[1].split(',').map((s) => parseFloat(s)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
        const blend = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
        const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
        const eff = (el) => { const st = []; let p = el; while (p) { st.push(parse(getComputedStyle(p).backgroundColor)); p = p.parentElement; } let bg = { r: 255, g: 255, b: 255, a: 1 }; for (let i = st.length - 1; i >= 0; i--) bg = st[i].a > 0 ? blend(st[i], bg) : bg; return bg; };
        const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b); return Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100; };
        const col = (el) => parse(getComputedStyle(el).color);
        const sec = document.getElementById('domain-trust');
        const p = sec.querySelector('.section-lede'); const a = p.querySelector('a'); const bgP = eff(p);
        const li = sec.querySelector('#trust-failures li'); const ul = sec.querySelector('#trust-failures ul'); const st = li.querySelector('strong');
        const sub = sec.querySelector('.subline'); const hint = sec.querySelector('.scroll-hint');
        const csA = getComputedStyle(a);
        const dom = await (await fetch('./assets/data/benchmark.json')).json();
        const heatTh = [...document.querySelectorAll('#heatmap thead th[title]')].map((t) => t.textContent.trim() + '=' + t.getAttribute('title'));
        return {
          ledeText: ratio(blend(col(p), bgP), bgP), linkOnBg: ratio(blend(col(a), bgP), bgP), linkVsText: ratio(col(a), col(p)),
          linkDecoration: csA.textDecorationLine, linkWeight: csA.fontWeight,
          failListText: ratio(blend(col(ul), eff(li)), eff(li)), failStrong: ratio(blend(col(st), eff(li)), eff(li)),
          subline: ratio(blend(col(sub), eff(sub)), eff(sub)), hint: ratio(blend(col(hint), eff(hint)), eff(hint)),
          trustHeadTitles: sec.querySelectorAll('#trust-table thead th[title]').length, trustHeadAria: sec.querySelectorAll('#trust-table thead th[aria-label], #trust-table thead th abbr').length,
          heatmapHeadTitles: heatTh.slice(0, 8), domainsInData: Object.fromEntries(Object.entries(dom.domains || {}).map(([k, v]) => [k, v.title])),
          domainWordsNearMatrix: /domain\s+[A-H]\b|status badge|catalogue|detail page|checkout|api/i.test(sec.querySelector('.section-lede').textContent),
        };
      });
      info('CONTRAST + labels', C);
      await ctx.close();
    }

    // ---------- 320 px reflow ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(RES, { waitUntil: 'load' });
      await page.waitForSelector('#trust-failures li', { timeout: 20000 });
      await page.waitForTimeout(800);
      const R = await page.evaluate(() => { const de = document.documentElement; const wrap = document.querySelector('#domain-trust .table-wrap'); return { iw: window.innerWidth, docScrollW: de.scrollWidth, wrapSw: wrap.scrollWidth, wrapCw: wrap.clientWidth, failW: document.getElementById('trust-failures').scrollWidth, failCw: document.getElementById('trust-failures').clientWidth }; });
      rec('REFLOW at 320 px: no page-level horizontal scroll, matrix scrolls in its own box', R.docScrollW <= R.iw && R.wrapSw > R.wrapCw && R.failW <= R.failCw, R);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log('SUMMARY pass=' + nPass + ' fail=' + nFail);
})().catch((e) => { console.error('SCRIPT_ERROR', (e && e.stack) || e); process.exit(1); });
