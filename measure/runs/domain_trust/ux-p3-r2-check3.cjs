const fs = require('fs');
const { chromium } = require('/home/daniebo/.nvm/versions/node/v24.19.0/lib/node_modules/@playwright/test/node_modules/playwright-core');
const WT = '/home/daniebo/Desktop/lending-desk-bench-trust';
const RES = 'http://127.0.0.1:8767/results.html';
const METH = 'http://127.0.0.1:8767/methodology.html';
const cut = (d, n) => { const s = typeof d === 'string' ? d : JSON.stringify(d); return s && s.length > n ? s.slice(0, n) + '...' : s; };
const info = (id, detail) => console.log('INFO ' + id + ' :: ' + cut(detail, 1500));
const rec = (id, ok, detail) => console.log((ok ? 'PASS ' : 'FAIL ') + id + ' :: ' + cut(detail, 1500));

async function settle(page) {
  let last = -1, same = 0;
  for (let i = 0; i < 40; i++) {
    const y = await page.evaluate(() => Math.round(window.scrollY));
    if (y === last) { same++; if (same >= 4) return y; } else { same = 0; last = y; }
    await page.waitForTimeout(150);
  }
  return last;
}
const measure = (page, id) => page.evaluate((target) => {
  const nav = document.querySelector('.site-nav').getBoundingClientRect();
  const el = document.getElementById(target); const h = el.querySelector('h2').getBoundingClientRect();
  return { navBottom: Math.round(nav.bottom), sectionTop: Math.round(el.getBoundingClientRect().top), h2Top: Math.round(h.top), h2Bottom: Math.round(h.bottom), scrollY: Math.round(window.scrollY), vh: window.innerHeight, smooth: getComputedStyle(document.documentElement).scrollBehavior };
}, id);
async function consoleOnLoad(opts) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const con = [], bad = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') con.push(m.type() + ': ' + m.text()); });
  const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
  cdp.on('Network.responseReceived', (e) => { if (e.response.status >= 400) bad.push(e.response.status + ' ' + e.response.url); });
  if (opts.html) await page.route('**/results.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: opts.html }));
  await page.goto(RES, { waitUntil: 'load' });
  await page.waitForSelector('#arm-b-note h2', { timeout: 20000 });
  await page.waitForTimeout(1200);
  await browser.close();
  return { con, bad };
}
(async () => {
  // Is the favicon request an artifact of how the document is loaded? Same HEAD html, served by the network vs fulfilled by the test.
  const headHtml = fs.readFileSync(WT + '/docs/results.html', 'utf8');
  const net = await consoleOnLoad({});
  const ful = await consoleOnLoad({ html: headHtml });
  info('HEAD page, document from the network (fresh browser)', net);
  info('HEAD page, same html fulfilled by the test harness (fresh browser)', ful);
  rec('FAVICON the 404 shows only when the document comes from the network; the fulfilled copy shows none', net.bad.length === 1 && /favicon\.ico/.test(net.bad[0]) && ful.bad.length === 0, { network: net, fulfilled: ful });

  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const [w, hgt, mobile] of [[1280, 900, false], [390, 844, true]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto(RES, { waitUntil: 'load' });
      await page.waitForSelector('#trust-failures li', { timeout: 20000 });
      await page.waitForTimeout(800);
      await Promise.all([page.waitForURL('**/methodology.html#domain-trust', { timeout: 15000 }), page.locator('#domain-trust .section-lede a').click()]);
      await page.waitForSelector('#domain-trust h2', { timeout: 15000 });
      await page.waitForTimeout(1500);
      await settle(page);
      const a1 = await measure(page, 'domain-trust');
      await page.goto(METH + '#sources', { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      await settle(page);
      const a2 = await measure(page, 'sources');
      info('anchor landing, reduced motion @' + w, { domainTrustViaLink: a1, sourcesDirectLoadForComparison: a2 });
      rec('ANCHOR the link target is in view and its heading sits below the sticky nav @' + w, a1.sectionTop >= 0 && a1.sectionTop < a1.vh && a1.h2Top >= a1.navBottom, { viaLink: a1, headingUnderNav: a1.h2Top < a1.navBottom, sourcesHeadingUnderNavToo: a2.h2Top < a2.navBottom });
      await ctx.close();
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error('SCRIPT_ERROR', (e && e.stack) || e); process.exit(1); });
