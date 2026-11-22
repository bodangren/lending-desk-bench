const { chromium } = require('/home/daniebo/Desktop/lending-desk-bench/harness/node_modules/playwright');
const out = '/home/daniebo/Desktop/lending-desk-bench/measure/runs/model_guide/ux-1633eba';
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto('file:///tmp/ux2-preview/real-work.html');
  await p.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find(e => e.textContent.trim() === 'Checker roles');
    if (h) h.scrollIntoView();
  });
  await p.waitForTimeout(200);
  await p.screenshot({ path: out + '/real-work-390-checker.png' });
  // scroll checker table right to expose Escapes column
  await p.evaluate(() => {
    const w = document.querySelector('.table-wrap[aria-label="Checker roles table"]');
    if (w) { w.scrollTo(w.scrollWidth, 0); w.focus(); }
  });
  await p.waitForTimeout(200);
  await p.screenshot({ path: out + '/real-work-390-escapes.png' });
  await b.close();
})();
