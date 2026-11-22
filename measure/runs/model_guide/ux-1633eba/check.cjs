const { chromium } = require('/home/daniebo/Desktop/lending-desk-bench/harness/node_modules/playwright');
const out = '/home/daniebo/Desktop/lending-desk-bench/measure/runs/model_guide/ux-1633eba';
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const results = [];
  for (const vw of [390, 980, 1280]) {
    for (const page of ['real-work.html', 'index.html']) {
      const p = await b.newPage({ viewport: { width: vw, height: 844 } });
      await p.goto('file:///tmp/ux2-preview/' + page);
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
          return (tb.compareDocumentPosition(t[0]) & 4) ? 'top-before' : 'top-after';
        })(),
        topLines: (() => {
          const tb = document.querySelector('[data-mg="top-block"]');
          if (!tb) return [];
          return [...tb.querySelectorAll('li')].map(li => li.textContent.trim().replace(/\s+/g, ' ').slice(0, 140));
        })(),
        marks: {
          na: (document.body.innerHTML.match(/not allowed/g) || []).length,
          nfv: (document.body.innerHTML.match(/not for verdicts/g) || []).length,
          noData: (document.body.innerHTML.match(/no data/g) || []).length
        },
        sentences: {
          highPass: document.body.textContent.includes('A high pass % does not mean a good checker.'),
          effort: /effort/i.test(document.querySelector('[data-mg="about-footer"], footer') ? document.querySelector('[data-mg="about-footer"], footer').textContent : ''),
          fiveTasks: document.body.textContent.includes('5 tasks or runs')
        },
        toggles: [...document.querySelectorAll('button, summary')].map(e => e.tagName + ':' + (e.textContent || '').trim().slice(0, 40)),
        footer: (() => {
          const f = document.querySelector('[data-mg="about-footer"], footer');
          return f ? f.textContent.trim().replace(/\s+/g, ' ').slice(0, 600) : 'NO-FOOTER';
        })(),
        overviewText: (() => {
          const g = document.querySelector('[aria-label="Model guide table"]');
          if (!g) return 'NO-GUIDE';
          const sec = g.closest('section, div');
          const h = document.querySelector('h1, h2');
          return document.body.textContent.replace(/\s+/g, ' ').slice(0, 0) || (sec && sec.parentElement ? sec.parentElement.textContent.trim().replace(/\s+/g, ' ').slice(0, 500) : 'NONE');
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
