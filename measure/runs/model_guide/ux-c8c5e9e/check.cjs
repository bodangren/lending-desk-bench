const { chromium } = require('/home/daniebo/Desktop/lending-desk-bench/harness/node_modules/playwright');
const out = '/home/daniebo/Desktop/lending-desk-bench/measure/runs/model_guide/ux-c8c5e9e';
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const results = [];
  const vws = [390, 980, 1280];
  const pages = ['real-work.html', 'index.html'];
  for (const vw of vws) {
    for (const page of pages) {
      const p = await b.newPage({ viewport: { width: vw, height: 844 } });
      await p.goto('file:///tmp/ux-preview/' + page);
      const data = await p.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        wraps: [...document.querySelectorAll('.table-wrap')].map(w => ({
          sw: w.scrollWidth, cw: w.clientWidth,
          tab: w.getAttribute('tabindex'), role: w.getAttribute('role'), label: w.getAttribute('aria-label'),
          hintAfter: !!(w.nextElementSibling && /scroll/i.test(w.nextElementSibling.textContent || ''))
        })),
        order: (() => {
          const tb = document.querySelector('[data-mg="top-block"]');
          const t = document.querySelectorAll('table');
          if (!tb) return 'no-top-block';
          if (!t.length) return 'top-no-tables';
          return (tb.compareDocumentPosition(t[0]) & 4) ? 'top-after' : 'top-before';
        })(),
        marks: {
          na: (document.body.innerHTML.match(/not allowed/g) || []).length,
          nfv: (document.body.innerHTML.match(/not for verdicts/g) || []).length
        },
        toggles: [...document.querySelectorAll('button, summary')].map(e => e.tagName + ':' + (e.textContent || '').trim().slice(0, 40)),
        footer: (() => {
          const f = document.querySelector('[data-mg="about-footer"], footer');
          return f ? f.textContent.trim().replace(/\s+/g, ' ').slice(0, 250) : 'NO-FOOTER';
        })()
      }));
      results.push({ vw, page, ...data });
      await p.screenshot({ path: out + '/' + page.replace('.html', '') + '-' + vw + '.png' });
      await p.close();
    }
  }
  console.log(JSON.stringify(results, null, 1));
  await b.close();
})();
