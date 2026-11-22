const { chromium } = require('/home/daniebo/Desktop/lending-desk-bench/harness/node_modules/playwright');
const out = '/home/daniebo/Desktop/lending-desk-bench/measure/runs/model_guide/ux-c8c5e9e';
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const r = {};
  // 1. DOM order check on real-work
  {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    await p.goto('file:///tmp/ux-preview/real-work.html');
    r.order = await p.evaluate(() => {
      const tb = document.querySelector('[data-mg="top-block"]');
      const firstTable = document.querySelector('table');
      const els = [...document.querySelectorAll('body *')];
      return {
        topIndex: els.indexOf(tb), tableIndex: els.indexOf(firstTable),
        topText: tb ? tb.textContent.trim().replace(/\s+/g, ' ').slice(0, 400) : 'NONE',
        topTag: tb ? tb.tagName : 'NONE',
        h1: (document.querySelector('h1') || {}).textContent || 'no-h1',
        firstH2: [...document.querySelectorAll('h2')].map(h => h.textContent.trim().slice(0, 60)),
      };
    });
    // model name line counts at 390
    r.names390 = await p.evaluate(() => [...document.querySelectorAll('td')].filter(td => td.cellIndex === 0).map(td => {
      const rect = td.getBoundingClientRect();
      const cs = getComputedStyle(td);
      const lh = parseFloat(cs.lineHeight) || 16;
      return { text: td.textContent.trim().replace(/\s+/g, ' ').slice(0, 70), lines: Math.round(rect.height / lh), wrap: cs.overflowWrap + '/' + cs.wordBreak };
    }));
    // keyboard: focus first summary and toggle with keyboard
    const kb = [];
    const sum = p.locator('details > summary').first();
    await sum.focus();
    const focused = await p.evaluate(() => document.activeElement ? document.activeElement.tagName + ':' + document.activeElement.textContent.trim().slice(0, 30) : 'none');
    kb.push('focused:' + focused);
    const before = await p.evaluate(() => document.querySelector('details').open);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(300);
    const afterEnter = await p.evaluate(() => document.querySelector('details').open);
    kb.push('enterToggle:' + before + '->' + afterEnter);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(300);
    const spaceTest = await p.evaluate(() => document.querySelectorAll('details')[1].open);
    const sum2 = p.locator('details > summary').nth(1);
    await sum2.focus();
    await p.keyboard.press(' ');
    await p.waitForTimeout(300);
    const afterSpace = await p.evaluate(() => document.querySelectorAll('details')[1].open);
    kb.push('spaceToggle:' + spaceTest + '->' + afterSpace);
    // focus outline
    r.focusStyle = await p.evaluate(() => {
      const e = document.activeElement;
      const s = getComputedStyle(e);
      return { tag: e.tagName, outline: s.outlineWidth + ' ' + s.outlineStyle + ' ' + s.outlineColor, boxShadow: s.boxShadow.slice(0, 80) };
    });
    r.kb = kb;
    // mark styles
    r.marks = await p.evaluate(() => [...document.querySelectorAll('*')]
      .filter(e => e.children.length === 0 && /not allowed|not for verdicts/i.test(e.textContent || ''))
      .slice(0, 6).map(e => {
        const s = getComputedStyle(e);
        return { text: e.textContent.trim().slice(0, 40), color: s.color, size: s.fontSize, weight: s.fontWeight };
      }));
    await p.screenshot({ path: out + '/real-work-390-topblock.png' });
    await p.close();
  }
  // 2. index.html: identify second wrap table + overview position
  {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    await p.goto('file:///tmp/ux-preview/index.html');
    r.index = await p.evaluate(() => ({
      guidePos: (() => {
        const g = document.querySelector('[data-mg="guide"], section.model-guide, [aria-label="Model guide table"]');
        const hero = document.querySelector('.hero, main h1, h1');
        return { guide: !!g, heroText: hero ? hero.textContent.trim().slice(0, 80) : 'none' };
      })(),
      wraps: [...document.querySelectorAll('.table-wrap')].map(w => ({
        label: w.getAttribute('aria-label'), tab: w.getAttribute('tabindex'),
        tableHead: w.querySelector('table') ? w.querySelector('table').textContent.trim().replace(/\s+/g, ' ').slice(0, 120) : 'no-table',
        prevH: (() => { let e = w.previousElementSibling; while (e && !/^H[1-6]$/.test(e.tagName)) e = e.previousElementSibling; return e ? e.textContent.trim().slice(0, 60) : 'none'; })()
      }))
    }));
    await p.screenshot({ path: out + '/index-390.png' });
    await p.close();
  }
  // 3. screenshots at 980/1280 + footer shot
  {
    for (const vw of [980, 1280]) {
      const p = await b.newPage({ viewport: { width: vw, height: 844 } });
      await p.goto('file:///tmp/ux-preview/real-work.html');
      await p.screenshot({ path: out + '/real-work-' + vw + '-top.png' });
      await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await p.waitForTimeout(200);
      await p.screenshot({ path: out + '/real-work-' + vw + '-footer.png' });
      await p.close();
    }
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    await p.goto('file:///tmp/ux-preview/real-work.html');
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(200);
    await p.screenshot({ path: out + '/real-work-390-footer.png' });
    await p.close();
  }
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
