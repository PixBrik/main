SET LOCAL search_path TO pixbrik, pg_catalog;

DO $migration$
BEGIN
  IF current_user::text <> 'pixbrik_migrator'
    OR session_user::text <> 'pixbrik_migrator' THEN
    RAISE EXCEPTION 'migration 0008 must run directly as pixbrik_migrator';
  END IF;

  IF EXISTS (
    SELECT build_version_id
    FROM model_library_version
    GROUP BY build_version_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot enforce model-library source uniqueness while duplicate build versions exist';
  END IF;
END;
$migration$;

-- One approved production output can back only one library version. This is a
-- database invariant in addition to the application lock, so alternate writers
-- cannot publish the same source build under two customer-facing entries.
CREATE UNIQUE INDEX model_library_version_build_version_unique_idx
  ON model_library_version (build_version_id);
