/**
 * One header on every public page.
 *
 * The test reads each published page under docs/. It checks the nav labels,
 * the link order, the link targets, and the header block. The active link and
 * the path prefix may differ. The generator templates must use the same set.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const DOCS = join(ROOT, "docs");
const HARNESS = join(ROOT, "harness");
const LABELS = ["Overview", "Methodology", "Results", "Real work", "Review", "Models", "Tracks"];
const ROOT_HREFS = [
  "./", "./methodology.html", "./results.html", "./real-work.html",
  "./review.html", "./models/", "./tracks.html",
];
const MODEL_HREFS = [
  "../", "../methodology.html", "../results.html", "../real-work.html",
  "../review.html", "./", "../tracks.html",
];

function pages(folder = DOCS, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(folder).sort()) {
    const path = join(folder, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(path).isDirectory()) out.push(...pages(path, rel));
    else if (name.endsWith(".html")) out.push(rel);
  }
  return out;
}

function navOf(html: string): string {
  const found = html.match(/  <nav class="site-nav">[\s\S]*?  <\/nav>/);
  expect(found, "one site nav block per page").not.toBeNull();
  return found![0];
}

function linkParts(nav: string): { labels: string[]; hrefs: string[] } {
  const links = nav.match(/<div class="nav-links">([\s\S]*?)<\/div>/)?.[1] ?? "";
  const anchors = [...links.matchAll(/<a([^>]*)>([^<]+)<\/a>/g)];
  return {
    labels: anchors.map((m) => m[2].trim()),
    hrefs: anchors.map((m) => m[1].match(/href="([^"]+)"/)?.[1] ?? ""),
  };
}

const PAGE_LIST = pages();

describe("one nav on every public page", () => {
  it("shows the same seven labels in the same order", () => {
    expect(PAGE_LIST.length).toBeGreaterThan(0);
    for (const rel of PAGE_LIST) {
      const html = readFileSync(join(DOCS, rel), "utf8");
      expect(html.match(/<nav class="site-nav">/g)?.length, `${rel}: nav count`).toBe(1);
      const nav = navOf(html);
      expect(linkParts(nav).labels, `${rel}: nav labels`).toEqual(LABELS);
      expect(nav, `${rel}: brand link`).toContain(
        `<a class="brand" href="${rel.startsWith("models/") ? "../" : "./"}"><span class="brand-mark"></span> Lending Desk Bench</a>`,
      );
      expect(nav.match(/class="active"/g)?.length, `${rel}: one active link`).toBe(1);
    }
  });

  it("uses only the root or the models path prefix", () => {
    for (const rel of PAGE_LIST) {
      const html = readFileSync(join(DOCS, rel), "utf8");
      const expected = rel.startsWith("models/") ? MODEL_HREFS : ROOT_HREFS;
      expect(linkParts(navOf(html)).hrefs, `${rel}: nav targets`).toEqual(expected);
    }
  });

  it("resolves every nav target on disk", () => {
    for (const rel of PAGE_LIST) {
      const html = readFileSync(join(DOCS, rel), "utf8");
      for (const href of linkParts(navOf(html)).hrefs) {
        expect(existsSync(resolve(dirname(join(DOCS, rel)), href)), `${rel}: ${href}`).toBe(true);
      }
    }
  });
});

describe("one header block on every public page", () => {
  it("uses the hero header and no page-head style", () => {
    for (const rel of PAGE_LIST) {
      const html = readFileSync(join(DOCS, rel), "utf8");
      const firstHeader = html.match(/<header class="([^"]+)">/)?.[1] ?? "";
      expect(firstHeader, `${rel}: page header`).toContain("hero");
      expect(html, `${rel}: no second header style`).not.toContain("page-head");
    }
  });

  it("shows the hero fields on the real work and review pages", () => {
    for (const rel of ["real-work.html", "review.html"]) {
      const html = readFileSync(join(DOCS, rel), "utf8");
      expect(html).toContain('<header class="hero wrap">');
      expect(html).toContain('<p class="kicker">');
      expect(html).toMatch(/<header class="hero wrap">[\s\S]*?<h1>[\s\S]*?<\/h1>[\s\S]*?<p class="lede">/);
    }
  });

  it("puts the overview guide below the index hero", () => {
    const html = readFileSync(join(DOCS, "index.html"), "utf8");
    expect(html.indexOf('id="model-guide"')).toBeGreaterThan(html.indexOf('<header class="hero wrap">'));
  });
});

describe("the generators hold the same header", () => {
  it("uses the one nav in the model page template", () => {
    const source = readFileSync(join(HARNESS, "generate-model-pages.py"), "utf8");
    const template = source.match(/TEMPLATE = """([\s\S]*?)"""/)?.[1] ?? "";
    expect(linkParts(navOf(template)).labels).toEqual(LABELS);
    expect(template).toContain('<header class="hero hero-model wrap">');
  });

  it("uses the one nav and hero in the guide page templates", () => {
    for (const name of ["real-work.html", "review.html"]) {
      const html = readFileSync(join(HARNESS, "model-guide", "pages", name), "utf8");
      expect(linkParts(navOf(html)).labels, `${name}: nav labels`).toEqual(LABELS);
      expect(html).toContain('<header class="hero wrap">');
      expect(html).not.toContain("page-head");
    }
  });

  it("renders the overview guide after the hero", () => {
    const preview = readFileSync(join(HARNESS, "model-guide", "preview.sh"), "utf8");
    expect(preview).not.toContain("before the current hero");
    expect(preview).toContain('"""Put the overview section after the current hero."""');
  });
});
