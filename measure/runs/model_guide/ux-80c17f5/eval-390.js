(() => {
  const p = [...document.querySelectorAll('p')].find(x => x.textContent.includes('SHA-256'));
  const card = p ? p.closest('.card') : null;
  const d = document.documentElement;
  const clipped = [];
  document.querySelectorAll('body *').forEach(el => {
    if (el.closest('.table-wrap')) return;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      const cs = getComputedStyle(el);
      if (cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && cs.overflowX !== 'clip') {
        clipped.push(el.tagName + '.' + (el.className || '') + ' sw' + el.scrollWidth + ' cw' + el.clientWidth + ' ox' + cs.overflowX);
      }
    }
  });
  return JSON.stringify({
    innerWidth: innerWidth,
    docScrollW: d.scrollWidth,
    docClientW: d.clientWidth,
    pExists: !!p,
    pScrollW: p ? p.scrollWidth : null,
    pClientW: p ? p.clientWidth : null,
    pHeight: p ? p.getBoundingClientRect().height : null,
    pText: p ? p.textContent : null,
    cardScrollW: card ? card.scrollWidth : null,
    cardClientW: card ? card.clientWidth : null,
    cardOverflow: card ? getComputedStyle(card).overflow : null,
    clipped: clipped
  });
})()
