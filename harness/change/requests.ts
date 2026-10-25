/**
 * Change requests for the lending_desk_change track (change_bench FR-1).
 *
 * A request is new or changed behavior for the working application. Its X.*
 * criteria (tests/criteria.ts CHANGE_CRITERIA) grade it. A request may name the
 * build criteria it supersedes; those leave the regression denominator. No
 * request in the registry adds an export, so the public surface stays the clean
 * app's surface.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHANGE_CRITERIA } from "../tests/criteria.js";

export type ChangeRequest = {
  id: string;
  title: string;
  files: readonly string[];
  superseded: readonly string[];
};

export const CHANGE_REQUESTS: readonly ChangeRequest[] = [
  {
    id: "CR-1",
    title: "Catalogue status filter (?status=available|on-loan)",
    files: ["app/items/page.tsx"],
    superseded: [],
  },
  {
    id: "CR-2",
    title: "Loans API member filter (?memberId=)",
    files: ["app/api/loans/route.ts"],
    superseded: [],
  },
  {
    id: "CR-3",
    title: "Due date at most 60 days after now, in the action and the API",
    files: ["src/actions/loans.ts", "app/api/loans/route.ts"],
    superseded: [],
  },
  {
    id: "CR-4",
    title: "Detail page names the borrower and the due date of an open loan",
    files: ["app/items/[id]/page.tsx"],
    superseded: [],
  },
];

export function getRequest(id: string): ChangeRequest {
  const request = CHANGE_REQUESTS.find((candidate) => candidate.id === id);
  if (!request) throw new Error(`unknown change request: ${id}`);
  return request;
}

/** The X.* criteria that grade one request. */
export function requestCriteria(id: string): string[] {
  return Object.entries(CHANGE_CRITERIA).filter(([, criterion]) => criterion.cr === id).map(([criterionId]) => criterionId);
}

export function changeRegistryHash(): string {
  const rows = [...CHANGE_REQUESTS]
    .map((request) => JSON.stringify({ ...request, criteria: requestCriteria(request.id).sort() }))
    .sort();
  return createHash("sha256").update(rows.join("\n")).digest("hex");
}

const SETS_DIR = resolve(import.meta.dirname, "sets");

export type ChangeSet = { schema: 1; id: string; requests: readonly string[]; notes: string };

export function changeSetPath(idOrPath: string): string {
  return idOrPath.endsWith(".json") ? resolve(idOrPath) : join(SETS_DIR, `${idOrPath}.json`);
}

export function loadChangeSet(idOrPath: string): ChangeSet {
  const path = changeSetPath(idOrPath);
  if (!existsSync(path)) throw new Error(`missing change set: ${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`malformed change set ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const record = parsed as Record<string, unknown>;
  if (typeof parsed !== "object" || parsed === null || record.schema !== 1 || typeof record.id !== "string" ||
      !Array.isArray(record.requests) || !record.requests.every((id) => typeof id === "string")) {
    throw new Error(`change set ${path} is not a schema-1 set`);
  }
  return {
    schema: 1,
    id: record.id,
    requests: record.requests as string[],
    notes: typeof record.notes === "string" ? record.notes : "",
  };
}

export function validateChangeSet(set: ChangeSet): string[] {
  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const id of set.requests) {
    if (seen.has(id)) reasons.push(`duplicate request in set ${set.id}: ${id}`);
    seen.add(id);
    try {
      getRequest(id);
      if (!requestCriteria(id).length) reasons.push(`${id} has no X.* criteria`);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
    }
  }
  return reasons;
}

/** Every X.* criterion of the set's requests, in registry order. */
export function setChangeCriteria(set: ChangeSet): string[] {
  return set.requests.flatMap((id) => requestCriteria(id));
}

export function setSuperseded(set: ChangeSet): string[] {
  return [...new Set(set.requests.flatMap((id) => getRequest(id).superseded))];
}

export function changeSetFileHash(idOrPath: string): { path: string; sha256: string } {
  const path = changeSetPath(idOrPath);
  return { path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
}
