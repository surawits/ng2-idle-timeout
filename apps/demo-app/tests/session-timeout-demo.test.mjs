import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const readme = readFileSync(resolve(root, "README.md"), "utf8");

assert.ok(
  readme.includes("ng add schematic (Sprint 6)"),
  "README is missing the Sprint 6 schematic instructions"
);

assert.ok(
  readme.includes("ng add ng2-idle-timeout-ng-add"),
  "README is missing the ng add command"
);

assert.ok(
  readme.includes("sessionTimeoutProviders"),
  "README should reference the generated providers helper"
);
