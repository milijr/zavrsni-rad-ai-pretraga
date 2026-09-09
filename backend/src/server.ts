import "dotenv/config";
import { mkdirSync, unlink } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import multer from "multer";
import { splitIntoChunks } from "./chunking.js";
import { db } from "./db.js";
import { cosineSimilarity, createEmbedding } from "./embeddings.js";
import { extractTextFromFile } from "./text-extraction.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const uploadDirectory = fileURLToPath(new URL("../uploads/", import.meta.url));

mkdirSync(uploadDirectory, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (_request, file, callback) => {
      const extension = extname(file.originalname).toLowerCase();
      callback(null, `${crypto.randomUUID()}${extension}`);
    },
  }),
  fileFilter: (_request, file, callback) => {
    const extension = extname(file.originalname).toLowerCase();
    callback(null, extension === ".pdf" || extension === ".docx");
  },
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

type DocumentInput = {
  title?: unknown;
  author?: unknown;
  documentType?: unknown;
  institution?: unknown;
  faculty?: unknown;
  studyProgram?: unknown;
  fieldOfStudy?: unknown;
  mentor?: unknown;
  defenseDate?: unknown;
  documentYear?: unknown;
  languageCode?: unknown;
  abstractLocal?: unknown;
  abstractEnglish?: unknown;
  keywords?: unknown;
  originalFileName?: unknown;
  fullText?: unknown;
};

function requiredText(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Polje '${fieldName}' je obavezno.`);
  }

  return value.trim();
}

function optionalText(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`Polje '${fieldName}' mora biti tekst.`);
  }

  return value.trim() || null;
}

function optionalYear(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1900 ||
    value > 2100
  ) {
    throw new Error("Polje 'documentYear' mora biti godina između 1900 i 2100.");
  }

  return value;
}

function optionalDate(value: unknown): string | null {
  const date = optionalText(value, "defenseDate");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Polje 'defenseDate' mora biti u formatu YYYY-MM-DD.");
  }

  return date;
}

function keywords(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value) || value.some((keyword) => typeof keyword !== "string")) {
    throw new Error("Polje 'keywords' mora biti niz tekstualnih ključnih riječi.");
  }

  return value.map((keyword) => keyword.trim()).filter(Boolean);
}

function uploadInput(body: Record<string, unknown>): DocumentInput {
  const year = typeof body.documentYear === "string" && body.documentYear.trim()
    ? Number(body.documentYear)
    : body.documentYear;
  const uploadedKeywords = typeof body.keywords === "string"
    ? body.keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean)
    : body.keywords;

  return { ...body, documentYear: year, keywords: uploadedKeywords };
}

async function saveDocumentChunks(documentId: string, fullText: string): Promise<number> {
  const chunks = splitIntoChunks(fullText);
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM document_chunks WHERE document_id = $1", [documentId]);

    for (const chunk of chunks) {
      await client.query(
        `INSERT INTO document_chunks (
          document_id, chunk_index, content, token_count, character_start, character_end
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          documentId,
          chunk.chunkIndex,
          chunk.content,
          chunk.tokenCount,
          chunk.characterStart,
          chunk.characterEnd,
        ],
      );
    }

    await client.query("COMMIT");
    return chunks.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function generateDocumentEmbeddings(documentId: string): Promise<number> {
  const chunks = await db.query<{ id: string; content: string }>(
    `SELECT id, content FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index`,
    [documentId],
  );

  for (const chunk of chunks.rows) {
    const embedding = await createEmbedding(chunk.content);
    await db.query(
      "UPDATE document_chunks SET embedding_json = $1 WHERE id = $2",
      [JSON.stringify(embedding), chunk.id],
    );
  }

  return chunks.rowCount ?? 0;
}

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  }),
);
app.use(express.json());

