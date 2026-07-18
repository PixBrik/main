import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { migrationChecksumCandidates, normalizeMigrationSource } from "../scripts/migration-source.mjs";

const runner = await readFile(new URL("../scripts/migrate.mjs", import.meta.url), "utf8");
const attributes = await readFile(new URL("../../../.gitattributes", import.meta.url), "utf8");

test("migration checksums are stable across LF and CRLF checkouts", () => {
  const lf = "SET LOCAL search_path TO pixbrik, public;\nSELECT 1;\n";
  const crlf = lf.replace(/\n/g, "\r\n");

  assert.equal(normalizeMigrationSource(crlf), lf);
  assert.equal(migrationChecksumCandidates(lf)[0], migrationChecksumCandidates(crlf)[0]);
  assert.equal(migrationChecksumCandidates(lf)[1], migrationChecksumCandidates(crlf)[1]);
  assert.notEqual(migrationChecksumCandidates(lf)[0], migrationChecksumCandidates(lf)[1]);
  assert.match(attributes, /^\*\.sql text eol=lf$/m);
});

test("the migration batch and advisory lock share one transaction", () => {
  assert.match(runner, /sql\.begin\(async \(transaction\)/);
  assert.match(runner, /transaction`SELECT pg_advisory_xact_lock/);
  assert.doesNotMatch(runner, /pg_advisory_lock\(/);
  assert.doesNotMatch(runner, /pg_advisory_unlock\(/);
});

test("connection cleanup preserves a migration failure", () => {
  assert.match(runner, /catch \(error\) \{\s+migrationError = error;/);
  assert.match(runner, /if \(!migrationError\) throw error;/);
  assert.match(runner, /if \(migrationError\) throw migrationError;/);
});
