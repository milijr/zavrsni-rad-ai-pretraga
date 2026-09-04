CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Local PostgreSQL installations on Windows often do not include pgvector.
-- The application can still start; semantic search is enabled when the
-- extension becomes available.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION
  WHEN undefined_file OR feature_not_supported THEN
    RAISE NOTICE 'pgvector is not installed; the embedding column will be added later.';
END $$;
