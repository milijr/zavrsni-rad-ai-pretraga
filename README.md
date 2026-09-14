# AI pretraga dokumenata

Web aplikacija za semantičku pretragu i preporuku dokumenata, razvijena kao dio diplomskog rada.

## Struktura

- `frontend` — React + Vite korisnički interfejs
- `backend` — Node.js + Express REST API
- `database` — PostgreSQL inicijalizacija sa `pgvector` ekstenzijom

## Pokretanje lokalno

Potrebni su Node.js (LTS) i PostgreSQL 16 (sa `pgvector` ekstenzijom).

### 1. Pripremi bazu podataka

Prvo kreiraj PostgreSQL bazu i pokreni SQL skripta za inicijalizaciju:

```powershell
# SQL skripta iz database/init/ foldera trebaju biti izvršeni
# Preporučeno je koristiti pgAdmin ili psql:
psql -U postgres -d postgres -f database\init\001_extensions.sql
psql -U postgres -d postgres -f database\init\002_document_schema.sql
psql -U postgres -d postgres -f database\init\003_local_embeddings.sql
```

ili direktno kreiraj bazu:

```powershell
createdb ai_search
psql -U postgres -d ai_search -f database\init\001_extensions.sql
psql -U postgres -d ai_search -f database\init\002_document_schema.sql
psql -U postgres -d ai_search -f database\init\003_local_embeddings.sql
```

### 2. Pokreni backend (PowerShell terminal 1)

```powershell
cd backend
Copy-Item .env.example .env
# Uredi .env sa svojim PostgreSQL kredencijalima i CONNECTION_STRING
npm install
npm run dev
```

API će biti dostupan na `http://localhost:4000`

### 3. Pokreni frontend (PowerShell terminal 2)

```powershell
cd frontend
npm install
npm run dev
```

Frontend će biti dostupan na `http://localhost:5173`. Automatski će proxy-ati API zahtjeve na `http://localhost:4000/api/*`

## Konfiguracija

Kreiraj `.env` fajl u `backend/` folderu sa sljedećim:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/ai_search
PORT=4000
CORS_ORIGIN=http://localhost:5173
```

## Razvoj

- **Backend**: `npm run dev` — pokreće TypeScript sa nodemon watcherom
- **Frontend**: `npm run dev` — pokreće Vite dev server sa HMR-om

Za build produkcije:
```powershell
# Backend
npm run build

# Frontend
npm run build
```

