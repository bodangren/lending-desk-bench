/**
 * Reads a page as a raw HTTP stream and records when each marker first appears.
 *
 * Playwright's `locator.waitFor` cannot answer "did the shell arrive before the
 * content" — its polling interval is the same order of magnitude as the thing
 * being measured, so a page that streams nothing still shows tens of ms between
 * two sequential waits. Reading the bytes off the socket measures the server's
 * actual flush order instead.
 */
import http from "node:http";

/** Same origin the Playwright project uses. */
export const BASE = process.env.PW_BASE_URL ?? "http://127.0.0.1:3000";

export type Marks = Record<string, number | undefined> & { total: number; body: string };

export function streamMarks(
  url: string,
  markers: Record<string, string | RegExp>,
  headers: Record<string, string> = {},
): Promise<Marks> {
  const u = new URL(url);
  const t0 = Date.now();
  const at: Record<string, number | undefined> = {};
  let buf = "";

  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers,
        // Own socket, closed on completion. The global agent keeps its sockets
        // alive, and a parked connection to the candidate server has been enough
        // to stall the next test's navigation.
        agent: false,
      },
      (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buf += chunk;
          for (const [name, m] of Object.entries(markers)) {
            if (at[name] !== undefined) continue;
            const hit = typeof m === "string" ? buf.includes(m) : m.test(buf);
            if (hit) at[name] = Date.now() - t0;
          }
        });
        res.on("end", () => resolve({ ...at, total: Date.now() - t0, body: buf } as Marks));
      },
    );
    req.on("error", reject);
  });
}

/** Everything that had arrived before `marker` first appeared. */
export function prefixBefore(body: string, marker: string): string {
  const i = body.indexOf(marker);
  return i === -1 ? body : body.slice(0, i);
}

/** Rough count of rendered elements, for "are there N tiles here" questions. */
export function countElements(html: string): number {
  return (html.match(/<(div|li|article|section|span|p)\b/g) ?? []).length;
}
