-- Preserve the existing production data while moving the application-owned
-- schema from the former World name to the Learn name.
DO $$
BEGIN
  IF to_regnamespace('hara_world') IS NOT NULL
     AND to_regnamespace('hara_learn') IS NULL THEN
    EXECUTE 'ALTER SCHEMA hara_world RENAME TO hara_learn';
  END IF;
END
$$;
