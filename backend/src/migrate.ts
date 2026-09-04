import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";

const migrationsDirectory = fileURLToPath(
  new URL("../../database/init/", import.meta.url),
);

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/i.test(file))
    .sort();

  const applied = await db.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations",
  );
  const appliedFiles = new Set(applied.rows.map((row) => row.filename));

  for (const filename of files) {
    if (appliedFiles.has(filename)) {
      console.log(`Already applied: ${filename}`);
      continue;
    }

    const sql = await readFile(`${migrationsDirectory}/${filename}`, "utf8");
    const client = await db.connect();

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [filename],
      );
      await client.query("COMMIT");
      console.log(`Applied: ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

migrate()
  .catch((error: unknown) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
