import "dotenv/config";
import { mkdirSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import multer from "multer";
import { db } from "./db.js";
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

      response.status(201).json({
        document: result.rows[0],
        extractedCharacters: fullText.length,
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

    response.status(201).json({ document: result.rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nije moguće sačuvati dokument.";
    response.status(400).json({ message });
  }
});

app.listen(port, () => {
  console.log(`API is available at http://localhost:${port}`);
});
