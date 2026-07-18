import { createHash } from "node:crypto";

export function normalizeMigrationSource(source) {
  return source.replace(/\r\n?/g, "\n");
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

/**
 * New migration records always use the canonical LF checksum. The CRLF
 * candidate keeps databases migrated by the pre-canonical Windows runner
 * readable without rewriting their audit ledger.
 */
export function migrationChecksumCandidates(source) {
  const normalized = normalizeMigrationSource(source);
  return [sha256(normalized), sha256(normalized.replace(/\n/g, "\r\n"))];
}
