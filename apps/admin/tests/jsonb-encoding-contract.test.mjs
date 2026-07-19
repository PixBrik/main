import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

// postgres.js double-encodes string params bound to json/jsonb-typed placeholders:
// the server types `${...}::jsonb` as jsonb, so the driver JSON-encodes the already
// stringified value again and the column stores a jsonb STRING whose `->` lookups
// return NULL silently. Stringified params must be typed `::text::jsonb` so the
// server parses the JSON exactly once.
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SCAN_ROOTS = ["../src", "../scripts"];

// An interpolation terminator cast straight to json/jsonb. SQL literals such as
// `'{}'::jsonb` and repairs such as `(col #>> '{}')::jsonb` never put the closing
// brace directly before the cast, so every match is a double-encoding hazard.
const UNSAFE_CAST = /\}\s*::json\b|\}\s*::jsonb\b/gi;

async function sourceFiles(root) {
  const directory = fileURLToPath(new URL(root, import.meta.url));
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

test("no stringified param is cast to json/jsonb without the ::text guard", async () => {
  const violations = [];
  for (const root of SCAN_ROOTS) {
    for (const file of await sourceFiles(root)) {
      const content = await readFile(file, "utf8");
      for (const match of content.matchAll(UNSAFE_CAST)) {
        const line = content.slice(0, match.index).split("\n").length;
        violations.push(`${file}:${line} → ${match[0].trim()}`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Found \${...}::jsonb params without the ::text guard (use \${JSON.stringify(x)}::text::jsonb):\n${violations.join("\n")}`
  );
});

test("known jsonb writers keep the ::text::jsonb form", async () => {
  const webhook = await readFile(new URL("../src/lib/email/webhooks.ts", import.meta.url), "utf8");
  assert.match(webhook, /INSERT INTO pixbrik\.email_delivery_event[\s\S]*?::text::jsonb/);
  assert.doesNotMatch(webhook, /stringify\([^\n]*\)\s*\}\s*::jsonb/);
});
