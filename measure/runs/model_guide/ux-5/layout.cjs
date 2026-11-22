const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const userDataDir = "/tmp/ux5-chrome-cdp";
const urls = {
  review: "file:///home/daniebo/Desktop/lending-desk-bench/docs/review.html",
  index: "file:///home/daniebo/Desktop/lending-desk-bench/docs/index.html",
  realWork: "file:///home/daniebo/Desktop/lending-desk-bench/docs/real-work.html",
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFile(file, child, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`Chrome exited early: ${child.exitCode}`);
    try {
      return await fsp.readFile(file, "utf8");
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function main() {
  await fsp.rm(userDataDir, { recursive: true, force: true });
  const chrome = spawn("/usr/bin/google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--hide-scrollbars",
    "--window-size=1280,2400",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  chrome.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  let socket;
  try {
    const activePort = await waitForFile(path.join(userDataDir, "DevToolsActivePort"), chrome);
    const [port] = activePort.trim().split(/\r?\n/);
    const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
    if (!response.ok) throw new Error(`DevTools target creation failed: ${response.status}`);
    const target = await response.json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression, returnByValue = true) => {
      const result = await cdp("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue,
        ...(returnByValue ? {} : { generatePreview: true }),
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value ?? result.result;
    };
    await cdp("Page.enable");
    await cdp("Runtime.enable");
    await cdp("Accessibility.enable");
    const facts = [];
    for (const [page, url] of Object.entries(urls)) {
      for (const width of [390, 1280]) {
        await cdp("Emulation.setDeviceMetricsOverride", {
          width, height: 2400, deviceScaleFactor: 1, mobile: width === 390,
        });
        await cdp("Page.navigate", { url });
        const readyDeadline = Date.now() + 10000;
        let ready = false;
        while (Date.now() < readyDeadline) {
          ready = await evaluate("document.readyState === 'complete' && !!document.body");
          if (ready) break;
          await delay(150);
        }
        if (!ready) throw new Error(`Document did not finish loading: ${url}`);
        const dom = await evaluate(`(() => {
          const nav = document.querySelector('nav');
          const links = [...(nav?.querySelectorAll('a') || [])];
          const routeTable = document.querySelector('[data-mg="review-table"]');
          const routeBox = routeTable?.closest('.table-wrap');
          const routeRows = [...(routeTable?.querySelectorAll('tbody tr') || [])].map(row => ({
            route: row.cells?.item(0)?.textContent?.trim() ?? '',
            cells: [...row.cells].slice(1).map(cell => cell.textContent?.trim() ?? '')
          }));
          const method = document.querySelector('[data-mg="review-method"]');
          const routeCell = routeTable?.querySelector('tbody tr td.routes');
          const tableRegion = routeBox;
          const bodyText = document.body.innerText;
          const internalHits = ['PM 2026', 'nights 1 and 2'].filter(term => bodyText.includes(term));
          return {
            title: document.title,
            viewport: { width: innerWidth, height: innerHeight },
            page: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
            nav: { review: links.filter(a => a.textContent.trim() === 'Review').length, realWork: links.filter(a => a.textContent.trim() === 'Real work').length },
            routeRows,
            routeColumn: routeCell ? { width: Math.round(routeCell.getBoundingClientRect().width), minWidth: getComputedStyle(routeCell).minWidth } : null,
            routeBox: routeBox ? { clientWidth: routeBox.clientWidth, scrollWidth: routeBox.scrollWidth, overflowX: getComputedStyle(routeBox).overflowX, tabIndex: routeBox.tabIndex, role: routeBox.getAttribute('role'), label: routeBox.getAttribute('aria-label') } : null,
            method: method ? { text: method.innerText, width: Math.round(method.getBoundingClientRect().width), height: Math.round(method.getBoundingClientRect().height) } : null,
            internalHits,
            indexCodeReview: ${JSON.stringify(page)} === 'index' ? document.body.innerText.match(/Code review[^\\n]*\\n[^\\n]*/)?.[0] ?? null : null,
            bodyTextLength: bodyText.length
          };
        })()`);
        const ax = await cdp("Accessibility.getFullAXTree");
        const nodes = ax.nodes || [];
        const roleCount = (role) => nodes.filter(node => node.role?.value?.toLowerCase() === role.toLowerCase()).length;
        const snapshot = {
          nodes: nodes.length,
          navigation: roleCount("navigation"),
          main: roleCount("main"),
          tables: roleCount("table"),
          columnHeaders: roleCount("columnHeader"),
          regions: roleCount("region"),
          links: roleCount("link"),
          unnamedLinks: nodes.filter(node => node.role?.value === "link" && !node.name?.value?.trim()).length,
        };
        let keyboard = null;
        if (page === "review" && width === 390) {
          keyboard = await evaluate(`(() => {
          const box = document.querySelector('[aria-label="Review results by route"]');
          if (!box) return null;
          box.focus();
          return { focused: document.activeElement === box, before: box.scrollLeft };
        })()`);
          await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight" });
          await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight" });
          keyboard = { ...keyboard, afterRight: await evaluate(`document.querySelector('[aria-label="Review results by route"]')?.scrollLeft ?? null`) };
          await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowLeft", code: "ArrowLeft" });
          await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowLeft", code: "ArrowLeft" });
          keyboard.afterLeft = await evaluate(`document.querySelector('[aria-label="Review results by route"]')?.scrollLeft ?? null`);
          const methodView = await evaluate(`(() => {
            const method = document.querySelector('[data-mg="review-method"]');
            method?.scrollIntoView({ block: "center", behavior: "instant" });
            document.activeElement?.blur();
            return { scrollY: window.scrollY, top: method?.getBoundingClientRect().top ?? null };
          })()`);
          await delay(200);
          const methodImage = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
          await fsp.writeFile(path.join(__dirname, "review-method-390.png"), Buffer.from(methodImage.data, "base64"));
          keyboard.methodView = methodView;
        }
        facts.push({ page, url, width, dom, accessibility: snapshot, accessibilityTree: nodes, keyboard });
      }
    }
    const output = path.join(__dirname, "layout-facts.json");
    await fsp.writeFile(output, `${JSON.stringify({ facts }, null, 2)}\n`);
    console.log(`Saved full viewport, interaction, and accessibility evidence to ${output}`);
  } finally {
    try { socket?.close(); } catch {}
    if (chrome.exitCode === null) chrome.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      delay(5000),
    ]);
    await fsp.rm(userDataDir, { recursive: true, force: true });
    if (chrome.exitCode === null) {
      console.error(stderr);
      throw new Error("Chrome did not exit after SIGTERM");
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
