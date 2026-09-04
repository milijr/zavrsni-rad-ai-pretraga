-- Core storage for uploaded academic documents and their searchable chunks.

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'master_rad',
  institution TEXT,
  faculty TEXT,
  study_program TEXT,
  field_of_study TEXT,
  mentor TEXT,
  defense_date DATE,
  document_year INTEGER CHECK (document_year BETWEEN 1900 AND 2100),
  language_code VARCHAR(16) NOT NULL DEFAULT 'sr-Latn',
  abstract_local TEXT,
  abstract_english TEXT,
  keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  original_file_name TEXT NOT NULL,
  stored_file_path TEXT,
  mime_type VARCHAR(255),
  file_size_bytes BIGINT CHECK (file_size_bytes >= 0),
  page_count INTEGER CHECK (page_count > 0),
  full_text TEXT NOT NULL,
  full_text_search TSVECTOR NOT NULL DEFAULT ''::TSVECTOR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION documents_update_full_text_search()
RETURNS TRIGGER AS $$
BEGIN
  NEW.full_text_search := to_tsvector(
    'simple',
    concat_ws(
      ' ',
      NEW.title,
      NEW.abstract_local,
      NEW.abstract_english,
      array_to_string(NEW.keywords, ' '),
      NEW.full_text
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS documents_update_full_text_search_trigger ON documents;

CREATE TRIGGER documents_update_full_text_search_trigger
BEFORE INSERT OR UPDATE OF title, abstract_local, abstract_english, keywords, full_text
ON documents
FOR EACH ROW
EXECUTE FUNCTION documents_update_full_text_search();

CREATE INDEX IF NOT EXISTS documents_full_text_search_idx
  ON documents USING GIN (full_text_search);

CREATE INDEX IF NOT EXISTS documents_document_type_idx
  ON documents (document_type);

CREATE INDEX IF NOT EXISTS documents_document_year_idx
  ON documents (document_year);

CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  content TEXT NOT NULL,
  token_count INTEGER,
  character_start INTEGER,
  character_end INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index),
  CHECK (token_count IS NULL OR token_count > 0),
  CHECK (
    character_start IS NULL OR character_end IS NULL OR character_end >= character_start
  )
);

CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx
  ON document_chunks (document_id);

-- pgvector is optional during the first local setup. If it is installed,
-- this adds the embedding column needed for semantic search.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    ALTER TABLE document_chunks
      ADD COLUMN IF NOT EXISTS embedding vector(1536);
  END IF;
END $$;

-- The vector index is created later, after embeddings have been generated.
