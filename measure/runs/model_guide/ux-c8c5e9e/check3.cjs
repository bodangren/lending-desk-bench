const { chromium } = require('/home/daniebo/Desktop/lending-desk-bench/harness/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto('file:///tmp/ux-preview/real-work.html');
  const r = await p.evaluate(() => {
    const tables = [...document.querySelectorAll('.table-wrap > table, .table-wrap table')];
    return tables.map(t => {
      const wrap = t.closest('.table-wrap');
      const det = t.closest('details');
      const firstTd = t.querySelector('tbody td');
      const cs = firstTd ? getComputedStyle(firstTd) : null;
      const lh = cs ? parseFloat(cs.lineHeight) : 0;
      const cells = [...t.querySelectorAll('tbody td')].filter(td => td.cellIndex === 0).map(td => {
        const rect = td.getBoundingClientRect();
        return { text: td.textContent.trim().replace(/\s+/g, ' ').slice(0, 50), h: Math.round(rect.height), lines: lh ? +(rect.height / lh).toFixed(1) : 0 };
      });
      return {
        label: wrap ? wrap.getAttribute('aria-label') : 'no-wrap',
        inDetails: !!det, detailsOpen: det ? det.open : 'n/a',
        rows: cells.length, lh,
        sample: cells.slice(0, 3), worst: cells.reduce((a, c) => (c.lines > a.lines ? c : a), { lines: 0, text: '' })
      };
    });
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
