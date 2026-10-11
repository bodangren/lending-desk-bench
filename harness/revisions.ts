/**
 * Model-visible fixture revision.
 *
 * r1 (2026w35–w39): the original fixture.
 * r2 (2026w40–): AGENTS.md and the spec state "do not add, rename, change, or
 *   remove" exports and forbid edits to spec.md; spec E gains the accessible-name
 *   and error-announcement checkboxes; the protected grader-only route
 *   app/api/bench-state serves the browser checks; vitest joins the fixture's
 *   dev dependencies for the tests track. vitest pulls vite, which requires
 *   postcss ^8.5.28, so the hoisted postcss moved 8.5.25 -> 8.5.28 (nanoid
 *   3.3.16 -> 3.3.19).
 *
 * A record's `fixture_revision` names the instructions the agent saw. A graft
 * regrade grades an older revision's writable files on the current tree and says
 * so in provenance (`graft`), so the two revisions share one ruler.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_REVISION = 2;

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(String(FIXTURE_REVISION));
}
