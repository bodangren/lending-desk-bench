const { chromium } = require('/home/daniebo/Desktop/lending-desk-bench/harness/node_modules/playwright');
const out = '/home/daniebo/Desktop/lending-desk-bench/measure/runs/model_guide/ux-1633eba';
function lum(rgb) {
  const m = rgb.match(/[\d.]+/g).map(Number).slice(0, 3).map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
}
function ratio(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2);
}
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  // 390 real-work deep checks
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto('file:///tmp/ux2-preview/real-work.html');
  const r = await p.evaluate(() => {
    const tb = document.querySelector('[data-mg="top-block"]');
    const lis = [...tb.querySelectorAll('li')].map(li => {
      const rect = li.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(li).lineHeight) || 16;
      return { text: li.textContent.trim().replace(/\s+/g, ' ').slice(0, 100), h: Math.round(rect.height), lines: +(rect.height / lh).toFixed(1) };
    });
    const noData = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.textContent || '').trim() === 'no data').slice(0, 4).map(e => {
      const s = getComputedStyle(e);
      return { color: s.color, size: s.fontSize, bg: getComputedStyle(e.closest('td') || document.body).backgroundColor, cellText: e.closest('tr') ? e.closest('tr').textContent.trim().replace(/\s+/g, ' ').slice(0, 80) : '' };
    });
    const body = document.body.textContent;
    const hp = body.indexOf('A high pass % does not mean a good checker.');
    const hpCtx = body.slice(Math.max(0, hp - 200), hp + 120).replace(/\s+/g, ' ');
    const names = [...document.querySelectorAll('td')].filter(td => td.cellIndex === 0 && td.closest('.table-wrap[aria-label="Producer roles table"], .table-wrap[aria-label="Checker roles table"]')).map(td => {
      const rect = td.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(td).lineHeight) || 16;
      return { text: td.textContent.trim().replace(/\s+/g, ' ').slice(0, 50), lines: +(rect.height / lh).toFixed(1) };
    });
    const worst = names.reduce((a, c) => (c.lines > a.lines ? c : a), { lines: 0, text: '' });
    return { lis, noData, hpCtx, nameCount: names.length, worstName: worst, nameSample: names.slice(0, 6) };
  });
  r.noDataContrast = r.noData.map(n => ratio(n.color, n.bg && n.bg !== 'rgba(0, 0, 0, 0)' ? n.bg : 'rgb(10, 13, 18)'));
  // keyboard toggle + focus
  const kb = [];
  const sum = p.locator('details > summary').first();
  await sum.focus();
  kb.push('focused:' + await p.evaluate(() => document.activeElement.textContent.trim().slice(0, 30)));
  const before = await p.evaluate(() => document.querySelector('details').open);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  kb.push('enter:' + before + '->' + await p.evaluate(() => document.querySelector('details').open));
  r.kb = kb;
  r.focusStyle = await p.evaluate(() => {
    const s = getComputedStyle(document.activeElement);
    return { tag: document.activeElement.tagName, outline: s.outlineWidth + ' ' + s.outlineStyle };
  });
  await p.screenshot({ path: out + '/real-work-390-picks.png' });
  // scroll to checker section (high-pass sentence) and screenshot
  await p.evaluate(() => {
    const els = [...document.querySelectorAll('h2, p')];
    const t = els.find(e => e.textContent.includes('A high pass % does not mean a good checker.'));
    if (t) t.scrollIntoView({ block: 'center' });
  });
  await p.waitForTimeout(200);
  await p.screenshot({ path: out + '/real-work-390-checkernote.png' });
  // footer screenshot
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(200);
  await p.screenshot({ path: out + '/real-work-390-footer.png' });
  await p.close();
  // 980 + 1280 tops and footers
  for (const vw of [980, 1280]) {
    const q = await b.newPage({ viewport: { width: vw, height: 844 } });
    await q.goto('file:///tmp/ux2-preview/real-work.html');
    r['len' + vw] = await q.evaluate(() => document.body.scrollHeight);
    await q.screenshot({ path: out + '/real-work-' + vw + '-top.png' });
    await q.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await q.waitForTimeout(200);
    await q.screenshot({ path: out + '/real-work-' + vw + '-footer.png' });
    await q.close();
  }
  // index overview at 390 and 1280
  const i1 = await b.newPage({ viewport: { width: 390, height: 844 } });
  await i1.goto('file:///tmp/ux2-preview/index.html');
  await i1.screenshot({ path: out + '/index-390.png' });
  await i1.close();
  const i2 = await b.newPage({ viewport: { width: 1280, height: 844 } });
  await i2.goto('file:///tmp/ux2-preview/index.html');
  await i2.screenshot({ path: out + '/index-1280-top.png' });
  await i2.close();
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