app.get("/api/health", async (_request, response) => {
  try {
    await db.query("SELECT 1");
    response.json({ status: "ok", database: "connected" });
  } catch {
    response.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.get("/api/search/classic", async (request, response) => {
  const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
  const requestedLimit = Number(request.query.limit ?? 10);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 30)
    : 10;

  if (!query) {
    response.json({ query, results: [] });
    return;
  }

  try {
    const result = await db.query(
      `WITH search_query AS (
        SELECT websearch_to_tsquery('simple'::regconfig, $1) AS value
      )
      SELECT
        d.id,
        d.title,
        d.author,
        d.document_type AS "documentType",
        d.document_year AS "documentYear",
        d.keywords,
        ROUND((ts_rank_cd(d.full_text_search, search_query.value) * 100)::numeric, 2) AS score,
        ts_headline(
          'simple'::regconfig,
          d.full_text,
          search_query.value,
          'StartSel=<mark>, StopSel=</mark>, MaxWords=34, MinWords=16, MaxFragments=2, FragmentDelimiter= … '
        ) AS snippet
      FROM documents d
      CROSS JOIN search_query
      WHERE d.full_text_search @@ search_query.value
      ORDER BY score DESC, d.created_at DESC
      LIMIT $2`,
      [query, limit],
    );

    response.json({ query, results: result.rows });
  } catch {
    response.status(500).json({ message: "Pretraga trenutno nije dostupna." });
  }
});

app.post("/api/documents/:id/embeddings", async (request, response) => {
  try {
    const document = await db.query<{ id: string }>("SELECT id FROM documents WHERE id = $1", [request.params.id]);
    if (document.rowCount === 0) {
      response.status(404).json({ message: "Dokument nije pronađen." });
      return;
    }

    const chunkCount = await generateDocumentEmbeddings(request.params.id);
    response.json({ documentId: request.params.id, embeddedChunks: chunkCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nije moguće generisati embeddings.";
    response.status(500).json({ message });
  }
});

app.get("/api/search/semantic", async (request, response) => {
  const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
  if (!query) {
    response.json({ query, results: [] });
    return;
  }

  try {
    const queryEmbedding = await createEmbedding(query);
    const chunks = await db.query<{
      documentId: string;
      title: string;
      author: string;
      documentType: string;
      documentYear: number | null;
      keywords: string[];
      content: string;
      embedding: number[];
    }>(
      `SELECT
        d.id AS "documentId", d.title, d.author,
        d.document_type AS "documentType", d.document_year AS "documentYear",
        d.keywords, c.content, c.embedding_json AS embedding
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE c.embedding_json IS NOT NULL`,
    );

    const bestMatches = new Map<string, {
      id: string; title: string; author: string; documentType: string;
      documentYear: number | null; keywords: string[]; score: number; snippet: string;
    }>();

    for (const chunk of chunks.rows) {
      const score = cosineSimilarity(queryEmbedding, chunk.embedding);
      const current = bestMatches.get(chunk.documentId);
      if (!current || score > current.score) {
        bestMatches.set(chunk.documentId, {
          id: chunk.documentId,
          title: chunk.title,
          author: chunk.author,
          documentType: chunk.documentType,
          documentYear: chunk.documentYear,
          keywords: chunk.keywords,
          score: Number((score * 100).toFixed(2)),
          snippet: chunk.content.slice(0, 300).trim(),
        });
      }
    }

    const results = [...bestMatches.values()].sort((first, second) => second.score - first.score).slice(0, 10);
    response.json({ query, results, embeddedChunks: chunks.rowCount ?? 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Semantička pretraga nije dostupna.";
    response.status(500).json({ message });
  }
});

app.get("/api/documents/:id/recommendations", async (request, response) => {
  try {
    const rows = await db.query<{
      documentId: string;
      title: string;
      author: string;
      documentType: string;
      documentYear: number | null;
      keywords: string[];
      embedding: number[];
    }>(
      `SELECT
        d.id AS "documentId", d.title, d.author,
        d.document_type AS "documentType", d.document_year AS "documentYear",
        d.keywords, c.embedding_json AS embedding
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE c.embedding_json IS NOT NULL`,
    );

    type RecommendationMetadata = {
      documentId: string;
      title: string;
      author: string;
      documentType: string;
      documentYear: number | null;
      keywords: string[];
    };
    const documentEmbeddings = new Map<string, { metadata: RecommendationMetadata; embeddings: number[][] }>();
    for (const row of rows.rows) {
      const current = documentEmbeddings.get(row.documentId);
      if (current) {
        current.embeddings.push(row.embedding);
      } else {
        const { embedding, ...metadata } = row;
        documentEmbeddings.set(row.documentId, { metadata, embeddings: [embedding] });
      }
    }

    const selected = documentEmbeddings.get(request.params.id);
    if (!selected) {
      response.status(404).json({ message: "Dokument nema generisane embeddings." });
      return;
    }

    const averageEmbedding = (embeddings: number[]) => {
      const target = selected.embeddings;
      return target.reduce((sum, vector) => sum + cosineSimilarity(embeddings, vector), 0) / target.length;
    };

    const recommendations = [...documentEmbeddings.entries()]
      .filter(([documentId]) => documentId !== request.params.id)
      .map(([id, candidate]) => ({
        id,
        title: candidate.metadata.title,
        author: candidate.metadata.author,
        documentType: candidate.metadata.documentType,
        documentYear: candidate.metadata.documentYear,
        keywords: candidate.metadata.keywords,
        score: Number((candidate.embeddings.reduce((sum, embedding) => sum + averageEmbedding(embedding), 0) / candidate.embeddings.length * 100).toFixed(2)),
      }))
      .sort((first, second) => second.score - first.score)
      .slice(0, 3);

    response.json({ documentId: request.params.id, recommendations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preporuke trenutno nisu dostupne.";
    response.status(500).json({ message });
  }
});

app.get("/api/documents", async (request, response) => {
  const requestedLimit = Number(request.query.limit ?? 20);
  const requestedOffset = Number(request.query.offset ?? 0);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 20;
  const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;

  try {
    const result = await db.query(
      `SELECT
        id,
        title,
        author,
        document_type AS "documentType",
        institution,
        faculty,
        document_year AS "documentYear",
        keywords,
        created_at AS "createdAt"
      FROM documents
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    response.json({ documents: result.rows, limit, offset });
  } catch {
    response.status(500).json({ message: "Nije moguće učitati dokumente." });
  }
});

app.get("/api/documents/:id", async (request, response) => {
  try {
    const result = await db.query(
      `SELECT
        id,
        title,
        author,
        document_type AS "documentType",
        institution,
        faculty,
        study_program AS "studyProgram",
        field_of_study AS "fieldOfStudy",
        mentor,
        defense_date AS "defenseDate",
        document_year AS "documentYear",
        language_code AS "languageCode",
        abstract_local AS "abstractLocal",
        abstract_english AS "abstractEnglish",
        keywords,
        original_file_name AS "originalFileName",
        full_text AS "fullText",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM documents
      WHERE id = $1`,
      [request.params.id],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ message: "Dokument nije pronađen." });
      return;
    }

    response.json({ document: result.rows[0] });
  } catch {
    response.status(400).json({ message: "Neispravan identifikator dokumenta." });
  }
});

app.delete("/api/documents/:id", async (request, response) => {
  try {
    const result = await db.query<{ storedFilePath: string | null }>(
      `DELETE FROM documents
       WHERE id = $1
       RETURNING stored_file_path AS "storedFilePath"`,
      [request.params.id],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ message: "Dokument nije pronađen." });
      return;
    }

    const storedFilePath = result.rows[0].storedFilePath;
    if (storedFilePath) {
      const filePath = fileURLToPath(new URL(`../${storedFilePath.replace(/^uploads[\\/]/, "uploads/")}`, import.meta.url));
      unlink(filePath, () => undefined);
    }

    response.json({ deleted: true, documentId: request.params.id });
  } catch {
    response.status(400).json({ message: "Nije moguće obrisati dokument." });
  }
});

app.post("/api/documents/:id/chunks", async (request, response) => {
  try {
    const result = await db.query<{ id: string; fullText: string }>(
      `SELECT id, full_text AS "fullText" FROM documents WHERE id = $1`,
      [request.params.id],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ message: "Dokument nije pronađen." });
      return;
    }

    const document = result.rows[0];
    const chunkCount = await saveDocumentChunks(document.id, document.fullText);
    response.json({ documentId: document.id, chunkCount });
  } catch {
    response.status(400).json({ message: "Nije moguće podijeliti dokument na cjeline." });
  }
});

app.post("/api/documents/upload", (request, response) => {
  upload.single("file")(request, response, async (uploadError) => {
    if (uploadError) {
      const message = uploadError instanceof multer.MulterError && uploadError.code === "LIMIT_FILE_SIZE"
        ? "Fajl je prevelik. Maksimalna veličina je 15 MB."
        : "Odaberite PDF ili DOCX fajl.";
      response.status(400).json({ message });
      return;
    }

    if (!request.file) {
      response.status(400).json({ message: "Odaberite PDF ili DOCX fajl za upload." });
      return;
    }

    try {
      const input = uploadInput(request.body as Record<string, unknown>);
      const title = requiredText(input.title, "title");
      const author = requiredText(input.author, "author");
      const fullText = await extractTextFromFile(request.file.path);

      if (!fullText) {
        throw new Error("Iz odabranog fajla nije moguće izdvojiti tekst.");
      }

      const result = await db.query(
        `INSERT INTO documents (
          title, author, document_type, institution, faculty, study_program,
          field_of_study, mentor, defense_date, document_year, language_code,
          abstract_local, abstract_english, keywords, original_file_name,
          stored_file_path, mime_type, file_size_bytes, full_text
        ) VALUES (
          $1, $2, COALESCE($3, 'master_rad'), $4, $5, $6,
          $7, $8, $9, $10, COALESCE($11, 'sr-Latn'),
          $12, $13, $14, $15, $16, $17, $18, $19
        )
        RETURNING id, title, author, document_type AS "documentType",
          keywords, created_at AS "createdAt"`,
        [
          title,
          author,
          optionalText(input.documentType, "documentType"),
          optionalText(input.institution, "institution"),
          optionalText(input.faculty, "faculty"),
          optionalText(input.studyProgram, "studyProgram"),
          optionalText(input.fieldOfStudy, "fieldOfStudy"),
          optionalText(input.mentor, "mentor"),
          optionalDate(input.defenseDate),
          optionalYear(input.documentYear),
          optionalText(input.languageCode, "languageCode"),
          optionalText(input.abstractLocal, "abstractLocal"),
          optionalText(input.abstractEnglish, "abstractEnglish"),
          keywords(input.keywords),
          request.file.originalname,
          `uploads/${request.file.filename}`,
          request.file.mimetype,
          request.file.size,
          fullText,
        ],
      );

      const chunkCount = await saveDocumentChunks(result.rows[0].id as string, fullText);
      const embeddedChunks = await generateDocumentEmbeddings(result.rows[0].id as string);
      response.status(201).json({
        document: result.rows[0],
        extractedCharacters: fullText.length,
        chunkCount,
        embeddedChunks,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nije moguće obraditi dokument.";
      response.status(400).json({ message });
    }
  });
});

app.post("/api/documents", async (request, response) => {
  try {
    const input = request.body as DocumentInput;
    const title = requiredText(input.title, "title");
    const author = requiredText(input.author, "author");
    const fullText = requiredText(input.fullText, "fullText");
    const result = await db.query(
      `INSERT INTO documents (
        title, author, document_type, institution, faculty, study_program,
        field_of_study, mentor, defense_date, document_year, language_code,
        abstract_local, abstract_english, keywords, original_file_name, full_text
      ) VALUES (
        $1, $2, COALESCE($3, 'master_rad'), $4, $5, $6,
        $7, $8, $9, $10, COALESCE($11, 'sr-Latn'),
        $12, $13, $14, COALESCE($15, 'manual-entry.txt'), $16
      )
      RETURNING
        id, title, author, document_type AS "documentType",
        keywords, created_at AS "createdAt"`,
      [
        title,
        author,
        optionalText(input.documentType, "documentType"),
        optionalText(input.institution, "institution"),
        optionalText(input.faculty, "faculty"),
        optionalText(input.studyProgram, "studyProgram"),
        optionalText(input.fieldOfStudy, "fieldOfStudy"),
        optionalText(input.mentor, "mentor"),
        optionalDate(input.defenseDate),
        optionalYear(input.documentYear),
        optionalText(input.languageCode, "languageCode"),
        optionalText(input.abstractLocal, "abstractLocal"),
        optionalText(input.abstractEnglish, "abstractEnglish"),
        keywords(input.keywords),
        optionalText(input.originalFileName, "originalFileName"),
        fullText,
      ],
    );

    const chunkCount = await saveDocumentChunks(result.rows[0].id as string, fullText);
    const embeddedChunks = await generateDocumentEmbeddings(result.rows[0].id as string);
    response.status(201).json({ document: result.rows[0], chunkCount, embeddedChunks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nije moguće sačuvati dokument.";
    response.status(400).json({ message });
  }
});

app.listen(port, () => {
  console.log(`API is available at http://localhost:${port}`);
});
