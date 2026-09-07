-- Local embedding vectors are stored as JSON while pgvector is unavailable.
-- This keeps the semantic-search feature fully local and migration-safe.
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS embedding_json JSONB;

CREATE INDEX IF NOT EXISTS document_chunks_embedding_json_idx
  ON document_chunks USING GIN (embedding_json)
  WHERE embedding_json IS NOT NULL;
