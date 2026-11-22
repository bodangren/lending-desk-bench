import { writeFileSync } from "node:fs";

const base = "http://127.0.0.1:8766";
const tabResponse = await fetch(`http://127.0.0.1:9333/json/new?${base}/review.html`, { method: "PUT" });
if (!tabResponse.ok) throw new Error(`new target failed: ${tabResponse.status}`);
const target = await tabResponse.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    data.error ? reject(new Error(data.error.message)) : resolve(data.result);
  }
});
function send(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
await send("Page.enable");
await send("Runtime.enable");
await send("Accessibility.enable");
const reports = [];
for (const width of [390, 1280]) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (const page of ["review.html", "index.html"]) {
    await send("Page.navigate", { url: `${base}/${page}` });
    await pause(500);
    const facts = await evaluate(`(() => {
      const text = (node) => node?.innerText?.replace(/\\\\s+/g, " ").trim() ?? null;
      const reviewRows = [...document.querySelectorAll('[data-mg="review-table"] tbody tr')];
      const table = document.querySelector('[data-mg="review-table"]');
      const wrap = table?.closest(".table-wrap");
      const codeReview = [...document.querySelectorAll("tr")].find((row) =>
        row.innerText.includes("Code review")
      );
      return {
        url: location.href,
        innerWidth,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        routeRows: reviewRows.map((row) => ({
          route: row.dataset.route,
          text: text(row.cells[0]),
          cells: [...row.cells].map(text),
        })),
        marks: [...document.querySelectorAll('[data-mg="review-route"] .mark')].map(text),
        worstCells: [...document.querySelectorAll('[data-mg="review-worst"]')].map(text),
        passItems: [...document.querySelectorAll('[data-mg="review-pass"]')].map(text),
        columnLabels: table ? [...table.querySelectorAll("thead th")].map(text) : [],
        tableLayout: table && wrap ? {
          tableWidth: table.getBoundingClientRect().width,
          wrapWidth: wrap.getBoundingClientRect().width,
          wrapClientWidth: wrap.clientWidth,
          wrapScrollWidth: wrap.scrollWidth,
          tableRows: reviewRows.map((row) => ({
            routeCellWidth: row.cells[0].getBoundingClientRect().width,
            routeCellHeight: row.cells[0].getBoundingClientRect().height,
          })),
        } : null,
        reviewNavLinkCount: [...document.querySelectorAll(".nav-links a")].filter((a) =>
          text(a) === "Review"
        ).length,
        codeReviewRow: text(codeReview),
        methodNote: text(document.querySelector('[data-mg="review-method"]')),
        focusableTableRegions: [...document.querySelectorAll('.table-wrap[tabindex="0"][role="region"]')]
          .map((node) => ({ label: node.getAttribute("aria-label"), tabIndex: node.tabIndex })),
      };
    })()`);
    const ax = await send("Accessibility.getFullAXTree");
    const axNodes = ax.nodes ?? [];
    const axSummary = {
      nodeCount: axNodes.length,
      roleCounts: axNodes.reduce((counts, node) => {
        const role = node.role?.value;
        if (role) counts[role] = (counts[role] ?? 0) + 1;
        return counts;
      }, {}),
      namedRegions: axNodes.filter((node) =>
        node.role?.value === "region" && node.name?.value
      ).map((node) => node.name.value),
      unnamedLinks: axNodes.filter((node) =>
        node.role?.value === "link" && !node.name?.value
      ).length,
    };
    let keyboard = null;
    if (page === "review.html" && width === 390) {
      const tableRegion = await evaluate(`(() => {
        const node = document.querySelector('.table-wrap[role="region"]');
        node?.focus();
        const rect = node?.getBoundingClientRect();
        return {
          activeRole: document.activeElement?.getAttribute("role"),
          before: node?.scrollLeft,
          x: rect ? rect.left + Math.min(rect.width / 2, 100) : null,
          y: rect ? rect.top + Math.min(rect.height / 2, 80) : null,
        };
      })()`);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", {
          type,
          x: tableRegion.x,
          y: tableRegion.y,
          button: "left",
          clickCount: type === "mousePressed" ? 1 : 0,
        });
      }
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "ArrowRight",
        code: "ArrowRight",
        windowsVirtualKeyCode: 39,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "ArrowRight",
        code: "ArrowRight",
        windowsVirtualKeyCode: 39,
      });
      const right = await evaluate(`document.querySelector('.table-wrap[role="region"]')?.scrollLeft ?? null`);
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "ArrowLeft",
        code: "ArrowLeft",
        windowsVirtualKeyCode: 37,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "ArrowLeft",
        code: "ArrowLeft",
        windowsVirtualKeyCode: 37,
      });
      const left = await evaluate(`document.querySelector('.table-wrap[role="region"]')?.scrollLeft ?? null`);
      keyboard = { tableRegion, afterArrowRight: right, afterArrowLeft: left };
    }
    reports.push({
      width,
      page,
      facts,
      axSummary,
      accessibilitySnapshot: axNodes,
      keyboard,
    });
  }
}
writeFileSync(
  new URL("./cdp-facts.json", import.meta.url),
  `${JSON.stringify(reports, null, 2)}\n`,
);
console.log(`Wrote ${reports.length} viewport/page reports to measure/runs/model_guide/ux-4b/cdp-facts.json`);
ws.close();
