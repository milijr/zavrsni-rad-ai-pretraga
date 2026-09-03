import "dotenv/config";
import cors from "cors";
import express from "express";
import { db } from "./db.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

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

app.listen(port, () => {
  console.log(`API is available at http://localhost:${port}`);
});

