import { createHash } from "node:crypto";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

export type ProtectedTreeSnapshot = {
  schema: 1;
  files: readonly string[];
  sha256: string;
};

const TOP_LEVEL_EXCLUSIONS = new Set([".git", ".next", "node_modules"]);

type ProtectedEntry = {
  path: string;
  kind:
    | "directory"
    | "file"
    | "symlink"
    | "block-device"
    | "character-device"
    | "fifo"
    | "socket"
    | "unknown";
};

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function protectedEntries(root: string): ProtectedEntry[] {
  const entries: ProtectedEntry[] = [];

  const walk = (directory: string, parent = ""): void => {
    const children = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => comparePaths(left.name, right.name));

    for (const child of children) {
      const path = parent ? `${parent}/${child.name}` : child.name;
      if (parent === "" && TOP_LEVEL_EXCLUSIONS.has(child.name)) continue;
      if (child.name.endsWith(".tsbuildinfo")) continue;

      const absolute = join(directory, child.name);
      if (child.isDirectory()) {
        entries.push({ path, kind: "directory" });
        walk(absolute, path);
      } else if (child.isFile()) {
        entries.push({ path, kind: "file" });
      } else if (child.isSymbolicLink()) {
        entries.push({ path, kind: "symlink" });
      } else {
        const kind = child.isBlockDevice() ? "block-device"
          : child.isCharacterDevice() ? "character-device"
            : child.isFIFO() ? "fifo"
              : child.isSocket() ? "socket"
                : "unknown";
        entries.push({ path, kind });
      }
    }
  };

  walk(root);
  return entries;
}

export function snapshotProtectedTree(root: string): ProtectedTreeSnapshot {
  const entries = protectedEntries(root);
  const hash = createHash("sha256");

  for (const entry of entries) {
    hash.update(entry.path);
    hash.update("\0");
    hash.update(entry.kind);
    hash.update("\0");
    const absolute = join(root, entry.path);
    if (entry.kind === "file") {
      hash.update(readFileSync(absolute));
    } else if (entry.kind === "symlink") {
      hash.update(readlinkSync(absolute));
    }
    hash.update("\0");
  }

  return {
    schema: 1,
    files: entries.filter((entry) => entry.kind === "file" || entry.kind === "symlink").map((entry) => entry.path),
    sha256: hash.digest("hex"),
  };
}

export function protectedTreeUnchanged(
  before: ProtectedTreeSnapshot,
  root: string,
): boolean {
  const after = snapshotProtectedTree(root);
  return before.schema === 1 &&
    before.sha256 === after.sha256 &&
    before.files.length === after.files.length &&
    before.files.every((file, index) => file === after.files[index]);
}
