import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

import { migrationChecksumCandidates, normalizeMigrationSource } from "./migration-source.mjs";

const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL is required; never migrate with the runtime credential");

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDirectory = join(root, "migrations");
const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  connection: { application_name: "pixbrik-migrator" }
});

let migrationError;
try {
  const messages = await sql.begin(async (transaction) => {
    // A transaction-scoped lock remains bound to one PostgreSQL backend even
    // when the connection URL sits behind a transaction pooler. Keeping the
    // full batch in this transaction also makes the migration records atomic
    // with the DDL they describe.
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended('pixbrik-schema-migrations', 0))`;

    await transaction.unsafe(`
      CREATE TABLE IF NOT EXISTS public.pixbrik_schema_migration (
        filename text PRIMARY KEY,
        checksum_sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const filenames = (await readdir(migrationDirectory))
      .filter((filename) => /^\d{4}_[a-z0-9_]+\.sql$/.test(filename))
      .sort();
    const completed = [];

    for (const filename of filenames) {
      const rawSource = await readFile(join(migrationDirectory, filename), "utf8");
      const source = normalizeMigrationSource(rawSource);
      const [checksum, ...compatibleLegacyChecksums] = migrationChecksumCandidates(source);
      const existing = await transaction`
        SELECT checksum_sha256
        FROM public.pixbrik_schema_migration
        WHERE filename = ${filename}
      `;

      if (existing.length > 0) {
        if (![checksum, ...compatibleLegacyChecksums].includes(existing[0].checksum_sha256)) {
          throw new Error(`Applied migration ${filename} has changed; add a new migration instead`);
        }
        completed.push(`skip ${filename}`);
        continue;
      }

      await transaction.unsafe(source);
      await transaction`
        INSERT INTO public.pixbrik_schema_migration (filename, checksum_sha256)
        VALUES (${filename}, ${checksum})
      `;
      completed.push(`applied ${filename}`);
    }

    return completed;
  });

  for (const message of messages) process.stdout.write(`${message}\n`);
} catch (error) {
  migrationError = error;
}

try {
  await sql.end({ timeout: 5 });
} catch (error) {
  if (!migrationError) throw error;
  process.stderr.write(`database cleanup also failed: ${error instanceof Error ? error.message : String(error)}\n`);
}

if (migrationError) throw migrationError;
