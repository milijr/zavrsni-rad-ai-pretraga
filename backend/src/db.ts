import "dotenv/config";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured. Copy .env.example to .env first.");
}

export const db = new Pool({ connectionString: databaseUrl });

