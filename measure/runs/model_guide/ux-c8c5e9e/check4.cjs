const { chromium } = require('/home/daniebo/Desktop/lending-desk-bench/harness/node_modules/playwright');
const out = '/home/daniebo/Desktop/lending-desk-bench/measure/runs/model_guide/ux-c8c5e9e';
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
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto('file:///tmp/ux-preview/real-work.html');
  const r = await p.evaluate(() => {
    const mark = document.querySelector('[data-mark="not-for-verdicts"]');
    const mark2 = document.querySelector('[data-mark="not-allowed"]');
    const cell = mark ? mark.closest('td') : null;
    const cs = c => { const s = getComputedStyle(c); return { color: s.color, bg: s.backgroundColor, size: s.fontSize }; };
    const wrap = document.querySelector('.table-wrap');
    wrap.focus();
    const ws = getComputedStyle(document.activeElement);
    return {
      markNFV: mark ? cs(mark) : null,
      markNA: mark2 ? cs(mark2) : null,
      cellBg: cell ? getComputedStyle(cell).backgroundColor : null,
      pageBg: getComputedStyle(document.body).backgroundColor,
      wrapFocus: { outline: ws.outlineWidth + ' ' + ws.outlineStyle + ' ' + ws.outlineColor },
      pageLen: document.body.scrollHeight,
      hintTexts: [...document.querySelectorAll('.table-wrap')].map(w => w.nextElementSibling ? w.nextElementSibling.textContent.trim().slice(0, 60) : 'NONE'),
    };
  });
  r.contrastNFV = r.markNFV ? ratio(r.markNFV.color, r.cellBg && r.cellBg !== 'rgba(0, 0, 0, 0)' ? r.cellBg : r.pageBg) : null;
  r.contrastNA = r.markNA ? ratio(r.markNA.color, r.cellBg && r.cellBg !== 'rgba(0, 0, 0, 0)' ? r.cellBg : r.pageBg) : null;
  // open More columns on producer table and screenshot tall cells
  await p.goto('file:///tmp/ux-preview/real-work.html');
  const sums = p.locator('details > summary');
  await sums.nth(1).scrollIntoViewIfNeeded();
  await sums.nth(1).click();
  await p.waitForTimeout(300);
  await p.screenshot({ path: out + '/real-work-390-morecols.png' });
  // page length at 1280
  const p2 = await b.newPage({ viewport: { width: 1280, height: 844 } });
  await p2.goto('file:///tmp/ux-preview/real-work.html');
  r.len1280 = await p2.evaluate(() => document.body.scrollHeight);
  await p2.goto('file:///tmp/ux-preview/index.html');
  r.indexHint = await p2.evaluate(() => {
    const w = [...document.querySelectorAll('.table-wrap')].map(x => ({ label: x.getAttribute('aria-label'), next: x.nextElementSibling ? x.nextElementSibling.tagName + ':' + x.nextElementSibling.textContent.trim().slice(0, 80) : 'NONE' }));
    return w;
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
